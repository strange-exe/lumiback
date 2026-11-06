import { requireNativeView, requireOptionalNativeModule } from "expo";
import type { ComponentType } from "react";
import { Platform, View, type ViewProps } from "react-native";

/** "down": the press was refused as it began. "up": an overlay appeared mid-press, so it was cancelled. */
export type BlockedTouchPhase = "down" | "up";

export interface TouchGuardProps extends ViewProps {
  /** A tap on the wrapped control was refused because another app was drawing over the screen. */
  onBlockedTouch?: (event: { nativeEvent: { phase: BlockedTouchPhase } }) => void;
}

/** The plain stand-in: a View that never fires onBlockedTouch. */
export function PlainTouchGuard({ onBlockedTouch: _unused, ...rest }: TouchGuardProps) {
  return <View {...rest} />;
}

/**
 * The native guard exists only on Android, and only in a binary built with this module. On web,
 * in jest, or in an older binary running a newer JS update, the guard is a plain View instead, so
 * the screen still works (without the protection) rather than failing to render.
 */
export function pickTouchGuard(
  os: string,
  hasNativeModule: boolean,
  loadNative: () => ComponentType<TouchGuardProps>,
): ComponentType<TouchGuardProps> {
  if (os !== "android" || !hasNativeModule) return PlainTouchGuard;
  try {
    return loadNative();
  } catch {
    return PlainTouchGuard;
  }
}

const hasNativeModule =
  Platform.OS === "android" && requireOptionalNativeModule("TouchGuard") != null;

export const TouchGuard = pickTouchGuard(Platform.OS, hasNativeModule, () =>
  requireNativeView<TouchGuardProps>("TouchGuard"),
);

/** Whether taps are really guarded in this build (false means the plain View stand-in). */
export const touchGuardActive = TouchGuard !== PlainTouchGuard;
