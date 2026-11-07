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
import { timeLeft, type LedReading } from "@/lib/led";
import { useData } from "@/lib/use-data";
import { useNow } from "@/lib/use-now";
import { mockState, type Positions } from "@/location/mock";
import { openLocationSettings, settingsLabel } from "@/location/settings";
import {
  isSending,
  sendingShareIds,
  sendProblem,
  startSending,
  stopSending,
  type SendProblem,
  type StartResult,
} from "@/location/task";
import { allowNotifications } from "@/notify/notify";
import { haptic } from "@/ui/haptics";
import { Illustration } from "@/ui/illustration";
import {
  Button,
  Card,
  Chips,
  FormError,
  Heading,
  LoadFailed,
  Notice,
  Screen,
  Section,
  StatusChip,
  T,
} from "@/ui/kit";
import { LedBoard } from "@/ui/led";
import { LiveMap } from "@/ui/LiveMap";
import { MockNotice } from "@/ui/MockNotice";
import { Sheet } from "@/ui/sheet";
import { fonts, radius, space, type, useColors } from "@/ui/theme";

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

/** Which failed start an error message reports, so its settings button can fix it. */
function problemOf(error: string | null): Exclude<StartResult, "started"> | null {
  if (error === START_PROBLEM.denied) return "denied";
  if (error === START_PROBLEM.servicesOff) return "servicesOff";
  return null;
}

/** A button to the settings that fix a failed start (location off, or not allowed). */
function SettingsFix({ error }: { error: string | null }): ReactNode {
  const problem = problemOf(error);
  if (!problem) return null;
  return (
    <Button
      label={settingsLabel(problem)}
      variant="secondary"
      onPress={() => void openLocationSettings(problem)}
    />
  );
}

/** What to do when the server refuses this phone's fixes (see location/task.ts). */
const SEND_PROBLEM: Record<SendProblem, string> = {
  clock:
    "Your phone's clock is ahead, so the people following can't see where you are. Turn on automatic date and time in Settings.",
  refused:
    "Lumiback isn't accepting this phone's location, so the people following can't see where you are. Try stopping and starting the share.",
};

function message(e: unknown): string {
  return e instanceof ApiError ? e.detail : "Something went wrong. Try again.";
}

