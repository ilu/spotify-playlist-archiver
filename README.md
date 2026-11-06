# Spotify playlist archiver

Automatically copy the songs from any Spotify playlist into an archive playlist before they disappear.
It was made for **Discover Weekly** and **Release Radar**, which replace their songs every week, but it works
with any playlist.

**It runs on [Val Town](https://www.val.town)**, a free platform for small TypeScript jobs: a daily cron
job plus a one-page web endpoint, with no server to manage. It isn't a standalone app; to use it, remix
the val (or fork this repo and deploy it to your own val, see [Deploying from GitHub](#deploying-from-github)).

**Val:** [ilu/spotify-playlist-archiver](https://www.val.town/x/ilu/spotify-playlist-archiver) ·
**Source:** [github.com/ilu/spotify-playlist-archiver](https://github.com/ilu/spotify-playlist-archiver)

- **Config without code:** each playlist is one environment variable with its link and archive name.
  Options include one playlist per year (`{name} Archive {year}`), a new one every week
  (`{name} {weekyear}-W{week}`), or a single playlist forever.
- **Safe to re-run:** songs already in an archive are never added twice. Run it daily and it catches up
  if a run fails.
- **Creates archives for you:** new archive playlists (e.g. a new year's) are created automatically.
- **Notifications:** get an email when a run fails (works out of the box), or switch on push
  notifications (ntfy), Discord, Slack or any webhook, for failures and/or new songs.

## How it works

Since November 2024, Spotify doesn't let personal apps read Spotify-owned playlists (Discover Weekly,
Release Radar, editorial playlists) through its API. They just return "not found". So:

| Playlist | How the songs are read |
|---|---|
| Playlists you own or collaborate on | Official Web API, all songs |
| Anything else, incl. Discover Weekly & Release Radar | Spotify's public **embed player page** (`open.spotify.com/embed/playlist/…`), first 100 songs |

Writing to your archive playlists always goes through the official API, using a Spotify app you create.

Caveats:
- **The embed page is not an official API.** If Spotify changes it, runs fail with "Couldn't find
  the track list…", you get an email, and `readEmbedPlaylist` in `lib.ts` needs updating.
- **The 100-song limit.** For long playlists you don't own, only the first 100 songs are visible,
  and the log shows a warning. Discover Weekly and Release Radar have 30 songs each.

## Files

| File | Val Town trigger | Purpose |
|---|---|---|
| `config.ts` | none | notification settings (optional to edit) |
| `archive.cron.ts` | **Cron** (daily) | runs the archiving |
| `auth.http.ts` | **HTTP** | one-time "Connect Spotify" page |
| `lib.ts` | none | shared logic |
| `notify.ts` | none | notification methods |

## Setup (about 15 minutes)

### 1. Create the val

1. [Remix the val on Val Town](https://www.val.town/x/ilu/spotify-playlist-archiver), or create a new val with the files above.
   - Set `auth.http.ts` to the **HTTP** trigger.
   - Set `archive.cron.ts` to the **Cron** trigger.
2. Open the HTTP file's URL (something like `https://you--abc123.web.val.run`). Until the Spotify keys
   are set, it shows the **Redirect URI**: the same address with `/callback` at the end. Copy it.

### 2. Create a Spotify app

1. Go to <https://developer.spotify.com/dashboard> and click **Create app**.
2. Fill it in:
   - Name / description: anything.
   - Redirect URI: paste the URI from step 1.2.
   - API: tick **Web API**.
3. Open the app's **Settings** and copy the **Client ID** and **Client secret**.

The app stays in "development mode", which is fine: only your own account uses it.

### 3. Set environment variables and connect

1. In Val Town, open the val's settings and add these environment variables:

   | Variable | Value |
   |---|---|
   | `SPOTIFY_CLIENT_ID` | from your Spotify app |
   | `SPOTIFY_CLIENT_SECRET` | from your Spotify app |
   | `PLAYLIST_…` | one per playlist, see [Playlists](#playlists) |
   | `TIME_ZONE` | optional, e.g. `Europe/Helsinki` (default UTC) |

   For example:
   ```
   PLAYLIST_DISCOVER_WEEKLY = https://open.spotify.com/playlist/… | Discover Weekly Archive {year}
   PLAYLIST_RELEASE_RADAR   = https://open.spotify.com/playlist/… | Release Radar Archive {year}
   ```
2. Reload the HTTP page and click **Connect Spotify**, then approve in Spotify.

The page is public, so after setup it only shows whether Spotify is connected, plus a Connect link
when it isn't: no username or redirect URI. To reconnect while it says connected, open the page's
address with `/login` at the end. Only accounts allowed in your Spotify app (in development mode, just yours) can connect.

Your secret, login token and playlists stay in your own Val Town account. Environment variables
and blob storage are not copied when someone remixes the val.

### 4. Test and schedule

1. Click **Run** on `archive.cron.ts`. The log shows something like:
   ```
   ✓ Discover Weekly → "Discover Weekly Archive 2026": added 30 of 30
   ✓ Release Radar → "Release Radar Archive 2026" (new): added 30 of 30
   ```
2. Set the cron schedule to daily, e.g. `0 9 * * *` (Val Town crons run in UTC). Discover Weekly
   updates on Mondays and Release Radar on Fridays.

## Playlists

Each playlist is one environment variable. The name must start with `PLAYLIST_`, and the rest is up to you.
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

**Coming from IFTTT?** If your archive names match your existing IFTTT playlists exactly, the script
keeps adding to them and skips songs that are already there.

## Notifications

Configured in `config.ts` under `NOTIFICATIONS`:

```ts
export const NOTIFICATIONS: NotificationsConfig = {
  enabled: true,                                   // master switch
  channels: [
    { type: "email", on: ["error"] },              // built in: emails your Val Town address
    { type: "ntfy", topic: env("NTFY_TOPIC"), on: ["error", "added"] },
  ],
};
```

Events:
- `"error"`: a run failed, including a login problem.
- `"added"`: new songs were archived.

Each channel defaults to `["error"]`. Add `enabled: false` to mute a channel without deleting it.

| Type | Setup |
|---|---|
| `email` | Nothing. Uses Val Town's built-in email to your own account. |
| `ntfy` | Install the free [ntfy](https://ntfy.sh) app and subscribe to a hard-to-guess topic name. Set it as `NTFY_TOPIC`. Optional `server` for self-hosted ntfy. |
| `discord` | Channel settings → Integrations → Webhooks → copy URL. Set it as `DISCORD_WEBHOOK_URL`. |
| `slack` | Create an incoming webhook. Set its URL as `SLACK_WEBHOOK_URL`. |
| `webhook` | Any URL. Receives a JSON POST: `{ event, subject, text, error, results }`. |

`env("NAME")` reads the value from the val's environment variables at send time. That keeps webhook URLs
and topics out of the code, so they aren't copied when someone remixes the val. A plain string works too.
If a notification can't be sent, the problem is logged and the other channels still go out.

## Deploying from GitHub

To keep your copy in GitHub instead of editing it on Val Town, `.github/workflows/deploy.yml` deploys
the repo to a val on every push to `main`:

1. Remix the val (or create one with the same files and triggers), and fork this repo.
2. In your fork's `.github/workflows/deploy.yml`, set `VAL` to your val, e.g. `you/spotify-playlist-archiver`.
3. Create an API token at [val.town/settings/api](https://www.val.town/settings/api) with
   **val: read and write** and **user: read**, and add it to the fork as the repository secret
   `VAL_TOWN_API_KEY` (Settings → Secrets and variables → Actions).
4. Push to `main`, or run the workflow from the **Actions** tab.

GitHub is then the source of truth: edits made in Val Town's web editor are overwritten by the next
deploy. Environment variables, the Spotify connection and the cron schedule aren't files, so deploys
never touch them.

## Troubleshooting

- **"No playlists configured"**: add at least one `PLAYLIST_…` environment variable (see [Playlists](#playlists)).
- **"unknown option …"**: the only option after the archive name is `public`.
- **"Not connected" / "login was revoked"**: open the HTTP page and click Connect. (When Spotify
  rejects the login, the page shows the Connect link. The old login is kept and retried daily, so
  if Spotify's rejection was a fluke, it fixes itself.)
- **"… doesn't look like a playlist link or ID"**: copy the link again via Share → Copy link.
- **A notification didn't arrive**: check the run's log for "… notification failed", e.g. an
  environment variable that isn't set.
- **"Couldn't find the track list on Spotify's embed page"**: Spotify changed the page, so
  `readEmbedPlaylist` in `lib.ts` needs updating. For private playlists you don't own, there's no
  embed page at all.
- **INVALID_CLIENT: Invalid redirect URI**: the redirect URI in the Spotify app must be exactly the
  HTTP page's address followed by `/callback`.
