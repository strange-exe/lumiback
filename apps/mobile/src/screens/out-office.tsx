import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ReactNode } from "react";
import { AccessibilityInfo, Alert, Linking, View } from "react-native";

import {
  CALL_ME_SENT,
  callMeError,
  helpError,
  helpResult,
  officeAction,
  telHref,
} from "@/lib/alerts";
import { ApiError } from "@/lib/api";
import { formatPhone } from "@/lib/office";
import { sessionGeneration } from "@/lib/session";
import { student } from "@/lib/student-api";
import type { OfficeContact } from "@/lib/types";
import { helpFix } from "@/location/help-fix";
import { haptic } from "@/ui/haptics";
import { Button, FormError, Notice, T } from "@/ui/kit";
import { Sheet } from "@/ui/sheet";
import { radius, space, useColors } from "@/ui/theme";

function callOffice(phone: string): void {
  Linking.openURL(telHref(phone)).catch(() =>
    Alert.alert("Couldn't start a call", `Call ${formatPhone(phone)} from your phone app.`),
  );
}

function say(text: string): void {
  AccessibilityInfo.announceForAccessibility(text);
}

/**
 * While out (or late): call the hostel office, or ask it to call when the hostel has no number,
 * and the Help button (confirmed first; one location fix, never tracking).
 */
export function OutOffice({ office }: { office: OfficeContact | null | undefined }): ReactNode {
  const c = useColors();
  const action = officeAction(office);
  const [asking, setAsking] = useState(false);
  const [asked, setAsked] = useState<{ text: string; ok: boolean } | null>(null);
  const [helping, setHelping] = useState(false);

  const askForCall = async (): Promise<void> => {
    setAsking(true);
    setAsked(null);
    try {
      await student.callMe();
      haptic.success();
      setAsked({ text: CALL_ME_SENT, ok: true });
      say(CALL_ME_SENT);
    } catch (e) {
      haptic.warning();
      const text =
        e instanceof ApiError
          ? callMeError(e.status, e.detail)
          : "Something went wrong. Try again.";
      setAsked({ text, ok: false });
      say(text);
    } finally {
      setAsking(false);
    }
  };

  const where = office?.hostel ? `${office.hostel} hostel office` : "Your hostel office";
  return (
    <View
      style={{
        gap: space(3),
        backgroundColor: c.surface,
        borderColor: c.line,
        borderWidth: 1,
        borderRadius: radius.card,
        borderCurve: "continuous",
        padding: space(4),
      }}
    >
      <View
        accessible
        accessibilityLabel={
          action.kind === "call" ? `${where}, ${formatPhone(action.phone)}` : `${where}, no number`
        }
        style={{ gap: 2 }}
      >
        <T tone="label" style={{ fontSize: 15 }}>
          {where}
        </T>
        <T tone="caption">
          {action.kind === "call"
            ? formatPhone(action.phone)
            : "No office number in Lumiback yet. You can ask them to call you."}
        </T>
      </View>
      {action.kind === "call" ? (
        <Button
          label="Call the hostel office"
          variant="secondary"
          accessibilityLabel={`Call the hostel office, ${formatPhone(action.phone)}`}
          icon={<Ionicons name="call" size={18} color={c.accentText} />}
          onPress={() => {
            haptic.tap();
            callOffice(action.phone);
          }}
        />
      ) : (
        <Button
          label="Ask the office to call me"
          variant="secondary"
          busy={asking}
          busyLabel="Asking…"
          icon={<Ionicons name="call-outline" size={18} color={c.accentText} />}
          onPress={() => void askForCall()}
        />
      )}
      {asked ? (
        <T
          tone="label"
          accessibilityRole={asked.ok ? "text" : "alert"}
          style={{ color: asked.ok ? c.good : c.danger }}
        >
          {asked.text}
        </T>
      ) : null}
      <Button
        label="Help"
        variant="danger"
        accessibilityLabel="Help: send a help alert to the hostel office"
        icon={<Ionicons name="alert-circle" size={20} color={c.surface} />}
        onPress={() => {
          haptic.tap();
          setHelping(true);
        }}
      />
      {helping ? <HelpSheet office={office} onClose={() => setHelping(false)} /> : null}
    </View>
  );
}

type Step =
  | { kind: "confirm" }
  | { kind: "locating" }
  | { kind: "sending" }
  | {
      kind: "sent";
      title: string;
      detail: string;
      officeTold: boolean;
      office: OfficeContact | null;
    };

/** "Send a help alert?" then what happened, with the office number to call. */
function HelpSheet({
  office,
  onClose,
}: {
  office: OfficeContact | null | undefined;
  onClose: () => void;
}): ReactNode {
  const c = useColors();
  const [step, setStep] = useState<Step>({ kind: "confirm" });
  const [error, setError] = useState<string | null>(null);
  const busy = step.kind === "locating" || step.kind === "sending";

  const send = async (): Promise<void> => {
    // Whose Help this is, read before the wait for a fix: if someone else signs in meanwhile,
    // it's refused rather than sent as them.
    const session = sessionGeneration();
    setError(null);
    setStep({ kind: "locating" });
    const fix = await helpFix(); // null without permission or a fix: help still goes
    setStep({ kind: "sending" });
    try {
      const sent = await student.help(fix, session);
      const result = helpResult(sent, fix !== null);
      haptic.success();
      setStep({
        kind: "sent",
        ...result,
        officeTold: sent.office_told > 0,
        office: sent.office ?? office ?? null,
      });
      say(`${result.title}. ${result.detail}`);
    } catch (e) {
      haptic.warning();
      const text =
        e instanceof ApiError ? helpError(e.status, e.detail) : "Something went wrong. Try again.";
      setError(text);
      setStep({ kind: "confirm" });
      say(text);
    }
  };

  if (step.kind === "sent") {
    const action = officeAction(step.office);
    return (
      <Sheet open onClose={onClose} title={step.title}>
        <Notice tone={step.officeTold ? "good" : "warn"}>{step.detail}</Notice>
        {action.kind === "call" ? (
          <View style={{ gap: space(2) }}>
            <T tone="caption">Hostel office: {formatPhone(action.phone)}</T>
            <Button
              label="Call the hostel office"
              accessibilityLabel={`Call the hostel office, ${formatPhone(action.phone)}`}
              icon={<Ionicons name="call" size={18} color={c.onAccent} />}
              onPress={() => callOffice(action.phone)}
            />
          </View>
        ) : (
          <T tone="muted">Your hostel office has no number in Lumiback yet.</T>
        )}
        <Button label="Done" variant="quiet" onPress={onClose} />
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={busy ? () => undefined : onClose} title="Send a help alert?">
      <T>
        The hostel office, the people you share your location with and your emergency contact are
        told. One location is sent, not tracking.
      </T>
      <FormError message={error} />
      <Button
        label="Send help alert"
        variant="danger"
        busy={busy}
        busyLabel={step.kind === "locating" ? "Getting your location…" : "Sending…"}
        onPress={() => void send()}
      />
      {busy ? null : <Button label="Cancel" variant="quiet" onPress={onClose} />}
    </Sheet>
  );
}
