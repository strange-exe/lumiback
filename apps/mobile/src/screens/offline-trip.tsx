import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Alert, Linking, Text, View } from "react-native";

import { telHref } from "@/lib/alerts";
import { IN, timeLate, timeLeft } from "@/lib/led";
import { formatPhone } from "@/lib/office";
import { formatTime } from "@/lib/time";
import type { OfflineView } from "@/lib/today-cache";
import { useNow } from "@/lib/use-now";
import { haptic } from "@/ui/haptics";
import { Button, T } from "@/ui/kit";
import { LedBoard } from "@/ui/led";
import { radius, space, type, useColors } from "@/ui/theme";

function call(phone: string): void {
  Linking.openURL(telHref(phone)).catch(() =>
    Alert.alert("Couldn't start a call", `Call ${formatPhone(phone)} from your phone app.`),
  );
}

/**
 * Today while Lumiback can't be reached: the last trip it showed, marked with when, and
 * read-only. Only what works without the server is offered: calling the hostel office.
 */
export function OfflineTrip({
  view,
  onRetry,
  busy = false,
}: {
  view: OfflineView;
  /** Today's pull-down retry as a button; the launch screen has its own. */
  onRetry?: () => void;
  busy?: boolean;
}): ReactNode {
  const c = useColors();
  const now = useNow(15_000);
  const o = view.outing;
  const dueMs = o ? Date.parse(o.expected_return_at) : 0;
  // The due time can't move while offline, so the countdown stays true from the phone's clock.
  const late = o !== null && now > dueMs;
  const minutesLeft = Math.round((dueMs - now) / 60_000);
  const phone = o?.office?.phone ?? null;

  return (
    <View style={{ gap: space(4) }}>
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={`${view.asOf}. Lumiback can't be reached, so this can't change until it can.`}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space(3),
          backgroundColor: c.warnSoft,
          borderRadius: radius.control,
          borderCurve: "continuous",
          padding: space(4),
        }}
      >
        <Ionicons name="cloud-offline-outline" size={22} color={c.warn} />
        <View style={{ flex: 1, gap: 2 }}>
          <T tone="label" style={{ color: c.warn }}>
            {view.asOf}
          </T>
          <T tone="caption" style={{ color: c.ink }}>
            Lumiback can&apos;t be reached, so this is the last thing it showed.
          </T>
        </View>
      </View>

      {o ? (
        <LedBoard
          label={late ? "Late by" : "Time left"}
          labelTone={late ? "late" : "muted"}
          aside={o.out_via === "gate" ? "Verified at the gate" : "Self-reported"}
          asideTone={o.out_via === "gate" ? "in" : "muted"}
          reading={late ? timeLate(-minutesLeft) : timeLeft(minutesLeft)}
        >
          <Text style={[type.title, { color: c.onBoard }]} numberOfLines={2}>
            {o.destination ?? "Out and about"}
          </Text>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(3) }}>
            <View style={{ gap: space(0.5) }}>
              <Text style={[type.caption, { color: c.boardMuted }]}>Left</Text>
              <Text style={[type.label, { color: c.onBoard, fontVariant: ["tabular-nums"] }]}>
                {formatTime(o.left_at)}
              </Text>
            </View>
            <View style={{ gap: space(0.5), alignItems: "flex-end" }}>
              <Text style={[type.caption, { color: c.boardMuted }]}>Back by</Text>
              <Text style={[type.label, { color: c.onBoard, fontVariant: ["tabular-nums"] }]}>
                {formatTime(o.expected_return_at)}
              </Text>
            </View>
          </View>
          {o.original_return_at && view.due ? (
            <Text style={[type.caption, { color: c.boardMuted }]}>{view.due}</Text>
          ) : null}
        </LedBoard>
      ) : (
        <LedBoard label="On campus" labelTone="in" reading={IN}>
          <Text style={[type.title, { color: c.onBoard }]}>You were on campus</Text>
        </LedBoard>
      )}

      <T tone="muted">
        {o
          ? "Tapping in, I'm back, running late and Help alerts need a connection. Calling the hostel office doesn't."
          : "Tapping out needs a connection."}
      </T>

      {phone ? (
        <Button
          label="Call the hostel office"
          variant="secondary"
          accessibilityLabel={`Call the hostel office, ${formatPhone(phone)}`}
          icon={<Ionicons name="call" size={18} color={c.accentText} />}
          onPress={() => {
            haptic.tap();
            call(phone);
          }}
        />
      ) : null}
      {onRetry ? (
        <Button
          label="Try again"
          variant={phone ? "quiet" : "secondary"}
          busy={busy}
          busyLabel="Connecting…"
          onPress={onRetry}
        />
      ) : null}
    </View>
  );
}
