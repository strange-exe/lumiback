import { Stack } from "expo-router";
import type { ReactNode } from "react";

import { fonts, useColors } from "@/ui/theme";

/**
 * The stack inside each tab. Tab home screens draw their own large heading (no app bar);
 * pushed screens get a native header with a back arrow.
 */
export function TabStack({ children }: { children?: ReactNode }): ReactNode {
  const c = useColors();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.page },
        headerTintColor: c.ink,
        headerTitleStyle: { fontFamily: fonts.semibold, fontSize: 18 },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: c.page },
        animation: "default",
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      {children}
    </Stack>
  );
}
