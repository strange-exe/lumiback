import { useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, type StyleProp, type ViewStyle } from "react-native";

/**
 * Motion with React Native's built-in Animated on the native driver: enough for a press and an
 * entrance, without a native animation library to build. Everything honours Android's
 * "Remove animations" setting.
 */
export function useReducedMotion(): boolean {
  return useMotionSetting() === true;
}

/**
 * The same setting, but null until Android has answered. Endless loops (the LED blink, the scan
 * band) wait for a false here, so they never start for someone who turned animations off.
 */
export function useMotionSetting(): boolean | null {
  const [reduced, setReduced] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (live) setReduced(value);
      })
      .catch(() => {
        if (live) setReduced(false);
      });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/**
 * Runs an endless animation only while motion is allowed (and `enabled`); stops it when the
 * setting changes. It restarts when `key` changes (e.g. a measured width).
 */
export function useLoop(
  make: () => Animated.CompositeAnimation,
  reset: () => void,
  enabled = true,
  key?: unknown,
): void {
  const reduced = useMotionSetting();
  const run = reduced === false && enabled;
  useEffect(() => {
    if (!run) {
      reset();
      return;
    }
    const animation = make();
    animation.start();
    return () => {
      animation.stop();
      reset();
    };
    // make/reset are recreated each render; the loop restarts only when these change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, key]);
}

/** Fades and lifts its content in once, on mount (220 ms). */
export function FadeIn({
  children,
  style,
  delay = 0,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  delay?: number;
}): ReactNode {
  const reduced = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    Animated.timing(progress, {
      toValue: 1,
      duration: 220,
      delay,
      easing: Easing.out(Easing.cubic), // entrances ease out
      useNativeDriver: true,
    }).start();
  }, [progress, reduced, delay]);
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  return (
    <Animated.View style={[style, { opacity: progress, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}
