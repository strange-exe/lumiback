import { router, useLocalSearchParams } from "expo-router";
import { useState, type ReactNode } from "react";
import { View } from "react-native";

import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Field, FormError, Notice, Screen, T } from "@/ui/kit";
import { space } from "@/ui/theme";

export default function Verify(): ReactNode {
  const { email = "" } = useLocalSearchParams<{ email?: string }>();
  const { verify, resend } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (!/^\d{6}$/.test(code.replace(/\s/g, "")))
      return setError("Enter the 6-digit code from your email.");
    setBusy(true);
    setError(null);
    try {
      // Signed in automatically when the password from sign-up is still in memory; otherwise
      // (app restarted in between) the account exists and the student signs in.
      const signedIn = await verify(email, code);
      if (!signedIn) router.replace({ pathname: "/sign-in", params: { verified: email } });
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const again = async (): Promise<void> => {
    setError(null);
    try {
      await resend(email);
      setNotice("If that sign-up is still waiting, a new code is on its way.");
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Something went wrong. Try again.");
    }
  };

  return (
    <Screen>
      <View style={{ gap: space(2) }}>
        <T tone="title" accessibilityRole="header">
          Check your inbox
        </T>
        <T tone="muted">
          We sent a 6-digit code to {email || "your email"}. It expires in 15 minutes. Look in Junk
          too.
        </T>
      </View>
      {notice ? <Notice>{notice}</Notice> : null}
      <View style={{ gap: space(4) }}>
        <Field
          label="Code"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={7}
          placeholder="482915"
          style={{ fontSize: 24, letterSpacing: 6 }}
        />
        <FormError message={error} />
        <Button
          label="Verify email"
          busy={busy}
          busyLabel="Checking…"
          onPress={() => void submit()}
        />
        <Button label="Send a new code" variant="quiet" onPress={() => void again()} />
      </View>
    </Screen>
  );
}
