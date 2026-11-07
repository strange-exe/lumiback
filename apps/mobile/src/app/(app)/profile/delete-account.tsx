import { useState, type ReactNode } from "react";
import { View } from "react-native";

import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, Field, FormError, PasswordField, Screen, T } from "@/ui/kit";
import { space, useColors } from "@/ui/theme";

export default function DeleteAccount(): ReactNode {
  const { deleteAccount } = useAuth();
  const c = useColors();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (confirm.trim().toLowerCase() !== "delete") return setError('Type "delete" to confirm.');
    if (!password) return setError("Enter your password.");
    setBusy(true);
    setError(null);
    try {
      // Stops sharing and the reminders only once the server has deleted the account: it
      // refuses while the student is out, and their safe-return share must keep going then.
      await deleteAccount(password); // signs out: the guard then shows sign-in
    } catch (e) {
      // The server's own words for a refusal ("You're out right now...", "Make someone else
      // an admin first"), or a wrong password.
      setError(e instanceof ApiError ? e.detail : "Something went wrong. Try again.");
      setPassword("");
      setBusy(false);
    }
  };

  return (
    <Screen edges={["bottom"]}>
      <View style={{ gap: space(2) }}>
        <T tone="title" accessibilityRole="header">
          This can&apos;t be undone
        </T>
        <T tone="muted">
          Your account, live shares and contacts are removed permanently. People watching your
          location lose access straight away. The hostel keeps your outing records, with your name
          and roll number, for the campus retention period (180 days by default), then they&apos;re
          deleted.
        </T>
        <T tone="muted">You can&apos;t delete your account while you&apos;re out.</T>
      </View>
      <Card style={{ borderColor: c.danger }}>
        <PasswordField
          label="Password"
          value={password}
          onChangeText={setPassword}
          autoComplete="current-password"
        />
        <Field
          label='Type "delete" to confirm'
          value={confirm}
          onChangeText={setConfirm}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <FormError message={error} />
        <Button
          label="Delete my account"
          variant="danger"
          busy={busy}
          busyLabel="Deleting…"
          onPress={() => void submit()}
        />
      </Card>
    </Screen>
  );
}
