/** Where the tour's highlight and card go. Pure, so `node --test` can check the math. */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Room kept around a highlighted control, inside the lit hole. */
export const PAD = 6;
/** Space between the hole and the card. */
export const GAP = 12;
/** Space kept clear at the viewport's edges. */
export const EDGE = 16;
/** The card's widest size. */
export const CARD_MAX = 384;

/**
 * The lit hole around a control: its box plus PAD on every side, clipped to the viewport, so
 * a control that runs past an edge never pushes the ring off screen. Null when no part of it
 * is in view.
 */
export function holeFor(target: Rect, viewport: { width: number; height: number }): Rect | null {
  const left = Math.max(0, target.x - PAD);
  const top = Math.max(0, target.y - PAD);
  const right = Math.min(viewport.width, target.x + target.width + PAD);
  const bottom = Math.min(viewport.height, target.y + target.height + PAD);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The hole's corner radius: rounded like a control, never more than half its height. */
export function holeRadius(hole: Rect): number {
  return Math.min(hole.height / 2, 20);
}

/**
 * The card's top edge: under the hole when it fits, otherwise above it. Neither fits (a very
 * tall highlight): it overlaps the hole, still inside the viewport. No hole: centred.
 */
export function placeCardTop({
  hole,
  viewportHeight,
  cardHeight,
  gap = GAP,
  edge = EDGE,
}: {
  hole: Rect | null;
  viewportHeight: number;
  cardHeight: number;
  gap?: number;
  edge?: number;
}): number {
  const lowest = Math.max(edge, viewportHeight - edge - cardHeight);
  if (!hole) return Math.min(lowest, Math.max(edge, (viewportHeight - cardHeight) / 2));
  const below = hole.y + hole.height + gap;
  if (below + cardHeight <= viewportHeight - edge) return below;
  const above = hole.y - gap - cardHeight;
  if (above >= edge) return above;
  return Math.min(Math.max(edge, below), lowest);
}

/**
 * The card's left edge and width: as wide as CARD_MAX allows, lined up with the hole's left
 * edge where it fits, and always inside the viewport with EDGE to spare on both sides.
 */
export function placeCardX({
  hole,
  viewportWidth,
  max = CARD_MAX,
  edge = EDGE,
}: {
  hole: Rect | null;
  viewportWidth: number;
  max?: number;
  edge?: number;
}): { left: number; width: number } {
  const width = Math.max(0, Math.min(max, viewportWidth - edge * 2));
  const rightmost = viewportWidth - edge - width;
  const wanted = hole ? hole.x : (viewportWidth - width) / 2;
  return { left: Math.max(edge, Math.min(wanted, rightmost)), width };
}
