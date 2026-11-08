/**
 * What the starting screen says while the launch check waits for the server, and the short
 * hand-off it plays once the server has answered. On the free hosting plan the server sleeps
 * when nobody uses it and takes up to about a minute to wake, so after a few seconds the screen
 * says why it is taking long. Pure, so the wording and the timings are tested.
 */

/** How long a normal start takes before the screen explains a slow one. */
export const SLOW_AFTER_MS = 5_000;

/**
 * A launch check that took at least this long had to wait for a sleeping server: the hand-off
 * then says the server started. A quicker one found it awake, so it only says welcome back.
 */
export const WOKE_AFTER_MS = 1_500;

export function startingLines(elapsedMs: number): { title: string; detail: string | null } {
  if (elapsedMs < SLOW_AFTER_MS) return { title: "Starting", detail: null };
  return {
    title: "Waking the server",
    detail:
      "It sleeps after a quiet spell and takes up to a minute to start. This screen moves on by itself.",
  };
}

/** "0:07", "1:02": how long the student has waited, shown once a start is slow. */
export function waitedLabel(elapsedMs: number): string {
  const s = Math.max(0, Math.floor(elapsedMs / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** How the launch check ended (the auth status it settled on). */
export type StartOutcome = "signedIn" | "signedOut" | "offline";

export interface HandoffStep {
  line: string;
  /** How long the line stays before the next one (or the exit). */
  holdMs: number;
}

/** The first word of a name, for "Welcome back, Riya". Empty or blank: no name. */
export function firstName(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? first : null;
}

/**
 * The lines the screen plays between the server answering and the app opening. Every line is
 * true when it shows: the server answered, the stored session was accepted, the student is in.
 * Offline has none (the "Can't reach Lumiback" screen takes over), and a refused session only
 * says the server started before the sign-in form.
 */
export function handoffSteps(
  outcome: StartOutcome,
  waitedMs: number,
  name: string | null,
): HandoffStep[] {
  const woke = waitedMs >= WOKE_AFTER_MS;
  const started: HandoffStep = { line: "Server started", holdMs: 650 };
  if (outcome === "offline") return [];
  if (outcome === "signedOut") return woke ? [started] : [];
  const first = firstName(name);
  const welcome: HandoffStep = {
    line: first ? `Welcome back, ${first}` : "Welcome back",
    holdMs: 800,
  };
  return woke ? [started, { line: "Signing you in", holdMs: 650 }, welcome] : [welcome];
}
