import { Redirect } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import type { ReactNode } from "react";

import { useAuth } from "@/lib/auth";
import { usePrefs } from "@/lib/prefs";
import { useNotificationRoutes } from "@/notify/notify";
import { fonts, useColors } from "@/ui/theme";

/** Material 3 bottom navigation (native), one stack per tab. */
export default function AppLayout(): ReactNode {
  const { status } = useAuth();
  const { onboarded } = usePrefs();
  const c = useColors();
  useNotificationRoutes(status === "signedIn" && onboarded);
  if (status !== "signedIn") return <Redirect href="/sign-in" />;
  if (!onboarded) return <Redirect href="/onboarding" />;

  return (
    <NativeTabs
      backgroundColor={c.surface}
      tintColor={c.pine}
      iconColor={{ default: c.stone, selected: c.pine }}
      indicatorColor={c.pineSoft}
      rippleColor={c.line}
      labelStyle={{
        default: { color: c.stone, fontFamily: fonts.medium, fontSize: 12 },
        selected: { color: c.pine, fontFamily: fonts.semibold, fontSize: 12 },
      }}
      labelVisibilityMode="labeled"
    >
      <NativeTabs.Trigger name="today">
        <NativeTabs.Trigger.Icon md="directions_walk" />
        <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="share">
        <NativeTabs.Trigger.Icon md="near_me" />
        <NativeTabs.Trigger.Label>Share</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="follow">
        <NativeTabs.Trigger.Icon md="group" />
        <NativeTabs.Trigger.Label>Follow</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="history">
        <NativeTabs.Trigger.Icon md="history" />
        <NativeTabs.Trigger.Label>History</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Icon md="person" />
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
