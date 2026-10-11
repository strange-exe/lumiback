import { Redirect, Stack } from "expo-router";
import type { ReactNode } from "react";

import { useAuth } from "@/lib/auth";
import { isStaff } from "@/lib/office";
import { fonts, useColors } from "@/ui/theme";

/** The hostel office: admins and wardens only (the API also checks, on every call). */
export default function OfficeLayout(): ReactNode {
  const { status, user } = useAuth();
  const c = useColors();
  if (status !== "signedIn") return <Redirect href="/sign-in" />;
  if (!isStaff(user?.role)) return <Redirect href="/today" />;
  return (
    <Stack
      screenOptions={{
        title: "Hostel office",
        headerStyle: { backgroundColor: c.page },
        headerTintColor: c.ink,
        headerTitleStyle: { fontFamily: fonts.semibold, fontSize: 18 },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: c.page },
        animation: "none", // switching sections replaces the screen in place
      }}
    />
  );
}
