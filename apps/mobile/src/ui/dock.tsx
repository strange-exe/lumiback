import Ionicons from "@expo/vector-icons/Ionicons";
import { router, Tabs } from "expo-router";
import { useState, type ComponentProps, type ReactNode } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { scanParams } from "@/gate/intent";
import { useAuth } from "@/lib/auth";
import { isStaff } from "@/lib/office";
import type { TargetId } from "@/tour/steps";
import { tourTarget } from "@/tour/store";
import { Glass, sceneTarget } from "@/ui/glass";
import { haptic } from "@/ui/haptics";
import { Press } from "@/ui/kit";
import { useLoop } from "@/ui/motion";
import { dock, fonts, useColors } from "@/ui/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];
/** The props a custom tab bar receives, taken from Tabs itself (the type is not exported). */
type DockProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

/** Tab route name → icon pair (outline when idle, filled when active) and label. */
const TABS: Record<string, { label: string; icon: IconName; active: IconName }> = {
  today: { label: "Today", icon: "home-outline", active: "home" },
  live: { label: "Live", icon: "navigate-outline", active: "navigate" },
  history: { label: "History", icon: "time-outline", active: "time" },
  profile: { label: "Profile", icon: "person-outline", active: "person" },
};
const STAFF_TABS = ["today", "profile"];

const ITEM = dock.height - 12;
/** An idle tab is its icon alone, never narrower than a 44 dp touch target. */
const TAB = 44;
/** The dock's distance from the screen edges, and the pill's inner padding. */
const SIDE = 16;
const PAD = 6;
/** Scan with its ring, and the gap the tabs leave for it in the middle of the pill. */
export const SCAN_SIZE = dock.scan + dock.ring * 2;
export const CENTRE_GAP = SCAN_SIZE + 12;
/** How far Scan's ring rises above the pill's top edge. */
const RAISE = dock.rise + dock.ring;
/** Tab names grow with the font size setting up to this much; the dock has no room beyond it. */
const LABEL_SCALE = 1.3;
/** Scan's glyph: a QR code inside the scanner's corner brackets, and the line that sweeps it. */
const GLYPH = 30;
const QR = 14;
const LINE = 3;
/** The two fading bands of the line's trail, above it: [height, opacity], nearest first. */
const TRAIL = [
  [4, 0.32],
  [5, 0.12],
] as const;
/**
 * Scan's loop, as a real scanner reads: the line fades in at the top and passes down once
 * (eased at both ends), fades out at the bottom while the QR code pops (a spring with a slight
 * overshoot: "read"), jumps back to the top unseen, then everything rests. Entrances ease out,
 * exits ease in, nothing is linear (owner's animation brief).
 */
export const SCAN_MOTION = {
  fadeIn: 160,
  fadeInEasing: Easing.out(Easing.cubic),
  pass: 1100,
  passEasing: Easing.inOut(Easing.cubic),
  fadeOut: 180,
  fadeOutEasing: Easing.in(Easing.cubic),
  popIn: 120,
  rest: 2400,
} as const;
/** How much the QR code grows at the pop's peak. */
const POP_SCALE = 1.08;

/** The loop itself. `native` is false only in tests, where jest has no native driver. */
export function scanLoop(
  v: { beam: Animated.Value; shown: Animated.Value; pop: Animated.Value },
  native = true,
): Animated.CompositeAnimation {
  const m = SCAN_MOTION;
  return Animated.loop(
    Animated.sequence([
      Animated.parallel([
        Animated.timing(v.shown, {
          toValue: 1,
          duration: m.fadeIn,
          easing: m.fadeInEasing,
          useNativeDriver: native,
        }),
        Animated.timing(v.beam, {
          toValue: 1,
          duration: m.pass,
          easing: m.passEasing,
          useNativeDriver: native,
        }),
      ]),
      Animated.parallel([
        Animated.timing(v.shown, {
          toValue: 0,
          duration: m.fadeOut,
          easing: m.fadeOutEasing,
          useNativeDriver: native,
        }),
        Animated.sequence([
          Animated.timing(v.pop, {
            toValue: 1,
            duration: m.popIn,
            easing: m.fadeInEasing,
            useNativeDriver: native,
          }),
          Animated.spring(v.pop, {
            toValue: 0,
            speed: 14,
            bounciness: 6,
            restDisplacementThreshold: 0.005,
            restSpeedThreshold: 0.005,
            useNativeDriver: native,
          }),
        ]),
      ]),
      // Back to the top while hidden, so the line never travels up in view.
      Animated.timing(v.beam, { toValue: 0, duration: 0, useNativeDriver: native }),
      Animated.delay(m.rest),
    ]),
  );
}

