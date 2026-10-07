import { forwardRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useReducedMotion } from "@/ui/motion";
import { fonts, layout, radius, space, type, useColors } from "@/ui/theme";

/** Scale-down on press: a physical "push" (native driver; off with reduced motion). */
export function Press({
  onPress,
  disabled,
  style,
  children,
  accessibilityLabel,
  accessibilityRole = "button",
  accessibilityState,
  hitSlop,
}: {
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  accessibilityLabel?: string;
  accessibilityRole?: "button" | "link" | "radio" | "tab";
  accessibilityState?: {
    checked?: boolean;
    busy?: boolean;
    disabled?: boolean;
    selected?: boolean;
  };
  hitSlop?: number;
}): ReactNode {
  const [scale] = useState(() => new Animated.Value(1));
  const reduced = useReducedMotion();
  const to = (value: number): void => {
    if (reduced) return;
    Animated.spring(scale, {
      toValue: value,
      useNativeDriver: true,
      speed: 40,
      bounciness: 0,
    }).start();
  };
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onPressIn={() => to(0.97)}
      onPressOut={() => to(1)}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, ...accessibilityState }}
      hitSlop={hitSlop}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

/** A scrolling page with the app's background and safe-area padding. */
export function Screen({
  children,
  edges = ["top", "bottom"],
  refreshControl,
}: {
  children: ReactNode;
  edges?: ("top" | "bottom")[];
  refreshControl?: React.ComponentProps<typeof ScrollView>["refreshControl"];
}): ReactNode {
  const c = useColors();
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: c.page }}>
      <ScrollView
        contentContainerStyle={{
          padding: layout.gutter,
          paddingBottom: layout.dockClearance,
          gap: layout.section,
          flexGrow: 1,
        }}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

type Tone =
  | "display"
  | "title"
  | "headline"
  | "heading" // alias of headline
  | "body"
  | "muted"
  | "label"
  | "caption"
  | "small";

export function T({
  tone = "body",
  style,
  children,
  selectable,
  numberOfLines,
  ...rest
}: {
  tone?: Tone;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  selectable?: boolean;
  numberOfLines?: number;
  accessibilityRole?: "header" | "text" | "alert" | "link";
  accessibilityLabel?: string;
  onPress?: () => void;
}): ReactNode {
  const c = useColors();
  const base: Record<Tone, TextStyle> = {
    display: { ...type.display, color: c.ink, fontVariant: ["tabular-nums"] },
    title: { ...type.title, color: c.ink },
    headline: { ...type.headline, color: c.ink },
    heading: { ...type.headline, color: c.ink },
    body: { ...type.body, color: c.ink },
    muted: { ...type.body, color: c.muted },
    label: { ...type.label, color: c.ink },
    caption: { ...type.caption, color: c.muted },
    small: { ...type.caption, color: c.muted },
  };
  return (
    <Text
      style={[base[tone], style]}
      selectable={selectable}
      numberOfLines={numberOfLines}
      {...rest}
    >
      {children}
    </Text>
  );
}

/** Every top-level screen opens the same way: a small coloured eyebrow, the title, a lede. */
export function Heading({
  eyebrow,
  title,
  lede,
  tone = "accent",
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  tone?: "accent" | "good" | "danger" | "muted";
}): ReactNode {
  const c = useColors();
  return (
    <View style={{ gap: space(2) }}>
      {eyebrow ? <Text style={[type.eyebrow, { color: c[tone] }]}>{eyebrow}</Text> : null}
      <T tone="title" accessibilityRole="header">
        {title}
      </T>
      {lede ? <T tone="muted">{lede}</T> : null}
    </View>
  );
}

