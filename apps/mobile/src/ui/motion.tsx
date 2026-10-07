import { useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, type StyleProp, type ViewStyle } from "react-native";

/**
 * Motion with React Native's built-in Animated on the native driver: enough for a press and an
 * entrance, without a native animation library to build. Everything honours Android's
 * "Remove animations" setting.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => sub.remove();
  }, []);
  return reduced;
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
