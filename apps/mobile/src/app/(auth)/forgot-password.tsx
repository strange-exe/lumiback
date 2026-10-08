import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState, type ReactNode } from "react";
import { type TextInput, View } from "react-native";

import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Field, FormError, Notice, PasswordField, Screen, T } from "@/ui/kit";
import { space } from "@/ui/theme";

function message(e: unknown): string {
  return e instanceof ApiError ? e.detail : "Something went wrong. Try again.";
}

/**
 * Forgot password: ask for a code by email, then set a new password with it. The server
 * answers the same whether or not an account exists, so this screen never says either way.
 * A new password signs out every other device; this one signs straight in.
 */
export default function ForgotPassword(): ReactNode {
  const { signIn } = useAuth();
  const { email: initial = "" } = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(initial);
  const [step, setStep] = useState<"email" | "reset">("email");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const normalized = email.trim().toLowerCase();

  const sendCode = async (): Promise<void> => {
    if (!normalized.includes("@")) return setError("Enter your university email.");
    setBusy(true);
    setError(null);
    try {
      await api("/auth/forgot-password", {
        method: "POST",
        auth: false,
        body: { email: normalized },
      });
      setNotice(null);
      setStep("reset");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (): Promise<void> => {
    const digits = code.replace(/\s/g, "");
    if (!/^\d{6}$/.test(digits)) return setError("Enter the 6-digit code from your email.");
    if (!password) return setError("Choose a new password.");
    setBusy(true);
    setError(null);
    try {
      await api("/auth/reset-password", {
        method: "POST",
        auth: false,
        body: { email: normalized, code: digits, password },
      });
    } catch (e) {
      setError(message(e));
      setBusy(false);
      return;
    }
    try {
      await signIn(normalized, password); // the auth layout then moves on to Today
    } catch {
      // Password changed; signing in can still be refused (e.g. offline): let them do it.
      router.replace({ pathname: "/sign-in", params: { verified: normalized } });
    } finally {
      setBusy(false);
    }
  };

  const again = async (): Promise<void> => {
    setError(null);
    try {
      await api("/auth/forgot-password", {
        method: "POST",
        auth: false,
        body: { email: normalized },
      });
      setNotice("A new code is on its way. Only the newest code works.");
    } catch (e) {
      setError(message(e));
    }
  };

  if (step === "email") {
    return (
      <Screen>
        <View style={{ gap: space(2) }}>
          <T tone="title" accessibilityRole="header">
            Reset your password
          </T>
          <T tone="muted">
            Enter your university email. If it has a Lumiback account, we&apos;ll send a 6-digit
            code to set a new password.
          </T>
        </View>
        <View style={{ gap: space(4) }}>
          <Field
            label="University email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="student_id@geu.ac.in"
            returnKeyType="send"
            onSubmitEditing={() => void sendCode()}
          />
          <FormError message={error} />
          <Button
            label="Send code"
            busy={busy}
            busyLabel="Sending…"
            onPress={() => void sendCode()}
          />
          <Button label="Back to sign in" variant="quiet" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ gap: space(2) }}>
        <T tone="title" accessibilityRole="header">
          Check your inbox
        </T>
        <T tone="muted">
          If {normalized} has an account, a code is on its way. It expires in 15 minutes. Look in
          Junk too.
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
          maxLength={7}
          placeholder="482915"
          style={{ fontSize: 24, letterSpacing: 6 }}
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <PasswordField
          ref={passwordRef}
          label="New password"
          value={password}
          onChangeText={setPassword}
          autoComplete="new-password"
          hint="At least 10 characters. Avoid your name or email. You'll be signed out on other devices."
          returnKeyType="go"
          onSubmitEditing={() => void resetPassword()}
        />
        <FormError message={error} />
        <Button
          label="Set new password"
          busy={busy}
          busyLabel="Saving…"
          onPress={() => void resetPassword()}
        />
        <Button label="Send a new code" variant="quiet" onPress={() => void again()} />
      </View>
    </Screen>
  );
}
