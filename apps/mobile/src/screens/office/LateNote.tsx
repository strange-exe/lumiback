import type { ReactNode } from "react";
import { View } from "react-native";

import { officeLateNote, type RunningLateFields } from "@/lib/running-late";
import { formatTime } from "@/lib/time";
import { T } from "@/ui/kit";
import { space } from "@/ui/theme";

/**
 * The student said they were running late: by how much, the time it replaced, and their
 * reason (office only; followers never see the reason). Nothing when they didn't.
 */
export function LateNote({ outing }: { outing: RunningLateFields }): ReactNode {
  const note = officeLateNote(outing, formatTime);
  if (!note) return null;
  return (
    <View style={{ gap: space(0.5) }}>
      <T tone="caption">{note.moved}</T>
      {note.reason ? <T tone="caption">{`Reason: ${note.reason}`}</T> : null}
    </View>
  );
}
