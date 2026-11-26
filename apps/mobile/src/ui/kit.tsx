import Ionicons from "@expo/vector-icons/Ionicons";
import { forwardRef, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type DimensionValue,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { loadFailedText } from "@/lib/words";
import { DotBackground } from "@/ui/backdrop";
import { useReducedMotion } from "@/ui/motion";
import {
  fonts,
  layout,
  radius,
  space,
  type,
  useColors,
  useDockClearance,
  type Colors,
} from "@/ui/theme";

/**
 * Scale-down on press: a physical "push" that springs back with a slight overshoot (native
 * driver; off with reduced motion).
 */
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
  accessibilityRole?: "button" | "link" | "radio" | "tab" | "checkbox";
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
      speed: 36,
      bounciness: 7,
    }).start();
  };
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onPressIn={() => to(0.96)}
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

/** The visible part of a Screen: how far it's scrolled and how tall the visible area is. */
export interface Viewport {
  scrollY: number;
  viewport: number;
}

/** A scrolling page with the app's background (dot grid) and safe-area padding. */
export function Screen({
  children,
  edges = ["top", "bottom"],
  refreshControl,
  scan = false,
  onViewport,
}: {
  children: ReactNode;
  edges?: ("top" | "bottom")[];
  refreshControl?: React.ComponentProps<typeof ScrollView>["refreshControl"];
  /** Status screens: the scan band passes over the dot grid. */
  scan?: boolean;
  /** What part of the page is in view (scroll offset and visible height), as it changes:
   * for content that counts as read once it's on screen (the hostel board card). */
  onViewport?: (view: Viewport) => void;
}): ReactNode {
  const c = useColors();
  const clearance = useDockClearance();
  const insets = useSafeAreaInsets();
  const view = useRef<Viewport>({ scrollY: 0, viewport: 0 });
  // With a "bottom" edge the safe area already adds the inset; don't count it twice.
  const bottom = edges.includes("bottom") ? clearance - insets.bottom : clearance;
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: c.page }}>
      <DotBackground scan={scan} />
      {/* Apps draw edge to edge, so Android no longer shrinks the window for the keyboard:
          shrink the page ourselves, and the scroll view keeps the focused field in sight. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={{
            padding: layout.gutter,
            paddingBottom: bottom,
            gap: layout.section,
            flexGrow: 1,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={refreshControl}
          onLayout={
            onViewport
              ? (e) => {
                  view.current.viewport = e.nativeEvent.layout.height;
                  onViewport({ ...view.current });
                }
              : undefined
          }
          onScroll={
            onViewport
              ? (e) => {
                  view.current.scrollY = e.nativeEvent.contentOffset.y;
                  onViewport({ ...view.current });
                }
              : undefined
          }
          scrollEventThrottle={onViewport ? 100 : undefined}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
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

/** Every top-level screen opens the same way: a small sentence-case line, the title, a lede. */
export function Heading({
  eyebrow,
  title,
  lede,
  tone = "muted",
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  /** The small line's colour: muted, or a state (live, faked, a warning). */
  tone?: "accent" | "good" | "danger" | "muted";
}): ReactNode {
  const c = useColors();
  const color = tone === "accent" ? c.accentText : c[tone];
  return (
    <View style={{ gap: space(2) }}>
      {eyebrow ? <Text style={[type.eyebrow, { color }]}>{eyebrow}</Text> : null}
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

type Variant =
  | "primary"
  | "secondary"
  | "danger"
  | "quiet"
  | "onHero"
  | "onHeroOutline"
  | "onBoard"
  | "onBoardOutline";

export function Button({
  label,
  onPress,
  variant = "primary",
  busy = false,
  busyLabel,
  style,
  accessibilityLabel,
  icon,
  iconSize = 18,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  busy?: boolean;
  busyLabel?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  /** An icon before the label, drawn in the label's colour (so the two never drift apart). */
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  iconSize?: number;
}): ReactNode {
  const c = useColors();
  const look: Record<Variant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: c.accent, fg: c.onAccent },
    // Secondary and quiet words are links: ink in Gate glass and Dusk, orange in LED night.
    secondary: { bg: c.surface, fg: c.link, border: c.line },
    danger: { bg: c.danger, fg: c.surface },
    quiet: { bg: "transparent", fg: c.link },
    onHero: { bg: c.onHero, fg: c.hero },
    onHeroOutline: { bg: "transparent", fg: c.onHero, border: c.heroLine },
    // On a status board, which is light or dark with the theme.
    onBoard: { bg: c.onBoard, fg: c.board },
    onBoardOutline: { bg: "transparent", fg: c.onBoard, border: c.boardMuted },
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
      {busy ? (
        <ActivityIndicator color={fg} size="small" />
      ) : icon ? (
        <Ionicons name={icon} size={iconSize} color={fg} />
      ) : null}
      <Text style={{ fontFamily: fonts.semibold, fontSize: 16, color: fg }} numberOfLines={1}>
        {busy && busyLabel ? busyLabel : label}
      </Text>
    </Press>
  );
}

type FieldProps = TextInputProps & {
  label: string;
  hint?: string;
  /** Drawn inside the box on the right (e.g. the show-password button). */
  trailing?: ReactNode;
};

/**
 * Labelled input: the label is always visible (placeholders are examples, not labels).
 * The box shows focus (a focus-colour border), and the caret, selection and handles use the
 * theme's focus colour instead of Android's default teal.
 */
export const Field = forwardRef<TextInput, FieldProps>(function Field(
  { label, hint, style, trailing, onFocus, onBlur, ...input },
  ref,
) {
  const c = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: space(1.5) }}>
      <T tone="label">{label}</T>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          minHeight: 52,
          borderRadius: radius.control,
          borderCurve: "continuous",
          borderWidth: focused ? 2 : 1,
          // Keep the text from shifting when the border thickens on focus.
          paddingHorizontal: focused ? space(4) - 1 : space(4),
          backgroundColor: c.raised,
          borderColor: focused ? c.focus : c.field,
        }}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={hint}
          placeholderTextColor={c.muted}
          cursorColor={c.focus}
          selectionHandleColor={c.focus}
          selectionColor={`${c.focus}55`}
          underlineColorAndroid="transparent"
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            {
              flex: 1,
              minHeight: 50,
              paddingVertical: space(3),
              fontFamily: fonts.regular,
              fontSize: 16,
              color: c.ink,
            },
            style,
          ]}
          {...input}
        />
        {trailing}
      </View>
      {hint ? <T tone="caption">{hint}</T> : null}
    </View>
  );
});

