import { Stack } from "expo-router";
import type { ReactNode } from "react";

import { TabStack } from "@/ui/tab-stack";

export default function Layout(): ReactNode {
  return (
    <TabStack>
      <Stack.Screen name="outing-details" options={{ title: "Hostel and contacts" }} />
      <Stack.Screen name="notifications" options={{ title: "Notifications" }} />
      <Stack.Screen name="appearance" options={{ title: "Appearance" }} />
      <Stack.Screen name="help" options={{ title: "Help" }} />
      <Stack.Screen name="whats-new" options={{ title: "What's new" }} />
      <Stack.Screen name="delete-account" options={{ title: "Delete account" }} />
    </TabStack>
  );
}
