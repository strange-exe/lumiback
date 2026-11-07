/** What an LED board shows, and how it says it in words for TalkBack. */

/** Out = led orange, late = red, in (back on campus) = green. */
export type LedState = "out" | "late" | "in";

export interface LedReading {
  /** The lit characters, e.g. "1:12", "+18", "IN". */
  text: string;
  state: LedState;
  /** A short word beside the figure ("left", "min late"), in the UI font. */
  unit?: string;
  /** The figure in words, for screen readers. */
  label: string;
}

/** "1 hour 12 minutes", "45 minutes", "1 minute", "2 hours". */
export function spokenMinutes(total: number): string {
  const minutes = Math.max(0, Math.round(total));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h === 0 ? "" : `${h} ${h === 1 ? "hour" : "hours"}`;
  const mins = m === 0 && h > 0 ? "" : `${m} ${m === 1 ? "minute" : "minutes"}`;
  return [hours, mins].filter(Boolean).join(" ");
}

/** Hours and minutes as an LED clock: 72 -> "1:12", 5 -> "0:05". */
export function clockOf(total: number): string {
  const minutes = Math.max(0, Math.round(total));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** "32" + "min", or "1:32" + "h": minutes alone under an hour, hours and minutes from one. */
function figureOf(minutes: number): { text: string; unit: "min" | "h" } {
  return minutes < 60 ? { text: String(minutes), unit: "min" } : { text: clockOf(minutes), unit: "h" };
}

/** Counting down to the back-by time: "32 min left", "1:32 h left". */
export function timeLeft(minutesLeft: number): LedReading {
  const left = Math.max(0, Math.round(minutesLeft));
  const { text, unit } = figureOf(left);
  return { text, state: "out", unit: `${unit} left`, label: `${spokenMinutes(left)} left` };
}

/** Past the back-by time: "+18 min late", then "+1:05 h late". */
export function timeLate(minutesLate: number): LedReading {
  const late = Math.max(1, Math.round(minutesLate));
  const { text, unit } = figureOf(late);
  return { text: `+${text}`, state: "late", unit: `${unit} late`, label: `${spokenMinutes(late)} late` };
}

/** On campus. */
export const IN: LedReading = { text: "IN", state: "in", label: "In, on campus" };