/** A password field with a show/hide button, so a typo can be checked before submitting. */
export const PasswordField = forwardRef<
  TextInput,
  Omit<FieldProps, "secureTextEntry" | "trailing">
>(function PasswordField(props, ref) {
  const c = useColors();
  const [visible, setVisible] = useState(false);
  return (
    <Field
      ref={ref}
      {...props}
      secureTextEntry={!visible}
      autoCapitalize="none"
      autoCorrect={false}
      trailing={
        <Pressable
          onPress={() => setVisible((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={visible ? "Hide password" : "Show password"}
          hitSlop={8}
          style={{
            width: 44,
            height: 44,
            marginRight: -space(2),
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name={visible ? "eye-off-outline" : "eye-outline"} size={22} color={c.muted} />
        </Pressable>
      }
    />
  );
});

export function FormError({ message }: { message: string | null }): ReactNode {
  const c = useColors();
  if (!message) return null;
  return (
    <T tone="label" accessibilityRole="alert" selectable style={{ color: c.danger }}>
      {message}
    </T>
  );
}

/** A first load failed (usually offline): say so and offer a retry, and show nothing made up. */
export function LoadFailed({
  title,
  message,
  after,
  busy,
  onRetry,
}: {
  title: string;
  message: string | null;
  /** What appears here once it loads. */
  after: string;
  busy: boolean;
  onRetry: () => Promise<void>;
}): ReactNode {
  const c = useColors();
  return (
    <View
      accessibilityRole="alert"
      style={{
        gap: space(3),
        backgroundColor: c.surface,
        borderColor: c.line,
        borderWidth: 1,
        borderRadius: radius.card,
        borderCurve: "continuous",
        padding: space(5),
      }}
    >
      <Ionicons name="cloud-offline-outline" size={28} color={c.muted} />
      <T tone="headline">{title}</T>
      <T tone="muted">{loadFailedText(message, after)}</T>
      <Button
        label="Try again"
        variant="secondary"
        busy={busy}
        busyLabel="Loading…"
        onPress={() => void onRetry()}
      />
    </View>
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
        backgroundColor: tone === "good" ? c.goodSoft : c.warnSoft,
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
          borderRadius: radius.card,
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
  columns,
}: {
  label: string;
  options: { value: V; label: string }[];
  value: V;
  onChange: (value: V) => void;
  onHero?: boolean;
  /** Options per row, for labels too long to share one row ("Maintenance"). */
  columns?: number;
}): ReactNode {
  const c = useColors();
  // Up to four share one row; more wrap, three to a row, so labels stay readable.
  const basis: DimensionValue = columns
    ? `${Math.floor(100 / columns) - 5}%`
    : options.length > 4
      ? "30%"
      : 0;
  return (
    <View style={{ gap: space(2) }}>
      <T tone="label" style={onHero ? { color: c.heroMuted } : undefined}>
        {label}
      </T>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}
      >
        {options.map((option) => {
          const selected = option.value === value;
          const bg = selected ? (onHero ? c.onHero : c.accent) : onHero ? "transparent" : c.raised;
          const fg = selected ? (onHero ? c.hero : c.onAccent) : onHero ? c.onHero : c.ink;
          const border = selected ? bg : onHero ? c.heroLine : c.line;
          return (
            <View key={option.value} style={{ flexGrow: 1, flexShrink: 1, flexBasis: basis }}>
              <Press
                onPress={() => onChange(option.value)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={option.label}
                style={{
                  minHeight: 48,
                  paddingHorizontal: space(2),
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

/**
 * `out` is the "out" status, in its own colours (teal in Gate glass): no other chip uses them.
 * `accent` marks something to notice that isn't a status colour ("Waiting", a staff role): ink
 * on the hairline fill, a step stronger than `muted`. Gate glass's accentSoft is the out teal.
 */
export type ChipTone = "good" | "danger" | "accent" | "out" | "muted";

/** A chip's fill and word colours: [fill, words]. */
export function chipColours(c: Colors, tone: ChipTone): readonly [string, string] {
  const map = {
    good: [c.goodSoft, c.good],
    danger: [c.dangerSoft, c.danger],
    accent: [c.line, c.ink],
    out: [c.outSoft, c.outText],
    muted: [c.line, c.muted],
  } as const;
  return map[tone];
}

/** Small rounded status label: "Verified at gate", "Self-reported", "Late". */
export function StatusChip({ label, tone }: { label: string; tone: ChipTone }): ReactNode {
  const c = useColors();
  const [bg, fg] = chipColours(c, tone);
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
  radiogroup = false,
}: {
  title?: string;
  children: ReactNode;
  footer?: string;
  /** The rows are one choice of several (radio rows): screen readers get them as a named group. */
  radiogroup?: boolean;
}): ReactNode {
  const c = useColors();
  const rows = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <View style={{ gap: space(2) }}>
      {title ? (
        <Text style={[type.eyebrow, { color: c.muted, paddingHorizontal: space(1) }]}>{title}</Text>
      ) : null}
      <View
        accessibilityRole={radiogroup ? "radiogroup" : undefined}
        accessibilityLabel={radiogroup ? title : undefined}
        style={{
          backgroundColor: c.surface,
          borderRadius: radius.card,
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
  accessibilityRole = "button",
  selected,
}: {
  title: string;
  detail?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  danger?: boolean;
  accessibilityLabel?: string;
  /** "radio" for one choice of several (Appearance); then `selected` says whether it's this one. */
  accessibilityRole?: "button" | "radio";
  selected?: boolean;
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
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityRole === "radio" ? { checked: !!selected } : undefined}
      accessibilityLabel={accessibilityLabel ?? title}
      android_ripple={{ color: c.line }}
    >
      {body}
    </Pressable>
  );
}
