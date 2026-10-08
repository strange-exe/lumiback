import { Link, router } from "expo-router";
import { useState, type ReactNode } from "react";
import { Linking, View } from "react-native";

import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { WEB_URL } from "@/lib/config";
import { Button, Field, FormError, Screen, T } from "@/ui/kit";
import { space, useColors } from "@/ui/theme";

const PRIVACY_URL = `${WEB_URL}/privacy`;

export default function Register(): ReactNode {
  const { register } = useAuth();
  const c = useColors();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rollNo, setRollNo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const { email: sentTo } = await register({ name, email, password, rollNo });
      router.push({ pathname: "/verify", params: { email: sentTo } });
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ gap: space(2) }}>
        <T tone="title" accessibilityRole="header">
          Create your account
        </T>
        <T tone="muted">
          Sign up with your university email. We&apos;ll send a code to confirm it.
        </T>
      </View>
      <View style={{ gap: space(4) }}>
        <Field
          label="Full name"
          value={name}
          onChangeText={setName}
          autoComplete="name"
          placeholder="Abhinesh Gangwar"
        />
        <Field
          label="University email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="student_id@geu.ac.in"
          hint="We'll send a 6-digit code to confirm it's yours."
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          hint="At least 10 characters. Avoid your name or email."
        />
        <Field
          label="Roll number (optional)"
          value={rollNo}
          onChangeText={setRollNo}
          keyboardType="number-pad"
        />
        <FormError message={error} />
        <Button
          label="Create account"
          busy={busy}
          busyLabel="Sending your code…"
          onPress={() => void submit()}
        />
        <T tone="small" style={{ textAlign: "center" }}>
          By creating an account you agree to how we handle your data, described in our{" "}
          <T
            tone="small"
            style={{ color: c.accent, fontWeight: "700" }}
            onPress={() => void Linking.openURL(PRIVACY_URL)}
          >
            privacy notice
          </T>
          .
        </T>
        <T tone="small" style={{ textAlign: "center" }}>
          Already registered?{" "}
          <Link href="/sign-in" style={{ color: c.accent, fontWeight: "700" }}>
            Sign in
          </Link>
        </T>
      </View>
    </Screen>
  );
}
