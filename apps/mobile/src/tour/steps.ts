import { compareVersions } from "@/updates/changelog";

/** The controls a tour step can point at. Each one registers itself with useTourTarget. */
export type TargetId =
  | "today-board"
  | "scan"
  | "tab-today"
  | "tab-live"
  | "tab-history"
  | "tab-profile";

export type Audience = "student" | "staff";

export interface TourStep {
  id: string;
  target: TargetId;
  audience: Audience;
  /** The release this control arrived in, or last changed in a way worth showing. */
  since: string;
  title: string;
  /** What the control does, for the first-run tour. */
  body: string;
  /** What changed, for the after-update tour. Without it, the body is shown there too. */
  changed?: string;
}

/**
 * The tour, in order. Copy says only what the app really does. When a release adds or changes
 * a control, add or update its step with that release as `since`: phones updating to it get a
 * short tour of just those steps.
 */
export const STEPS: readonly TourStep[] = [
  {
    id: "board",
    target: "today-board",
    audience: "student",
    since: "1.13.0",
    title: "Your trip at a glance",
    body: "While you're out, this board counts down to your back-by time. The glowing dot on the line is you. If you're late, it turns red and counts how late.",
    changed:
      "The board now shows your trip as a line from when you left to your back-by time, with a dot for now.",
  },
  {
    id: "scan",
    target: "scan",
    audience: "student",
    since: "1.13.0",
    title: "Scan at the gate",
    body: "Tap here and scan the screen at the hostel gate to tap out, and again to tap back in. The scan checks you're at the gate, so your trip shows as verified.",
    changed: "Scan has its own button now, next to the bar, so it's always one tap away.",
  },
  {
    id: "today",
    target: "tab-today",
    audience: "student",
    since: "1.0.0",
    title: "Today",
    body: "Today's outing hours, your trip while you're out, and on days that need approval, your request to the hostel office.",
  },
  {
    id: "live",
    target: "tab-live",
    audience: "student",
    since: "1.0.0",
    title: "Live",
    body: "Share your location with a friend on your way back, or follow someone who sent you a code. Only people you approve can see you.",
  },
  {
    id: "history",
    target: "tab-history",
    audience: "student",
    since: "1.13.0",
    title: "History",
    body: "Every outing on one line: when you left, when you got back, and whether you were on time. If one is wrong, use Something wrong? on it to ask the hostel office to fix it.",
    changed: "History now lists each outing on one line, with its times on the left.",
  },
  {
    id: "profile",
    target: "tab-profile",
    audience: "student",
    since: "1.0.0",
    title: "Profile",
    body: "Notifications, appearance, the devices signed in to your account, your password, and help. You can take this tour again from Help.",
  },
  {
    id: "office",
    target: "tab-today",
    audience: "staff",
    since: "1.0.0",
    title: "Your office",
    body: "Who's out and who's late, outing requests to decide, and corrections to review, for the hostels you look after.",
  },
  {
    id: "staff-profile",
    target: "tab-profile",
    audience: "staff",
    since: "1.0.0",
    title: "Profile",
    body: "Notifications, appearance, the devices signed in to your account, your password, and help. You can take this tour again from Help.",
  },
];

export interface TourPlan {
  /** "welcome": the whole tour, the first time. "new": only what this update added or changed. */
  kind: "welcome" | "new";
  steps: TourStep[];
}

/**
 * Which tour to run. `seen` is the app version the last tour was shown for (null: never). A
 * phone that has never had a tour gets all of it; after an update, only the steps that release
 * added or changed; otherwise none. `replay` (from Help) always gives the whole tour.
 */
export function planTour({
  seen,
  current,
  audience,
  replay = false,
}: {
  seen: string | null;
  current: string;
  audience: Audience;
  replay?: boolean;
}): TourPlan | null {
  const mine = STEPS.filter((s) => s.audience === audience);
  if (replay || seen === null) return mine.length > 0 ? { kind: "welcome", steps: mine } : null;
  if (compareVersions(current, seen) <= 0) return null;
  const fresh = mine.filter(
    (s) => compareVersions(s.since, seen) > 0 && compareVersions(s.since, current) <= 0,
  );
  return fresh.length > 0 ? { kind: "new", steps: fresh } : null;
}

/** The words a step shows in a given tour. */
export function stepText(step: TourStep, kind: TourPlan["kind"]): string {
  return kind === "new" && step.changed ? step.changed : step.body;
}
