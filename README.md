# Spotify playlist archiver

Automatically copy the songs from your **Discover Weekly** and **Release Radar** into archive playlists
before they disappear, since Spotify replaces both every week. Other public Spotify playlists work too,
up to their first 100 songs.

It runs as a **[Cloudflare Worker](https://developers.cloudflare.com/workers/)** on the free plan: a
daily scheduled job plus a one-page "Connect Spotify" site, with no server to manage. (It started out
on Val Town, which is shutting down.)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ilu/spotify-playlist-archiver)

- **Config without code:** each playlist is one variable with its link and archive name. Options include
  one playlist per year (`{name} Archive {year}`), a new one every week (`{name} {weekyear}-W{week}`),
  or a single playlist forever.
- **Safe to re-run:** songs already among the archive's newest 100 aren't added again, so running
  daily never doubles anything. A song that comes back weeks later is archived again, as part of that week.
- **Creates archives for you:** new archive playlists (e.g. a new year's) are created automatically.
- **Notifications:** push notifications to your phone with [ntfy](https://ntfy.sh) when a run fails
  (and optionally when songs are added), or Discord, Slack or any webhook.

## How it works

Since November 2024, Spotify doesn't let personal apps read Spotify-owned playlists (Discover Weekly,
Release Radar, editorial playlists) through its API. They just return "not found". So the playlists are
read from Spotify's public **embed player page** (`open.spotify.com/embed/playlist/…`), which shows a
playlist's first 100 songs without logging in. Writing to your archive playlists goes through the
official API, using a Spotify app you create.

To avoid adding the same songs every day, each run checks the archive's **newest 100 songs** (what one
request returns) and skips songs already there. With 30-song weekly playlists that covers about three
weeks, so a repeat from longer ago is archived again. A run takes about 3 requests per playlist, well
within the Cloudflare free plan's limit of 50 per run.

Caveats:
- **The embed page is not an official API.** If Spotify changes it, runs fail with "Couldn't find
  the track list…", you get a notification, and `readEmbedPlaylist` in `src/lib.ts` needs updating.
- **The 100-song limit.** Only a playlist's first 100 songs are visible on the embed page, and the log
  shows a warning when a playlist hits it. Discover Weekly and Release Radar have 30 songs each.
- **Public or shared playlists only.** Private playlists have no embed page. Discover Weekly and
  Release Radar work, since they can be shared by link.

## Setup (about 15 minutes)

### 1. Deploy the Worker

Either click **Deploy to Cloudflare** above (it copies this repo to your GitHub account and deploys it),
or fork this repo and in the Cloudflare dashboard go to **Workers & Pages → Create application →
Import a repository** and pick your fork. Either way, every push to `main` redeploys automatically.
If pushes don't trigger a build, connect GitHub under your Worker → **Settings → Builds** and allow
access to the repository.

The storage it needs is created automatically. Open the Worker's address (something like
`https://spotify-playlist-archiver.you.workers.dev`). It shows the **Redirect URI**: the same address
with `/callback` at the end. Copy it.

### 2. Create a Spotify app

1. Go to <https://developer.spotify.com/dashboard> and click **Create app** (or open an existing one).
2. Add the Redirect URI from step 1, and tick **Web API**.
3. Open the app's **Settings** and copy the **Client ID** and **Client secret**.

The app stays in "development mode", which is fine: only your own account uses it. Note that Spotify
requires the app's owner to have **Spotify Premium** for development-mode apps to work.

### 3. Add variables and secrets

In the Cloudflare dashboard: your Worker → **Settings → Variables and Secrets**.

