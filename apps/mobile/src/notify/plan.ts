/**
 * What to notify about, as pure functions (no Expo imports) so they are unit-tested.
 * notify.ts turns these plans into real notifications.
 */
import { formatTime } from "@/lib/time";

export const RETURN_SOON = "lumiback-return-soon";
export const RETURN_DUE = "lumiback-return-due";
const SOON_MS = 10 * 60_000;

export interface Reminder {
  id: typeof RETURN_SOON | typeof RETURN_DUE;
  at: Date;
  title: string;
  body: string;
}

/** Reminders for an open outing: 10 minutes before and at the planned return, future ones only. */
export function returnReminders(expectedReturnAt: string | null, now: number): Reminder[] {
  if (!expectedReturnAt) return [];
  const due = new Date(expectedReturnAt).getTime();
  const back = formatTime(expectedReturnAt);
  const all: Reminder[] = [
    {
      id: RETURN_SOON,
      at: new Date(due - SOON_MS),
      title: `Heading back? You're due at ${back}`,
      // Return times can't be extended: the reminders only say when, and what late means.
      body: "Start heading back now. Coming in after that is recorded as late.",
    },
    {
      id: RETURN_DUE,
      at: new Date(due),
      title: "You're due back now",
      body: "Tap in at the gate, or tap I'm back in Lumiback once you're in.",
    },
  ];
  return all.filter((r) => r.at.getTime() > now + 5_000);
}

/** Pending viewers we have not told the sharer about yet. */
export function newRequests<V extends { id: string; status: string }>(
  viewers: V[],
  alreadyNotified: readonly string[],
): V[] {
  const seen = new Set(alreadyNotified);
  return viewers.filter((v) => v.status === "pending" && !seen.has(v.id));
}

const ENDED: Record<string, string> = {
  expired: "Your sharing time ran out.",
  stopped_by_sharer: "Sharing was stopped from another device.",
  device_quiet: "Your phone stopped sending its location for 15 minutes.",
  tab_closed: "Sharing was stopped from the web.",
};

/**
 * Why a share ended, in words. Only shares that ended away from this phone reach here: stopping
 * in the app switches the location service off before telling the server.
 */
export function endedMessage(reason: string | null): string {
  return (reason ? ENDED[reason] : undefined) ?? "Your live share has ended.";
}

/** Screens a tapped notification can open. */
export type NotificationRoute = "/live" | "/today";
const ROUTES: readonly string[] = ["/live", "/today"] satisfies NotificationRoute[];

/**
 * Where a tapped notification goes. A push without a known `url` (e.g. the hostel office's
 * escalation alert, sent with none) opens Today rather than doing nothing.
 */
export function notificationRoute(data: unknown): NotificationRoute {
  const url = data && typeof data === "object" ? (data as { url?: unknown }).url : undefined;
  return typeof url === "string" && ROUTES.includes(url) ? (url as NotificationRoute) : "/today";
}

/** Server push channels (match the Android channels and backend PushMessage.channel). */
export type PushChannel = "follow-requests" | "return-reminders" | "share-status";

/** Channels the student switched off, sent with the push token so the server skips them. */
export function mutedChannels(prefs: {
  followRequests: boolean;
  returnReminders: boolean;
  shareStatus: boolean;
}): PushChannel[] {
  const muted: PushChannel[] = [];
  if (!prefs.followRequests) muted.push("follow-requests");
  if (!prefs.returnReminders) muted.push("return-reminders");
  if (!prefs.shareStatus) muted.push("share-status");
  return muted;
}