/**
 * Floating glass dock: the four destinations in one smoked-glass pill, two each side, and Scan
 * (tap in/out at the gate) as a raised accent button in the middle. Scan is an action, not a tab
 * (HIG: tab bars navigate), so it is a button outside the tab list. It opens the full-screen
 * scanner (src/app/scan.tsx) from any tab. Staff have no Scan: a compact two-tab pill.
 */
export function Dock({ state, navigation }: DockProps): ReactNode {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const staff = isStaff(user?.role);
  const active = state.routes[state.index];
  const target = sceneTarget(active?.key ?? "");

  // Every tab shows its name (an icon alone is a guess): students' four tabs put it under the
  // icon, which fits in half the pill on a 360 dp phone; staff's two put it beside.
  const item = (name: string, look: "under" | "staff"): ReactNode => {
    const tab = TABS[name];
    const route = state.routes.find((r) => r.name === name);
    if (!tab || !route) return null;
    const focused = active?.name === name;
    const under = look === "under";
    const color = focused ? c.onDock : c.dockMuted;
    return (
      <Pressable
        key={name}
        ref={tourTarget(`tab-${name}` as TargetId)}
        onPress={() => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            haptic.tap();
            navigation.navigate(route.name, route.params);
          }
        }}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={tab.label}
        style={{
          // Students' tabs share their half of the pill: an idle tab takes what the active
          // one leaves, so its touch area is as wide as the room allows.
          flexGrow: look === "staff" ? 0 : 1,
          minWidth: TAB,
          height: ITEM,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Never flattened: Android drops an idle (transparent) chip, and the view it rebuilds
            when the tab lights up loses its radius, drawing a square block. */}
        <View
          collapsable={false}
          style={{
            height: ITEM,
            minWidth: TAB,
            paddingHorizontal: under ? 4 : 16,
            borderRadius: ITEM / 2,
            borderCurve: "continuous",
            flexDirection: under ? "column" : "row",
            alignItems: "center",
            justifyContent: "center",
            gap: under ? 1 : 6,
            backgroundColor: focused ? c.dockActive : "transparent",
          }}
        >
          <Ionicons name={focused ? tab.active : tab.icon} size={22} color={color} />
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={LABEL_SCALE}
            // A large font setting on a narrow phone shrinks the name to fit, never cuts it.
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            style={{
              fontFamily: focused ? fonts.semibold : fonts.medium,
              fontSize: under ? 12 : 13,
              lineHeight: under ? 16 : undefined,
              color,
            }}
          >
            {tab.label}
          </Text>
        </View>
      </Pressable>
    );
  };

  if (staff) {
    // Staff don't go out through the app: no Scan, Live or History, just their office (Today)
    // and Profile, in a compact pill in the middle (two tabs across the width read as empty).
    return (
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          left: SIDE,
          right: SIDE,
          bottom: insets.bottom + dock.lift,
          alignItems: "center",
        }}
      >
        <Glass target={target} radius={dock.height / 2}>
          <View
            accessibilityRole="tablist"
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              height: dock.height,
              paddingHorizontal: PAD,
            }}
          >
            {STAFF_TABS.map((name) => item(name, "staff"))}
          </View>
        </Glass>
      </View>
    );
  }

  const half = (names: string[]): ReactNode => (
    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 2 }}>
      {names.map((name) => item(name, "under"))}
    </View>
  );
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: SIDE,
        right: SIDE,
        bottom: insets.bottom + dock.lift,
        // Tall enough to hold Scan where it rises above the pill, so all of it takes touches.
        height: dock.height + RAISE,
      }}
    >
      <Glass
        target={target}
        radius={dock.height / 2}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: dock.height }}
      >
        <View
          accessibilityRole="tablist"
          style={{
            flexDirection: "row",
            alignItems: "center",
            height: dock.height,
            paddingHorizontal: PAD,
          }}
        >
          {half(["today", "live"])}
          <View style={{ width: CENTRE_GAP }} />
          {half(["history", "profile"])}
        </View>
      </Glass>
      <View
        pointerEvents="box-none"
        style={{ position: "absolute", top: 0, left: 0, right: 0, alignItems: "center" }}
      >
        <ScanButton />
      </View>
    </View>
  );
}

