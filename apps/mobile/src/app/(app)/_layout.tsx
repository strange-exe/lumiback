import { Redirect, Tabs } from "expo-router";
import { useState, type ReactNode } from "react";

import { useAuth } from "@/lib/auth";
import { usePrefs } from "@/lib/prefs";
import { useNotificationRoutes } from "@/notify/notify";
import { Tour } from "@/tour/Tour";
import { WhatsNew } from "@/updates/WhatsNew";
import { Dock } from "@/ui/dock";
import { useColors } from "@/ui/theme";

/** Four destinations in a floating dock (with Scan in the middle), one stack per tab. */
export default function AppLayout(): ReactNode {
  const { status } = useAuth();
  const { onboarded } = usePrefs();
  const c = useColors();
  const [notesSettled, setNotesSettled] = useState(false);
  useNotificationRoutes(status === "signedIn" && onboarded);
  if (status !== "signedIn") return <Redirect href="/sign-in" />;
  if (!onboarded) return <Redirect href="/onboarding" />;

  return (
    <>
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
      {/* Signed in and past onboarding: the moment a release note makes sense. The guided
          tour waits for it, so the two never stack. */}
      <WhatsNew onSettled={() => setNotesSettled(true)} />
      <Tour ready={notesSettled} />
    </>
  );
}
