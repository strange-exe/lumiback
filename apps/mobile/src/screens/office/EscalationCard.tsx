import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ReactNode } from "react";
import { AccessibilityInfo, Linking, View } from "react-native";

import { callLine, claimLine } from "@/lib/alerts";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { everyHostel } from "@/lib/office";
import { office } from "@/lib/office-api";
import { formatMinutes, formatTime } from "@/lib/time";
import type { Escalation, LastSeen } from "@/lib/types";
import { Contact } from "@/screens/office/Contact";
import { LogCallSheet } from "@/screens/office/LogCallSheet";
import { haptic } from "@/ui/haptics";
import { Button, Card, Field, FormError, StatusChip, T } from "@/ui/kit";
import { radius, space, useColors } from "@/ui/theme";

const REPLY = { on_my_way: "Said they're on the way", safe: "Said they're safe" } as const;

/** A late student who didn't answer: who to call, where they were last seen, who is on it,
 * the calls made, and "handled". */
export function EscalationCard({
  escalation: e,
  onChanged,
}: {
  escalation: Escalation;
  onChanged: () => void;
}): ReactNode {
  const c = useColors();
  const { user } = useAuth();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"resolve" | "claim" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const open = e.resolved_at === null;
  const claim = claimLine(e);
  const calls = e.calls ?? [];
  const realerts = e.realerts ?? 0;
  // Whoever claimed it gives it back; a head warden or admin can take it off anyone.
  const canGiveBack = e.claimed_by_me === true || everyHostel(user?.role);

  const run = async (
    kind: NonNullable<typeof busy>,
    call: () => Promise<void>,
    done?: string,
  ): Promise<void> => {
    setBusy(kind);
    setError(null);
    try {
      await call();
      haptic.success();
      if (done) AccessibilityInfo.announceForAccessibility(done);
      onChanged();
    } catch (err) {
      haptic.warning();
      const text = err instanceof ApiError ? err.detail : "Couldn't save that. Try again.";
      setError(text);
      AccessibilityInfo.announceForAccessibility(text);
      // "Someone else is on it" or "already handled": show the card as it is now.
      if (err instanceof ApiError && err.status === 409) onChanged();
    } finally {
      setBusy(null);
    }
  };

  const resolve = (): Promise<void> =>
    run("resolve", () => office.resolve(e.id, note.trim() || null));

  const timeline = [
    `Left ${formatTime(e.left_at)}${e.destination ? ` for ${e.destination}` : ""}`,
    `due back ${formatTime(e.expected_return_at)}`,
    e.alert_at ? `alerted ${formatTime(e.alert_at)}` : null,
    e.returned_at
      ? `back ${formatTime(e.returned_at)}`
      : e.late_reply
        ? REPLY[e.late_reply]
        : "no answer",
  ].filter(Boolean);

  return (
    <Card style={open ? { borderColor: c.danger } : undefined}>
      <View style={{ gap: space(1) }}>
        <T tone="headline">{e.name}</T>
        <T tone="caption">{[e.roll_no, e.hostel].filter(Boolean).join(" · ")}</T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
          <StatusChip
            label={
              e.returned_at
                ? `Back, ${formatMinutes(e.late_minutes)} late`
                : `${formatMinutes(e.late_minutes)} late`
            }
            tone={e.returned_at ? "muted" : "danger"}
          />
          {open && e.handed_over_at ? (
            <StatusChip label="With the head warden" tone="accent" />
          ) : null}
        </View>
      </View>
      <T tone="caption">{timeline.join(" · ")}</T>
      {open ? (
        <View style={{ gap: space(2) }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space(3) }}>
            <View style={{ flex: 1, gap: 2 }}>
              <T tone="label" style={claim ? undefined : { color: c.danger }}>
                {claim ?? "Nobody is on this yet"}
              </T>
              {!e.claimed_by && realerts > 0 ? (
                <T tone="caption">
                  {realerts === 1 ? "Re-alerted once" : `Re-alerted ${realerts} times`} while nobody
                  had it.
                </T>
              ) : null}
            </View>
            {!e.claimed_by ? (
              <Button
                label="I'm on it"
                variant="secondary"
                accessibilityLabel={`I'm on it: follow up ${e.name}`}
                busy={busy === "claim"}
                busyLabel="Saving…"
                onPress={() => void run("claim", () => office.claim(e.id), "You're on it")}
              />
            ) : canGiveBack ? (
              <Button
                label="Give back"
                variant="quiet"
                accessibilityLabel={`Give back ${e.name}'s follow-up`}
                busy={busy === "claim"}
                busyLabel="Saving…"
                style={{ minHeight: 44 }}
                onPress={() => void run("claim", () => office.release(e.id), "Given back")}
              />
            ) : null}
          </View>
        </View>
      ) : null}
      <View style={{ gap: space(3) }}>
        <Contact label="Student" phone={e.phone} />
        <Contact
          label={`Emergency contact${e.emergency_relation ? ` (${e.emergency_relation})` : ""}`}
          name={e.emergency_name}
          phone={e.emergency_phone}
        />
        <Contact
          label={`Warden${e.hostel ? `, ${e.hostel}` : ""}`}
          name={e.warden_name}
          phone={e.warden_phone}
        />
      </View>
      {open && !e.returned_at ? <LastSeenNote seen={e.last_seen} /> : null}
      {calls.length > 0 ? (
        <View style={{ gap: space(1) }}>
          <T tone="label">Calls</T>
          {calls.map((call, i) => (
            <T key={`${call.at}-${i}`} tone="caption">
              {callLine(call)}
            </T>
          ))}
        </View>
      ) : null}
      {open ? (
        <Button
          label="Log a call"
          variant="secondary"
          accessibilityLabel={`Log a call about ${e.name}`}
          icon={<Ionicons name="call-outline" size={18} color={c.accentText} />}
          onPress={() => setLogging(true)}
        />
      ) : null}
      {logging ? (
        <LogCallSheet
          escalationId={e.id}
          name={e.name}
          onClose={() => setLogging(false)}
          onDone={() => {
            setLogging(false);
            onChanged();
          }}
        />
      ) : null}
      {open ? (
        <View
          style={{ gap: space(3), borderTopWidth: 1, borderTopColor: c.line, paddingTop: space(4) }}
        >
          <Field
            label="What happened"
            placeholder="Called her mother: the bus was late"
            value={note}
            onChangeText={setNote}
            maxLength={200}
          />
          <FormError message={error} />
          <Button
            label="Mark as handled"
            onPress={() => void resolve()}
            busy={busy === "resolve"}
            busyLabel="Saving…"
          />
        </View>
      ) : (
        <T tone="caption">
          Handled by {e.resolved_by ?? "the hostel office"}
          {e.resolved_at ? `, ${formatTime(e.resolved_at)}` : ""}
          {e.note ? `: "${e.note}"` : ""}
        </T>
      )}
    </Card>
  );
}

