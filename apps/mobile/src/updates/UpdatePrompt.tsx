import Ionicons from "@expo/vector-icons/Ionicons";
import * as Updates from "expo-updates";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, View } from "react-native";

import { haptic } from "@/ui/haptics";
import { Button, T } from "@/ui/kit";
import { Sheet } from "@/ui/sheet";
import { radius, space, useColors } from "@/ui/theme";

/** Foreground checks at most this often (Expo advises against polling in a loop). */
const CHECK_EVERY_MS = 30 * 60_000;

/**
 * Over-the-air updates download in the background (at launch, and when the app comes back to
 * the foreground). Once one is ready, this asks to restart into it, instead of the update
 * waiting silently for the second cold start. "Later" hides it for that update; it still
 * applies on the next full restart.
 */
export function UpdatePrompt(): ReactNode {
  // Dev builds and Expo Go have no updates; the hook would never report one anyway.
  if (!Updates.isEnabled) return null;
  return <Prompt />;
}

function Prompt(): ReactNode {
  const c = useColors();
  const { isUpdatePending, downloadedUpdate } = Updates.useUpdates();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const lastCheck = useRef(0);

  useEffect(() => {
    lastCheck.current = Date.now(); // the launch already checked
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" || Date.now() - lastCheck.current < CHECK_EVERY_MS) return;
      lastCheck.current = Date.now();
      void (async () => {
        try {
          const check = await Updates.checkForUpdateAsync();
          if (check.isAvailable) await Updates.fetchUpdateAsync(); // sets isUpdatePending
        } catch {
          // offline or the update server is unreachable: try again on a later foreground
        }
      })();
    });
    return () => sub.remove();
  }, []);

  const id = downloadedUpdate?.updateId ?? "pending";
  const open = isUpdatePending && dismissed !== id;

  return (
    <Sheet open={open} onClose={() => setDismissed(id)} title="Update ready">
      <View style={{ flexDirection: "row", gap: space(3), alignItems: "flex-start" }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: radius.control,
            backgroundColor: c.accentSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="sparkles" size={20} color={c.accent} />
        </View>
        <T tone="muted" style={{ flex: 1 }}>
          A new version of Lumiback has downloaded. Restart now to use it. It takes a second, and
          you stay signed in.
        </T>
      </View>
      <View style={{ gap: space(2) }}>
        <Button
          label="Restart now"
          busy={restarting}
          busyLabel="Restarting…"
          onPress={() => {
            haptic.tap();
            setRestarting(true);
            void Updates.reloadAsync({
              reloadScreenOptions: { backgroundColor: c.page, fade: true },
            }).catch(() => setRestarting(false));
          }}
        />
        <Button label="Later" variant="secondary" onPress={() => setDismissed(id)} />
      </View>
    </Sheet>
  );
}
