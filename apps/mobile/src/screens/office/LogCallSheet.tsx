import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ReactNode } from "react";
import { AccessibilityInfo, View } from "react-native";

import { CALL_OUTCOMES } from "@/lib/alerts";
import { ApiError } from "@/lib/api";
import { office } from "@/lib/office-api";
import type { CallOutcome } from "@/lib/types";
import { haptic } from "@/ui/haptics";
import { Button, Field, FormError, Press, T } from "@/ui/kit";
import { Sheet } from "@/ui/sheet";
import { fonts, radius, space, useColors } from "@/ui/theme";

/** "Log a call" on an escalation: how it went, and a short note. Logging claims it if nobody has. */
export function LogCallSheet({
  escalationId,
  name,
  onClose,
  onDone,
}: {
  escalationId: string;
  name: string;
  onClose: () => void;
  onDone: () => void;
}): ReactNode {
  const c = useColors();
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    if (!outcome) {
      setError("Choose how the call went.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await office.logCall(escalationId, outcome, note.trim() || null);
      haptic.success();
      AccessibilityInfo.announceForAccessibility("Call logged");
      onDone();
    } catch (e) {
      haptic.warning();
      setError(e instanceof ApiError ? e.detail : "Couldn't save that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title={`Log a call about ${name}`}>
      <View style={{ gap: space(2) }}>
        <T tone="label">How did it go?</T>
        <View accessibilityRole="radiogroup" accessibilityLabel="How did it go?">
          {CALL_OUTCOMES.map((o) => {
            const selected = outcome === o.value;
            return (
              <Press
                key={o.value}
                onPress={() => setOutcome(o.value)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={o.label}
                style={{
                  minHeight: 48,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space(3),
                  paddingHorizontal: space(3),
                  marginBottom: space(2),
                  borderRadius: radius.control,
                  borderCurve: "continuous",
                  borderWidth: selected ? 2 : 1,
                  borderColor: selected ? c.accent : c.line,
                  backgroundColor: c.raised,
                }}
              >
                <Ionicons
                  name={selected ? "radio-button-on" : "radio-button-off"}
                  size={20}
                  color={selected ? c.accentText : c.muted}
                />
                <T style={{ flex: 1, fontFamily: selected ? fonts.semibold : fonts.regular }}>
                  {o.label}
                </T>
              </Press>
            );
          })}
        </View>
      </View>
      <Field
        label="Note (optional)"
        placeholder="Phone switched off"
        value={note}
        onChangeText={setNote}
        maxLength={200}
      />
      <FormError message={error} />
      <Button label="Save call" busy={busy} busyLabel="Saving…" onPress={() => void save()} />
    </Sheet>
  );
}
