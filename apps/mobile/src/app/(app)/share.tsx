import { useFocusEffect } from "expo-router";
import { useCallback, useState, type ReactNode } from "react";
import { Linking, RefreshControl, ScrollView, Share as ShareSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, ApiError } from "@/lib/api";
import { WEB_URL } from "@/lib/config";
import { formatTime } from "@/lib/time";
import type { JoinCode, LiveLocation, ShareSession, Viewer } from "@/lib/types";
import { useData } from "@/lib/use-data";
import { isSending, startSending, stopSending, type StartResult } from "@/location/task";
import { allowNotifications } from "@/notify/notify";
import { haptic } from "@/ui/haptics";
import { Button, Card, Chips, FormError, Heading, Notice, T } from "@/ui/kit";
import { LiveMap } from "@/ui/LiveMap";
import { fonts, radius, space, useColors } from "@/ui/theme";

type Length = "60" | "120" | "240" | "480";
const LENGTHS: { value: Length; label: string }[] = [
  { value: "60", label: "1 h" },
  { value: "120", label: "2 h" },
  { value: "240", label: "4 h" },
  { value: "480", label: "8 h" },
];
const POLL_MS = 10_000; // pick up join requests while the screen is open

const START_PROBLEM: Record<Exclude<StartResult, "started">, string> = {
  denied: "Lumiback needs location access while you share. Allow it in Settings, then try again.",
  servicesOff: "Location is turned off on this phone. Turn it on, then try again.",
};

function message(e: unknown): string {
  return e instanceof ApiError ? e.detail : "Something went wrong. Try again.";
}

export default function Share(): ReactNode {
  const c = useColors();
  const load = useCallback(async () => {
    const [mine, sending] = await Promise.all([api<ShareSession[]>("/sessions/mine"), isSending()]);
    const active = mine.find((s) => s.source === "app" && s.status === "active") ?? null;
    // The share ended elsewhere (web, expiry, idle close): make sure the service is off too.
    if (!active && sending) await stopSending();
    // What viewers see: the last position the server has (sharers can read their own).
    const location = active
      ? (await api<{ location: LiveLocation | null }>(`/sessions/${active.id}/location`)).location
      : null;
    return { active, sending: Boolean(active) && sending, location };
  }, []);
  const { data, error, loading, refreshing, reload, refetch } = useData(load);

  const live = Boolean(data?.active);
  useFocusEffect(
    useCallback(() => {
      if (!live) return;
      const timer = setInterval(() => void refetch(), POLL_MS);
      return () => clearInterval(timer);
    }, [live, refetch]),
  );

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.page }}>
      <ScrollView
        contentContainerStyle={{ padding: space(5), gap: space(6) }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void reload()}
            tintColor={c.pine}
          />
        }
      >
        {loading ? null : data?.active ? (
          <Live
            share={data.active}
            sending={data.sending}
            location={data.location}
            onChange={refetch}
          />
        ) : (
          <Start onStarted={reload} />
        )}
        <FormError message={error} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Start({ onStarted }: { onStarted: () => Promise<void> }): ReactNode {
  const [length, setLength] = useState<Length>("120");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    let created: ShareSession | null = null;
    try {
      // Asked first: join requests and the sharing notification both need it (Android 13+).
      // Sharing still works if the student says no; requests then show only in this tab.
      await allowNotifications().catch(() => false);
      created = await api<ShareSession>("/sessions", {
        method: "POST",
        body: { source: "app", duration_minutes: Number(length) },
      });
      const result = await startSending(created.id, created.ends_at);
      if (result !== "started") {
        // No location, no share: end the session so nobody is invited to an empty map.
        await api(`/sessions/${created.id}/stop`, { method: "POST", body: {} }).catch(
          () => undefined,
        );
        haptic.warning();
        setError(START_PROBLEM[result]);
        return;
      }
      haptic.success();
      await onStarted();
    } catch (e) {
      if (created)
        await api(`/sessions/${created.id}/stop`, { method: "POST", body: {} }).catch(
          () => undefined,
        );
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Heading
        eyebrow="Live location"
        title="Share your way back"
        lede="Send a code to a friend or family member. They see you only after you approve them, and only until you stop or the time runs out."
      />
      <Card>
        <Chips
          label="Share for"
          options={LENGTHS}
          value={length}
          onChange={(v) => {
            haptic.tap();
            setLength(v);
          }}
        />
        <T tone="small">
          A notification stays on while you share. If your phone goes quiet for 15 minutes, sharing
          ends by itself.
        </T>
        <FormError message={error} />
        {error === START_PROBLEM.denied ? (
          <Button
            label="Open Settings"
            variant="secondary"
            onPress={() => void Linking.openSettings()}
          />
        ) : null}
        <Button
          label="Start sharing"
          busy={busy}
          busyLabel="Starting…"
          onPress={() => void start()}
        />
      </Card>
    </>
  );
}

