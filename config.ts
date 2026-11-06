// Settings for the Spotify playlist archiver.
//
// PLAYLISTS are configured as environment variables on the val, one per playlist,
// so nothing personal lives in the code:
//
//   Name:  PLAYLIST_<anything>, e.g. PLAYLIST_DISCOVER_WEEKLY
//   Value: <playlist link> | <archive name> | public
//            link          Share link or ID (in Spotify: ••• → Share → Copy link)
//            archive name  Optional. Default "{name} Archive {year}". Placeholders:
//                            {name}     the source playlist's name, e.g. "Discover Weekly"
//                            {year}     2026            {month}  01–12
//                            {week}     ISO week 01–53  {date}   2026-11-06
//                            {weekyear} the year the ISO week belongs to (use with {week})
//            public        Optional. Make the archive playlist public when it's created.
//
//   Examples:
//     PLAYLIST_DISCOVER_WEEKLY = https://open.spotify.com/playlist/… | Discover Weekly Archive {year}
//     PLAYLIST_RELEASE_RADAR   = https://open.spotify.com/playlist/… | {name} {weekyear}-W{week}
//     PLAYLIST_FAVOURITES      = https://open.spotify.com/playlist/…
//
//   Blank a variable's value to pause that playlist.
//
// TIME_ZONE (optional environment variable) sets the time zone for the date placeholders,
// e.g. "Europe/Helsinki". Default: UTC.

import { env, type NotificationsConfig } from "./notify.ts";

// ---------- Notifications ----------
//
//   enabled   Master switch for all notifications.
//   channels  Where to send them. Each channel takes:
//               on       which events: "error" (a run failed) and/or "added" (new songs archived).
//                        Default: ["error"]
//               enabled  false turns a channel off without deleting it.
//
// Secrets like webhook URLs: use env("NAME") and add NAME as an environment variable on the val,
// so the secret isn't in the code (and isn't copied when someone remixes the val).

export const NOTIFICATIONS: NotificationsConfig = {
  enabled: true,
  channels: [
    // Email to your Val Town account's address. Works out of the box.
    { type: "email", on: ["error"] },

    // Push notifications to your phone with the free ntfy app (https://ntfy.sh).
    // Subscribe to a hard-to-guess topic name in the app and put the same name in NTFY_TOPIC.
    // { type: "ntfy", topic: env("NTFY_TOPIC"), on: ["error", "added"] },

    // Discord / Slack incoming webhooks.
    // { type: "discord", url: env("DISCORD_WEBHOOK_URL"), on: ["error"] },
    // { type: "slack", url: env("SLACK_WEBHOOK_URL"), on: ["error"] },

    // Any URL; receives a JSON POST: { event, subject, text, error, results }.
    // { type: "webhook", url: env("WEBHOOK_URL"), on: ["error", "added"] },
  ],
};
