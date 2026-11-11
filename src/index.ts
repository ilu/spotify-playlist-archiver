// Cloudflare Worker: a daily Cron Trigger archives the playlists, and a small page handles the
// one-time "Connect Spotify" login. After a successful login it also runs the archiver once.

import { NOTIFICATIONS } from "./config.ts";
import {
  archiveAll,
  type Cache,
  exchangeCode,
  getAccessToken,
  playlistsFromEnv,
  type Result,
  SCOPES,
  type Store,
} from "./lib.ts";
import { buildMessage, formatResult, notify } from "./notify.ts";

/** The parts of Cloudflare's KV binding we use. */
type KV = {
  get(key: string, type: "json"): Promise<any>;
  put(key: string, value: string): Promise<void>;
};

export type Env = {
  STORE: KV;
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
  TIME_ZONE?: string;
  [key: string]: unknown;
};

const TOKEN_KEY = "spotify-token";
const STATE_KEY = "oauth-state";

const tokenStore = (kv: KV): Store => ({
  get: () => kv.get(TOKEN_KEY, "json"),
  set: (v) => kv.put(TOKEN_KEY, JSON.stringify(v)),
});
const cache = (kv: KV): Cache => ({
  get: (key) => kv.get(key, "json"),
  put: (key, value) => kv.put(key, JSON.stringify(value)),
});
const getEnv = (env: Env) => (name: string) => (typeof env[name] === "string" ? (env[name] as string) : undefined);

// ---------- daily job ----------

async function runArchive(env: Env): Promise<void> {
  let results: Result[] = [];
  let fatal: string | undefined;
  try {
    const token = await getAccessToken(tokenStore(env.STORE), env.SPOTIFY_CLIENT_ID ?? "", env.SPOTIFY_CLIENT_SECRET ?? "");
    results = await archiveAll(token, playlistsFromEnv(env), { timeZone: env.TIME_ZONE, cache: cache(env.STORE) });
  } catch (e: any) {
    fatal = e.message;
  }

  const msg = buildMessage(results, fatal);
  console.log(msg.text);
  for (const f of await notify(NOTIFICATIONS, msg, { getEnv: getEnv(env) })) console.error(f);

  // Mark the run as failed in Cloudflare's logs too.
  if (msg.events.has("error")) throw new Error(msg.text);
}

// ---------- Connect page ----------

const esc = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const page = (body: string, status = 200) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spotify archiver</title>
<body style="font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem">
<h1>Spotify archiver</h1>${body}</body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );

async function handleRequest(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const redirectUri = `${url.origin}/callback`;
  const clientId = env.SPOTIFY_CLIENT_ID;
  const clientSecret = env.SPOTIFY_CLIENT_SECRET;

  // The page is public, so once the Spotify keys are set it only shows whether Spotify is
  // connected, plus a Connect link when it isn't. Only accounts allowed in your Spotify app can connect.
  if (!clientId || !clientSecret) {
    return page(`<p>Add the <code>SPOTIFY_CLIENT_ID</code> and <code>SPOTIFY_CLIENT_SECRET</code>
      secrets to this Worker first.</p>
      <p>Redirect URI to register in your Spotify app: <code>${esc(redirectUri)}</code></p>`);
  }

  if (url.pathname === "/login") {
    const state = crypto.randomUUID();
    await env.STORE.put(STATE_KEY, JSON.stringify({ state, at: Date.now() }));
    const auth = new URL("https://accounts.spotify.com/authorize");
    auth.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      scope: SCOPES,
      redirect_uri: redirectUri,
      state,
      show_dialog: "true",
    }).toString();
    return new Response(null, { status: 302, headers: { Location: auth.toString() } });
  }

  if (url.pathname === "/callback") {
    if (url.searchParams.get("error")) {
      return page(`<p>Spotify said: ${esc(url.searchParams.get("error")!)}</p><p><a href="/">Back</a></p>`, 400);
    }
    const saved = await env.STORE.get(STATE_KEY, "json");
    if (!saved || saved.state !== url.searchParams.get("state") || Date.now() - saved.at > 10 * 60_000) {
      return page(`<p>This login link has expired. <a href="/login">Try again</a>.</p>`, 400);
    }
    await env.STORE.put(STATE_KEY, JSON.stringify(null));
    const tok = await exchangeCode(url.searchParams.get("code")!, redirectUri, clientId, clientSecret);
    const me = await (await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    })).json() as any;
    await tokenStore(env.STORE).set({ refresh_token: tok.refresh_token, user: me.display_name || me.id });

    // Run once right away, so you can see it working.
    let report: string;
    try {
      const results = await archiveAll(tok.access_token, playlistsFromEnv(env), {
        timeZone: env.TIME_ZONE,
        cache: cache(env.STORE),
        counter: { n: 2 }, // the token exchange and /me above
      });
      report = results.map(formatResult).join("\n");
    } catch (e: any) {
      report = `✗ ${e.message}`;
    }
    return page(`<p>✓ Connected as <b>${esc(me.display_name || me.id)}</b>.</p>
      <p>First run:</p><pre style="white-space:pre-wrap">${esc(report)}</pre>
      <p>From now on it runs every day by itself. You can close this page.</p>`);
  }

  const token = await env.STORE.get(TOKEN_KEY, "json");
  const connected = !!token?.refresh_token && !token.needsReconnect;
  return page(
    connected
      ? `<p>✓ Connected to Spotify.</p>`
      : `<p>Not connected.</p><p><a href="/login">Connect Spotify</a></p>`,
  );
}

export default {
  fetch: (req: Request, env: Env) => handleRequest(req, env),
  scheduled: (_controller: unknown, env: Env) => runArchive(env),
};
