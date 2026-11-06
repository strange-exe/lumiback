import { useState, type ReactNode } from "react";
import { View } from "react-native";

import { ApiError } from "@/lib/api";
import {
  clockText,
  dayChoices,
  dayText,
  istDay,
  reasonError,
  returnAt,
  timeKind,
} from "@/lib/corrections";
import type { CorrectionBody, InVia } from "@/lib/types";
import { haptic } from "@/ui/haptics";
import { Button, Chips, Field, FormError, T } from "@/ui/kit";
import { Sheet } from "@/ui/sheet";
import { space } from "@/ui/theme";

/** The outing being corrected: the fields every list here has. */
export interface CorrectionTarget {
  id: string;
  left_at: string;
  returned_at?: string | null;
  in_via?: InVia | null;
  destination?: string | null;
  /** The student's name, on the office's side. */
  name?: string;
}

type Choice = "time" | "cancel";

/**
 * One form for both sides of a correction. A student asks ("I came back at...", or "This trip
 * didn't happen", with a reason) and the hostel office decides; the office records a return or
 * fixes its time directly, with a reason. Times are typed on the campus clock (IST), whatever
 * the phone's timezone. Mount it with a `key` per outing so each opens fresh.
 */
export function CorrectionSheet({
  target,
  side,
  onClose,
  submit,
  onDone,
}: {
  target: CorrectionTarget;
  side: "student" | "office";
  onClose: () => void;
  /** Sends the correction; throws ApiError with the server's reason when refused. */
  submit: (body: CorrectionBody) => Promise<void>;
  onDone: () => void;
}): ReactNode {
  const [now] = useState(() => Date.now());
  const open = !target.returned_at;
  const unrecorded = target.in_via === "unrecorded";
  const days = dayChoices(target.left_at, now);
  const [choice, setChoice] = useState<Choice>("time");
  const [day, setDay] = useState(() =>
    open
      ? istDay(now)
      : unrecorded || !target.returned_at
        ? istDay(target.left_at)
        : istDay(target.returned_at),
  );
  // The office records a return as it happens: now. A student types when they really came back;
  // a closed trip starts from the time on record, so only the wrong part needs changing.
  const [time, setTime] = useState(() =>
    open
      ? side === "office"
        ? clockText(now)
        : ""
      : unrecorded || !target.returned_at
        ? ""
        : clockText(target.returned_at),
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title =
    side === "student"
      ? "Something wrong?"
      : open
        ? "Record return"
        : unrecorded
          ? "Set the return time"
          : "Correct this outing";

  const send = async (): Promise<void> => {
    const problem = reasonError(reason);
    let body: CorrectionBody;
    if (choice === "cancel") {
      if (problem) return setError(problem);
      body = { kind: "cancel", reason: reason.trim() };
    } else {
      const at = returnAt(day, time, target.left_at, Date.now());
      if ("error" in at) return setError(at.error);
      if (problem) return setError(problem);
      body = {
        kind: timeKind({ returned_at: target.returned_at ?? null }),
        returned_at: at.iso,
        reason: reason.trim(),
      };
    }
    setBusy(true);
    setError(null);
    try {
      await submit(body);
      haptic.success();
      onDone();
    } catch (e) {
      haptic.warning();
      setError(e instanceof ApiError ? e.detail : "Couldn't send that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const left = `${dayText(istDay(target.left_at))}, ${clockText(target.left_at)}`;

  return (
    <Sheet open onClose={onClose} title={title}>
      <View style={{ gap: space(1) }}>
        {target.name ? <T tone="label">{target.name}</T> : null}
        <T tone="muted">
          {[
            target.destination ? `To ${target.destination}` : null,
            `Left ${left}`,
            target.returned_at && !unrecorded
              ? `back ${dayText(istDay(target.returned_at))}, ${clockText(target.returned_at)}`
              : unrecorded
                ? "return time not recorded"
                : "still open",
          ]
            .filter(Boolean)
            .join(", ")}
        </T>
      </View>

      <Chips
        label="What happened?"
        value={choice}
        onChange={(next) => {
          setChoice(next);
          setError(null);
        }}
        options={[
          {
            value: "time",
            label:
              side === "student" ? "I came back at…" : open ? "They came back" : "Fix the time",
          },
          { value: "cancel", label: "This trip didn't happen" },
        ]}
      />

      {choice === "time" ? (
        <View style={{ gap: space(4) }}>
          {days.length > 1 ? (
            <Chips label="Day" value={day} onChange={setDay} options={days} />
          ) : null}
          <Field
            label="Time (India time)"
            hint={
              days.length > 1 ? "For example 7:40 pm." : `On ${dayText(day)}. For example 7:40 pm.`
            }
            value={time}
            onChangeText={setTime}
            placeholder="7:40 pm"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={10}
          />
        </View>
      ) : (
        <T tone="muted">
          {side === "student"
            ? "If the hostel office agrees it was a mistaken tap, the trip is marked cancelled."
            : "A mistaken tap: the trip is marked cancelled, and its times are kept with the record."}
        </T>
      )}

      <Field
        label="Reason"
        hint={
          side === "student"
            ? "The hostel office sees this. Nothing changes until they approve."
            : "Kept with the record, and shown to the student."
        }
        value={reason}
        onChangeText={setReason}
        placeholder={side === "student" ? "Forgot to tap in at the gate" : "Warden saw them return"}
        multiline
        maxLength={300}
      />
      <FormError message={error} />
      <Button
        label={side === "student" ? "Send to the hostel office" : "Save"}
        busy={busy}
        busyLabel={side === "student" ? "Sending…" : "Saving…"}
        onPress={() => void send()}
      />
    </Sheet>
  );
}
