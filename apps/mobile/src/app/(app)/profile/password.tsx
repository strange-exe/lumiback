import { router } from "expo-router";
import { useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Alert, type TextInput, View } from "react-native";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { changedMessage, changeError, formProblem } from "@/lib/password";
import type { PasswordChanged } from "@/lib/types";
import { haptic } from "@/ui/haptics";
import { Button, FormError, Notice, PasswordField, Screen, T } from "@/ui/kit";
import { space } from "@/ui/theme";

/**
 * Change password while signed in, knowing the current one. Every other device is signed out;
 * this one stays signed in, unless it signed in before devices had ids: then the server signs
 * it out too, and this screen signs out here so the person signs in with the new password.
 */
export default function ChangePassword(): ReactNode {
  const { signOut } = useAuth();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const againRef = useRef<TextInput>(null);

  const submit = async (): Promise<void> => {
    if (busy) return;
    const problem = formProblem({ current, password, again });
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    let result: PasswordChanged;
    try {
      result = await api<PasswordChanged>("/auth/change-password", {
        method: "POST",
        body: { current_password: current, password },
      });
    } catch (e) {
      haptic.warning();
      setError(changeError(e));
      setBusy(false);
      return;
    }
    const message = changedMessage(result.signed_out);
    haptic.success();
    setCurrent("");
    setPassword("");
    setAgain("");
    if (!result.still_signed_in) {
      // The server ended this phone's sign-in too: say why before the sign-in screen shows.
      Alert.alert(
        "Sign in with your new password",
        `${message} This phone signed in before Lumiback named devices, so it was signed out as well.`,
      );
      // The guard then shows sign-in. Should signing out fail, the form comes back usable.
      await signOut().catch(() => setBusy(false));
      return;
    }
    setBusy(false);
    setDone(message);
    AccessibilityInfo.announceForAccessibility(message);
  };

  if (done) {
    return (
      <Screen edges={["bottom"]}>
        <Notice>{done}</Notice>
        <T tone="muted">This phone stays signed in. Use the new password next time you sign in.</T>
        <Button label="Back to Profile" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen edges={["bottom"]}>
      <T tone="muted">
        Enter the password you use now, then choose a new one. Every other device is signed out;
        this phone stays signed in.
      </T>
      <View style={{ gap: space(4) }}>
        <PasswordField
          label="Current password"
          value={current}
          onChangeText={setCurrent}
          autoComplete="current-password"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <PasswordField
          ref={passwordRef}
          label="New password"
          value={password}
          onChangeText={setPassword}
          autoComplete="new-password"
          hint="At least 10 characters. Avoid your name or email."
          returnKeyType="next"
          onSubmitEditing={() => againRef.current?.focus()}
        />
        <PasswordField
          ref={againRef}
          label="New password again"
          value={again}
          onChangeText={setAgain}
          autoComplete="new-password"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
        />
        <FormError message={error} />
        <Button
          label="Change password"
          busy={busy}
          busyLabel="Saving…"
          onPress={() => void submit()}
        />
      </View>
    </Screen>
  );
}
