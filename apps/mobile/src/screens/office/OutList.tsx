import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ReactNode } from "react";
import { View } from "react-native";

import { formatMinutes, formatTime } from "@/lib/time";
import type { OfficeOuting } from "@/lib/types";
import { Section, Segmented, StatusChip, T } from "@/ui/kit";
import { fonts, space, useColors } from "@/ui/theme";

type Filter = "all" | "late" | "due";

const REPLY = { on_my_way: "On the way", safe: "Says they're safe" } as const;

/** Everyone out now, most urgent first (the API sorts by return time). */
export function OutList({ outings }: { outings: OfficeOuting[] }): ReactNode {
  const [filter, setFilter] = useState<Filter>("all");
  const late = outings.filter((o) => o.status === "overdue");
  const shown =
    filter === "late"
      ? late
      : filter === "due"
        ? outings.filter((o) => o.status !== "overdue")
        : outings;
  return (
    <View style={{ gap: space(4) }}>
      <Segmented
        label="Show"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: `Everyone (${outings.length})` },
          { value: "late", label: `Late (${late.length})` },
          { value: "due", label: "Not yet due" },
        ]}
      />
      {shown.length === 0 ? (
        <T tone="muted" style={{ textAlign: "center", paddingVertical: space(6) }}>
          {filter === "late"
            ? "Nobody is late."
            : "Nobody is out right now. Students appear here when they tap out at a gate or check out in the app."}
        </T>
      ) : (
        <Section>
          {shown.map((o) => (
            <OutRow key={o.id} outing={o} />
          ))}
        </Section>
      )}
    </View>
  );
}

function OutRow({ outing: o }: { outing: OfficeOuting }): ReactNode {
  const c = useColors();
  const isLate = o.status === "overdue";
  return (
    <View style={{ padding: space(4), gap: space(1.5) }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <T style={{ flex: 1, fontFamily: fonts.semibold }} numberOfLines={1}>
          {o.name}
        </T>
        <StatusChip
          label={isLate ? `${formatMinutes(o.late_minutes)} late` : "Out"}
          tone={isLate ? "danger" : "accent"}
        />
      </View>
      <T tone="caption" numberOfLines={1}>
        {[o.roll_no, o.hostel, o.destination ? `to ${o.destination}` : null]
          .filter(Boolean)
          .join(" · ")}
      </T>
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: space(1.5), flexWrap: "wrap" }}
      >
        {o.out_via === "gate" ? (
          <Ionicons name="checkmark-circle" size={14} color={c.good} />
        ) : null}
        <T tone="caption">
          {[
            `Left ${formatTime(o.left_at)}${o.out_via === "gate" && o.out_gate ? ` at ${o.out_gate}` : o.out_via === "self" ? " (self-reported)" : ""}`,
            `due ${formatTime(o.expected_return_at)}`,
            o.late_reply ? REPLY[o.late_reply] : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </T>
      </View>
    </View>
  );
}
