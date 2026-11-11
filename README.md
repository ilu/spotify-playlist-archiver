# Spotify playlist archiver

Automatically copy the songs from any Spotify playlist into an archive playlist before they disappear.
It was made for **Discover Weekly** and **Release Radar**, which replace their songs every week, but it works
with any playlist.

It runs as a **[Cloudflare Worker](https://developers.cloudflare.com/workers/)** on the free plan: a
daily scheduled job plus a one-page "Connect Spotify" site, with no server to manage. (It started out
on Val Town, which is shutting down.)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ilu/spotify-playlist-archiver)

- **Config without code:** each playlist is one variable with its link and archive name. Options include
  one playlist per year (`{name} Archive {year}`), a new one every week (`{name} {weekyear}-W{week}`),
  or a single playlist forever.
- **Safe to re-run:** songs already in an archive are never added twice.
- **Creates archives for you:** new archive playlists (e.g. a new year's) are created automatically.
- **Notifications:** push notifications to your phone with [ntfy](https://ntfy.sh) when a run fails
  (and optionally when songs are added), or Discord, Slack or any webhook.

## How it works

Since November 2024, Spotify doesn't let personal apps read Spotify-owned playlists (Discover Weekly,
Release Radar, editorial playlists) through its API. They just return "not found". So:

| Playlist | How the songs are read |
|---|---|
| Playlists you own or collaborate on | Official Web API, all songs |
| Anything else, incl. Discover Weekly & Release Radar | Spotify's public **embed player page** (`open.spotify.com/embed/playlist/…`), first 100 songs |

Writing to your archive playlists always goes through the official API, using a Spotify app you create.

The Worker remembers which songs are already in each archive (in Cloudflare KV storage), so an existing
archive is read only once. That keeps a daily run to about 10 requests, well within the free plan's
limit of 50 outgoing requests per run.

Caveats:
- **The embed page is not an official API.** If Spotify changes it, runs fail with "Couldn't find
  the track list…", you get a notification, and `readEmbedPlaylist` in `src/lib.ts` needs updating.
- **The 100-song limit.** For long playlists you don't own, only the first 100 songs are visible,
  and the log shows a warning. Discover Weekly and Release Radar have 30 songs each.
- **Existing archives over ~3,500 songs** can't be checked on the free plan the first time. Use an
  archive name with `{year}` so each year starts fresh.

## Setup (about 15 minutes)

### 1. Deploy the Worker

Either click **Deploy to Cloudflare** above (it copies this repo to your GitHub account and deploys it),
or fork this repo and in the Cloudflare dashboard go to **Workers & Pages → Create application →
Import a repository** and pick your fork. Either way, every push to `main` redeploys automatically.

The storage it needs is created automatically. Open the Worker's address (something like
`https://spotify-playlist-archiver.you.workers.dev`). It shows the **Redirect URI**: the same address
with `/callback` at the end. Copy it.

### 2. Create a Spotify app

1. Go to <https://developer.spotify.com/dashboard> and click **Create app** (or open an existing one).
2. Add the Redirect URI from step 1, and tick **Web API**.
3. Open the app's **Settings** and copy the **Client ID** and **Client secret**.

The app stays in "development mode", which is fine: only your own account uses it.

### 3. Add variables and secrets

In the Cloudflare dashboard: your Worker → **Settings → Variables and Secrets**.