/** A time set large, the period small: the one number a screen is about. */
export function Clock({
  time,
  period,
  color,
  size = 56,
}: {
  time: string;
  period: string;
  color?: string;
  size?: number;
}): ReactNode {
  const c = useColors();
  return (
    <Text
      accessibilityLabel={`${time} ${period}`}
      style={{
        fontFamily: fonts.semibold,
        fontSize: size,
        lineHeight: size * 1.08,
        letterSpacing: -size * 0.03,
        color: color ?? c.ink,
        fontVariant: ["tabular-nums"],
      }}
    >
      {time}
      <Text style={{ fontSize: size * 0.36, letterSpacing: 0.5 }}> {period}</Text>
    </Text>
  );
}

type Variant = "primary" | "secondary" | "danger" | "quiet" | "onHero" | "onHeroOutline";

export function Button({
  label,
  onPress,
  variant = "primary",
  busy = false,
  busyLabel,
  style,
  accessibilityLabel,
  icon,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  busy?: boolean;
  busyLabel?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  icon?: ReactNode;
}): ReactNode {
  const c = useColors();
  const look: Record<Variant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: c.accent, fg: c.onAccent },
    secondary: { bg: c.surface, fg: c.accent, border: c.line },
    danger: { bg: c.danger, fg: c.surface },
    quiet: { bg: "transparent", fg: c.accent },
    onHero: { bg: c.onHero, fg: c.hero },
    onHeroOutline: { bg: "transparent", fg: c.onHero, border: c.heroLine },
  };
  const { bg, fg, border } = look[variant];
  return (
    <Press
      onPress={onPress}
      disabled={busy}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ busy }}
      style={[
        {
          minHeight: 52,
          borderRadius: radius.control,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: border ?? bg,
          backgroundColor: bg,
          paddingHorizontal: space(5),
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: space(2),
          opacity: busy ? 0.75 : 1,
        },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} size="small" /> : icon}
      <Text style={{ fontFamily: fonts.semibold, fontSize: 16, color: fg }} numberOfLines={1}>
        {busy && busyLabel ? busyLabel : label}
      </Text>
    </Press>
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
          placeholderTextColor={c.muted}
          style={[
            {
              minHeight: 52,
              borderRadius: radius.control,
              borderCurve: "continuous",
              borderWidth: 1,
              paddingHorizontal: space(4),
              fontFamily: fonts.regular,
              fontSize: 16,
              backgroundColor: c.raised,
              borderColor: c.line,
              color: c.ink,
            },
            style,
          ]}
          {...input}
        />
        {hint ? <T tone="caption">{hint}</T> : null}
      </View>
    );
  },
);

export function FormError({ message }: { message: string | null }): ReactNode {
  const c = useColors();
  if (!message) return null;
  return (
    <T tone="label" accessibilityRole="alert" selectable style={{ color: c.danger }}>
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
        backgroundColor: tone === "good" ? c.goodSoft : c.accentSoft,
        borderRadius: radius.control,
        borderCurve: "continuous",
        padding: space(4),
      }}
    >
      <T>{children}</T>
    </View>
  );
}

