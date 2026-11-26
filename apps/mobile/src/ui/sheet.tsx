import { useEffect, useState, type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { haptic } from "@/ui/haptics";
import { T } from "@/ui/kit";
import { useReducedMotion } from "@/ui/motion";
import { dragOffset, shouldDismiss } from "@/ui/sheet-motion";
import { sheetSurface } from "@/ui/sheet-surface";
import { layout, radius, space, useColors, useIsDark } from "@/ui/theme";

// Entrances ease out (the iOS sheet curve), exits ease in and are quicker; a sheet let go
// mid-drag springs home, clamped so it never lifts off the bottom edge.
const ENTER = { duration: 300, easing: Easing.bezier(0.32, 0.72, 0, 1) };
const EXIT = { duration: 200, easing: Easing.bezier(0.4, 0, 1, 1) };
const HOME = { duration: 300, dampingRatio: 0.8, overshootClamping: true };
const FADE = { duration: 150 };

/**
 * A bottom sheet on React Native's Modal: a real native window that closes with Android's back
 * gesture, a tap on the scrim, or a drag down on its handle, and resizes for the keyboard. Used
 * for short tasks that shouldn't leave the screen (log a trip, invite someone).
 *
 * The scrim fades while the sheet slides (Reanimated, on the UI thread). Closing animates first
 * and then calls `onClose`; if the parent keeps it open (a no-op while busy), it springs back.
 * With animations turned off it only fades.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}): ReactNode {
  const c = useColors();
  const dark = useIsDark();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { height: screen } = useWindowDimensions();
  // Kept in the window after `open` turns false, until the exit animation ends.
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  // Counts closes this sheet asked its parent for (see the effect below).
  const [asked, setAsked] = useState(0);
  const y = useSharedValue(screen); // points below its resting place (off screen until it opens)
  const fade = useSharedValue(0); // the whole sheet's opacity (reduced motion)
  const height = useSharedValue(screen);
  const from = useSharedValue(0); // where the finger touched down for the current drag

  useEffect(() => {
    if (open) {
      // Slide (or fade) in from wherever it is: below the edge, or part way out if it was
      // opened again during its exit.
      if (reduced) {
        y.set(0);
        fade.set(withTiming(1, FADE));
      } else {
        fade.set(1);
        y.set(withTiming(0, ENTER));
      }
      return;
    }
    // Closed by the parent: play the exit, then leave the window.
    const done = (): void => setShown(false);
    if (reduced) {
      fade.set(withTiming(0, FADE, (ok) => ok && scheduleOnRN(done)));
    } else {
      y.set(withTiming(height.get(), EXIT, (ok) => ok && scheduleOnRN(done)));
    }
  }, [open, reduced, y, fade, height]);

  useEffect(() => {
    // After a close, a parent that accepted has closed or unmounted the sheet (which cancels
    // this); one that kept it open (busy) gets it back.
    if (asked === 0 || !open) return;
    const back = setTimeout(() => {
      y.set(withSpring(0, HOME));
      fade.set(withTiming(1, FADE));
    }, 80);
    return () => clearTimeout(back);
  }, [asked, open, y, fade]);

  /** The sheet has left the screen: tell the parent. */
  const closed = (): void => {
    setAsked((n) => n + 1);
    onClose();
  };

  /** Back gesture or scrim tap: play the exit, then close. */
  const dismiss = (): void => {
    if (reduced) {
      fade.set(withTiming(0, FADE, (ok) => ok && scheduleOnRN(closed)));
    } else {
      y.set(withTiming(height.get(), EXIT, (ok) => ok && scheduleOnRN(closed)));
    }
  };

  // Travel is measured from where the finger touched down. The pan's own translation restarts
  // when it activates, which drops everything moved before then: in a quick flick Android can
  // batch the whole movement into the activating event, leaving a translation of zero.
  const drag = Gesture.Pan()
    .enabled(!reduced)
    .activeOffsetY([-8, 8])
    .onBegin((e) => {
      from.set(e.absoluteY);
    })
    .onUpdate((e) => {
      y.set(dragOffset(e.absoluteY - from.get()));
    })
    .onEnd((e) => {
      const travel = e.absoluteY - from.get();
      if (shouldDismiss(travel, e.velocityY, height.get())) {
        scheduleOnRN(haptic.snap); // the commit, in the same frame as the sheet letting go
        const left = Math.max(0, height.get() - y.get());
        const ms = Math.min(EXIT.duration, Math.max(120, (left / Math.max(e.velocityY, 1)) * 1000));
        y.set(
          withTiming(height.get(), { ...EXIT, duration: ms }, (ok) => ok && scheduleOnRN(closed)),
        );
      } else {
        y.set(withSpring(0, { ...HOME, velocity: e.velocityY }));
      }
    });

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: reduced
      ? fade.get()
      : interpolate(y.get(), [0, Math.max(height.get(), 1)], [1, 0], "clamp"),
  }));
  const sheetStyle = useAnimatedStyle(() => ({
    opacity: reduced ? fade.get() : 1,
    transform: [{ translateY: reduced ? 0 : y.get() }],
  }));

  return (
    <Modal
      visible={shown}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={dismiss}
    >
      {/* Gestures inside an Android Modal need their own root (gesture-handler's docs). */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: "flex-end" }}>
          <Animated.View
            style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }, scrimStyle]}
          >
            <Pressable
              onPress={dismiss}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          <Animated.View
            accessibilityViewIsModal
            // Its real height: how far a drag or the exit moves it, and how the scrim fades.
            onLayout={(e) => height.set(e.nativeEvent.layout.height)}
            style={[
              {
                // Its own fill, and in dark mode a hairline top edge (sheet-surface.ts).
                ...sheetSurface(c, dark),
                borderTopLeftRadius: radius.sheet + 4,
                borderTopRightRadius: radius.sheet + 4,
                borderCurve: "continuous",
                maxHeight: "90%",
                paddingBottom: insets.bottom + space(4),
              },
              sheetStyle,
            ]}
          >
            <GestureDetector gesture={drag}>
              {/* The handle and title: the part a thumb drags down to close. */}
              <View>
                <View
                  style={{ alignItems: "center", paddingTop: space(3), paddingBottom: space(2) }}
                >
                  <View
                    style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: c.line }}
                  />
                </View>
                <View style={{ paddingHorizontal: layout.gutter, paddingTop: space(2) }}>
                  <T tone="headline" accessibilityRole="header">
                    {title}
                  </T>
                </View>
              </View>
            </GestureDetector>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                paddingHorizontal: layout.gutter,
                gap: space(5),
                paddingTop: space(5),
              }}
            >
              {children}
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}
