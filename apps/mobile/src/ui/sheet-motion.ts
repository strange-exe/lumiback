/**
 * The bottom sheet's drag rules, as plain functions so they can be tested and called from the
 * gesture on the UI thread (hence 'worklet').
 */

/** Points per second downward that count as a flick. */
const FLICK = 800;
/** Share of the sheet's height that a slow drag must cover. */
const SHARE = 0.3;
/** ...but never less than this many points, so a short sheet still needs a real drag. */
const FLOOR = 80;
/** How far the sheet may be pulled up past its resting place. */
const UP_LIMIT = 24;

/** Close after a drag? A downward flick, or a slow drag far enough down; never a flick back up. */
export function shouldDismiss(translation: number, velocity: number, height: number): boolean {
  "worklet";
  if (velocity < -FLICK / 2) return false; // flung back up: the person changed their mind
  if (velocity > FLICK && translation > 0) return true;
  return translation > Math.max(FLOOR, height * SHARE);
}

/** Where the sheet sits for a finger `translation` points down: 1:1 down, resisting up. */
export function dragOffset(translation: number): number {
  "worklet";
  if (translation >= 0) return translation;
  // Rubber band: the further up, the less it gives, approaching UP_LIMIT.
  const pulled = -translation;
  return -UP_LIMIT * (1 - 1 / (pulled / UP_LIMIT / 2 + 1));
}
