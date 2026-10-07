import Constants from "expo-constants";
import { useState, type ReactNode } from "react";
import { Linking, View } from "react-native";

import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { WEB_URL } from "@/lib/config";
import { formatDate } from "@/lib/time";
import { stopSending } from "@/location/task";
import { Button, Card, Field, FormError, Screen, T } from "@/ui/kit";
import { space, useColors } from "@/ui/theme";

const PRIVACY_URL = `${WEB_URL}/privacy`;

export default function Account(): ReactNode {
  const { user, signOut } = useAuth();
  const c = useColors();
  const [signingOut, setSigningOut] = useState(false);
  if (!user) return null;

  const rows: [string, string][] = [
    ["Name", user.name],
    ["University email", user.email],
    ...(user.roll_no ? ([["Roll number", user.roll_no]] as [string, string][]) : []),
    ["Member since", formatDate(user.created_at)],
  ];

  return (
    <Screen edges={["top"]}>
      <T tone="title" accessibilityRole="header">
        Account
      </T>
      <Card>
        {rows.map(([label, value]) => (
          <View key={label} accessible style={{ gap: space(0.5) }}>
            <T tone="small">{label}</T>
            <T>{value}</T>
          </View>
        ))}
      </Card>
      <View style={{ gap: space(2) }}>
        <Button
          label="Sign out"
          variant="secondary"
          busy={signingOut}
          busyLabel="Signing out…"
          onPress={() => {
            setSigningOut(true);
            void stopSending()
              .then(signOut)
              .finally(() => setSigningOut(false));
          }}
        />
        <Button
          label="Privacy notice"
          variant="quiet"
          onPress={() => void Linking.openURL(PRIVACY_URL)}
        />
      </View>
      <DeleteAccount />
      <T tone="small" style={{ textAlign: "center", color: c.stone }}>
        Lumiback {Constants.expoConfig?.version ?? ""}
      </T>
    </Screen>
  );
}

function DeleteAccount(): ReactNode {
  const { deleteAccount } = useAuth();
  const c = useColors();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return <Button label="Delete my account…" variant="quiet" onPress={() => setOpen(true)} />;
  }

  const submit = async (): Promise<void> => {
    if (confirm.trim().toLowerCase() !== "delete") return setError('Type "delete" to confirm.');
    if (!password) return setError("Enter your password.");
    setBusy(true);
    setError(null);
    try {
      await stopSending();
      await deleteAccount(password); // signs out; the guard sends the student to sign-in
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Something went wrong. Try again.");
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ borderColor: c.ember }}>
      <T tone="heading" accessibilityRole="header">
        Delete your account
      </T>
      <T tone="muted">
        This permanently removes your outings, live shares and contacts. People watching your
        location lose access straight away. It can&apos;t be undone.
      </T>
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
        label="Delete account"
        variant="danger"
        busy={busy}
        busyLabel="Deleting…"
        onPress={() => void submit()}
      />
      <Button label="Keep my account" variant="quiet" onPress={() => setOpen(false)} />
    </Card>
  );
}