function LastSeenNote({ seen }: { seen: LastSeen | null }): ReactNode {
  const c = useColors();
  let text: string;
  let map: string | null = null;
  if (!seen) {
    text =
      "No known position: they aren't sharing their location and haven't scanned at a gate. Lumiback doesn't track students.";
  } else if (seen.kind === "gate") {
    text = `Last seen at ${seen.gate ?? "a gate"}, ${formatTime(seen.at)} (gate scan).`;
  } else if (seen.lat === null || seen.lng === null) {
    text = "Sharing, but only a faked location. There is no real position to show.";
  } else {
    text = `Sharing live: last real position ${formatTime(seen.at)}, accurate to about ${Math.round(seen.accuracy_m ?? 0)} m.`;
    map = `https://www.openstreetmap.org/?mlat=${seen.lat}&mlon=${seen.lng}#map=17/${seen.lat}/${seen.lng}`;
  }
  return (
    <View
      style={{
        flexDirection: "row",
        gap: space(2),
        padding: space(3),
        borderRadius: radius.control,
        backgroundColor: c.accentSoft,
      }}
    >
      <Ionicons name="location-outline" size={18} color={c.accentText} style={{ marginTop: 3 }} />
      <View style={{ flex: 1, gap: space(1) }}>
        <T>{text}</T>
        {seen?.mock_since && seen.lat !== null ? (
          <T style={{ color: c.danger }}>
            Their phone has reported a faked location since {formatTime(seen.mock_since)}.
          </T>
        ) : null}
        {map ? (
          <T
            accessibilityRole="link"
            onPress={() => void Linking.openURL(map).catch(() => undefined)}
            style={{ color: c.accentText }}
          >
            Open map
          </T>
        ) : null}
      </View>
    </View>
  );
}
