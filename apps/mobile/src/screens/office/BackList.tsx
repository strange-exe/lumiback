import { useState, type ReactNode } from "react";
import { View } from "react-native";

import { office } from "@/lib/office-api";
import { formatTime } from "@/lib/time";
import type { OfficeOuting } from "@/lib/types";
import { viaLabel } from "@/lib/words";
import { CorrectionSheet } from "@/screens/correction-sheet";
import { Press, Section, StatusChip, T } from "@/ui/kit";
import { fonts, space, useColors } from "@/ui/theme";

/** Outings that ended today, latest first. Each can be corrected: a wrong return time, or a
 * mistaken tap (the trip didn't happen), with a reason. */
export function BackList({
  outings,
  onChanged,
}: {
  outings: OfficeOuting[];
  onChanged: () => void;
}): ReactNode {
  const [correcting, setCorrecting] = useState<OfficeOuting | null>(null);
  return (
    <View style={{ gap: space(3) }}>
      <T tone="label" accessibilityRole="header">
        Back today ({outings.length})
      </T>
      {outings.length === 0 ? (
        <T tone="muted" style={{ textAlign: "center", paddingVertical: space(6) }}>
          Nobody has come back yet today.
        </T>
      ) : (
        <Section>
          {outings.map((o) => (
            <BackRow key={o.id} outing={o} onCorrect={() => setCorrecting(o)} />
          ))}
        </Section>
      )}
      {correcting ? (
        <CorrectionSheet
          key={correcting.id}
          target={correcting}
          side="office"
          onClose={() => setCorrecting(null)}
          submit={async (body) => {
            await office.correct(correcting.id, body);
          }}
          onDone={() => {
            setCorrecting(null);
            onChanged();
          }}
        />
      ) : null}
    </View>
  );
}

function BackRow({
  outing: o,
  onCorrect,
}: {
  outing: OfficeOuting;
  onCorrect: () => void;
}): ReactNode {
  const c = useColors();
  const cancelled = o.returned_at === o.left_at;
  const late = o.late_minutes > 0 && !cancelled && o.in_via !== "unrecorded";
  return (
    <View style={{ padding: space(4), gap: space(1.5) }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <T style={{ flex: 1, fontFamily: fonts.semibold }} numberOfLines={1}>
          {o.name}
        </T>
        <StatusChip
          label={cancelled ? "Cancelled" : late ? "Back late" : "Back"}
          tone={cancelled ? "muted" : late ? "danger" : "good"}
        />
      </View>
      <T tone="caption" numberOfLines={1}>
        {[o.roll_no, o.hostel].filter(Boolean).join(", ")}
      </T>
      <T tone="caption">
        {[
          `Left ${formatTime(o.left_at)}`,
          cancelled || !o.returned_at ? null : `back ${formatTime(o.returned_at)}`,
          viaLabel({ out_via: o.out_via, in_via: o.in_via ?? null }).label,
        ]
          .filter(Boolean)
          .join(", ")}
      </T>
      <Press
        onPress={onCorrect}
        accessibilityLabel={`Correct ${o.name}'s outing`}
        style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}
      >
        <T tone="label" style={{ color: c.accentText }}>
          Correct
        </T>
      </Press>
    </View>
  );
}