| Name | Type | Value |
|---|---|---|
| `SPOTIFY_CLIENT_ID` | Secret | from your Spotify app |
| `SPOTIFY_CLIENT_SECRET` | Secret | from your Spotify app |
| `PLAYLIST_…` | Text or Secret | one per playlist, see [Playlists](#playlists) |
| `NTFY_TOPIC` | Secret | recommended, see [Notifications](#notifications) |
| `NTFY_TOKEN` | Secret | recommended with ntfy, see [Notifications](#notifications) |
| `TIME_ZONE` | Text | optional, e.g. `Europe/Helsinki` (default UTC) |

For example:
```
PLAYLIST_DISCOVER_WEEKLY = https://open.spotify.com/playlist/… | Discover Weekly Archive {year}
PLAYLIST_RELEASE_RADAR   = https://open.spotify.com/playlist/… | Release Radar Archive {year}
```

### 4. Connect

Reload the Worker's page and click **Connect Spotify**, then approve in Spotify. The page then runs
the archiver once, sends a test notification, and shows both results:
```
First run:
✓ Discover Weekly → "Discover Weekly Archive 2026": added 30 of 30
✓ Release Radar → "Release Radar Archive 2026" (new): added 30 of 30

Notifications:
✓ ntfy: test notification sent
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
playlists exactly, it keeps adding to them and skips this week's songs if they're already there.

## Notifications

Configured in `src/config.ts` under `NOTIFICATIONS`. By default, ntfy sends a push notification when a
run fails:

1. Install the free [ntfy](https://ntfy.sh) app and subscribe to a hard-to-guess topic name.
2. Add the same name as the `NTFY_TOPIC` secret on the Worker.
3. Recommended: create a free account on [ntfy.sh](https://ntfy.sh/app), go to **Account → Access tokens**,
   create a token and add it as the `NTFY_TOKEN` secret. Without a token, ntfy.sh limits messages per
   IP address, and Cloudflare's addresses are shared with many other users, so alerts could be dropped.

Connecting Spotify (or reconnecting via `/login`) also sends a test notification and shows on the
page whether it went through.

```ts
export const NOTIFICATIONS: NotificationsConfig = {
  enabled: true,                                                    // master switch
  channels: [
    { type: "ntfy", topic: env("NTFY_TOPIC"), token: env("NTFY_TOKEN"), on: ["error"] },  // add "added" for new-song pings
  ],
};
```

Events:
- `"error"`: a run failed, including a login problem.
- `"added"`: new songs were archived.

Each channel defaults to `["error"]`. Add `enabled: false` to mute a channel without deleting it.

| Type | Setup |
|---|---|
| `ntfy` | See above. Optional `server` for self-hosted ntfy, and `token` for an access token. |
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

- **The page keeps asking for the Spotify secrets after you added them**: Cloudflare saved them as a new
  version without deploying it. Click **Deploy** in the Worker's dashboard.

- **"No playlists configured"**: add at least one `PLAYLIST_…` variable (see [Playlists](#playlists)).
- **"unknown option …"**: the only option after the archive name is `public`.
- **"Not connected" / "login was revoked"**: open the Worker's page and click Connect. (When Spotify
  rejects the login, the page shows the Connect link. The old login is kept and retried daily, so
  if Spotify's rejection was a fluke, it fixes itself.)
- **"… doesn't look like a playlist link or ID"**: copy the link again via Share → Copy link.
- **A notification didn't arrive**: check the logs for "… notification failed", e.g. `NTFY_TOPIC` isn't set.
  Reconnecting via `/login` sends a test notification and shows any error on the page.
- **ntfy: "daily message quota reached"**: add an `NTFY_TOKEN` (see [Notifications](#notifications)), so
  the quota is your account's instead of Cloudflare's shared IP address.
- **"Couldn't find the track list on Spotify's embed page"**: either the playlist is private (private
  playlists have no embed page), or Spotify changed the page and `readEmbedPlaylist` in `src/lib.ts`
  needs updating.
- **Spotify login or API calls fail even though everything is set up**: check that the Spotify account
  that owns the app has Premium. Spotify requires it for apps in development mode.
- **INVALID_CLIENT: Invalid redirect URI**: the redirect URI in the Spotify app must be exactly the
  Worker's address followed by `/callback`.
