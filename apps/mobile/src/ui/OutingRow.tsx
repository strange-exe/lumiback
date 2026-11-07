import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { View } from "react-native";

import { correctionStatus, isCancelled } from "@/lib/corrections";
import { formatMinutes, formatTime } from "@/lib/time";
import type { Outing } from "@/lib/types";
import { viaLabel } from "@/lib/words";
import { Press, StatusChip, T } from "@/ui/kit";
import { radius, space, useColors } from "@/ui/theme";

/**
 * One trip in a grouped list (History, and Recent trips on Today): where, when, how long,
 * on time or late, and how much of it the gate verified. `first`/`last` round the group.
 * With `onFix`, the row also offers "Something wrong?" (History, for trips the student can still
 * ask about); a correction on the trip shows its state either way.
 */
export function OutingRow({
  outing,
  first,
  last,
  onFix,
}: {
  outing: Outing;
  first: boolean;
  last: boolean;
  onFix?: () => void;
}): ReactNode {
  const c = useColors();
  const late = outing.late_minutes > 0;
  const cancelled = isCancelled(outing);
  const unrecorded = outing.in_via === "unrecorded";
  const chip = cancelled
    ? { label: "Cancelled", tone: "muted" as const }
    : outing.status === "overdue"
      ? { label: "Late", tone: "danger" as const }
      : outing.status === "out"
        ? { label: "Out now", tone: "accent" as const }
        : unrecorded
          ? { label: "Not recorded", tone: "muted" as const }
          : late
            ? { label: `${formatMinutes(outing.late_minutes)} late`, tone: "danger" as const }
            : { label: "On time", tone: "good" as const };
  const { label: via, verified } = viaLabel(outing);
  const fix = correctionStatus(outing.correction);
  // An unrecorded return's time is only when they next went out: don't present it as theirs.
  const back = outing.returned_at && !unrecorded && !cancelled ? outing.returned_at : null;

  return (
    <View
      style={{
        backgroundColor: c.surface,
        borderColor: c.line,
        borderWidth: 1,
        borderTopWidth: first ? 1 : 0,
        borderTopLeftRadius: first ? radius.sheet : 0,
        borderTopRightRadius: first ? radius.sheet : 0,
        borderBottomLeftRadius: last ? radius.sheet : 0,
        borderBottomRightRadius: last ? radius.sheet : 0,
        paddingHorizontal: space(4),
        paddingVertical: space(4),
        gap: space(3),
      }}
    >
      <View
        accessible
        accessibilityLabel={[
          `${outing.destination ?? "Outing"}, left ${formatTime(outing.left_at)}${back ? `, back ${formatTime(back)}` : ""}`,
          chip.label,
          via,
          fix ? `${fix.label}${fix.detail ? `: ${fix.detail}` : ""}` : null,
        ]
          .filter(Boolean)
          .join(", ")}
        style={{ flexDirection: "row", alignItems: "center", gap: space(3) }}
      >
        {/* A departures-board strip: when on the left, what happened in the middle, status right. */}
        <View style={{ width: 76, gap: space(0.5) }}>
          <T
            tone="label"
            numberOfLines={1}
            style={{ fontSize: 15, lineHeight: 22, fontVariant: ["tabular-nums"] }}
          >
            {formatTime(outing.left_at)}
          </T>
          <T tone="caption" numberOfLines={1} style={{ fontVariant: ["tabular-nums"] }}>
            {back
              ? formatTime(back)
              : !cancelled && (outing.status === "out" || outing.status === "overdue")
                ? "out now"
                : ""}
          </T>
        </View>
        <View style={{ flex: 1, gap: space(1) }}>
          <T tone="label" numberOfLines={1} style={{ fontSize: 16, lineHeight: 22 }}>
            {outing.destination ?? "Outing"}
          </T>
          {back && outing.duration_minutes != null ? (
            <T tone="caption" style={{ fontVariant: ["tabular-nums"] }}>
              {formatMinutes(outing.duration_minutes)} out
            </T>
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: space(1) }}>
            {verified ? <Ionicons name="shield-checkmark" size={13} color={c.good} /> : null}
            <T tone="caption" style={{ color: verified ? c.good : c.muted }}>
              {via}
            </T>
          </View>
          {fix ? (
            <View style={{ gap: space(1), paddingTop: space(1) }}>
              <StatusChip label={fix.label} tone={fix.tone} />
              {fix.detail ? <T tone="caption">{fix.detail}</T> : null}
            </View>
          ) : null}
        </View>
        <StatusChip label={chip.label} tone={chip.tone} />
      </View>
      {onFix ? (
        <Press
          onPress={onFix}
          accessibilityRole="button"
          accessibilityLabel={`Something wrong with ${outing.destination ?? "this outing"}? Ask the hostel office to fix it`}
          style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}
        >
          <T tone="label" style={{ color: c.accentText }}>
            Something wrong?
          </T>
        </Press>
      ) : null}
    </View>
  );
}