/** The Share half of the Live tab: start, run and stop a live share. */
export function SharePanel({ header }: { header: ReactNode }): ReactNode {
  const c = useColors();
  const load = useCallback(async () => {
    const [mine, stored, serviceOn] = await Promise.all([
      api<ShareSession[]>("/sessions/mine"),
      sendingShareIds().catch((): string[] => []),
      isSending(),
    ]);
    // A safe-return share (started by checking out) runs on this phone's service too, so it
    // counts: otherwise opening Live would stop sending for it below. Both can run at once (a
    // share started here, then a check-out): the phone sends for both, and this tab shows the
    // one started here, with a line about the other.
    const running = mine.filter((s) => s.status === "active");
    const app = running.find((s) => s.source === "app") ?? null;
    const outing = running.find((s) => s.source === "outing") ?? null;
    const active = app ?? outing;
    // A share that ended elsewhere (web, expiry, idle close): stop sending for it here too,
    // leaving any other share sending.
    const live = new Set(running.map((s) => s.id));
    for (const id of stored.filter((id) => !live.has(id))) await stopSending(id);
    // What viewers see: the last position the server has (sharers can read their own). A map
    // hiccup must not hide the share: without it the Start form would invite a second one.
    const [positions, looks, problem] = active
      ? await Promise.all([
          api<Positions>(`/sessions/${active.id}/location`).catch((): Positions => ({
            location: null,
          })),
          // Who looked, including the hostel office following up a late return.
          api<AccessLogEntry[]>(`/sessions/${active.id}/access-log`).catch(() => []),
          sendProblem(active.id),
        ])
      : [{ location: null }, [], null];
    return {
      active,
      // Sending for this share, not only for another one.
      sending: Boolean(active) && serviceOn && stored.includes(active?.id ?? ""),
      // The safe-return share running beside a share started here.
      alsoOuting: app && outing ? outing : null,
      positions,
      looks,
      problem,
    };
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
      scan={live}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void reload()}
          colors={[c.accent]}
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
          problem={data.problem}
          alsoOuting={data.alsoOuting !== null}
          positions={data.positions}
          looks={data.looks}
          onChange={refetch}
        />
      ) : data ? (
        <Start onStarted={reload} />
      ) : (
        // Never the Start form when it couldn't tell whether a share is running: starting one
        // on top of a running share would leave the first one's viewers with a frozen map.
        <LoadFailed
          title="Couldn't load your sharing"
          message={error}
          after="Your share, if one is running, appears here."
          busy={refreshing}
          onRetry={reload}
        />
      )}
      {data ? <FormError message={error} /> : null}
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
        <SettingsFix error={error} />
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
  problem,
  alsoOuting,
  positions,
  looks,
  onChange,
}: {
  share: ShareSession;
  sending: boolean;
  /** The server refuses this phone's fixes: viewers see no new position. */
  problem: SendProblem | null;
  /** A safe-return share runs too (checked out while this share was on). */
  alsoOuting: boolean;
  positions: Positions;
  looks: AccessLogEntry[];
  onChange: () => Promise<void>;
}): ReactNode {
  const c = useColors();
  const now = useNow(15_000);
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

  // Stops sending for this share only: a safe-return share running beside it keeps sending.
  const stop = () =>
    run("stop", async () => {
      await stopSending(share.id);
      await api(`/sessions/${share.id}/stop`, { method: "POST", body: {} });
    });

  // Refused fixes never reach viewers, so "Live" would be untrue.
  const reaching = sending && !problem;

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

  const names = watching.map((v) => v.name.split(" ")[0]).join(", ");
  const minutesLeft = Math.round((new Date(share.ends_at).getTime() - now) / 60_000);
  // A share started here counts down to its end; a safe-return one runs until the student is
  // back, so its board just says whether it's on.
  const reading: LedReading =
    share.source === "outing"
      ? {
          text: reaching ? "ON" : "OFF",
          state: "out",
          label: reaching ? "Sharing until you're back" : "Not reaching anyone right now",
        }
      : timeLeft(minutesLeft);

  return (
    <>
      <LedBoard
        glow
        label={
          reaching ? "Sharing live" : sending ? "Not reaching Lumiback" : "Paused on this phone"
        }
        labelTone={reaching ? "in" : "muted"}
        aside={
          share.source === "outing" ? "Until you're back" : `Until ${formatTime(share.ends_at)}`
        }
        reading={reading}
        ticker={watching.length > 0 ? `${names} can see you` : undefined}
      >
        <Text style={[type.body, { color: c.boardMuted }]}>
          {share.source === "outing" && watching.length > 0
            ? `${names} can see you until you tap back in.`
            : watching.length === 0
              ? "Nobody can see you yet. Invite someone below."
              : `${names} can see you.`}
        </Text>
      </LedBoard>

      <View>
        <LiveMap
          point={location}
          fake={fake}
          paused={!reaching || !location || location.stale || fake !== null}
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
            <StatusChip
              label={reaching ? "● Live" : "Paused"}
              tone={reaching ? "good" : "accent"}
            />
          )}
        </View>
      </View>

      <MockNotice state={mock} />

      {sending && problem ? (
        <Card style={{ borderColor: c.accent }}>
          <T tone="headline">Your location isn&apos;t reaching Lumiback</T>
          <T tone="muted">{SEND_PROBLEM[problem]}</T>
        </Card>
      ) : null}

      {alsoOuting ? (
        <Notice>
          Your emergency contact can also follow you until you&apos;re back. Stopping this share
          doesn&apos;t stop theirs.
        </Notice>
      ) : null}

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
      <SettingsFix error={error} />
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
              {entry.kind === "guest" && !entry.contact
                ? `${entry.viewer_name} (guest)`
                : entry.viewer_name}
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
        <Text style={{ fontFamily: fonts.semibold, fontSize: 16, color: c.accentText }}>
          {viewer.name.trim().charAt(0).toUpperCase() || "?"}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <T tone="label" numberOfLines={1}>
          {viewer.name}
        </T>
        {/* Only the server's mark says who the contact is: a guest can copy their name. */}
        <T tone="caption">
          {viewer.contact
            ? "Your emergency contact"
            : viewer.kind === "guest"
              ? "Guest, no account"
              : "Lumiback student"}
        </T>
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
            fontFamily: fonts.semibold,
            fontSize: 30,
            lineHeight: 36,
            letterSpacing: 5,
            color: c.accentText,
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
              <Ionicons
                name={copied ? "checkmark" : "copy-outline"}
                size={18}
                color={c.accentText}
              />
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
            icon={<Ionicons name="share-social-outline" size={18} color={c.accentText} />}
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
