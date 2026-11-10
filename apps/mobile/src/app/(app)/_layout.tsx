import { Redirect, Tabs } from "expo-router";
import { useState, type ReactNode } from "react";

import { useAuth } from "@/lib/auth";
import { usePrefs } from "@/lib/prefs";
import { useViewAs } from "@/lib/view-as";
import { useNotificationRoutes } from "@/notify/notify";
import { Tour } from "@/tour/Tour";
import { WhatsNew } from "@/updates/WhatsNew";
import { Dock } from "@/ui/dock";
import { SceneTarget } from "@/ui/glass";
import { useColors } from "@/ui/theme";
import { ViewAsFrame } from "@/ui/view-as-banner";

/** Four destinations in a floating glass dock (Scan raised in its middle), one stack per tab. */
export default function AppLayout(): ReactNode {
  const { status } = useAuth();
  const { onboarded } = usePrefs();
  const c = useColors();
  const [notesSettled, setNotesSettled] = useState(false);
  // A developer viewing as another role: no tour and no release notes (not for a preview).
  const viewingAs = useViewAs() !== null;
  useNotificationRoutes(status === "signedIn" && onboarded);
  if (status !== "signedIn") return <Redirect href="/sign-in" />;
  if (!onboarded) return <Redirect href="/onboarding" />;

  return (
    <ViewAsFrame>
      <Tabs
        tabBar={(props) => <Dock {...props} />}
        // Each tab's scene sits in the view the dock's glass blurs; the dock (the tab bar) is
        // drawn beside the scenes, outside every target.
        screenLayout={({ route, children }) => (
          <SceneTarget routeKey={route.key}>{children}</SceneTarget>
        )}
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
      {viewingAs ? null : (
        <>
          <WhatsNew onSettled={() => setNotesSettled(true)} />
          <Tour ready={notesSettled} />
        </>
      )}
    </ViewAsFrame>
  );
}
