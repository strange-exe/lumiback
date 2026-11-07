import { useSyncExternalStore } from "react";
import type { View } from "react-native";

import type { TargetId } from "./steps";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The on-screen controls the tour can point at, registered by the screens that draw them. */
const targets = new Map<TargetId, View>();

const refs = new Map<TargetId, (node: View | null) => void>();

/**
 * A ref callback for a control the tour points at (the same function every render, so React
 * doesn't re-attach it). Put it on a View that isn't collapsed away.
 */
export function tourTarget(id: TargetId): (node: View | null) => void {
  let ref = refs.get(id);
  if (!ref) {
    ref = (node: View | null) => {
      if (node) targets.set(id, node);
      else targets.delete(id);
    };
    refs.set(id, ref);
  }
  return ref;
}

/** Where a control is on screen, or null when it isn't drawn (another tab, or not out). */
export function measureTarget(id: TargetId): Promise<Rect | null> {
  const node = targets.get(id);
  if (!node) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      node.measureInWindow((x, y, width, height) => {
        resolve(width > 0 && height > 0 ? { x, y, width, height } : null);
      });
    } catch {
      resolve(null);
    }
  });
}

/** Help's "Take the tour again": a counter the tour watches. */
let replays = 0;
const listeners = new Set<() => void>();

export function replayTour(): void {
  replays += 1;
  listeners.forEach((l) => l());
}

export function useReplays(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => replays,
  );
}

/** Where the tip card goes: under the highlight when it fits, otherwise above it. */
export function placeCard({
  hole,
  screenHeight,
  cardHeight,
  gap,
  top,
  bottom,
}: {
  hole: Rect | null;
  screenHeight: number;
  cardHeight: number;
  gap: number;
  /** Space kept clear at the top and bottom (status bar, navigation bar). */
  top: number;
  bottom: number;
}): number {
  if (!hole) return Math.max(top, (screenHeight - cardHeight) / 2);
  const below = hole.y + hole.height + gap;
  if (below + cardHeight <= screenHeight - bottom) return below;
  const above = hole.y - gap - cardHeight;
  if (above >= top) return above;
  // Neither fits (a very tall highlight): overlap the highlight's top part, inside the screen.
  return Math.min(Math.max(top, below), screenHeight - bottom - cardHeight);
}
