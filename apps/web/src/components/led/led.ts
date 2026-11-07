/**
 * The LED board's logic, kept pure so it runs under `node --test`: its state colour, and a
 * countdown in words and in LED form. The dot font is in glyphs.ts.
 */

/** out: orange (time left); late: red ("+18 min"); in: green ("IN"). */
export type LedState = "out" | "late" | "in";

/** The CSS class that sets each state's colour (globals.css). */
export const LED_TONE: Record<LedState, string> = {
  out: "led-out",
  late: "led-late",
  in: "led-in",
};

export interface Countdown {
  state: "out" | "late";
  /** What the board shows: "1:12", "45", "+18", "+1:05". */
  text: string;
  unit: "h" | "min";
  /** The same in words, for screen readers: "1 hour 12 minutes left", "18 minutes late". */
  label: string;
}

const MAX_MINUTES = 99 * 60 + 59;

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function inWords(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return plural(rest, "minute");
  return rest === 0 ? plural(hours, "hour") : `${plural(hours, "hour")} ${plural(rest, "minute")}`;
}

/**
 * Time until the return time, rounded up to whole minutes, so "1 min" shows until the moment
 * itself. Past it, the board turns late and counts whole minutes late (rounded down, as the
 * server's late_minutes is), from "+1 min".
 */
export function countdown(msLeft: number): Countdown {
  const late = msLeft <= 0;
  const whole = late ? Math.floor(-msLeft / 60_000) : Math.ceil(msLeft / 60_000);
  const raw = Math.max(1, whole);
  const minutes = Math.min(MAX_MINUTES, raw);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const figure = hours > 0 ? `${hours}:${String(rest).padStart(2, "0")}` : String(rest);
  return {
    state: late ? "late" : "out",
    text: late ? `+${figure}` : figure,
    unit: hours > 0 ? "h" : "min",
    label: `${inWords(minutes)} ${late ? "late" : "left"}`,
  };
}
