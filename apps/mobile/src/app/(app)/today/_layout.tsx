import { Stack } from "expo-router";
import type { ReactNode } from "react";

import { TabStack } from "@/ui/tab-stack";

export default function Layout(): ReactNode {
  return (
    <TabStack>
      <Stack.Screen name="board" options={{ title: "Hostel board" }} />
    </TabStack>
  );
}