function Live({
  share,
  sending,
  location,
  onChange,
}: {
  share: ShareSession;
  sending: boolean;
  location: LiveLocation | null;
  onChange: () => Promise<void>;
}): ReactNode {
  const c = useColors();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, call: () => Promise<unknown>): Promise<void> => {
    setBusy(key);
    setError(null);
    try {
      await call();
      haptic.success();
      await onChange();
    } catch (e) {
      haptic.warning();
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  const stop = () =>
    run("stop", async () => {
      await stopSending();
      await api(`/sessions/${share.id}/stop`, { method: "POST", body: {} });
    });

  const resume = () =>
    run("resume", async () => {
      const result = await startSending(share.id, share.ends_at);
      if (result !== "started") throw new ApiError(400, START_PROBLEM[result]);
    });

  const viewers = share.viewers.filter((v) => v.status !== "revoked");
  const pending = viewers.filter((v) => v.status === "pending");
  const watching = viewers.filter((v) => v.status === "granted");

  return (
    <>
      <Heading
        eyebrow={sending ? "Sharing live" : "Paused on this phone"}
        tone={sending ? "sage" : "stone"}
        title={`Until ${formatTime(share.ends_at)}`}
        lede={
          watching.length === 0
            ? "Nobody can see you yet. Send a code below."
            : `${watching.map((v) => v.name.split(" ")[0]).join(", ")} can see you.`
        }
      />
      <LiveMap
        point={location}
        paused={!sending || !location || location.stale}
        height={220}
        label={
          location
            ? `Your shared location, accurate to about ${Math.round(location.accuracy_m)} metres`
            : "Map, waiting for your first location"
        }
      />

      {!sending ? (
        <Card style={{ borderColor: c.lantern }}>
          <T>
            Your location isn&apos;t being sent. This happens if the app was closed from recent
            apps.
          </T>
          <Button
            label="Resume sharing"
            busy={busy === "resume"}
            busyLabel="Resuming…"
            onPress={() => void resume()}
          />
        </Card>
      ) : null}

      {pending.length > 0 ? (
        <Card style={{ borderColor: c.pine }}>
          <T tone="heading" accessibilityRole="header">
            Wants to follow you
          </T>
          {pending.map((v) => (
            <ViewerRow key={v.id} viewer={v}>
              <Button
                label="Decline"
                variant="quiet"
                accessibilityLabel={`Decline ${v.name}`}
                busy={busy === `revoke-${v.id}`}
                onPress={() =>
                  void run(`revoke-${v.id}`, () =>
                    api(`/sessions/${share.id}/viewers/${v.id}/revoke`, { method: "POST" }),
                  )
                }
              />
              <Button
                label="Approve"
                accessibilityLabel={`Approve ${v.name}`}
                busy={busy === `approve-${v.id}`}
                onPress={() =>
                  void run(`approve-${v.id}`, () =>
                    api(`/sessions/${share.id}/viewers/${v.id}/approve`, { method: "POST" }),
                  )
                }
              />
            </ViewerRow>
          ))}
        </Card>
      ) : null}

      {/* keyed: a code belongs to one share and is dropped when the share changes */}
      <Invite key={share.id} sessionId={share.id} />

      <View style={{ gap: space(2) }}>
        <T tone="label">Can see you</T>
        {watching.length === 0 ? (
          <T tone="muted">Nobody yet. Send a code above.</T>
        ) : (
          watching.map((v) => (
            <ViewerRow key={v.id} viewer={v}>
              <Button
                label="Remove"
                variant="quiet"
                accessibilityLabel={`Remove ${v.name}`}
                busy={busy === `revoke-${v.id}`}
                onPress={() =>
                  void run(`revoke-${v.id}`, () =>
                    api(`/sessions/${share.id}/viewers/${v.id}/revoke`, { method: "POST" }),
                  )
                }
              />
            </ViewerRow>
          ))
        )}
      </View>

      <FormError message={error} />
      <Button
        label="Stop sharing"
        variant="danger"
        busy={busy === "stop"}
        busyLabel="Stopping…"
        onPress={() => void stop()}
      />
    </>
  );
}

function ViewerRow({ viewer, children }: { viewer: Viewer; children: ReactNode }): ReactNode {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
      <View style={{ flex: 1 }}>
        <T tone="label">{viewer.name}</T>
        <T tone="small">{viewer.kind === "guest" ? "Guest, no account" : "Lumiback student"}</T>
      </View>
      {children}
    </View>
  );
}

function Invite({ sessionId }: { sessionId: string }): ReactNode {
  const c = useColors();
  const [code, setCode] = useState<JoinCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const make = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setCode(await api<JoinCode>(`/sessions/${sessionId}/codes`, { method: "POST" }));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const send = (current: JoinCode): void => {
    const link = `${WEB_URL}/join#code=${encodeURIComponent(current.code)}`;
    void ShareSheet.share({
      message: `Follow my way back on Lumiback: ${link}\nOr enter code ${current.code}. It works once, until ${formatTime(current.expires_at)}.`,
    }).catch(() => undefined); // dismissed: the code is on screen to read out
  };

  return (
    <Card>
      <T tone="heading" accessibilityRole="header">
        Invite someone
      </T>
      {code ? (
        <>
          <View
            accessible
            accessibilityLabel={`Join code ${code.code.split("").join(" ")}`}
            style={{
              borderWidth: 2,
              borderStyle: "dashed",
              borderColor: c.pine,
              backgroundColor: c.pineSoft,
              borderRadius: radius.control,
              paddingVertical: space(4),
            }}
          >
            <T
              style={{
                textAlign: "center",
                fontFamily: fonts.bold,
                fontSize: 30,
                lineHeight: 36,
                letterSpacing: 6,
                color: c.pine,
              }}
            >
              {code.code}
            </T>
          </View>
          <T tone="small">
            Works once, until {formatTime(code.expires_at)}. You&apos;ll approve them before they
            see anything.
          </T>
          <Button label="Send code" onPress={() => send(code)} />
          <Button
            label="New code"
            variant="quiet"
            busy={busy}
            busyLabel="Making a code…"
            onPress={() => void make()}
          />
        </>
      ) : (
        <>
          <T tone="muted">Get a one-time code and send it from any app.</T>
          <Button
            label="Get a join code"
            variant="secondary"
            busy={busy}
            busyLabel="Making a code…"
            onPress={() => void make()}
          />
        </>
      )}
      {error ? <Notice tone="warn">{error}</Notice> : null}
    </Card>
  );
}
