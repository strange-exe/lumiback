import { Redirect, Tabs } from "expo-router";
import type { ReactNode } from "react";

import { useAuth } from "@/lib/auth";
import { usePrefs } from "@/lib/prefs";
import { useNotificationRoutes } from "@/notify/notify";
import { Dock } from "@/ui/dock";
import { useColors } from "@/ui/theme";

/** Four destinations in a floating dock (with Scan in the middle), one stack per tab. */
export default function AppLayout(): ReactNode {
  const { status } = useAuth();
  const { onboarded } = usePrefs();
  const c = useColors();
  useNotificationRoutes(status === "signedIn" && onboarded);
  if (status !== "signedIn") return <Redirect href="/sign-in" />;
  if (!onboarded) return <Redirect href="/onboarding" />;

  return (
    <Tabs
      tabBar={(props) => <Dock {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: c.page },
        animation: "fade",
      }}
    >
      <Tabs.Screen name="today" />
      <Tabs.Screen name="live" />
      <Tabs.Screen name="history" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
