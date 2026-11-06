import { useFocusEffect } from "expo-router";
import { useCallback, useState, type ReactNode } from "react";
import { RefreshControl, Text, View } from "react-native";

import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { clockText, correctionAsk, dayText, istDay } from "@/lib/corrections";
import { everyHostel } from "@/lib/office";
import { office } from "@/lib/office-api";
import type { Correction, OfficeOuting } from "@/lib/types";
import { useData } from "@/lib/use-data";
import { CorrectionSheet } from "@/screens/correction-sheet";
import { haptic } from "@/ui/haptics";
import { Button, Card, Field, FormError, Heading, Screen, StatusChip, T } from "@/ui/kit";
import { fonts, space, type, useColors } from "@/ui/theme";

const POLL_MS = 30_000;

/** "Tue 4 Nov, 7:40 pm" on the campus clock. */
function when(iso: string): string {
  return `${dayText(istDay(iso))}, ${clockText(iso)}`;
}

/** The outing as the record has it now, in one line. */
function outingLine(o: OfficeOuting): string {
  const back =
    o.in_via === "unrecorded"
      ? "return time not recorded"
      : o.returned_at
        ? `back ${when(o.returned_at)}`
        : "still out";
  return `Left ${when(o.left_at)}, ${back}`;
}

/**
 * The office's corrections: students asking to fix an outing (approve or decline), and returns
 * the gate never saw (a student went out again on a later day without tapping in), whose time
 * the office sets. Opened from the office's Today and from the "correction asked" push.
 */
export default function Corrections(): ReactNode {
  const { user } = useAuth();
  const c = useColors();
  const load = useCallback(() => office.corrections(), []);
  const { data, error, loading, refreshing, reload, refetch } = useData(load);
  const [fixing, setFixing] = useState<OfficeOuting | null>(null);

  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(() => void refetch(), POLL_MS);
      return () => clearInterval(timer);
    }, [refetch]),
  );

  const scope = everyHostel(user?.role)
    ? "Every hostel's students."
    : "Your hostels' students only.";

  return (
    <Screen
      edges={["bottom"]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void reload()}
          colors={[c.accent]}
          tintColor={c.accent}
        />
      }
    >
      <Heading
        title="Corrections"
        lede={`Forgotten tap-ins and mistaken taps. Every change keeps the old time and your reason. ${scope}`}
      />

      {error && !data ? (
        <T tone="muted" accessibilityRole="alert">
          {error} Pull down to try again.
        </T>
      ) : loading && !data ? (
        <T tone="muted">Loading…</T>
      ) : data ? (
        <>
          <FormError message={error} />
          <View style={{ gap: space(3) }}>
            <Text style={[type.eyebrow, { color: c.muted, paddingHorizontal: space(1) }]}>
              Asked by students
            </Text>
            {data.asks.length === 0 ? (
              <Empty text="No asks waiting. Students ask from their History when a time is wrong." />
            ) : (
              data.asks.map((a) => (
                <AskCard
                  key={a.correction.id}
                  correction={a.correction}
                  outing={a.outing}
                  onDecided={() => void refetch()}
                />
              ))
            )}
          </View>

          <View style={{ gap: space(3) }}>
            <Text style={[type.eyebrow, { color: c.muted, paddingHorizontal: space(1) }]}>
              Return times to fix
            </Text>
            <T tone="caption" style={{ paddingHorizontal: space(1) }}>
              These students went out again on a later day without tapping in, so when they came
              back isn&apos;t known. They aren&apos;t counted as late.
            </T>
            {data.unrecorded.length === 0 ? (
              <Empty text="Nothing to fix." />
            ) : (
              data.unrecorded.map((o) => (
                <Card key={o.id} flat>
                  <View style={{ gap: space(1) }}>
                    <T style={{ fontFamily: fonts.semibold }}>{o.name}</T>
                    <T tone="caption">
                      {[o.roll_no, o.hostel, o.destination ? `to ${o.destination}` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </T>
                    <T tone="caption">{outingLine(o)}</T>
                  </View>
                  <Button
                    label="Set return time"
                    variant="secondary"
                    accessibilityLabel={`Set ${o.name}'s return time`}
                    onPress={() => setFixing(o)}
                  />
                </Card>
              ))
            )}
          </View>
        </>
      ) : null}

      {fixing ? (
        <CorrectionSheet
          key={fixing.id}
          target={fixing}
          side="office"
          onClose={() => setFixing(null)}
          submit={async (body) => {
            await office.correct(fixing.id, body);
          }}
          onDone={() => {
            setFixing(null);
            void reload();
          }}
        />
      ) : null}
    </Screen>
  );
}

/** One student's ask: what the record says, what they say happened and why, and a decision. */
function AskCard({
  correction,
  outing,
  onDecided,
}: {
  correction: Correction;
  outing: OfficeOuting;
  onDecided: () => void;
}): ReactNode {
  const c = useColors();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (approve: boolean): Promise<void> => {
    setBusy(approve ? "approve" : "decline");
    setError(null);
    try {
      await office.decideCorrection(correction.id, approve, note.trim() || null);
      haptic.success();
      onDecided();
    } catch (e) {
      haptic.warning();
      setError(e instanceof ApiError ? e.detail : "Couldn't save that. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <View style={{ gap: space(1) }}>
        <T tone="headline">{outing.name}</T>
        <T tone="caption">{[outing.roll_no, outing.hostel].filter(Boolean).join(" · ")}</T>
        <StatusChip label="Waiting for you" tone="accent" />
      </View>
      <View style={{ gap: space(1) }}>
        <T tone="label" style={{ color: c.muted }}>
          On record
        </T>
        <T>{outingLine(outing)}</T>
      </View>
      <View style={{ gap: space(1) }}>
        <T tone="label" style={{ color: c.muted }}>
          They say
        </T>
        <T style={{ fontFamily: fonts.semibold }}>{correctionAsk(correction)}</T>
        <T>&ldquo;{correction.reason}&rdquo;</T>
        <T tone="caption">Asked {when(correction.created_at)}</T>
      </View>
      <View
        style={{ gap: space(3), borderTopWidth: 1, borderTopColor: c.line, paddingTop: space(4) }}
      >
        <Field
          label="Note to the student (optional)"
          value={note}
          onChangeText={setNote}
          maxLength={300}
        />
        <FormError message={error} />
        <View style={{ flexDirection: "row", gap: space(3) }}>
          <View style={{ flex: 1 }}>
            <Button
              label="Approve"
              accessibilityLabel={`Approve ${outing.name}'s correction`}
              onPress={() => void decide(true)}
              busy={busy === "approve"}
              busyLabel="Approving…"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label="Decline"
              variant="secondary"
              accessibilityLabel={`Decline ${outing.name}'s correction`}
              onPress={() => void decide(false)}
              busy={busy === "decline"}
              busyLabel="Declining…"
            />
          </View>
        </View>
      </View>
    </Card>
  );
}

function Empty({ text }: { text: string }): ReactNode {
  return (
    <T tone="muted" style={{ textAlign: "center", paddingVertical: space(6) }}>
      {text}
    </T>
  );
}
