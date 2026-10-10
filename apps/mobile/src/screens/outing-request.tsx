import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";

import { api, ApiError } from "@/lib/api";
import { lengthOptions } from "@/lib/rules";
import type { OutingRequest, Profile, TodayRules } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import { haptic } from "@/ui/haptics";
import { Button, Chips, Field, FormError, T } from "@/ui/kit";
import { Sheet } from "@/ui/sheet";
import { space } from "@/ui/theme";

/** "full" (the day's allowance) or a shorter outing in whole minutes, e.g. "120". */
type Length = string;

function message(e: unknown): string {
  return e instanceof ApiError ? e.detail : "Something went wrong. Try again.";
}

/**
 * The outing request form, for days that need approval (currently Sundays and holidays): purpose, the student's number and an emergency contact
 * (prefilled from their profile, and saved back to it), and optionally a shorter outing than the
 * day allows. An admin approves it; then the gate lets them out once.
 */
export function RequestSheet({
  open,
  rules,
  onClose,
  onSent,
}: {
  open: boolean;
  rules: TodayRules;
  onClose: () => void;
  onSent: () => Promise<void>;
}): ReactNode {
  const [purpose, setPurpose] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [emergency, setEmergency] = useState("");
  const [length, setLength] = useState<Length>("full");
  const now = useNow(60_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void api<Profile>("/profile")
      .then((p) => {
        if (!alive) return;
        // Prefill only what's empty: never overwrite what the student is typing.
        setPhone((v) => v || p.phone || "");
        setName((v) => v || p.emergency_name || "");
        setRelation((v) => v || p.emergency_relation || "");
        setEmergency((v) => v || p.emergency_phone || "");
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [open]);

  const lengths: { value: Length; label: string }[] = lengthOptions(rules, now).map((o) => ({
    value: o.minutes === null ? "full" : String(o.minutes),
    label: o.label,
  }));
  // A choice that no longer fits (time moved on) falls back to the full allowance.
  const chosen = lengths.some((o) => o.value === length) ? length : "full";

  const send = async (): Promise<void> => {
    if (!purpose.trim()) return setError("Say where you're going and why.");
    setBusy(true);
    setError(null);
    try {
      await api<OutingRequest>("/outings/request", {
        method: "POST",
        body: {
          purpose: purpose.trim(),
          phone,
          emergency_name: name.trim(),
          emergency_relation: relation.trim(),
          emergency_phone: emergency,
          requested_minutes: chosen === "full" ? null : Number(chosen),
        },
      });
      haptic.success();
      setPurpose("");
      onClose();
      await onSent();
    } catch (e) {
      haptic.warning();
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={`Ask for today's outing`}>
      <T tone="muted">
        {rules.label} outings need the hostel office&apos;s OK. They&apos;ll see this form, and you
        get a notification when they decide.
      </T>
      <Field
        label="Where and why"
        value={purpose}
        onChangeText={setPurpose}
        placeholder="Shopping at Pacific Mall"
        maxLength={200}
      />
      {lengths.length > 1 ? (
        <View style={{ gap: space(1) }}>
          <Chips
            label="Shorter than the limit? (optional)"
            options={lengths}
            value={chosen}
            onChange={setLength}
          />
          <T tone="caption">
            You can only ask for less time than the limit, never more. Your return time can&apos;t
            be changed later.
          </T>
        </View>
      ) : null}
      <Field
        label="Your phone number"
        value={phone}
        onChangeText={setPhone}
        placeholder="98765 43210"
        keyboardType="phone-pad"
        autoComplete="tel"
        maxLength={24}
      />
      <View style={{ gap: space(3) }}>
        <T tone="label">Emergency contact</T>
        <T tone="caption">A parent, guardian, or someone going with you.</T>
        <Field label="Name" value={name} onChangeText={setName} maxLength={80} />
        <Field
          label="Relation"
          value={relation}
          onChangeText={setRelation}
          placeholder="Mother"
          maxLength={40}
        />
        <Field
          label="Their phone number"
          value={emergency}
          onChangeText={setEmergency}
          keyboardType="phone-pad"
          maxLength={24}
        />
      </View>
      <FormError message={error} />
      <Button
        label="Send for approval"
        busy={busy}
        busyLabel="Sending…"
        onPress={() => void send()}
      />
    </Sheet>
  );
}
