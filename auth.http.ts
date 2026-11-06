// HTTP val: one-time "Connect Spotify" page. Stores the refresh token in Val Town blob storage.
// The page is public, so once the Spotify keys are set it only shows whether Spotify is connected,
// plus a Connect link when it isn't: no username, no redirect URI. Only Spotify accounts allowed in
// your Spotify app can connect.
import { blob } from "https://esm.town/v/std/blob/main.ts";
import { exchangeCode, SCOPES } from "./lib.ts";

const TOKEN_KEY = "spotify-archiver-token";
const STATE_KEY = "spotify-archiver-oauth-state";

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

export default async function (req: Request): Promise<Response> {
  const url = new URL(req.url);
  const redirectUri = `${url.origin}/callback`;
  const clientId = Deno.env.get("SPOTIFY_CLIENT_ID");
  const clientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    return page(`<p>Set the <code>SPOTIFY_CLIENT_ID</code> and <code>SPOTIFY_CLIENT_SECRET</code>
      environment variables on this val first.</p>
      <p>Redirect URI to register in your Spotify app: <code>${esc(redirectUri)}</code></p>`);
  }

  if (url.pathname === "/login") {
    const state = crypto.randomUUID();
    await blob.setJSON(STATE_KEY, { state, at: Date.now() });
    const auth = new URL("https://accounts.spotify.com/authorize");
    auth.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      scope: SCOPES,
      redirect_uri: redirectUri,
      state,
      show_dialog: "true",
    }).toString();
    return Response.redirect(auth.toString(), 302);
  }

  if (url.pathname === "/callback") {
    if (url.searchParams.get("error")) {
      return page(`<p>Spotify said: ${esc(url.searchParams.get("error")!)}</p><p><a href="/">Back</a></p>`, 400);
    }
    const saved = await blob.getJSON(STATE_KEY);
    await blob.delete(STATE_KEY);
    if (!saved || saved.state !== url.searchParams.get("state") || Date.now() - saved.at > 10 * 60_000) {
      return page(`<p>This login link has expired. <a href="/login">Try again</a>.</p>`, 400);
    }
    const tok = await exchangeCode(url.searchParams.get("code")!, redirectUri, clientId, clientSecret);
    const me = await (await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    })).json();
    await blob.setJSON(TOKEN_KEY, { refresh_token: tok.refresh_token, user: me.display_name || me.id });
    return page(`<p>✓ Connected as <b>${esc(me.display_name || me.id)}</b>. You can close this page.</p>`);
  }

  // Public page: shows whether Spotify is connected, but not which account. The Connect link only
  // appears when not connected; to reconnect anyway, open /login directly.
  const saved = await blob.getJSON(TOKEN_KEY);
  const connected = !!saved?.refresh_token && !saved.needsReconnect;
  return page(
    connected
      ? `<p>✓ Connected to Spotify.</p>`
      : `<p>Not connected.</p><p><a href="/login">Connect Spotify</a></p>`,
  );
}
