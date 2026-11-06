// Shared logic for the Spotify archiver. No Val Town imports here, so it's easy to test.

export const SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
].join(" ");

/** A value given directly, or read from an environment variable at run time. */
export type Secret = string | { env: string };
export const env = (name: string): Secret => ({ env: name });

export function resolveSecret(value: Secret, getEnv: (name: string) => string | undefined): string | undefined {
  return typeof value === "string" ? value : getEnv(value.env)?.trim() || undefined;
}

export type PlaylistConfig = {
  /** Share link or ID of the playlist to archive. */
  playlist: string;
  /** Archive playlist name; supports {name} {year} {month} {week} {weekyear} {date}. Default "{name} Archive {year}". */
  archive?: string;
  /** Make newly created archive playlists public. Default false. */
  public?: boolean;
  /** Shown in logs, e.g. the environment variable's name. */
  label?: string;
  /** Set when the configuration itself is invalid; reported as an error for this playlist. */
  invalid?: string;
};

export const PLAYLIST_ENV_PREFIX = "PLAYLIST_";
export const NO_PLAYLISTS_MESSAGE =
  "No playlists configured. Add an environment variable per playlist, e.g. " +
  'PLAYLIST_DISCOVER_WEEKLY = "https://open.spotify.com/playlist/… | Discover Weekly Archive {year}".';

/**
 * Every environment variable named PLAYLIST_<anything> is one playlist:
 *   <link or ID>
 *   <link or ID> | <archive name>
 *   <link or ID> | <archive name> | public
 * Empty values are ignored, so blanking a variable pauses that playlist.
 */
export function playlistsFromEnv(vars: Record<string, string | undefined>): PlaylistConfig[] {
  return Object.keys(vars)
    .filter((k) => k.startsWith(PLAYLIST_ENV_PREFIX) && vars[k]?.trim())
    .sort()
    .map((label) => {
      const [playlist, archive, ...flags] = vars[label]!.split("|").map((s) => s.trim());
      const cfg: PlaylistConfig = { label, playlist, archive: archive || undefined };
      for (const flag of flags.filter(Boolean)) {
        if (flag.toLowerCase() === "public") cfg.public = true;
        else cfg.invalid = `unknown option "${flag}" (the only option is "public")`;
      }
      return cfg;
    });
}
export type Store = { get(): Promise<any>; set(v: any): Promise<void> };

const API = "https://api.spotify.com/v1";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- auth ----------

async function tokenRequest(params: Record<string, string>, clientId: string, clientSecret: string) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${clientId}:${clientSecret}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  const text = await res.text();
  if (!res.ok) {
    const err: any = new Error(`Spotify token request failed (${res.status}): ${text}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return JSON.parse(text);
}

export function exchangeCode(code: string, redirectUri: string, clientId: string, clientSecret: string) {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri }, clientId, clientSecret);
}

export async function getAccessToken(store: Store, clientId: string, clientSecret: string): Promise<string> {
  const saved = await store.get();
  if (!saved?.refresh_token) {
    throw new Error("Not connected to Spotify yet. Open the auth page and click “Connect Spotify”.");
  }
  let tok;
  try {
    tok = await tokenRequest({ grant_type: "refresh_token", refresh_token: saved.refresh_token }, clientId, clientSecret);
  } catch (e: any) {
    if (e.status === 400 && /invalid_grant/.test(e.body ?? "")) {
      // Keep the token (in case this was a fluke and it works next time), but flag it so the
      // setup page shows "Not connected" with a Connect link.
      if (!saved.needsReconnect) await store.set({ ...saved, needsReconnect: true });
      throw new Error("Spotify login was revoked or expired. Open the auth page and connect again.");
    }
    throw e;
  }
  const refreshToken = tok.refresh_token || saved.refresh_token;
  if (refreshToken !== saved.refresh_token || saved.needsReconnect) {
    await store.set({ ...saved, refresh_token: refreshToken, needsReconnect: false });
  }
  return tok.access_token;
}

// ---------- reading Spotify-owned playlists via the public embed page ----------
// The embed page lists at most this many tracks.
export const EMBED_TRACK_LIMIT = 100;

export async function readEmbedPlaylist(id: string): Promise<{ name: string; uris: string[] }> {
  const res = await fetch(`https://open.spotify.com/embed/playlist/${id}`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      "Accept-Language": "en",
    },
  });
  if (!res.ok) throw new Error(`Embed page for playlist ${id} returned ${res.status}`);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  const entity = m && JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity;
  if (!entity || !Array.isArray(entity.trackList)) {
    throw new Error("Couldn't find the track list on Spotify's embed page. Spotify may have changed the page.");
  }
  const uris = entity.trackList
    .map((t: any) => t?.uri)
    .filter((u: any) => typeof u === "string" && u.startsWith("spotify:track:"));
  return { name: entity.name ?? "", uris: [...new Set<string>(uris)] };
}

export function parsePlaylistId(s: string): string {
  const m = String(s).match(/playlist[/:]([A-Za-z0-9]+)/);
  return m ? m[1] : String(s).trim();
}

// ---------- official Web API (only touches playlists you own) ----------

function makeApi(token: string) {
  return async function api(method: string, path: string, body?: unknown): Promise<any> {
    const url = path.startsWith("http") ? path : API + path;
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 429 || res.status >= 500) {
        const wait = Number(res.headers.get("retry-after") || 2 ** attempt);
        await sleep(Math.min(wait, 30) * 1000);
        continue;
      }
      const text = await res.text();
      if (!res.ok) {
        const err: any = new Error(`${method} ${url} → ${res.status}: ${text}`);
        err.status = res.status;
        throw err;
      }
      return text ? JSON.parse(text) : null;
    }
    throw new Error(`${method} ${url} kept failing after retries`);
  };
}
type Api = ReturnType<typeof makeApi>;

