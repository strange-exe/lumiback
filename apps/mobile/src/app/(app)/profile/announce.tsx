import { useCallback, useState, type ReactNode } from "react";
import { AccessibilityInfo, View } from "react-native";

import {
  ANNOUNCE_CONFIRM,
  announceBody,
  announceDraft,
  announceError,
  announceTiming,
  canAnnounce,
  MAX_ANNOUNCE_BODY,
  MAX_ANNOUNCE_TITLE,
  reachedLine,
  type AnnounceState,
  type Announced,
} from "@/lib/announce";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatStamp } from "@/lib/time";
import { CURRENT } from "@/updates/changelog";
import { useData } from "@/lib/use-data";
import { useNow } from "@/lib/use-now";
import { haptic } from "@/ui/haptics";
import { Button, Card, Field, FormError, LoadFailed, Notice, Screen, T } from "@/ui/kit";
import { space } from "@/ui/theme";

const fmt = (iso: string): string => formatStamp(new Date(iso));
const DRAFT = announceDraft(CURRENT);

/**
 * Developers only: tell every phone with Lumiback that a new version is out, at most once a day.
 * Nothing is sent until the developer confirms; the server checks the role and the daily limit
 * again. Like the website's Announce an update.
 */
export default function Announce(): ReactNode {
  const { user } = useAuth();
  const allowedHere = canAnnounce(user);
  // Asked only for a developer as themselves; anyone else never calls it.
  const load = useCallback(
    () => (allowedHere ? api<AnnounceState>("/admin/announcements") : Promise.resolve(null)),
    [allowedHere],
  );
  const { data, error: loadError, loading, reload } = useData(load);
  // Re-read every 30 s, so the form opens again once the daily limit has passed.
  const now = useNow(30_000);
  // After a send, the server's new limit (until the next load).
  const [sent, setSent] = useState<AnnounceState | null>(null);
  // Starts with this release's title and summary (the changelog), ready to edit.
  const [title, setTitle] = useState(DRAFT.title);
  const [line, setLine] = useState(DRAFT.body);
  const [confirming, setConfirming] = useState<{ title: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reached, setReached] = useState<string | null>(null);

  if (!allowedHere) {
    return (
      <Screen edges={["bottom"]}>
        <T tone="muted">This is for developers only.</T>
      </Screen>
    );
  }

  const state = sent ?? data;
  const timing = state ? announceTiming(state, now, fmt) : null;

  const next = (): void => {
    const checked = announceBody(title, line);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setError(null);
    setReached(null);
    setConfirming(checked.body);
  };

  // The only place a push is sent from: the confirm step's button.
  const send = async (): Promise<void> => {
    if (!confirming || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<Announced>("/admin/announcements", {
        method: "POST",
        body: confirming,
      });
      haptic.success();
      const done = reachedLine(result.devices);
      setSent({ last_at: new Date().toISOString(), next_at: result.next_at });
      setReached(done);
      setConfirming(null);
      setTitle("");
      setLine("");
      AccessibilityInfo.announceForAccessibility(done);
    } catch (e) {
      haptic.warning();
      setError(
        e instanceof ApiError
          ? announceError(e.status, e.detail)
          : "Something went wrong. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={["bottom"]}>
      <T tone="muted">
        A notification on every phone with Lumiback, on the App updates channel. Tapping it installs
        the update. Send it once the update is published.
      </T>

      {loadError && !data ? (
        <LoadFailed
          title="Couldn't check the last announcement"
          message={loadError}
          after="The form opens once it loads."
          busy={loading}
          onRetry={reload}
        />
      ) : !timing ? (
        <T tone="muted">Loading…</T>
      ) : (
        <>
          <View accessible style={{ gap: space(1) }}>
            <T tone="body">{timing.last}</T>
            <T tone="muted">{timing.next}</T>
          </View>
          {reached ? <Notice>{reached}</Notice> : null}

          {confirming ? (
            <Card flat>
              <T tone="label">Preview</T>
              <View accessible style={{ gap: space(1) }}>
                <T tone="headline">{confirming.title}</T>
                <T tone="body">{confirming.body}</T>
              </View>
              <T tone="muted">{ANNOUNCE_CONFIRM}</T>
              <FormError message={error} />
              <View style={{ gap: space(2) }}>
                <Button
                  label="Send to every phone"
                  busy={busy}
                  busyLabel="Sending…"
                  onPress={() => void send()}
                />
                {busy ? null : (
                  <Button label="Back" variant="quiet" onPress={() => setConfirming(null)} />
                )}
              </View>
            </Card>
          ) : timing.allowed ? (
            <Card flat>
              <Field
                label="Title"
                value={title}
                onChangeText={setTitle}
                maxLength={MAX_ANNOUNCE_TITLE}
                placeholder="Lumiback 1.18.0 is ready"
                returnKeyType="next"
              />
              <Field
                label="One line about it"
                hint={`Up to ${MAX_ANNOUNCE_BODY} characters, shown under the title.`}
                value={line}
                onChangeText={setLine}
                maxLength={MAX_ANNOUNCE_BODY}
                placeholder="Running late, and Today works offline."
                returnKeyType="done"
              />
              <FormError message={error} />
              <Button label="Continue" onPress={next} />
            </Card>
          ) : null}
        </>
      )}
    </Screen>
  );
}
