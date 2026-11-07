/**
 * A 5x7 dot-matrix font for the LED board, the classic panel grid: each glyph is seven rows of
 * "1" (lit) and "0" (unlit). Narrow marks (":") are one column wide. Characters without a glyph
 * render as a blank cell; the figure's accessible name never depends on the dots.
 * Kept identical to the app's apps/mobile/src/lib/glyphs.ts.
 */

export const ROWS = 7;

const GLYPHS: Record<string, readonly string[]> = {
  "0": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  ":": ["0", "0", "1", "0", "1", "0", "0"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  " ": ["000", "000", "000", "000", "000", "000", "000"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "10001", "11001", "10101", "10011", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
};

const BLANK: readonly string[] = Array.from({ length: ROWS }, () => "00000");

export interface LedChar {
  /** First column of this character on the panel. */
  x: number;
  width: number;
  colon: boolean;
  /** Lit dots as [column, row], column relative to the panel. */
  dots: [number, number][];
}

export interface LedLayout {
  /** Panel width in dot columns; the panel is always ROWS tall. */
  columns: number;
  chars: LedChar[];
}

/** Lays a figure out on the panel: one unlit column between characters, like a real board. */
export function layout(text: string): LedLayout {
  const chars: LedChar[] = [];
  let x = 0;
  for (const ch of text.toUpperCase()) {
    const rows = GLYPHS[ch] ?? BLANK;
    const width = (rows[0] ?? "").length;
    const dots: [number, number][] = [];
    rows.forEach((row, y) => {
      for (let col = 0; col < width; col += 1) if (row[col] === "1") dots.push([x + col, y]);
    });
    chars.push({ x, width, colon: ch === ":", dots });
    x += width + 1;
  }
  return { columns: Math.max(0, x - 1), chars };
}

/** True when every character of `text` has a glyph (others show blank). */
export function hasGlyphs(text: string): boolean {
  return [...text.toUpperCase()].every((ch) => ch in GLYPHS);
}
