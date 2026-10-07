import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect, Tabs } from "expo-router";
import type { ComponentProps, ReactNode } from "react";
import type { ColorValue } from "react-native";

import { useAuth } from "@/lib/auth";
import { fonts, useColors } from "@/ui/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

function icon(name: IconName) {
  return function TabIcon({ color, size }: { color: ColorValue; size: number }): ReactNode {
    return <Ionicons name={name} color={color} size={size} />;
  };
}

export default function AppLayout(): ReactNode {
  const { status } = useAuth();
  const c = useColors();
  if (status !== "signedIn") return <Redirect href="/sign-in" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.pine,
        tabBarInactiveTintColor: c.stone,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.line },
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 12 },
      }}
    >
      <Tabs.Screen name="today" options={{ title: "Today", tabBarIcon: icon("walk-outline") }} />
      <Tabs.Screen
        name="history"
        options={{ title: "History", tabBarIcon: icon("time-outline") }}
      />
      <Tabs.Screen
        name="share"
        options={{ title: "Share", tabBarIcon: icon("navigate-circle-outline") }}
      />
      <Tabs.Screen
        name="follow"
        options={{ title: "Follow", tabBarIcon: icon("people-outline") }}
      />
      <Tabs.Screen name="watch/[id]" options={{ href: null }} />
      <Tabs.Screen
        name="account"
        options={{ title: "Account", tabBarIcon: icon("person-circle-outline") }}
      />
    </Tabs>
  );
}
