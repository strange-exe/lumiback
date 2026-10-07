import Ionicons from "@expo/vector-icons/Ionicons";
import { router, Tabs } from "expo-router";
import type { ComponentProps, ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { haptic } from "@/ui/haptics";
import { Press } from "@/ui/kit";
import { fonts, useColors } from "@/ui/theme";

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
const LEFT = ["today", "live"];
const RIGHT = ["history", "profile"];

/**
 * Floating dock: four destinations and the raised Scan action in the middle (tap in/out at the
 * gate). Until gate scanning ships, Scan opens the trip action on Today, so it always does
 * something real.
 */
export function Dock({ state, navigation }: DockProps): ReactNode {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const activeName = state.routes[state.index]?.name;

  const item = (name: string): ReactNode => {
    const tab = TABS[name];
    const route = state.routes.find((r) => r.name === name);
    if (!tab || !route) return null;
    const focused = activeName === name;
    return (
      <Pressable
        key={name}
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
        style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 3, minHeight: 56 }}
      >
        <Ionicons
          name={focused ? tab.active : tab.icon}
          size={22}
          color={focused ? c.onDock : c.dockMuted}
        />
        <Text
          style={{
            fontFamily: focused ? fonts.semibold : fonts.medium,
            fontSize: 11,
            color: focused ? c.onDock : c.dockMuted,
          }}
        >
          {tab.label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: 16, right: 16, bottom: insets.bottom + 10 }}
    >
      <View
        accessibilityRole="tablist"
        style={{
          flexDirection: "row",
          alignItems: "center",
          height: 68,
          paddingHorizontal: 6,
          borderRadius: 34,
          borderCurve: "continuous",
          backgroundColor: c.dock,
          boxShadow: "0 10px 30px rgba(11, 12, 16, 0.28)",
        }}
      >
        {LEFT.map(item)}
        <View style={{ width: 76, alignItems: "center" }}>
          <Press
            onPress={() => {
              haptic.tap();
              router.navigate({
                pathname: "/today",
                params: { action: "scan", at: String(Date.now()) },
              });
            }}
            accessibilityLabel="Scan at the gate"
            style={{
              width: 60,
              height: 60,
              marginTop: -26,
              borderRadius: 30,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: c.accent,
              borderWidth: 4,
              borderColor: c.page,
            }}
          >
            <Ionicons name="scan" size={26} color={c.onAccent} />
          </Press>
        </View>
        {RIGHT.map(item)}
      </View>
    </View>
  );
}