/**
 * Scan: an accent circle in a page-coloured ring, so it reads apart from what scrolls behind.
 * Its glyph is a QR code in the scanner's corner brackets. A scan line with a fading trail
 * passes down through it once, the code pops as if read, then it rests (SCAN_MOTION), so the
 * button reads as "scan" before anyone taps it. Pressing it squeezes slightly (Press). With
 * Android animations off the line never shows and the code stays still.
 */
function ScanButton(): ReactNode {
  const c = useColors();
  const [beam] = useState(() => new Animated.Value(0)); // 0 top of the brackets, 1 bottom
  const [shown] = useState(() => new Animated.Value(0));
  const [pop] = useState(() => new Animated.Value(0)); // 0 still, 1 the pop's peak
  useLoop(
    () => scanLoop({ beam, shown, pop }),
    () => {
      beam.setValue(0);
      shown.setValue(0);
      pop.setValue(0);
    },
  );
  return (
    <View ref={tourTarget("scan")} collapsable={false}>
      <Press
        onPress={() => {
          haptic.tap();
          // Today's safe-return box, if it is ticked, travels as an in-memory intent.
          const params = scanParams();
          router.push(params.intent ? { pathname: "/scan", params } : "/scan");
        }}
        accessibilityLabel="Scan at the gate"
        style={{
          width: SCAN_SIZE,
          height: SCAN_SIZE,
          borderRadius: SCAN_SIZE / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: c.page,
          boxShadow: c.scanShadow,
        }}
      >
        <View
          style={{
            width: dock.scan,
            height: dock.scan,
            borderRadius: dock.scan / 2,
            alignItems: "center",
            justifyContent: "center",
            // Scan's own colour per theme; its glyph, light or dark, passes 3:1 (theme.ts).
            backgroundColor: c.scan,
          }}
        >
          <View
            style={{ width: GLYPH, height: GLYPH, alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="scan" size={GLYPH} color={c.onScan} style={{ position: "absolute" }} />
            <Animated.View
              style={{
                transform: [
                  { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [1, POP_SCALE] }) },
                ],
              }}
            >
              <Ionicons name="qr-code" size={QR} color={c.onScan} />
            </Animated.View>
            <Animated.View
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{
                position: "absolute",
                top: 0,
                left: 2,
                right: 2,
                height: LINE,
                borderRadius: LINE / 2,
                backgroundColor: c.onScan,
                opacity: shown,
                transform: [
                  {
                    translateY: beam.interpolate({
                      inputRange: [0, 1],
                      outputRange: [3, GLYPH - LINE - 3],
                    }),
                  },
                ],
              }}
            >
              {/* The trail: the line only ever moves down, so it fades out behind, above it. */}
              {TRAIL.map(([height, opacity], i) => (
                <View
                  key={i}
                  style={{
                    position: "absolute",
                    left: 1,
                    right: 1,
                    bottom: LINE + TRAIL.slice(0, i).reduce((sum, [h]) => sum + h, 0),
                    height,
                    opacity,
                    backgroundColor: c.onScan,
                  }}
                />
              ))}
            </Animated.View>
          </View>
        </View>
      </Press>
    </View>
  );
}
