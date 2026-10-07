import { useState, type ReactNode } from "react";
import { View } from "react-native";

import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { stopSending } from "@/location/task";
import { syncReturnReminders } from "@/notify/notify";
import { Button, Card, Field, FormError, Screen, T } from "@/ui/kit";
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
      await stopSending();
      await syncReturnReminders(null);
      await deleteAccount(password); // signs out: the guard then shows sign-in
    } catch (e) {
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
          Your outings, live shares and contacts are removed permanently. People watching your
          location lose access straight away.
        </T>
      </View>
      <Card style={{ borderColor: c.danger }}>
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
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