| Name | Type | Value |
|---|---|---|
| `SPOTIFY_CLIENT_ID` | Secret | from your Spotify app |
| `SPOTIFY_CLIENT_SECRET` | Secret | from your Spotify app |
| `PLAYLIST_…` | Text or Secret | one per playlist, see [Playlists](#playlists) |
| `NTFY_TOPIC` | Secret | recommended, see [Notifications](#notifications) |
| `TIME_ZONE` | Text | optional, e.g. `Europe/Helsinki` (default UTC) |

For example:
```
PLAYLIST_DISCOVER_WEEKLY = https://open.spotify.com/playlist/… | Discover Weekly Archive {year}
PLAYLIST_RELEASE_RADAR   = https://open.spotify.com/playlist/… | Release Radar Archive {year}
```

### 4. Connect

Reload the Worker's page and click **Connect Spotify**, then approve in Spotify. The page then runs
the archiver once and shows the result:
```
✓ Discover Weekly → "Discover Weekly Archive 2026": added 30 of 30
✓ Release Radar → "Release Radar Archive 2026" (new): added 30 of 30
```

From then on it runs every day at 09:00 UTC (change `triggers.crons` in `wrangler.jsonc`). Discover
Weekly updates on Mondays and Release Radar on Fridays.

The page is public, so after setup it only shows whether Spotify is connected, plus a Connect link
when it isn't: no username or redirect URI. To reconnect (or run it by hand) while it says connected,
open the page's address with `/login` at the end. Only accounts allowed in your Spotify app (in
development mode, just yours) can connect.

## Playlists

Each playlist is one variable. The name must start with `PLAYLIST_`, and the rest is up to you.
The value is the playlist link, optionally followed by `|` and the archive name, and `| public`:

```
PLAYLIST_<anything> = <playlist link> | <archive name> | public
```

| Example value | Result |
|---|---|
| `https://open.spotify.com/playlist/…` | archives into `"{name} Archive {year}"`, e.g. "Discover Weekly Archive 2026" |
| `https://open.spotify.com/playlist/… \| Release Radar Archive {year}` | one archive per year |
| `https://open.spotify.com/playlist/… \| {name} {weekyear}-W{week}` | a new archive every week |
| `https://open.spotify.com/playlist/… \| All my discoveries` | one archive forever |
| `https://open.spotify.com/playlist/… \| {name} Archive {year} \| public` | newly created archives are public |

Get a playlist's link in Spotify via ••• → Share → Copy link. Blank a variable's value to pause that
playlist, or delete the variable to remove it.

Archive name placeholders:

| Placeholder | Meaning |
|---|---|
| `{name}` | the source playlist's name |
| `{year}` | the year |
| `{month}` | the month |
| `{week}` | the ISO week |
| `{weekyear}` | the year the ISO week belongs to (use with `{week}`) |
| `{date}` | the date |

The dates use the `TIME_ZONE` variable (default UTC).

**Coming from IFTTT or the old Val Town version?** If your archive names match your existing archive
playlists exactly, it keeps adding to them and skips songs that are already there.

## Notifications

Configured in `src/config.ts` under `NOTIFICATIONS`. By default, ntfy sends a push notification when a
run fails:

1. Install the free [ntfy](https://ntfy.sh) app and subscribe to a hard-to-guess topic name.
2. Add the same name as the `NTFY_TOPIC` secret on the Worker.

```ts
export const NOTIFICATIONS: NotificationsConfig = {
  enabled: true,                                                    // master switch
  channels: [
    { type: "ntfy", topic: env("NTFY_TOPIC"), on: ["error"] },      // add "added" for new-song pings
  ],
};
```

Events:
- `"error"`: a run failed, including a login problem.
- `"added"`: new songs were archived.

Each channel defaults to `["error"]`. Add `enabled: false` to mute a channel without deleting it.

| Type | Setup |
|---|---|
| `ntfy` | See above. Optional `server` for self-hosted ntfy. |
| `discord` | Channel settings → Integrations → Webhooks → copy URL. Add it as the `DISCORD_WEBHOOK_URL` secret. |
| `slack` | Create an incoming webhook. Add its URL as the `SLACK_WEBHOOK_URL` secret. |
| `webhook` | Any URL. Receives a JSON POST: `{ event, subject, text, error, results }`. |

`env("NAME")` reads the value from the Worker's variables and secrets at send time, so secrets stay out
of the code. If a notification can't be sent, the problem is logged and the other channels still go out.

## Files

| File | Purpose |
|---|---|
| `src/index.ts` | the Worker: daily job and the Connect page |
| `src/lib.ts` | Spotify logic: reading playlists, archive names, adding songs |
| `src/notify.ts` | notification methods |
| `src/config.ts` | notification settings (optional to edit) |
| `wrangler.jsonc` | Worker name, schedule and storage |

Local development: `npm install`, then `npm run dev` (with your secrets in a `.dev.vars` file).

## Troubleshooting

Runs and errors show up in the Cloudflare dashboard: your Worker → **Observability**.

- **"No playlists configured"**: add at least one `PLAYLIST_…` variable (see [Playlists](#playlists)).
- **"unknown option …"**: the only option after the archive name is `public`.
- **"Not connected" / "login was revoked"**: open the Worker's page and click Connect. (When Spotify
  rejects the login, the page shows the Connect link. The old login is kept and retried daily, so
  if Spotify's rejection was a fluke, it fixes itself.)
- **"… doesn't look like a playlist link or ID"**: copy the link again via Share → Copy link.
- **"checking the existing archive is postponed to the next run"**: normal on a first run with several
  large existing archives. Each run checks as many as the free plan allows; the rest follow the next day.
- **A notification didn't arrive**: check the logs for "… notification failed", e.g. `NTFY_TOPIC` isn't set.
- **"Couldn't find the track list on Spotify's embed page"**: Spotify changed the page, so
  `readEmbedPlaylist` in `src/lib.ts` needs updating. For private playlists you don't own, there's no
  embed page at all.
- **INVALID_CLIENT: Invalid redirect URI**: the redirect URI in the Spotify app must be exactly the
  Worker's address followed by `/callback`.
