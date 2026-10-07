import { forwardRef, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { fonts, radius, space, useColors } from "@/ui/theme";

/** A scrolling page with the app's background and safe-area padding. */
export function Screen({
  children,
  edges = ["top", "bottom"],
}: {
  children: ReactNode;
  edges?: ("top" | "bottom")[];
}): ReactNode {
  const c = useColors();
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: c.page }}>
      <ScrollView
        contentContainerStyle={{ padding: space(5), gap: space(6), flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

type Tone = "title" | "heading" | "body" | "muted" | "small" | "label";

export function T({
  tone = "body",
  style,
  children,
  ...rest
}: {
  tone?: Tone;
  style?: TextStyle;
  children: ReactNode;
  accessibilityRole?: "header" | "text" | "alert" | "link";
  onPress?: () => void;
}): ReactNode {
  const c = useColors();
  const base: Record<Tone, TextStyle> = {
    title: {
      fontFamily: fonts.semibold,
      fontSize: 31,
      lineHeight: 36,
      letterSpacing: -0.6,
      color: c.ink,
    },
    heading: {
      fontFamily: fonts.semibold,
      fontSize: 20,
      lineHeight: 26,
      letterSpacing: -0.3,
      color: c.ink,
    },
    body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, color: c.ink },
    muted: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, color: c.stone },
    small: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: c.stone },
    label: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 20, color: c.ink },
  };
  return (
    <Text style={[base[tone], style]} {...rest}>
      {children}
    </Text>
  );
}

type Variant = "primary" | "secondary" | "danger" | "quiet";

export function Button({
  label,
  onPress,
  variant = "primary",
  busy = false,
  busyLabel,
  style,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  busy?: boolean;
  busyLabel?: string;
  style?: ViewStyle;
  accessibilityLabel?: string;
}): ReactNode {
  const c = useColors();
  const look: Record<Variant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: c.pine, fg: c.onPine },
    secondary: { bg: c.surface, fg: c.pine, border: c.line },
    danger: { bg: c.ember, fg: c.surface },
    quiet: { bg: "transparent", fg: c.pine },
  };
  const { bg, fg, border } = look[variant];
  return (
    <Pressable
      onPress={busy ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ busy, disabled: busy }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: border ?? bg, opacity: busy ? 0.75 : 1 },
        pressed && !busy ? { transform: [{ scale: 0.98 }] } : null,
        style,
      ]}
    >
      {busy && <ActivityIndicator color={fg} size="small" />}
      <Text style={{ fontFamily: fonts.bold, fontSize: 16, color: fg }}>
        {busy && busyLabel ? busyLabel : label}
      </Text>
    </Pressable>
  );
}

/** Labelled input: the label is always visible (placeholders are examples, not labels). */
export const Field = forwardRef<TextInput, TextInputProps & { label: string; hint?: string }>(
  function Field({ label, hint, style, ...input }, ref) {
    const c = useColors();
    return (
      <View style={{ gap: space(1.5) }}>
        <T tone="label">{label}</T>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={hint}
          placeholderTextColor={c.stone}
          style={[
            styles.input,
            { backgroundColor: c.surface, borderColor: c.line, color: c.ink },
            style,
          ]}
          {...input}
        />
        {hint ? <T tone="small">{hint}</T> : null}
      </View>
    );
  },
);

export function FormError({ message }: { message: string | null }): ReactNode {
  const c = useColors();
  if (!message) return null;
  return (
    <T tone="label" accessibilityRole="alert" style={{ color: c.ember }}>
      {message}
    </T>
  );
}

export function Notice({
  children,
  tone = "good",
}: {
  children: ReactNode;
  tone?: "good" | "warn";
}): ReactNode {
  const c = useColors();
  return (
    <View
      style={{
        backgroundColor: tone === "good" ? c.sageSoft : c.lanternSoft,
        borderRadius: radius.control,
        padding: space(4),
      }}
    >
      <T>{children}</T>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }): ReactNode {
  const c = useColors();
  return (
    <View
      style={[
        {
          backgroundColor: c.surface,
          borderColor: c.line,
          borderWidth: 1,
          borderRadius: radius.sheet,
          padding: space(5),
          gap: space(3),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Single-choice row of options (a radio group): return time, share length. */
export function Chips<V extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: V; label: string }[];
  value: V;
  onChange: (value: V) => void;
}): ReactNode {
  const c = useColors();
  return (
    <View style={{ gap: space(1.5) }}>
      <T tone="label">{label}</T>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        style={{ flexDirection: "row", gap: space(2) }}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: selected ? c.pine : c.surface,
                  borderColor: selected ? c.pine : c.line,
                },
                pressed ? { transform: [{ scale: 0.97 }] } : null,
              ]}
            >
              <Text
                style={{
                  fontFamily: fonts.semibold,
                  fontSize: 15,
                  color: selected ? c.onPine : c.ink,
                }}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.control,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  button: {
    minHeight: 52,
    borderRadius: radius.control,
    borderWidth: 1,
    paddingHorizontal: space(5),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space(2),
  },
  input: {
    minHeight: 52,
    borderRadius: radius.control,
    borderWidth: 1,
    paddingHorizontal: space(4),
    fontFamily: fonts.regular,
    fontSize: 16,
  },
});
