import Ionicons from "@expo/vector-icons/Ionicons";
import * as Updates from "expo-updates";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, View } from "react-native";

import { haptic } from "@/ui/haptics";
import { Button, FormError, T } from "@/ui/kit";
import { Sheet } from "@/ui/sheet";
import { radius, space, useColors } from "@/ui/theme";

import { shouldCheck, shouldPrompt, type Snooze } from "./prompt-rules";

/**
 * "Update available: Update now / Remind me later", like store apps. The app asks the update
 * server itself at launch and whenever it comes back to the foreground (at most every few
 * minutes; Expo advises against polling in a loop), so the prompt doesn't depend on Expo's
 * silent launch download. "Remind me later" hides it for a few hours or until the next launch;
 * the update still applies on its own after two full restarts.
 */
const reopeners = new Set<() => void>();

/** Show the prompt again even after "Remind me later" (Profile's "Update available" badge). */
export function showUpdatePrompt(): void {
  for (const reopen of reopeners) reopen();
}

export function UpdatePrompt(): ReactNode {
  // Dev builds and Expo Go have no updates; the hook would never report one anyway.
  if (!Updates.isEnabled) return null;
  return <Prompt />;
}

function Prompt(): ReactNode {
  const c = useColors();
  const { isUpdateAvailable, isUpdatePending, availableUpdate, downloadedUpdate } =
    Updates.useUpdates();
  const [snooze, setSnooze] = useState<Snooze | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastCheck = useRef<number | null>(null);

  const check = useCallback(async (): Promise<void> => {
    const at = Date.now();
    if (!shouldCheck(lastCheck.current, at)) return;
    lastCheck.current = at;
    try {
      // Sets isUpdateAvailable / availableUpdate in useUpdates().
      await Updates.checkForUpdateAsync();
    } catch {
      // Offline or the update server is unreachable: try again on a later foreground.
    }
  }, []);

  useEffect(() => {
    const reopen = (): void => setSnooze(null);
    reopeners.add(reopen);
    return () => void reopeners.delete(reopen);
  }, []);

  useEffect(() => {
    void check(); // at launch
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      setNow(Date.now()); // a "remind me later" that has run out shows the prompt again
      void check();
    });
    return () => sub.remove();
  }, [check]);

  const id = downloadedUpdate?.updateId ?? availableUpdate?.updateId ?? null;
  const open =
    !updating && shouldPrompt({ available: isUpdateAvailable || isUpdatePending, id, snooze, now });

  const update = async (): Promise<void> => {
    haptic.tap();
    setUpdating(true);
    setError(null);
    try {
      if (!isUpdatePending) await Updates.fetchUpdateAsync();
      await Updates.reloadAsync({ reloadScreenOptions: { backgroundColor: c.page, fade: true } });
    } catch {
      setUpdating(false);
      setError("Couldn't download the update. Check your connection and try again.");
    }
  };

  const later = (): void => setSnooze({ id, at: Date.now() });

  return (
    <Sheet
      open={open || updating}
      onClose={() => (updating ? undefined : later())}
      title="Update available"
    >
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
          A new version of Lumiback is ready. Updating takes a few seconds, and you stay signed in.
        </T>
      </View>
      <FormError message={error} />
      <View style={{ gap: space(2) }}>
        <Button
          label="Update now"
          busy={updating}
          busyLabel="Updating…"
          onPress={() => void update()}
        />
        {updating ? null : <Button label="Remind me later" variant="secondary" onPress={later} />}
      </View>
    </Sheet>
  );
}
