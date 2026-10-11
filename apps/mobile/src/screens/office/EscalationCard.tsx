import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ReactNode } from "react";
import { Linking, View } from "react-native";

import { ApiError } from "@/lib/api";
import { office } from "@/lib/office-api";
import { formatMinutes, formatTime } from "@/lib/time";
import type { Escalation, LastSeen } from "@/lib/types";
import { Contact } from "@/screens/office/Contact";
import { haptic } from "@/ui/haptics";
import { Button, Card, Field, FormError, StatusChip, T } from "@/ui/kit";
import { radius, space, useColors } from "@/ui/theme";

const REPLY = { on_my_way: "Said they're on the way", safe: "Said they're safe" } as const;

/** A late student who didn't answer: who to call, where they were last seen, and "handled". */
export function EscalationCard({
  escalation: e,
  onResolved,
}: {
  escalation: Escalation;
  onResolved: () => void;
}): ReactNode {
  const c = useColors();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = e.resolved_at === null;

  const resolve = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await office.resolve(e.id, note.trim() || null);
      haptic.success();
      onResolved();
    } catch (err) {
      haptic.warning();
      setError(err instanceof ApiError ? err.detail : "Couldn't save that. Try again.");
    } finally {
      setBusy(false);
    }
  };

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
        <StatusChip
          label={
            e.returned_at
              ? `Back, ${formatMinutes(e.late_minutes)} late`
              : `${formatMinutes(e.late_minutes)} late`
          }
          tone={e.returned_at ? "muted" : "danger"}
        />
      </View>
      <T tone="caption">{timeline.join(" · ")}</T>
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
            busy={busy}
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
      <Ionicons name="location-outline" size={18} color={c.accent} style={{ marginTop: 3 }} />
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
            style={{ color: c.accent }}
          >
            Open map
          </T>
        ) : null}
      </View>
    </View>
  );
}
