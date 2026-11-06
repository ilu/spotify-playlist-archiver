// Cron val: run once a day. Copies every playlist configured in PLAYLIST_* environment variables
// into its archive.
import { blob } from "https://esm.town/v/std/blob/main.ts";
import { email } from "https://esm.town/v/std/email";
import { NOTIFICATIONS } from "./config.ts";
import { archiveAll, getAccessToken, playlistsFromEnv, type Result } from "./lib.ts";
import { buildMessage, notify } from "./notify.ts";

const TOKEN_KEY = "spotify-archiver-token";
const store = { get: () => blob.getJSON(TOKEN_KEY), set: (v: any) => blob.setJSON(TOKEN_KEY, v) };

export default async function () {
  let results: Result[] = [];
  let fatal: string | undefined;
  try {
    const token = await getAccessToken(
      store,
      Deno.env.get("SPOTIFY_CLIENT_ID")!,
      Deno.env.get("SPOTIFY_CLIENT_SECRET")!,
    );
    const vars = Deno.env.toObject();
    results = await archiveAll(token, playlistsFromEnv(vars), { timeZone: vars.TIME_ZONE });
  } catch (e: any) {
    fatal = e.message;
  }

  const msg = buildMessage(results, fatal);
  console.log(msg.text);

  const failures = await notify(NOTIFICATIONS, msg, {
    sendEmail: (m) => email(m),
    getEnv: (name) => Deno.env.get(name),
  });
  for (const f of failures) console.error(f);

  // Mark the run as failed in Val Town too.
  if (msg.events.has("error")) throw new Error(msg.text);
}
