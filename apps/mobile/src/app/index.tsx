import { Redirect } from "expo-router";
import type { ReactNode } from "react";

import { useAuth } from "@/lib/auth";

export default function Index(): ReactNode {
  const { status } = useAuth();
  return <Redirect href={status === "signedIn" ? "/today" : "/sign-in"} />;
}
