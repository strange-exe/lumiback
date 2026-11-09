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

/**
 * The local follow-request alert, worded like the server's push (backend/app/api/codes.py). A
 * guest picks their own name, so it says they are a guest and that the emergency contact never
 * has to ask: a name can look like the contact's, the kind can't.
 */
export function followRequestNotice(viewer: { name: string; kind: "user" | "guest" }): {
  title: string;
  body: string;
} {
  if (viewer.kind === "guest") {
    return {
      title: `${viewer.name} (guest) wants to follow you`,
      body: "Joined with a code, no account. Your emergency contact never has to ask.",
    };
  }
  return {
    title: `${viewer.name} wants to follow you`,
    body: "A Lumiback student. Open Lumiback to approve or decline.",
  };
}

const ENDED: Record<string, string> = {
  expired: "Your sharing time ran out.",
  stopped_by_sharer: "Sharing was stopped from another device.",
  device_quiet: "Your phone stopped sending its location for 15 minutes.",
  tab_closed: "Sharing was stopped from the web.",
  returned: "You're back, so sharing with your emergency contact stopped.",
};

/**
 * Why a share ended, in words. Only shares that ended away from this phone reach here: stopping
 * in the app switches the location service off before telling the server.
 */
export function endedMessage(reason: string | null): string {
  return (reason ? ENDED[reason] : undefined) ?? "Your live share has ended.";
}

/**
 * Why the people following see no position: the server refuses this phone's fixes. "clock":
 * the phone's clock is ahead of the server's (it refuses times in the future).
 */
export function sendProblemNotice(problem: "clock" | "refused"): { title: string; body: string } {
  return problem === "clock"
    ? {
        title: "Your location isn't reaching Lumiback",
        body: "Your phone's clock is ahead. Turn on automatic date and time in Settings.",
      }
    : {
        title: "Your location isn't reaching Lumiback",
        body: "Lumiback can't accept this phone's location. Open the app to check your share.",
      };
}

/** Screens a tapped notification can open. "/live?view=follow": the push telling a follower
 * they were approved opens the Follow view, where the share they follow is listed. */
export type NotificationRoute =
  | "/live"
  | "/live?view=follow"
  | "/today"
  | "/history"
  | "/office/requests"
  | "/office/escalations"
  | "/office/out"
  | "/office/corrections"
  | `/office/student/${string}`;
const ROUTES: readonly string[] = [
  "/live",
  "/live?view=follow",
  "/today",
  "/history",
  "/office/requests",
  "/office/escalations",
  "/office/out",
  "/office/corrections",
] satisfies NotificationRoute[];

// "Ask the office to call me" opens that student's history: exactly one UUID, nothing after it,
// so a push can't steer the app anywhere else (the history screen checks the id again).
const STUDENT_ROUTE =
  /^\/office\/student\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * Where a tapped notification goes. A push without a known `url` opens Today rather than doing
 * nothing. The hostel office's pushes (new request, escalation, correction asked, a student
 * asking for a call) open its screens; the office screens themselves send a student who isn't
 * staff back to Today. A student's correction answered opens History, where the trip shows it.
 */
export function notificationRoute(data: unknown): NotificationRoute {
  const url = data && typeof data === "object" ? (data as { url?: unknown }).url : undefined;
  if (typeof url !== "string") return "/today";
  if (ROUTES.includes(url)) return url as NotificationRoute;
  const student = STUDENT_ROUTE.exec(url);
  return student?.[1] ? `/office/student/${student[1].toLowerCase()}` : "/today";
}

/**
 * "App updates": the developers' announcement of a new release. Its own Android channel, so
 * people can mute it in Android's settings; not one of the in-app switches below.
 */
export const APP_UPDATES_CHANNEL = "app-updates";

/** A tapped push announcing a release (data {"kind": "app-update"}, no url). */
export function isAppUpdate(data: unknown): boolean {
  return (
    data !== null && typeof data === "object" && (data as { kind?: unknown }).kind === "app-update"
  );
}

/**
 * The update announcement's buttons (wave 5): the push names this category (backend
 * UPDATE_CATEGORY, Expo `categoryId`), and the app registers it at start. Android drops ':'
 * and '-' in category ids, hence the underscore.
 */
export const APP_UPDATE_CATEGORY = "app_update";
export const APP_UPDATE_ACTIONS = [
  { identifier: "changelog", buttonTitle: "Changelog", options: { opensAppToForeground: true } },
  { identifier: "update", buttonTitle: "Update", options: { opensAppToForeground: true } },
] as const;

/** The update notice's tag (backend UPDATE_TAG): a newer notice replaces the one shown. */
export const APP_UPDATE_TAG = "lumiback-update";
// The announce form's limits (backend AnnouncementIn): a longer push isn't one we sent.
const UPDATE_TITLE_MAX = 50;
const UPDATE_BODY_MAX = 140;
const TAG = /^[A-Za-z0-9:_-]{1,64}$/;

/** The update notice the app draws itself, from a data-only push (see updateFromTask). */
export interface DrawnUpdate {
  identifier: string;
  title: string;
  body: string;
  /** The same tap data the visible push carries, so tapTarget routes both alike. */
  data: { kind?: string; url?: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clip(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  // By code point, so an emoji is never cut in half.
  return text ? Array.from(text).slice(0, max).join("") : null;
}

/**
 * A data-only update push (backend push.py `_data_only_fields`): the push itself shows
 * nothing; the app draws it. Read by the notification handler, which hides the push while
 * the app is open, because the background task draws it then too.
 */
export function isDataOnlyUpdate(data: unknown): boolean {
  return isRecord(data) && data.lumiback === APP_UPDATE_CATEGORY;
}

/**
 * What the background task should draw for what it was handed (update-task.ts). Expo hands
 * the push's data as `data.dataString`, a JSON string (lead's spike, 2026-11-09). Null for
 * anything else: a button tap (also handed to the task), another app's or an older push, bad
 * JSON, or a notice without a title and a body. The task then draws nothing.
 */
export function updateFromTask(taskData: unknown): DrawnUpdate | null {
  const payload = isRecord(taskData) ? taskData.data : undefined;
  const raw = isRecord(payload) ? payload.dataString : undefined;
  if (typeof raw !== "string") return null;
  let sent: unknown;
  try {
    sent = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(sent) || !isDataOnlyUpdate(sent)) return null;
  const title = clip(sent.title, UPDATE_TITLE_MAX);
  const body = clip(sent.body, UPDATE_BODY_MAX);
  if (!title || !body) return null;
  const data: DrawnUpdate["data"] = {};
  if (typeof sent.kind === "string") data.kind = sent.kind;
  if (typeof sent.url === "string") data.url = sent.url;
  const tag = typeof sent.tag === "string" && TAG.test(sent.tag) ? sent.tag : APP_UPDATE_TAG;
  return { identifier: tag, title, body, data };
}

/** A tap on the notification itself (expo-notifications DEFAULT_ACTION_IDENTIFIER). */
export const DEFAULT_TAP = "expo.modules.notifications.actions.DEFAULT";

export type TapTarget =
  { to: "update" } | { to: "whats-new" } | { to: "route"; route: NotificationRoute };

/**
 * Where a tapped notification (or one of its buttons) goes, by kind: an update announcement
 * checks for the update (a plain tap or Update) or opens What's new (Changelog); anything else
 * opens its own screen.
 */
export function tapTarget(data: unknown, action: string): TapTarget {
  if (isAppUpdate(data)) return action === "changelog" ? { to: "whats-new" } : { to: "update" };
  return { to: "route", route: notificationRoute(data) };
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
