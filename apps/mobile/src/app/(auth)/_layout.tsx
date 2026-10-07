import { Redirect, Stack } from "expo-router";
import type { ReactNode } from "react";

import { useAuth } from "@/lib/auth";

export default function AuthLayout(): ReactNode {
  const { status } = useAuth();
  if (status === "signedIn") return <Redirect href="/today" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
