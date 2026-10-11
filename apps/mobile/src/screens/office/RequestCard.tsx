import { useState, type ReactNode } from "react";
import { View } from "react-native";

import { ApiError } from "@/lib/api";
import { office } from "@/lib/office-api";
import { formatMinutes, formatTime } from "@/lib/time";
import type { OfficeRequest } from "@/lib/types";
import { Contact } from "@/screens/office/Contact";
import { haptic } from "@/ui/haptics";
import { Button, Card, Field, FormError, StatusChip, T } from "@/ui/kit";
import { space, useColors } from "@/ui/theme";

const STATUS: Record<
  OfficeRequest["status"],
  { label: string; tone: "accent" | "good" | "danger" | "muted" }
> = {
  pending: { label: "Waiting for you", tone: "accent" },
  approved: { label: "Approved", tone: "good" },
  declined: { label: "Declined", tone: "danger" },
  cancelled: { label: "Cancelled by the student", tone: "muted" },
};

/** One outing form: who, why, how long, their contacts, and (while waiting) a decision. */
export function RequestCard({
  request,
  onDecided,
}: {
  request: OfficeRequest;
  onDecided: () => void;
}): ReactNode {
  const c = useColors();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = STATUS[request.status];
  const length = request.requested_minutes ?? request.max_minutes;

  const decide = async (approve: boolean): Promise<void> => {
    const text = note.trim();
    if (!approve && !text) {
      setError("Write a note for the student first: it tells them why.");
      return;
    }
    setBusy(approve ? "approve" : "decline");
    setError(null);
    try {
      await office.decide(request.id, approve, text || null);
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
        <T tone="headline">{request.name}</T>
        <T tone="caption">{[request.roll_no, request.hostel].filter(Boolean).join(" · ")}</T>
        <StatusChip label={status.label} tone={status.tone} />
      </View>
      <View style={{ gap: space(1) }}>
        <T>{request.purpose}</T>
        <T tone="caption">
          {[
            length ? `For ${formatMinutes(length)}` : "Until the day's return time",
            `asked ${formatTime(request.created_at)}`,
          ].join(" · ")}
        </T>
      </View>
      <View style={{ gap: space(3) }}>
        <Contact label="Student" phone={request.phone} />
        <Contact
          label={`Emergency contact (${request.emergency_relation})`}
          name={request.emergency_name}
          phone={request.emergency_phone}
        />
      </View>
      {request.status === "pending" ? (
        <View
          style={{ gap: space(3), borderTopWidth: 1, borderTopColor: c.line, paddingTop: space(4) }}
        >
          <Field
            label="Note to the student"
            hint="Needed when declining."
            value={note}
            onChangeText={setNote}
            maxLength={200}
          />
          <FormError message={error} />
          {/* Button's style lands inside its pressable, so the halves are sized here. */}
          <View style={{ flexDirection: "row", gap: space(3) }}>
            <View style={{ flex: 1 }}>
              <Button
                label="Approve"
                onPress={() => void decide(true)}
                busy={busy === "approve"}
                busyLabel="Approving…"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label="Decline"
                variant="secondary"
                onPress={() => void decide(false)}
                busy={busy === "decline"}
                busyLabel="Declining…"
              />
            </View>
          </View>
        </View>
      ) : request.decided_by && request.decided_at ? (
        <T tone="caption">
          {request.status === "approved" ? "Approved" : "Declined"} by {request.decided_by},{" "}
          {formatTime(request.decided_at)}
          {request.note ? `: "${request.note}"` : ""}
          {request.used ? " · used" : ""}
        </T>
      ) : null}
    </Card>
  );
}
