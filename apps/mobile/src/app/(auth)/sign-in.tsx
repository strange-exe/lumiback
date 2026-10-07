import { Link, router, useLocalSearchParams } from "expo-router";
import { useRef, useState, type ReactNode } from "react";
import { type TextInput, View } from "react-native";

import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Illustration } from "@/ui/illustration";
import { Button, Field, FormError, Notice, Screen, T } from "@/ui/kit";
import { space, useColors } from "@/ui/theme";

export default function SignIn(): ReactNode {
  const { signIn } = useAuth();
  const c = useColors();
  // Arrives from verify when the app restarted mid sign-up: the account exists, just sign in.
  const { verified } = useLocalSearchParams<{ verified?: string }>();
  const [email, setEmail] = useState(verified ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  const submit = async (): Promise<void> => {
    if (!email.trim() || !password) return setError("Enter your university email and password.");
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        router.push({ pathname: "/verify", params: { email: email.trim().toLowerCase() } });
      } else {
        setError(e instanceof ApiError ? e.detail : "Something went wrong. Try again.");
      }
      setPassword(""); // only the password needs typing again
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: "center", gap: space(6) }}>
        <View style={{ gap: space(3) }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space(1) }}>
            <Illustration name="lantern-lit" size={56} />
            <T tone="headline" style={{ color: c.accent }}>
              Lumiback
            </T>
          </View>
          <T tone="display" accessibilityRole="header">
            Head out.{"\n"}Get back safe.
          </T>
          <T tone="muted">Sign in with your university email.</T>
        </View>
        {verified ? <Notice>Email confirmed. Sign in to start using Lumiback.</Notice> : null}
        <View style={{ gap: space(4) }}>
          <Field
            label="University email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            placeholder="abhinesh.gangwar@geu.ac.in"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <Field
            ref={passwordRef}
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
          />
          <FormError message={error} />
          <Button
            label="Sign in"
            busy={busy}
            busyLabel="Signing in…"
            onPress={() => void submit()}
          />
        </View>
        <T tone="small" style={{ textAlign: "center" }}>
          New here?{" "}
          <Link href="/register" style={{ color: c.accent, fontWeight: "700" }}>
            Create your account
          </Link>
        </T>
      </View>
    </Screen>
  );
}
