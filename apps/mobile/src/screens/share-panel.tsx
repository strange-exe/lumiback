import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Linking, RefreshControl, Share as ShareSheet, Text, View } from "react-native";

import { api, ApiError } from "@/lib/api";
import { WEB_URL } from "@/lib/config";
import { inviteMessage, whatsappUrl } from "@/lib/invite";
import { formatTime } from "@/lib/time";
import type { AccessLogEntry, JoinCode, ShareSession, Viewer } from "@/lib/types";
import { useData } from "@/lib/use-data";
import { mockState, type Positions } from "@/location/mock";
import { isSending, startSending, stopSending, type StartResult } from "@/location/task";
import { allowNotifications } from "@/notify/notify";
import { haptic } from "@/ui/haptics";
import { Illustration } from "@/ui/illustration";
import { Button, Card, Chips, FormError, Heading, Screen, Section, StatusChip, T } from "@/ui/kit";
import { LiveMap } from "@/ui/LiveMap";
import { MockNotice } from "@/ui/MockNotice";
import { Sheet } from "@/ui/sheet";
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

/** The Share half of the Live tab: start, run and stop a live share. */
export function SharePanel({ header }: { header: ReactNode }): ReactNode {
  const c = useColors();
  const load = useCallback(async () => {
    const [mine, sending] = await Promise.all([api<ShareSession[]>("/sessions/mine"), isSending()]);
    const active = mine.find((s) => s.source === "app" && s.status === "active") ?? null;
    // The share ended elsewhere (web, expiry, idle close): make sure the service is off too.
    if (!active && sending) await stopSending();
    // What viewers see: the last position the server has (sharers can read their own).
    const [positions, looks] = active
      ? await Promise.all([
          api<Positions>(`/sessions/${active.id}/location`),
          // Who looked, including the hostel office following up a late return.
          api<AccessLogEntry[]>(`/sessions/${active.id}/access-log`).catch(() => []),
        ])
      : [{ location: null }, []];
    return { active, sending: Boolean(active) && sending, positions, looks };
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
    <Screen
      edges={["top"]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void reload()}
          tintColor={c.accent}
        />
      }
    >
      {header}
      {loading ? null : data?.active ? (
        // keyed: a join code belongs to one share and is dropped when the share changes
        <Live
          key={data.active.id}
          share={data.active}
          sending={data.sending}
          positions={data.positions}
          looks={data.looks}
          onChange={refetch}
        />
      ) : (
        <Start onStarted={reload} />
      )}
      <FormError message={error} />
    </Screen>
  );
}

function Start({ onStarted }: { onStarted: () => Promise<void> }): ReactNode {
  const c = useColors();
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
      if (created) {
        await api(`/sessions/${created.id}/stop`, { method: "POST", body: {} }).catch(
          () => undefined,
        );
      }
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const facts: { icon: React.ComponentProps<typeof Ionicons>["name"]; text: string }[] = [
    {
      icon: "checkmark-circle-outline",
      text: "You approve every person before they see anything. The hostel office can see your last position only if you're very late and don't answer.",
    },
    { icon: "notifications-outline", text: "A notification stays on the whole time you share." },
    { icon: "time-outline", text: "It ends when time runs out, or after 15 quiet minutes." },
  ];

  return (
    <>
      <Heading
        title="Share your way back"
        lede="Send a code to a friend or family member so they can follow you home."
      />
      <Card style={{ alignItems: "stretch", gap: space(5) }}>
        <View style={{ alignItems: "center" }}>
          <Illustration name="pin" size={170} />
        </View>
        <Chips
          label="Share for"
          options={LENGTHS}
          value={length}
          onChange={(v) => {
            haptic.tap();
            setLength(v);
          }}
        />
        <View style={{ gap: space(3) }}>
          {facts.map((f) => (
            <View
              key={f.text}
              style={{ flexDirection: "row", gap: space(3), alignItems: "flex-start" }}
            >
              <Ionicons name={f.icon} size={20} color={c.good} style={{ marginTop: 2 }} />
              <T tone="muted" style={{ flex: 1 }}>
                {f.text}
              </T>
            </View>
          ))}
        </View>
        <FormError message={error} />
        {error === START_PROBLEM.denied ? (
          <Button
            label="Open settings"
            variant="secondary"
            onPress={() => void Linking.openSettings()}
          />
        ) : null}
        <Button
          label="Start sharing"
          busy={busy}
          busyLabel="Starting…"
          icon={<Ionicons name="navigate" size={18} color={c.onAccent} />}
          onPress={() => void start()}
        />
      </Card>
    </>
  );
}

