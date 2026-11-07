import { compareVersions } from "../../lib/version.ts";

/**
 * The controls a tour step can point at. Each one carries `data-tour="<id>"` on the real
 * element (a nav link, the status board), so the tour finds it in the page.
 */
export type TargetId =
  | "status"
  | "checkout"
  | "nav-history"
  | "nav-share"
  | "nav-account"
  | "register-board"
  | "nav-requests"
  | "nav-corrections"
  | "nav-escalations"
  | "nav-people"
  | "tour-replay";

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
 * The website's tour, in order (the app's is apps/mobile/src/tour/steps.ts). Copy says only
 * what the site really does. When a release adds or changes a control, add or update its step
 * with that release as `since`: people who saw an earlier tour get a short one of just those.
 */
export const STEPS: readonly TourStep[] = [
  {
    id: "status",
    target: "status",
    audience: "student",
    since: "1.13.0",
    title: "Your status",
    body: "This board says whether you're in or out. While you're out, it counts down to your back-by time. If you're late, it turns red and counts how late.",
    changed:
      "Your status is now on a dark board with a dot-matrix countdown, like the boards at a station.",
  },
  {
    id: "checkout",
    target: "checkout",
    audience: "student",
    since: "1.0.0",
    title: "Check out",
    body: "Not tapping out at the gate? Check out here before you leave. Your hostel's rules set your return time, and it can't be changed once you're out.",
  },
  {
    id: "history",
    target: "nav-history",
    audience: "student",
    since: "1.13.0",
    title: "History",
    body: "Every outing on one line: when you left, when you got back, and whether you were on time. If one is wrong, use Something wrong? on it to ask the hostel office to fix it.",
    changed: "History now lists each outing on one line, with its times on the left.",
  },
  {
    id: "share",
    target: "nav-share",
    audience: "student",
    since: "1.0.0",
    title: "Share",
    body: "Share your location with a friend on your way back, or follow someone who sent you a code. Only people you approve can see you.",
  },
  {
    id: "account",
    target: "nav-account",
    audience: "student",
    since: "1.14.0",
    title: "Account",
    body: "Your details and emergency contact, your password, the devices signed in to your account, and a copy of your data. You can take this tour again from there.",
    changed: "Account has Take the tour again, so you can see this tour any time.",
  },
  {
    id: "register",
    target: "register-board",
    audience: "staff",
    since: "1.13.0",
    title: "The register",
    body: "Who's out now, who's late, and today's gate scans, updated every 30 seconds. Below it are everyone who's out and everyone who was late today, and you can correct a return from there.",
    changed: "The register's counts are now on a dark board with dot-matrix figures, like the app.",
  },
  {
    id: "requests",
    target: "nav-requests",
    audience: "staff",
    since: "1.0.0",
    title: "Requests",
    body: "On days that need approval, students send an outing request. Approve or decline it here. Once approved, they can go out once that day.",
  },
  {
    id: "corrections",
    target: "nav-corrections",
    audience: "staff",
    since: "1.0.0",
    title: "Corrections",
    body: "Students ask here when they forgot to tap in or tapped by mistake. Nothing changes until you approve. Returns the gate never saw are listed here too.",
  },
  {
    id: "escalations",
    target: "nav-escalations",
    audience: "staff",
    since: "1.0.0",
    title: "Escalations",
    body: "Students 30 minutes late who didn't answer the are-you-OK alert. Call them or their emergency contact, then mark it as handled.",
  },
  {
    id: "people",
    target: "nav-people",
    audience: "staff",
    since: "1.0.0",
    title: "People",
    body: "Find a student and their contacts. Correct a name, roll no. or phone, or turn an account off when someone leaves.",
  },
  {
    id: "staff-tour",
    target: "tour-replay",
    audience: "staff",
    since: "1.14.0",
    title: "This tour",
    body: "Take this tour again any time from here.",
  },
];

export interface TourPlan {
  /** "welcome": the whole tour, the first time. "new": only what this update added or changed. */
  kind: "welcome" | "new";
  steps: TourStep[];
}

/**
 * Which tour to run. `seen` is the version the last tour was shown for (null: never). Someone
 * who has never had a tour gets all of it; after an update, only the steps that release added
 * or changed; otherwise none. `replay` (Take the tour again) always gives the whole tour.
 */
export function planTour({
  seen,
  current,
  audience,
  replay = false,
  steps = STEPS,
}: {
  seen: string | null;
  current: string;
  audience: Audience;
  replay?: boolean;
  steps?: readonly TourStep[];
}): TourPlan | null {
  const mine = steps.filter((s) => s.audience === audience);
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

/** The card's small heading: "Quick tour", or "New in 1.14.0" after an update. */
export function tourLabel(kind: TourPlan["kind"], current: string): string {
  return kind === "new" ? `New in ${current}` : "Quick tour";
}
