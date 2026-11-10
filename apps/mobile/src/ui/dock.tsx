import Ionicons from "@expo/vector-icons/Ionicons";
import { router, Tabs } from "expo-router";
import type { ComponentProps, ReactNode } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/lib/auth";
import { isStaff } from "@/lib/office";
import type { TargetId } from "@/tour/steps";
import { tourTarget } from "@/tour/store";
import { Glass, sceneTarget } from "@/ui/glass";
import { haptic } from "@/ui/haptics";
import { Press } from "@/ui/kit";
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
/** The widest tab name ("History") at 13 px in Instrument Sans SemiBold, measured from the font. */
const LABEL_WIDTH = 45;
/** Tab names grow with the font size setting up to this much; the dock has no room beyond it. */
const LABEL_SCALE = 1.3;

/**
 * Whether the active tab's name fits beside its icon (as in the old dock) in half the pill. On
 * narrower phones, or with a larger font, it goes under the icon instead: still shown, never cut.
 */
export function labelBeside(width: number, fontScale: number): boolean {
  const half = (width - SIDE * 2 - PAD * 2 - CENTRE_GAP) / 2;
  const active = 12 + 22 + 6 + LABEL_WIDTH * Math.min(fontScale, LABEL_SCALE) + 12;
  return half >= active + 2 + TAB;
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
  const { width, fontScale } = useWindowDimensions();
  const { user } = useAuth();
  const staff = isStaff(user?.role);
  const active = state.routes[state.index];
  const target = sceneTarget(active?.key ?? "");

  const item = (name: string, look: "beside" | "under" | "staff"): ReactNode => {
    const tab = TABS[name];
    const route = state.routes.find((r) => r.name === name);
    if (!tab || !route) return null;
    const focused = active?.name === name;
    // Staff have two tabs: both keep their names, so the compact bar keeps one width.
    const labelled = focused || look === "staff";
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
        <View
          style={{
            height: ITEM,
            minWidth: TAB,
            paddingHorizontal: labelled ? (under ? 10 : look === "staff" ? 16 : 12) : 0,
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
          {labelled ? (
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={LABEL_SCALE}
              style={{
                fontFamily: fonts.semibold,
                fontSize: 13,
                lineHeight: under ? 16 : undefined,
                color,
              }}
            >
              {tab.label}
            </Text>
          ) : null}
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

  const look = labelBeside(width, fontScale) ? "beside" : "under";
  const half = (names: string[]): ReactNode => (
    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 2 }}>
      {names.map((name) => item(name, look))}
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

/** Scan: an accent circle in a page-coloured ring, so it reads apart from what scrolls behind. */
function ScanButton(): ReactNode {
  const c = useColors();
  return (
    <View ref={tourTarget("scan")} collapsable={false}>
      <Press
        onPress={() => {
          haptic.tap();
          router.push("/scan");
        }}
        accessibilityLabel="Scan at the gate"
        style={{
          width: SCAN_SIZE,
          height: SCAN_SIZE,
          borderRadius: SCAN_SIZE / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: c.page,
          boxShadow: "0 10px 24px rgba(232, 80, 26, 0.38)",
        }}
      >
        <View
          style={{
            width: dock.scan,
            height: dock.scan,
            borderRadius: dock.scan / 2,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: c.accent,
          }}
        >
          <Ionicons name="scan" size={28} color={c.onAccent} />
        </View>
      </Press>
    </View>
  );
}