export function Card({
  children,
  style,
  flat = false,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** No shadow: for cards inside other surfaces. */
  flat?: boolean;
}): ReactNode {
  const c = useColors();
  return (
    <View
      style={[
        {
          backgroundColor: c.surface,
          borderColor: c.line,
          borderWidth: 1,
          borderRadius: radius.sheet,
          borderCurve: "continuous",
          padding: space(5),
          gap: space(4),
          boxShadow: flat ? undefined : c.shadow,
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
  onHero = false,
}: {
  label: string;
  options: { value: V; label: string }[];
  value: V;
  onChange: (value: V) => void;
  onHero?: boolean;
}): ReactNode {
  const c = useColors();
  return (
    <View style={{ gap: space(2) }}>
      <T tone="label" style={onHero ? { color: c.heroMuted } : undefined}>
        {label}
      </T>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        style={{ flexDirection: "row", gap: space(2) }}
      >
        {options.map((option) => {
          const selected = option.value === value;
          const bg = selected ? (onHero ? c.onHero : c.accent) : onHero ? "transparent" : c.raised;
          const fg = selected ? (onHero ? c.hero : c.onAccent) : onHero ? c.onHero : c.ink;
          const border = selected ? bg : onHero ? c.heroLine : c.line;
          return (
            <View key={option.value} style={{ flex: 1 }}>
              <Press
                onPress={() => onChange(option.value)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={option.label}
                style={{
                  minHeight: 48,
                  borderRadius: radius.control,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: bg,
                  borderColor: border,
                }}
              >
                <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: fg }}>
                  {option.label}
                </Text>
              </Press>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** A two- or three-way switch between views of one screen (a tab group, not a form field). */
export function Segmented<V extends string>({
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
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      style={{
        flexDirection: "row",
        backgroundColor: c.line,
        borderRadius: radius.control,
        borderCurve: "continuous",
        padding: 4,
        gap: 4,
      }}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => !selected && onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={{
              flex: 1,
              minHeight: 44,
              borderRadius: radius.control - 4,
              borderCurve: "continuous",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: selected ? c.surface : "transparent",
              boxShadow: selected ? "0 1px 2px rgba(11, 12, 16, 0.08)" : undefined,
            }}
          >
            <Text
              style={{
                fontFamily: fonts.semibold,
                fontSize: 15,
                color: selected ? c.ink : c.muted,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Small rounded status label: "Verified at gate", "Self-reported", "Overdue". */
export function StatusChip({
  label,
  tone,
}: {
  label: string;
  tone: "good" | "danger" | "accent" | "muted";
}): ReactNode {
  const c = useColors();
  const map = {
    good: [c.goodSoft, c.good],
    danger: [c.dangerSoft, c.danger],
    accent: [c.accentSoft, c.accent],
    muted: [c.line, c.muted],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View
      style={{
        alignSelf: "flex-start",
        backgroundColor: bg,
        borderRadius: radius.pill,
        paddingHorizontal: space(2.5),
        paddingVertical: space(0.5),
      }}
    >
      <Text style={{ fontFamily: fonts.semibold, fontSize: 12, lineHeight: 18, color: fg }}>
        {label}
      </Text>
    </View>
  );
}

/** A labelled group of rows with hairline dividers (settings, details). */
export function Section({
  title,
  children,
  footer,
}: {
  title?: string;
  children: ReactNode;
  footer?: string;
}): ReactNode {
  const c = useColors();
  const rows = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <View style={{ gap: space(2) }}>
      {title ? (
        <Text style={[type.eyebrow, { color: c.muted, paddingHorizontal: space(1) }]}>{title}</Text>
      ) : null}
      <View
        style={{
          backgroundColor: c.surface,
          borderRadius: radius.sheet,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: c.line,
          overflow: "hidden",
        }}
      >
        {rows.map((row, i) => (
          <View key={i} style={i > 0 ? { borderTopWidth: 1, borderTopColor: c.line } : undefined}>
            {row}
          </View>
        ))}
      </View>
      {footer ? (
        <T tone="caption" style={{ paddingHorizontal: space(1) }}>
          {footer}
        </T>
      ) : null}
    </View>
  );
}

/** One tappable row: icon, title, optional detail, trailing element (chevron, switch, value). */
export function Row({
  title,
  detail,
  leading,
  trailing,
  onPress,
  danger = false,
  accessibilityLabel,
}: {
  title: string;
  detail?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  danger?: boolean;
  accessibilityLabel?: string;
}): ReactNode {
  const c = useColors();
  const body = (
    <View
      style={{
        minHeight: 60,
        paddingHorizontal: space(4),
        paddingVertical: space(3),
        flexDirection: "row",
        alignItems: "center",
        gap: space(3),
      }}
    >
      {leading}
      <View style={{ flex: 1, gap: 2 }}>
        <T tone="body" style={{ fontFamily: fonts.medium, color: danger ? c.danger : c.ink }}>
          {title}
        </T>
        {detail ? <T tone="caption">{detail}</T> : null}
      </View>
      {trailing}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      android_ripple={{ color: c.line }}
    >
      {body}
    </Pressable>
  );
}