// Spotify renamed /tracks → /items in 2026; try the new path, fall back to the old.
async function withFallback<T>(primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try {
    return await primary();
  } catch (e: any) {
    if ([403, 404, 405].includes(e.status)) return await fallback();
    throw e;
  }
}

async function getAll(api: Api, path: string): Promise<any[]> {
  const out: any[] = [];
  let next: string | null = path;
  while (next) {
    const page: any = await api("GET", next);
    out.push(...(page.items || []));
    next = page.next;
  }
  return out;
}

async function getOwnPlaylistUris(api: Api, playlistId: string): Promise<string[]> {
  const items = await withFallback(
    () => getAll(api, `/playlists/${playlistId}/items?limit=100`),
    () => getAll(api, `/playlists/${playlistId}/tracks?limit=100`),
  );
  return items
    .map((it) => (it.item ?? it.track)?.uri)
    .filter((u) => typeof u === "string" && u.startsWith("spotify:track:"));
}

function createPlaylist(api: Api, me: any, name: string, isPublic: boolean) {
  const body = { name, public: isPublic, description: "Automatically archived by a Val Town script" };
  return withFallback(
    () => api("POST", `/me/playlists`, body),
    () => api("POST", `/users/${encodeURIComponent(me.id)}/playlists`, body),
  );
}

async function addTracks(api: Api, playlistId: string, uris: string[]) {
  for (let i = 0; i < uris.length; i += 100) {
    const chunk = uris.slice(i, i + 100);
    await withFallback(
      () => api("POST", `/playlists/${playlistId}/items`, { uris: chunk }),
      () => api("POST", `/playlists/${playlistId}/tracks`, { uris: chunk }),
    );
  }
}

// ---------- reading any playlist ----------

// Playlists you own or collaborate on are read through the official API (no track limit).
// Anything else (incl. Discover Weekly / Release Radar) falls back to the embed page.
async function readSource(api: Api, id: string): Promise<{ name: string; uris: string[]; via: "api" | "embed" }> {
  try {
    const meta = await api("GET", `/playlists/${id}?fields=name`);
    const uris = [...new Set(await getOwnPlaylistUris(api, id))];
    if (meta?.name && uris.length > 0) return { name: meta.name, uris, via: "api" };
  } catch (e: any) {
    if (![401, 403, 404].includes(e.status)) throw e;
  }
  return { ...(await readEmbedPlaylist(id)), via: "embed" };
}

// ---------- archive names ----------

export function dateParts(now: Date, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  // ISO week number of the local calendar date
  const d = new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const week = Math.ceil(((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  return {
    year: p.year,
    month: p.month,
    week: String(week).padStart(2, "0"),
    weekyear: String(d.getUTCFullYear()),
    date: `${p.year}-${p.month}-${p.day}`,
  };
}

export function archiveName(template: string, name: string, parts: ReturnType<typeof dateParts>): string {
  const values: Record<string, string> = { name, ...parts };
  return template.replace(/\{(name|year|month|weekyear|week|date)\}/g, (_, k) => values[k]);
}

// ---------- main ----------

export type Result = {
  /** The configured playlist: its label (env var name) or link. */
  playlist: string;
  name?: string;
  archive?: string;
  created?: boolean;
  inSource?: number;
  added?: number;
  warning?: string;
  error?: string;
};

export async function archiveAll(
  token: string,
  playlists: PlaylistConfig[],
  opts: { timeZone?: string; now?: Date } = {},
): Promise<Result[]> {
  if (!playlists.length) throw new Error(NO_PLAYLISTS_MESSAGE);
  const timeZone = opts.timeZone || "UTC";
  let parts: ReturnType<typeof dateParts>;
  try {
    parts = dateParts(opts.now ?? new Date(), timeZone);
  } catch {
    throw new Error(`TIME_ZONE "${timeZone}" isn't a valid time zone. Use a name like "Europe/Helsinki".`);
  }
  const api = makeApi(token);
  const me = await api("GET", "/me");
  const myPlaylists = await getAll(api, "/me/playlists?limit=50");
  const results: Result[] = [];

  for (const cfg of playlists) {
    const r: Result = { playlist: cfg.label ?? cfg.playlist };
    results.push(r);
    try {
      if (cfg.invalid) throw new Error(cfg.invalid);
      const sourceId = parsePlaylistId(cfg.playlist);
      if (!/^[A-Za-z0-9]{22}$/.test(sourceId)) {
        throw new Error(`"${cfg.playlist}" doesn't look like a playlist link or ID.`);
      }

      const src = await readSource(api, sourceId);
      r.name = src.name;
      r.inSource = src.uris.length;
      if (src.via === "embed" && src.uris.length >= EMBED_TRACK_LIMIT) {
        r.warning = `only the first ${EMBED_TRACK_LIMIT} tracks are visible for playlists you don't own`;
      }

      const name = archiveName(cfg.archive ?? "{name} Archive {year}", src.name, parts);
      r.archive = name;
      let target = myPlaylists.find((p) => p?.name === name && p.owner?.id === me.id);
      if (target?.id === sourceId) throw new Error(`The archive name "${name}" is the source playlist itself.`);
      if (src.uris.length === 0) {
        r.added = 0;
        continue;
      }

      r.created = false;
      if (!target) {
        target = await createPlaylist(api, me, name, cfg.public ?? false);
        myPlaylists.push(target);
        r.created = true;
      }

      const existing = new Set(r.created ? [] : await getOwnPlaylistUris(api, target.id));
      const toAdd = src.uris.filter((u) => !existing.has(u));
      await addTracks(api, target.id, toAdd);
      r.added = toAdd.length;
    } catch (e: any) {
      r.error = e.message;
    }
  }
  return results;
}
