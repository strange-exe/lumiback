import type { Colors } from "@/ui/theme";

/** A bottom sheet's own fill and edge. */
export type SheetSurface =
  | { backgroundColor: string }
  | { backgroundColor: string; borderTopWidth: number; borderColor: string };

/**
 * How a bottom sheet stands apart from the page behind it (owner, 2026-11-26). In light mode the
 * scrim darkens the page, so the sheet keeps the page colour. In dark mode a dark scrim over a
 * dark page leaves no edge, so the sheet takes the raised surface fill plus a 1 px hairline
 * along its top (the rounded corners carry it round).
 */
export function sheetSurface(c: Colors, dark: boolean): SheetSurface {
  return dark
    ? { backgroundColor: c.surface, borderTopWidth: 1, borderColor: c.line }
    : { backgroundColor: c.page };
}