function Live({
  share,
  sending,
  positions,
  looks,
  onChange,
}: {
  share: ShareSession;
  sending: boolean;
  positions: Positions;
  looks: AccessLogEntry[];
  onChange: () => Promise<void>;
}): ReactNode {
  const c = useColors();
  const { location } = positions;
  const mock = mockState(positions);
  const fake = mock.kind === "now" ? mock.fake : null;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const invite = useJoinCode(share.id);

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

  const revoke = (v: Viewer) =>
    run(`revoke-${v.id}`, () =>
      api(`/sessions/${share.id}/viewers/${v.id}/revoke`, { method: "POST" }),
    );

  const viewers = share.viewers.filter((v) => v.status !== "revoked");
  const pending = viewers.filter((v) => v.status === "pending");
  const watching = viewers.filter((v) => v.status === "granted");

  return (
    <>
      <Heading
        eyebrow={sending ? "Sharing live" : "Paused on this phone"}
        tone={sending ? "good" : "accent"}
        title={`Until ${formatTime(share.ends_at)}`}
        lede={
          watching.length === 0
            ? "Nobody can see you yet. Invite someone below."
            : `${watching.map((v) => v.name.split(" ")[0]).join(", ")} can see you.`
        }
      />

      <View>
        <LiveMap
          point={location}
          fake={fake}
          paused={!sending || !location || location.stale || fake !== null}
          height={240}
          label={[
            location
              ? `Your last real location, accurate to about ${Math.round(location.accuracy_m)} metres`
              : "Map, no real location yet",
            fake ? "Your faked location is shown in red" : null,
          ]
            .filter(Boolean)
            .join(". ")}
        />
        <View style={{ position: "absolute", top: space(3), left: space(3) }}>
          {fake && sending ? (
            <StatusChip label="● Faked" tone="danger" />
          ) : (
            <StatusChip label={sending ? "● Live" : "Paused"} tone={sending ? "good" : "accent"} />
          )}
        </View>
      </View>

      <MockNotice state={mock} />

      {!sending ? (
        <Card style={{ borderColor: c.accent }}>
          <T tone="headline">Your location isn&apos;t being sent</T>
          <T tone="muted">This happens if the app was closed from recent apps.</T>
          <Button
            label="Resume sharing"
            busy={busy === "resume"}
            busyLabel="Resuming…"
            onPress={() => void resume()}
          />
        </Card>
      ) : null}

      {pending.length > 0 ? (
        <Section title={`Wants to follow you (${pending.length})`}>
          {pending.map((v) => (
            <PersonRow key={v.id} viewer={v}>
              <Button
                label="Decline"
                variant="quiet"
                accessibilityLabel={`Decline ${v.name}`}
                busy={busy === `revoke-${v.id}`}
                style={{ minHeight: 44, paddingHorizontal: space(3) }}
                onPress={() => void revoke(v)}
              />
              <Button
                label="Approve"
                accessibilityLabel={`Approve ${v.name}`}
                busy={busy === `approve-${v.id}`}
                style={{ minHeight: 44, paddingHorizontal: space(4) }}
                onPress={() =>
                  void run(`approve-${v.id}`, () =>
                    api(`/sessions/${share.id}/viewers/${v.id}/approve`, { method: "POST" }),
                  )
                }
              />
            </PersonRow>
          ))}
        </Section>
      ) : null}

      <Button
        label="Invite someone"
        icon={<Ionicons name="person-add" size={18} color={c.onAccent} />}
        onPress={() => {
          haptic.tap();
          invite.ensureFresh();
          setInviting(true);
        }}
      />

      <Section title="Can see you">
        {watching.length === 0 ? (
          <View style={{ padding: space(4) }}>
            <T tone="muted">Nobody yet.</T>
          </View>
        ) : (
          watching.map((v) => (
            <PersonRow key={v.id} viewer={v}>
              <Button
                label="Remove"
                variant="quiet"
                accessibilityLabel={`Remove ${v.name}`}
                busy={busy === `revoke-${v.id}`}
                style={{ minHeight: 44, paddingHorizontal: space(3) }}
                onPress={() => void revoke(v)}
              />
            </PersonRow>
          ))
        )}
      </Section>

      <WhoLooked looks={looks} />

      <FormError message={error} />
      <Button
        label="Stop sharing"
        variant="danger"
        busy={busy === "stop"}
        busyLabel="Stopping…"
        onPress={() => void stop()}
      />

      <InviteSheet open={inviting} onClose={() => setInviting(false)} invite={invite} />
    </>
  );
}

