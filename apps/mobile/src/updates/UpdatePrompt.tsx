import Ionicons from "@expo/vector-icons/Ionicons";
import * as Updates from "expo-updates";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { AppState, Linking, View } from "react-native";

import { WEB_URL } from "@/lib/config";
import { haptic } from "@/ui/haptics";
import { Button, FormError, T } from "@/ui/kit";
import { Sheet } from "@/ui/sheet";
import { radius, space, useColors } from "@/ui/theme";

import { NATIVE_BUILDS } from "./changelog";
import { nativeUpdateFor, type NativeUpdate } from "./native-build";
import { promptAllowed, shouldCheck, shouldPrompt, type Snooze } from "./prompt-rules";

/**
 * Two kinds of update, one prompt:
 * - over the air (most changes): "Update available: Update now / Remind me later";
 * - a new app build (native changes, which over-the-air updates can't deliver): "New app
 *   version: Download". The website publishes the latest build at /app/android.json.
 *
 * Both are checked at launch and whenever the app comes back to the foreground (at most every
 * few minutes; Expo advises against polling in a loop). "Remind me later" hides it for a few
 * hours or until the next launch; a required build can't be put off.
 */
const reopeners = new Set<() => void>();

/** Show the prompt again even after "Remind me later" (Profile's "Update available" badge). */
export function showUpdatePrompt(): void {
  for (const reopen of reopeners) reopen();
}

// The newest app build to download, if any, shared with Profile's badge.
let latestNative: NativeUpdate | null = null;
const nativeListeners = new Set<() => void>();
function publishNative(next: NativeUpdate | null): void {
  latestNative = next;
  for (const listener of nativeListeners) listener();
}

/** A newer app build waiting to be downloaded (null: none, or not known yet). */
export function useNativeUpdate(): NativeUpdate | null {
  return useSyncExternalStore(
    (listener) => {
      nativeListeners.add(listener);
      return () => void nativeListeners.delete(listener);
    },
    () => latestNative,
  );
}

interface Where {
  signedIn: boolean;
  /** The current route: the sheet stays away from some (see promptAllowed). */
  pathname: string;
}

/**
 * `signedIn`/`pathname` only decide whether the sheet may show; the checks keep running, so it
 * appears as soon as the student is somewhere it's welcome.
 */
export function UpdatePrompt(where: Where): ReactNode {
  // Dev builds and Expo Go have no updates; the hook would never report one anyway.
  if (!Updates.isEnabled) return null;
  return <Prompt {...where} />;
}

const BUILD_FILE = `${WEB_URL}/app/android.json`;

async function latestBuild(): Promise<NativeUpdate | null> {
  const installed = Updates.runtimeVersion ? NATIVE_BUILDS[Updates.runtimeVersion] : undefined;
  if (!Updates.channel || installed === undefined) return null;
  const res = await fetch(BUILD_FILE, { cache: "no-store" });
  if (!res.ok) return null;
  return nativeUpdateFor(await res.json(), Updates.channel, installed);
}

function Prompt({ signedIn, pathname }: Where): ReactNode {
  const { isUpdateAvailable, isUpdatePending, availableUpdate, downloadedUpdate } =
    Updates.useUpdates();
  const native = useNativeUpdate();
  const [snooze, setSnooze] = useState<Snooze | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const lastCheck = useRef<number | null>(null);

  const check = useCallback(async (): Promise<void> => {
    const at = Date.now();
    if (!shouldCheck(lastCheck.current, at)) return;
    lastCheck.current = at;
    // Each check stands alone: offline or unreachable just means "try on a later foreground".
    await Promise.all([
      // Sets isUpdateAvailable / availableUpdate in useUpdates().
      Updates.checkForUpdateAsync().catch(() => undefined),
      latestBuild()
        .then(publishNative)
        .catch(() => undefined),
    ]);
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

  if (native) {
    const id = `build-${native.build}`;
    const open = native.required || shouldPrompt({ available: true, id, snooze, now });
    const allowed = promptAllowed({ signedIn, pathname, required: native.required });
    return (
      <DownloadSheet
        open={open && allowed}
        update={native}
        onLater={() => setSnooze({ id, at: Date.now() })}
      />
    );
  }
  const id = downloadedUpdate?.updateId ?? availableUpdate?.updateId ?? null;
  return (
    <OverTheAirSheet
      available={isUpdateAvailable || isUpdatePending}
      pending={isUpdatePending}
      open={
        promptAllowed({ signedIn, pathname }) &&
        shouldPrompt({ available: isUpdateAvailable || isUpdatePending, id, snooze, now })
      }
      onLater={() => setSnooze({ id, at: Date.now() })}
    />
  );
}

function Lead({ icon, children }: { icon: "sparkles" | "download"; children: string }): ReactNode {
  const c = useColors();
  return (
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
        <Ionicons name={icon} size={20} color={c.accent} />
      </View>
      <T tone="muted" style={{ flex: 1 }}>
        {children}
      </T>
    </View>
  );
}

function OverTheAirSheet({
  available,
  pending,
  open,
  onLater,
}: {
  available: boolean;
  pending: boolean;
  open: boolean;
  onLater: () => void;
}): ReactNode {
  const c = useColors();
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = async (): Promise<void> => {
    haptic.tap();
    setUpdating(true);
    setError(null);
    try {
      if (!pending) await Updates.fetchUpdateAsync();
      await Updates.reloadAsync({ reloadScreenOptions: { backgroundColor: c.page, fade: true } });
    } catch {
      setUpdating(false);
      setError("Couldn't download the update. Check your connection and try again.");
    }
  };

  return (
    <Sheet
      open={(available && open) || updating}
      onClose={() => (updating ? undefined : onLater())}
      title="Update available"
    >
      <Lead icon="sparkles">
        A new version of Lumiback is ready. Updating takes a few seconds, and you stay signed in.
      </Lead>
      <FormError message={error} />
      <View style={{ gap: space(2) }}>
        <Button
          label="Update now"
          busy={updating}
          busyLabel="Updating…"
          onPress={() => void update()}
        />
        {updating ? null : <Button label="Remind me later" variant="secondary" onPress={onLater} />}
      </View>
    </Sheet>
  );
}

function DownloadSheet({
  open,
  update,
  onLater,
}: {
  open: boolean;
  update: NativeUpdate;
  onLater: () => void;
}): ReactNode {
  const [error, setError] = useState<string | null>(null);

  const download = (): void => {
    haptic.tap();
    setError(null);
    Linking.openURL(update.url).catch(() =>
      setError("Couldn't open the download. Try again, or ask the hostel office for the link."),
    );
  };

  return (
    <Sheet
      open={open}
      // A required build can't be put off: the sheet stays until the new app is installed.
      onClose={update.required ? () => undefined : onLater}
      title={update.required ? "Please update Lumiback" : "New app version"}
    >
      <Lead icon="download">
        {[
          update.required
            ? "This version of the app has stopped working with Lumiback. Download the new one to carry on."
            : "A new version of the Lumiback app is ready to download.",
          update.notes,
          "Install it over this one: you stay signed in and keep your history.",
        ]
          .filter(Boolean)
          .join(" ")}
      </Lead>
      <FormError message={error} />
      <View style={{ gap: space(2) }}>
        <Button label="Download" onPress={download} />
        {update.required ? null : (
          <Button label="Remind me later" variant="secondary" onPress={onLater} />
        )}
      </View>
    </Sheet>
  );
}
