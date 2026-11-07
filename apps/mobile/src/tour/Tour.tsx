import * as SecureStore from "expo-secure-store";
import { router } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Modal, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/lib/auth";
import { isStaff } from "@/lib/office";
import { CURRENT } from "@/updates/changelog";
import { haptic } from "@/ui/haptics";
import { Button } from "@/ui/kit";
import { useReducedMotion } from "@/ui/motion";
import { fonts, radius, space, type, useColors } from "@/ui/theme";

import { planTour, stepText, type TourPlan } from "./steps";
import { measureTarget, placeCard, useReplays, type Rect } from "./store";

const KEY = "tour-seen";
/** Room around a highlighted control, and between it and the tip card. */
const PAD = 6;
const GAP = 14;
/** How wide the dim layer's border is: wider than any phone, so it covers the whole screen. */
const SCRIM = 2400;
/** Time for the screens under the tour to lay out before it measures them. */
const SETTLE_MS = 900;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Keeps the steps whose control is on screen right now (Today's board only shows while out). */
async function onScreen(plan: TourPlan): Promise<TourPlan | null> {
  const rects = await Promise.all(plan.steps.map((s) => measureTarget(s.target)));
  const steps = plan.steps.filter((_, i) => rects[i] !== null);
  return steps.length > 0 ? { ...plan, steps } : null;
}

async function markSeen(): Promise<void> {
  await SecureStore.setItemAsync(KEY, CURRENT.version).catch(() => undefined);
}

/**
 * The guided tour (coach marks): dims the app, cuts a lit hole around one control at a time and
 * explains it in a card. The first time someone signs in it walks through everything; after an
 * update, only what that release added or changed (steps.ts). Help can replay it. Starts once
 * `ready` (after the What's new sheet, so the two never stack).
 */
export function Tour({ ready }: { ready: boolean }): ReactNode {
  const { user } = useAuth();
  const audience = isStaff(user?.role) ? "staff" : "student";
  const replays = useReplays();
  const firstReplays = useRef(replays);
  const [plan, setPlan] = useState<TourPlan | null>(null);
  const [index, setIndex] = useState(0);

  // First sign-in or an update: decide once, when the app is ready for it.
  useEffect(() => {
    if (!ready) return;
    let live = true;
    void (async () => {
      const seen = await SecureStore.getItemAsync(KEY).catch(() => CURRENT.version);
      const wanted = planTour({ seen, current: CURRENT.version, audience });
      if (!wanted) return;
      await wait(SETTLE_MS);
      const shown = await onScreen(wanted);
      if (!live) return;
      if (shown) {
        setIndex(0);
        setPlan(shown);
      } else await markSeen();
    })();
    return () => {
      live = false;
    };
  }, [ready, audience]);

  // Help's "Take the tour again": back to Today (where every control is), then the whole tour.
  useEffect(() => {
    if (replays === firstReplays.current) return;
    let live = true;
    router.navigate("/today");
    void (async () => {
      await wait(SETTLE_MS);
      const wanted = planTour({ seen: null, current: CURRENT.version, audience, replay: true });
      const shown = wanted ? await onScreen(wanted) : null;
      if (live && shown) {
        setIndex(0);
        setPlan(shown);
      }
    })();
    return () => {
      live = false;
    };
  }, [replays, audience]);

  const finish = (): void => {
    setPlan(null);
    setIndex(0);
    void markSeen();
  };

  if (!plan) return null;
  return (
    <TourOverlay
      plan={plan}
      index={index}
      onBack={() => setIndex((i) => Math.max(0, i - 1))}
      onNext={() => {
        haptic.tap();
        if (index >= plan.steps.length - 1) finish();
        else setIndex(index + 1);
      }}
      onSkip={finish}
    />
  );
}

function TourOverlay({
  plan,
  index,
  onBack,
  onNext,
  onSkip,
}: {
  plan: TourPlan;
  index: number;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}): ReactNode {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const step = plan.steps[index]!;
  const last = index === plan.steps.length - 1;
  const [screen, setScreen] = useState({ width: 0, height: 0 });
  const [hole, setHole] = useState<Rect | null>(null);
  const [measured, setMeasured] = useState<string | null>(null);
  const [cardHeight, setCardHeight] = useState(0);
  const [enter] = useState(() => new Animated.Value(0));
  const text = stepText(step, plan.kind);

  // Find the control for this step (it can move between steps, e.g. a tab's label).
  useEffect(() => {
    let live = true;
    void measureTarget(step.target).then((rect) => {
      if (!live) return;
      setHole(
        rect
          ? {
              x: rect.x - PAD,
              y: rect.y - PAD,
              width: rect.width + PAD * 2,
              height: rect.height + PAD * 2,
            }
          : null,
      );
      setMeasured(step.id);
    });
    return () => {
      live = false;
    };
  }, [step.id, step.target]);

  // Each step: the highlight settles in with a spring, the card eases up into place.
  const ready = measured === step.id && cardHeight > 0 && screen.height > 0;
  useEffect(() => {
    if (!ready) return;
    AccessibilityInfo.announceForAccessibility(
      `${index + 1} of ${plan.steps.length}. ${step.title}. ${text}`,
    );
    if (reduced) {
      enter.setValue(1);
      return;
    }
    enter.setValue(0);
    const run = Animated.spring(enter, {
      toValue: 1,
      friction: 7,
      tension: 70,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [ready, step.id, reduced, enter, index, plan.steps.length, step.title, text]);

  const holeRadius = hole ? Math.min(hole.height / 2, radius.board + PAD) : 0;
  const top = placeCard({
    hole,
    screenHeight: screen.height,
    cardHeight,
    gap: GAP,
    top: insets.top + space(2),
    bottom: insets.bottom + space(2),
  });

  return (
    <Modal
      transparent
      visible
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onSkip}
    >
      <View
        testID="tour"
        style={{ flex: 1 }}
        onLayout={(e) =>
          setScreen({
            width: e.nativeEvent.layout.width,
            height: e.nativeEvent.layout.height,
          })
        }
      >
        {hole ? (
          <>
            {/* One view whose huge border is the dim layer: its inside is the rounded, lit hole. */}
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: hole.x - SCRIM,
                top: hole.y - SCRIM,
                width: hole.width + SCRIM * 2,
                height: hole.height + SCRIM * 2,
                borderWidth: SCRIM,
                borderRadius: holeRadius + SCRIM,
                borderColor: c.scrim,
              }}
            />
            <Animated.View
              testID="tour-ring"
              pointerEvents="none"
              style={{
                position: "absolute",
                left: hole.x,
                top: hole.y,
                width: hole.width,
                height: hole.height,
                borderRadius: holeRadius,
                borderWidth: 2,
                borderColor: c.led,
                boxShadow: `0 0 18px ${c.led}99`,
                opacity: enter,
                transform: [
                  { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [1.12, 1] }) },
                ],
              }}
            />
          </>
        ) : (
          <View
            pointerEvents="none"
            style={{ position: "absolute", inset: 0, backgroundColor: c.scrim }}
          />
        )}

        <Animated.View
          accessibilityViewIsModal
          onLayout={(e) => setCardHeight(Math.round(e.nativeEvent.layout.height))}
          style={{
            position: "absolute",
            left: space(4),
            right: space(4),
            top,
            opacity: ready ? enter : 0,
            transform: [
              { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
            ],
            backgroundColor: c.surface,
            borderRadius: radius.card,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: c.line,
            padding: space(5),
            gap: space(3),
            boxShadow: c.shadow,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
            <Text
              style={[
                type.caption,
                { color: c.accentText, fontFamily: fonts.semibold, flex: 1 },
              ]}
            >
              {plan.kind === "new" ? `New in ${CURRENT.version}` : "Quick tour"}
            </Text>
            <Text style={[type.caption, { color: c.muted, fontVariant: ["tabular-nums"] }]}>
              {index + 1} of {plan.steps.length}
            </Text>
          </View>
          <Text style={[type.headline, { color: c.ink }]} accessibilityRole="header">
            {step.title}
          </Text>
          <Text style={[type.body, { color: c.muted }]}>{text}</Text>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ flexDirection: "row", gap: space(1.5) }}
          >
            {plan.steps.map((s, i) => (
              <View
                key={s.id}
                style={{
                  height: 4,
                  flex: i === index ? 2 : 1,
                  borderRadius: 2,
                  backgroundColor: i <= index ? c.accent : c.line,
                }}
              />
            ))}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
            <Button
              label={last ? "Close" : "Skip"}
              variant="quiet"
              accessibilityLabel={last ? "Close the tour" : "Skip the tour"}
              onPress={onSkip}
              style={{ paddingHorizontal: space(3) }}
            />
            <View style={{ flex: 1 }} />
            {index > 0 ? (
              <Button
                label="Back"
                variant="secondary"
                onPress={onBack}
                style={{ paddingHorizontal: space(4) }}
              />
            ) : null}
            <Button
              label={last ? "Done" : "Next"}
              onPress={onNext}
              style={{ paddingHorizontal: space(6) }}
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
