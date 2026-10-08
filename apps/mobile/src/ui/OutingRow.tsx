import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { View } from "react-native";

import { formatMinutes, formatTime } from "@/lib/time";
import type { Outing } from "@/lib/types";
import { StatusChip, T } from "@/ui/kit";
import { radius, space, useColors } from "@/ui/theme";

/**
 * One trip in a grouped list (History, and Recent trips on Today): where, when, how long,
 * on time or late, and whether it was verified at the gate. `first`/`last` round the group.
 */
export function OutingRow({
  outing,
  first,
  last,
}: {
  outing: Outing;
  first: boolean;
  last: boolean;
}): ReactNode {
  const c = useColors();
  const late = outing.late_minutes > 0;
  const chip =
    outing.status === "overdue"
      ? { label: "Overdue", tone: "danger" as const }
      : outing.status === "out"
        ? { label: "Out now", tone: "accent" as const }
        : late
          ? { label: `${formatMinutes(outing.late_minutes)} late`, tone: "danger" as const }
          : { label: "On time", tone: "good" as const };
  const via = outing.out_via === "gate" ? "Verified at gate" : "Self-reported";

  return (
    <View
      accessible
      accessibilityLabel={`${outing.destination ?? "Outing"}, left ${formatTime(outing.left_at)}${
        outing.returned_at ? `, back ${formatTime(outing.returned_at)}` : ""
      }, ${chip.label}, ${via}`}
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
        flexDirection: "row",
        alignItems: "center",
        gap: space(3),
      }}
    >
      <View style={{ flex: 1, gap: space(1) }}>
        <T tone="label" numberOfLines={1} style={{ fontSize: 16, lineHeight: 22 }}>
          {outing.destination ?? "Outing"}
        </T>
        <T tone="caption" style={{ fontVariant: ["tabular-nums"] }}>
          {formatTime(outing.left_at)}
          {outing.returned_at ? ` – ${formatTime(outing.returned_at)}` : ""}
          {outing.duration_minutes != null ? `  ·  ${formatMinutes(outing.duration_minutes)}` : ""}
        </T>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space(1) }}>
          {outing.out_via === "gate" ? (
            <Ionicons name="shield-checkmark" size={13} color={c.good} />
          ) : null}
          <T tone="caption" style={{ color: outing.out_via === "gate" ? c.good : c.muted }}>
            {via}
          </T>
        </View>
      </View>
      <StatusChip label={chip.label} tone={chip.tone} />
    </View>
  );
}
