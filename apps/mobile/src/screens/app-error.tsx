import type { ErrorBoundaryProps } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { reportCaughtError } from "@/lib/error-handler";
import { Illustration } from "@/ui/illustration";
import { Button, Screen, T } from "@/ui/kit";
import { space } from "@/ui/theme";

/**
 * What the app shows when a screen throws while drawing (the root layout's ErrorBoundary): a
 * plain way back instead of a blank or closed app. The error is reported (scrubbed by the
 * API); nothing about it is shown, since its text is for developers. It sits outside the root
 * layout, so it brings its own safe-area provider and touches no session or data.
 */
export function AppError({ error, retry }: ErrorBoundaryProps): ReactNode {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    reportCaughtError(error);
    // A throw before the first frame would leave the splash screen over this one.
    SplashScreen.hideAsync().catch(() => undefined);
  }, [error]);

  const tryAgain = async (): Promise<void> => {
    setBusy(true);
    try {
      await retry();
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaProvider>
      <Screen>
        <View style={{ flex: 1, justifyContent: "center", gap: space(6) }}>
          <View style={{ gap: space(3) }}>
            <Illustration name="lantern-unlit" size={120} />
            <T tone="title" accessibilityRole="header">
              Something went wrong
            </T>
            <T tone="muted">
              This screen stopped working. Try again; if it keeps happening, close Lumiback and open
              it again.
            </T>
          </View>
          <Button
            label="Try again"
            busy={busy}
            busyLabel="Trying again…"
            onPress={() => void tryAgain()}
          />
        </View>
      </Screen>
    </SafeAreaProvider>
  );
}
