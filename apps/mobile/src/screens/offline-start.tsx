import { useState, type ReactNode } from "react";
import { View } from "react-native";

import { useAuth } from "@/lib/auth";
import { Illustration } from "@/ui/illustration";
import { Button, Screen, T } from "@/ui/kit";
import { space } from "@/ui/theme";

/**
 * Shown at launch when a student is signed in but the server can't be reached (no signal, or
 * Lumiback is down). They stay signed in: nothing is stopped, a safe-return share keeps sending,
 * and the app tries again on its own. Never the sign-in form, which would look like a sign-out.
 */
export function OfflineStart(): ReactNode {
  const { retry, switchAccount } = useAuth();
  const [busy, setBusy] = useState(false);

  const tryAgain = async (): Promise<void> => {
    setBusy(true);
    try {
      await retry();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: "center", gap: space(6) }}>
        <View style={{ gap: space(3) }}>
          <Illustration name="lantern-unlit" size={120} />
          <T tone="title" accessibilityRole="header">
            Can&apos;t reach Lumiback
          </T>
          <T tone="muted">
            You&apos;re still signed in. Check your connection; the app keeps trying on its own.
          </T>
        </View>
        <View style={{ gap: space(3) }}>
          <Button
            label="Try again"
            busy={busy}
            busyLabel="Connecting…"
            onPress={() => void tryAgain()}
          />
          <Button label="Sign in to another account" variant="quiet" onPress={switchAccount} />
        </View>
      </View>
    </Screen>
  );
}