/** Everyone who has looked at this share's location, most recent first, grouped by person. */
function WhoLooked({ looks }: { looks: AccessLogEntry[] }): ReactNode {
  const c = useColors();
  if (looks.length === 0) return null;
  const people = new Map<string, { entry: AccessLogEntry; count: number }>();
  for (const entry of looks) {
    const key = `${entry.kind}:${entry.viewer_id ?? entry.viewer_name}`;
    const seen = people.get(key);
    if (seen) seen.count += 1;
    else people.set(key, { entry, count: 1 }); // the log is newest first
  }
  return (
    <Section title="Who looked">
      {[...people.values()].slice(0, 6).map(({ entry, count }) => (
        <View
          key={`${entry.kind}:${entry.viewer_id ?? entry.viewer_name}`}
          style={{ flexDirection: "row", alignItems: "center", gap: space(3), padding: space(4) }}
        >
          <Ionicons
            name={entry.kind === "admin" ? "shield-checkmark" : "eye-outline"}
            size={20}
            color={entry.kind === "admin" ? c.danger : c.muted}
          />
          <View style={{ flex: 1 }}>
            <T tone="label" numberOfLines={1}>
              {entry.viewer_name}
            </T>
            <T tone="caption">
              {entry.kind === "admin"
                ? `Checked your location at ${formatTime(entry.viewed_at)} because you were late`
                : `${count === 1 ? "Once" : `${count} times`}, last at ${formatTime(entry.viewed_at)}`}
            </T>
          </View>
        </View>
      ))}
    </Section>
  );
}

function PersonRow({ viewer, children }: { viewer: Viewer; children: ReactNode }): ReactNode {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space(3), padding: space(4) }}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: c.accentSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontFamily: fonts.semibold, fontSize: 16, color: c.accent }}>
          {viewer.name.trim().charAt(0).toUpperCase() || "?"}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <T tone="label" numberOfLines={1}>
          {viewer.name}
        </T>
        <T tone="caption">{viewer.kind === "guest" ? "Guest, no account" : "Lumiback student"}</T>
      </View>
      {children}
    </View>
  );
}

/** The share's current join code: fetched when the invite opens, renewed once it expires. */
function useJoinCode(sessionId: string) {
  const [code, setCode] = useState<JoinCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const make = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setCode(await api<JoinCode>(`/sessions/${sessionId}/codes`, { method: "POST" }));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }, [sessionId]);
  const ensureFresh = (): void => {
    if (busy) return;
    if (!code || new Date(code.expires_at).getTime() <= Date.now()) void make();
  };
  return { code, busy, error, make, ensureFresh };
}

function InviteSheet({
  open,
  onClose,
  invite,
}: {
  open: boolean;
  onClose: () => void;
  invite: ReturnType<typeof useJoinCode>;
}): ReactNode {
  const c = useColors();
  const { code, busy, error: codeError, make } = invite;
  const [copied, setCopied] = useState(false);
  const [openError, setError] = useState<string | null>(null);
  const error = codeError ?? openError;

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const text = code ? inviteMessage(WEB_URL, code.code, code.expires_at) : "";

  return (
    <Sheet open={open} onClose={onClose} title="Invite someone">
      <T tone="muted">
        They&apos;ll ask to follow you, and you approve them before they see anything.
      </T>
      <View
        accessible
        accessibilityLabel={code ? `Join code ${code.code.split("").join(" ")}` : "Making a code"}
        style={{
          borderWidth: 2,
          borderStyle: "dashed",
          borderColor: c.accent,
          backgroundColor: c.accentSoft,
          borderRadius: radius.control,
          paddingVertical: space(5),
          alignItems: "center",
          gap: space(1),
        }}
      >
        <Text
          selectable
          style={{
            fontFamily: fonts.bold,
            fontSize: 30,
            lineHeight: 36,
            letterSpacing: 5,
            color: c.accent,
            fontVariant: ["tabular-nums"],
          }}
        >
          {code?.code ?? "·····-·····"}
        </Text>
        {code ? <T tone="caption">Works once, until {formatTime(code.expires_at)}</T> : null}
      </View>
      <FormError message={error} />

      <Button
        label="Send on WhatsApp"
        icon={<Ionicons name="logo-whatsapp" size={20} color={c.onAccent} />}
        onPress={() => {
          if (!code) return;
          haptic.tap();
          void Linking.openURL(whatsappUrl(text)).catch(() => setError("Couldn't open WhatsApp."));
        }}
      />
      <View style={{ flexDirection: "row", gap: space(2) }}>
        <View style={{ flex: 1 }}>
          <Button
            label={copied ? "Copied" : "Copy code"}
            variant="secondary"
            icon={
              <Ionicons name={copied ? "checkmark" : "copy-outline"} size={18} color={c.accent} />
            }
            onPress={() => {
              if (!code) return;
              void Clipboard.setStringAsync(code.code).then(() => {
                haptic.success();
                setCopied(true);
              });
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="More apps"
            variant="secondary"
            icon={<Ionicons name="share-social-outline" size={18} color={c.accent} />}
            onPress={() => {
              if (!code) return;
              void ShareSheet.share({ message: text }).catch(() => undefined);
            }}
          />
        </View>
      </View>
      <Button
        label="New code"
        variant="quiet"
        busy={busy}
        busyLabel="Making a code…"
        onPress={() => void make()}
      />
    </Sheet>
  );
}
