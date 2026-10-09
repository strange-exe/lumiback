import * as SecureStore from "expo-secure-store";
import * as Updates from "expo-updates";
import { useEffect, useState, type ReactNode } from "react";

import { Button, T } from "@/ui/kit";
import { Sheet } from "@/ui/sheet";

import { CURRENT, shouldShowWhatsNew } from "./changelog";
import { ReleaseNotes } from "./ReleaseNotes";

const KEY = "whats-new-seen";

/** "What's new in 1.3.0", once, the first time the app opens on a newer release. */
export function WhatsNew(): ReactNode {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const seen = await SecureStore.getItemAsync(KEY);
        const show = shouldShowWhatsNew({
          seen,
          current: CURRENT.version,
          // Development builds load from the dev server (not "embedded"), so they'd look like
          // an updated phone: treat them as built-in code, with no sheet while developing.
          isEmbeddedLaunch: __DEV__ || !Updates.isEnabled || Updates.isEmbeddedLaunch,
        });
        if (show && live) setOpen(true);
        else if (seen !== CURRENT.version) await SecureStore.setItemAsync(KEY, CURRENT.version);
      } catch {
        // Storage unavailable: skip the sheet rather than risk showing it every launch.
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const close = (): void => {
    setOpen(false);
    void SecureStore.setItemAsync(KEY, CURRENT.version).catch(() => undefined);
  };

  return (
    <Sheet open={open} onClose={close} title={`What's new in ${CURRENT.version}`}>
      <T tone="label">{CURRENT.title}</T>
      <ReleaseNotes release={CURRENT} heading={false} />
      <Button label="Got it" onPress={close} />
    </Sheet>
  );
}
