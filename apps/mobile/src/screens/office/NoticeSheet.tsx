import { useState, type ReactNode } from "react";
import { AccessibilityInfo, Switch } from "react-native";

import { noticeError, noticeResult, noticeText } from "@/lib/alerts";
import { ApiError } from "@/lib/api";
import { office } from "@/lib/office-api";
import { haptic } from "@/ui/haptics";
import { Button, Field, FormError, Notice, Row, Section } from "@/ui/kit";
import { Sheet } from "@/ui/sheet";
import { useColors } from "@/ui/theme";

const MAX = 200;
const RECALL = "Ask them to come back now";

/** A one-line notice to the students out now (in this office's hostels), optionally a recall. */
export function NoticeSheet({
  everyHostel,
  onClose,
}: {
  everyHostel: boolean;
  onClose: () => void;
}): ReactNode {
  const c = useColors();
  const [message, setMessage] = useState("");
  const [recall, setRecall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ text: string; sent: number } | null>(null);

  const send = async (): Promise<void> => {
    const text = noticeText(message);
    if (!text) {
      setError("Write the notice first.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const { sent } = await office.notice(text, recall);
      haptic.success();
      const words = noticeResult(sent);
      setResult({ text: words, sent });
      if (sent > 0) setMessage("");
      AccessibilityInfo.announceForAccessibility(words);
    } catch (e) {
      haptic.warning();
      const words =
        e instanceof ApiError
          ? noticeError(e.status, e.detail)
          : "Something went wrong. Try again.";
      setError(words);
      AccessibilityInfo.announceForAccessibility(words);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title="Send a notice">
      <Field
        label="Message"
        hint={`Goes to students out now from ${everyHostel ? "every hostel" : "your hostels"}. One line, up to ${MAX} characters.`}
        placeholder="The main gate closes at 9 tonight"
        value={message}
        onChangeText={(next) => {
          setMessage(next);
          setResult(null);
        }}
        maxLength={MAX}
        returnKeyType="send"
        onSubmitEditing={() => void send()}
      />
      <Section>
        <Row
          title={RECALL}
          detail={'The notification reads "Come back to the hostel now".'}
          accessibilityLabel={RECALL}
          onPress={() => setRecall((v) => !v)}
          trailing={
            <Switch
              value={recall}
              onValueChange={setRecall}
              accessibilityLabel={RECALL}
              trackColor={{ true: c.accent, false: c.line }}
              thumbColor={c.surface}
            />
          }
        />
      </Section>
      <FormError message={error} />
      {result ? <Notice tone={result.sent > 0 ? "good" : "warn"}>{result.text}</Notice> : null}
      <Button
        label={recall ? "Send and ask them back" : "Send notice"}
        busy={busy}
        busyLabel="Sending…"
        onPress={() => void send()}
      />
      <Button label="Done" variant="quiet" onPress={onClose} />
    </Sheet>
  );
}
