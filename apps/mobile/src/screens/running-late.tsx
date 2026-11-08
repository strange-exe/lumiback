import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ReactNode } from "react";
import { AccessibilityInfo, View } from "react-native";

import { ApiError } from "@/lib/api";
import {
  choiceLabel,
  confirmLine,
  lateChoices,
  MAX_LATE_REASON,
  runningLateBody,
  runningLateError,
  type LateMinutes,
  type RunningLateBody,
} from "@/lib/running-late";
import { student } from "@/lib/student-api";
import type { Outing } from "@/lib/types";
import { haptic } from "@/ui/haptics";
import { Button, Chips, Field, FormError, T } from "@/ui/kit";
import { Sheet } from "@/ui/sheet";
import { space, useColors } from "@/ui/theme";

/**
 * "Running late?" while out: shown only when the server offers a choice (once per outing, until
 * the late alert has gone out). Choose 15, 30 or 60 minutes and an optional reason, confirm the
 * new time, then the hostel office and the people following are told.
 */
export function RunningLate({
  outing,
  onDone,
}: {
  outing: Outing;
  onDone: () => Promise<void>;
}): ReactNode {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const choices = lateChoices(outing.running_late_choices);
  if (choices.length === 0) return null;
  return (
    <>
      <Button
        label="Running late?"
        variant="secondary"
        accessibilityLabel="Running late? Move your due-back time, once per outing"
        icon={<Ionicons name="time-outline" size={18} color={c.accentText} />}
        onPress={() => {
          haptic.tap();
          setOpen(true);
        }}
      />
      {open ? (
        <RunningLateSheet
          key={outing.id}
          due={outing.expected_return_at}
          choices={choices}
          onClose={() => setOpen(false)}
          onDone={async () => {
            setOpen(false);
            await onDone();
          }}
        />
      ) : null}
    </>
  );
}

function RunningLateSheet({
  due,
  choices,
  onClose,
  onDone,
}: {
  due: string;
  choices: LateMinutes[];
  onClose: () => void;
  onDone: () => Promise<void>;
}): ReactNode {
  const [minutes, setMinutes] = useState<LateMinutes>(choices[0] ?? 15);
  const [reason, setReason] = useState("");
  // Set once the form checks out: the confirm step sends exactly this.
  const [confirming, setConfirming] = useState<RunningLateBody | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = (): void => {
    const checked = runningLateBody(minutes, reason);
    if ("error" in checked) {
      setError(checked.error);
      return;
    }
    setError(null);
    setConfirming(checked.body);
  };

  const send = async (body: RunningLateBody): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await student.runningLate(body);
      haptic.success();
      AccessibilityInfo.announceForAccessibility("The hostel office has been told.");
      await onDone();
    } catch (e) {
      haptic.warning();
      setError(
        e instanceof ApiError
          ? runningLateError(e.status, e.detail)
          : "Something went wrong. Try again.",
      );
      setBusy(false);
    }
  };

  if (confirming) {
    return (
      <Sheet open onClose={busy ? () => undefined : onClose} title="Move your due-back time?">
        <T>{confirmLine(due, confirming.minutes)}</T>
        {confirming.reason ? <T tone="muted">{`Reason: ${confirming.reason}`}</T> : null}
        <FormError message={error} />
        <View style={{ gap: space(2) }}>
          <Button
            label="Tell the hostel office"
            busy={busy}
            busyLabel="Sending…"
            onPress={() => void send(confirming)}
          />
          {busy ? null : (
            <Button label="Back" variant="quiet" onPress={() => setConfirming(null)} />
          )}
        </View>
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={onClose} title="Running late?">
      <T tone="muted">
        Move your due-back time once per outing. The hostel office is told, and so are the people
        you share your location with.
      </T>
      <Chips
        label="How much later"
        options={choices.map((m) => ({ value: String(m), label: choiceLabel(m) }))}
        value={String(minutes)}
        onChange={(value) => setMinutes(Number(value) as LateMinutes)}
      />
      <Field
        label="Reason (optional)"
        hint="Only the hostel office sees this."
        value={reason}
        onChangeText={setReason}
        placeholder="The bus is running late"
        maxLength={MAX_LATE_REASON}
        returnKeyType="done"
      />
      <FormError message={error} />
      <Button label="Continue" onPress={next} />
    </Sheet>
  );
}
