// Notifications: email (Val Town built-in), ntfy, Discord, Slack or any webhook.
// No Val Town imports here; the email sender is passed in, so this is easy to test.

import { env, resolveSecret, type Result, type Secret } from "./lib.ts";

export { env };

export type NotifyEvent = "error" | "added";

type ChannelBase = {
  /** Turn this channel off without deleting it. Default true. */
  enabled?: boolean;
  /** Which events to send. "error" = a run failed, "added" = new songs were archived. Default ["error"]. */
  on?: NotifyEvent[];
};

export type Channel =
  | (ChannelBase & { type: "email" })
  | (ChannelBase & { type: "ntfy"; topic: Secret; server?: string })
  | (ChannelBase & { type: "discord" | "slack" | "webhook"; url: Secret });

export type NotificationsConfig = { enabled: boolean; channels: Channel[] };

export type Message = {
  events: Set<NotifyEvent>;
  subject: string;
  text: string;
  results: Result[];
  error?: string;
};

export type Deps = {
  sendEmail: (m: { subject: string; text: string }) => Promise<unknown>;
  getEnv: (name: string) => string | undefined;
};

export function formatResult(r: Result): string {
  const label = r.name ?? r.playlist;
  if (r.error) return `✗ ${label}: ${r.error}`;
  return `✓ ${label} → "${r.archive}"${r.created ? " (new)" : ""}: added ${r.added} of ${r.inSource}` +
    (r.warning ? ` ⚠ ${r.warning}` : "");
}

export function buildMessage(results: Result[], fatal?: string): Message {
  const events = new Set<NotifyEvent>();
  const failed = !!fatal || results.some((r) => r.error);
  const added = results.reduce((n, r) => n + (r.added ?? 0), 0);
  if (failed) events.add("error");
  if (added > 0) events.add("added");

  const lines = results.map(formatResult);
  if (fatal) lines.unshift(`✗ Run failed: ${fatal}`);
  // Plain ASCII subjects: ntfy sends them as an HTTP header.
  const subject = failed
    ? "Spotify archiver failed"
    : `Spotify archiver: ${added} new song${added === 1 ? "" : "s"} archived`;
  return { events, subject, text: lines.join("\n") || "Nothing to do.", results, error: fatal };
}

function resolve(value: Secret, deps: Deps): string {
  const v = resolveSecret(value, deps.getEnv);
  if (!v) throw new Error(`environment variable ${typeof value === "string" ? "" : value.env} is not set`);
  return v;
}

async function post(url: string, body: string, headers: Record<string, string>) {
  const res = await fetch(url, { method: "POST", headers, body });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
}

async function send(ch: Channel, msg: Message, deps: Deps) {
  const json = { "Content-Type": "application/json" };
  switch (ch.type) {
    case "email":
      return void await deps.sendEmail({ subject: msg.subject, text: msg.text });
    case "ntfy": {
      const server = (ch.server ?? "https://ntfy.sh").replace(/\/$/, "");
      return post(`${server}/${encodeURIComponent(resolve(ch.topic, deps))}`, msg.text, {
        Title: msg.subject,
        Tags: msg.events.has("error") ? "warning" : "musical_note",
        Priority: msg.events.has("error") ? "high" : "default",
      });
    }
    case "discord":
      return post(resolve(ch.url, deps), JSON.stringify({ content: `**${msg.subject}**\n${msg.text}`.slice(0, 1990) }), json);
    case "slack":
      return post(resolve(ch.url, deps), JSON.stringify({ text: `*${msg.subject}*\n${msg.text}` }), json);
    case "webhook":
      return post(resolve(ch.url, deps), JSON.stringify({
        event: msg.events.has("error") ? "error" : "added",
        subject: msg.subject,
        text: msg.text,
        error: msg.error,
        results: msg.results,
      }), json);
    default:
      throw new Error(`unknown channel type "${(ch as any).type}"`);
  }
}

/** Sends the message to every enabled channel that wants one of its events. Never throws; returns failures. */
export async function notify(cfg: NotificationsConfig, msg: Message, deps: Deps): Promise<string[]> {
  const failures: string[] = [];
  if (!cfg.enabled) return failures;
  for (const ch of cfg.channels) {
    if (ch.enabled === false) continue;
    const on = ch.on ?? ["error"];
    if (!on.some((e) => msg.events.has(e))) continue;
    try {
      await send(ch, msg, deps);
    } catch (e: any) {
      failures.push(`${ch.type} notification failed: ${e.message}`);
    }
  }
  return failures;
}
