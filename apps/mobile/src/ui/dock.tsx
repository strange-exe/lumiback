import Ionicons from "@expo/vector-icons/Ionicons";
import { router, Tabs } from "expo-router";
import type { ComponentProps, ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/lib/auth";
import type { TargetId } from "@/tour/steps";
import { tourTarget } from "@/tour/store";
import { isStaff } from "@/lib/office";
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
const STUDENT_TABS = ["today", "live", "history", "profile"];
const STAFF_TABS = ["today", "profile"];
const ITEM = dock.height - 12;

/**
 * Floating toolbar (Material 3 Expressive): the destinations in one dark bar, the active one
 * showing its name, and Scan (tap in/out at the gate) as its own accent button beside the bar.
 * Scan opens the full-screen scanner (src/app/scan.tsx) from any tab.
 */
export function Dock({ state, navigation }: DockProps): ReactNode {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const staff = isStaff(user?.role);
  const activeName = state.routes[state.index]?.name;

  const item = (name: string): ReactNode => {
    const tab = TABS[name];
    const route = state.routes.find((r) => r.name === name);
    if (!tab || !route) return null;
    const focused = activeName === name;
    // Staff have two tabs: both keep their names, so the compact bar keeps one width.
    const labelled = focused || staff;
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
          height: ITEM,
          minWidth: ITEM,
          paddingHorizontal: labelled ? 16 : 0,
          borderRadius: ITEM / 2,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          backgroundColor: focused ? c.dockActive : "transparent",
        }}
      >
        <Ionicons
          name={focused ? tab.active : tab.icon}
          size={22}
          color={focused ? c.onDock : c.dockMuted}
        />
        {labelled ? (
          <Text
            style={{
              fontFamily: fonts.semibold,
              fontSize: 13,
              color: focused ? c.onDock : c.dockMuted,
            }}
          >
            {tab.label}
          </Text>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 16,
        right: 16,
        bottom: insets.bottom + dock.lift,
        flexDirection: "row",
        alignItems: "center",
        // Staff get a compact bar in the middle; two tabs across the whole width read as empty.
        justifyContent: staff ? "center" : undefined,
        gap: 10,
      }}
    >
      <View
        accessibilityRole="tablist"
        style={{
          flex: staff ? undefined : 1,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: staff ? "center" : "space-between",
          gap: staff ? 4 : 0,
          height: dock.height,
          paddingHorizontal: 6,
          borderRadius: dock.height / 2,
          borderCurve: "continuous",
          backgroundColor: c.dock,
          boxShadow: "0 10px 30px rgba(11, 12, 16, 0.28)",
        }}
      >
        {/* Staff don't go out through the app: no Scan, Live or History, just their office
            (Today) and Profile. */}
        {(staff ? STAFF_TABS : STUDENT_TABS).map(item)}
      </View>
      {staff ? null : <ScanButton />}
    </View>
  );
}

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
          width: dock.height,
          height: dock.height,
          borderRadius: 22,
          borderCurve: "continuous",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: c.accent,
          boxShadow: "0 10px 24px rgba(232, 80, 26, 0.38)",
        }}
      >
        <Ionicons name="scan" size={26} color={c.onAccent} />
      </Press>
    </View>
  );
}
