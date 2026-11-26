import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { formatTime } from "@/lib/time";
import type { Outing } from "@/lib/types";
import { fonts, space, type, useColors } from "@/ui/theme";

/** Where the trip is, in four steps: left, out now, due (or late), in. */
export function PhaseStrip({ outing, overdue }: { outing: Outing; overdue: boolean }): ReactNode {
  const c = useColors();
  const due = formatTime(outing.expected_return_at);
  // A word plus an optional time, on two lines, so a long time wraps at its space instead of being cut.
  const steps = [
    { word: "Left", time: formatTime(outing.left_at), state: "done" },
    { word: "Out now", time: null, state: overdue ? "done" : "now" },
    {
      word: overdue ? "Late" : "Due",
      time: overdue ? null : due,
      state: overdue ? "late" : "next",
    },
    { word: "In", time: null, state: "next" },
  ] as const;
  return (
    <View
      accessible
      accessibilityLabel={`Left ${formatTime(outing.left_at)}, ${overdue ? `late, was due ${due}` : `out now, due ${due}`}, not back in yet`}
      style={{ flexDirection: "row", gap: space(1.5) }}
    >
      {steps.map((s) => {
        const bar =
          s.state === "done"
            ? c.ink
            : s.state === "now"
              ? c.led
              : s.state === "late"
                ? c.danger
                : c.line;
        const ink = s.state === "next" ? c.muted : s.state === "late" ? c.danger : c.ink;
        return (
          <View key={s.word} style={{ flex: 1, gap: space(2) }}>
            <View style={{ height: 3, borderRadius: 2, backgroundColor: bar }} />
            <Text
              style={[
                type.caption,
                {
                  color: ink,
                  fontFamily:
                    s.state === "now" || s.state === "late" ? fonts.semibold : fonts.medium,
                  fontVariant: ["tabular-nums"],
                },
              ]}
            >
              {s.time ? `${s.word}\n${s.time}` : s.word}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
