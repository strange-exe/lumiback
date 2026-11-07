import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Text, View, type TextStyle } from "react-native";

import { layout, ROWS } from "@/lib/glyphs";
import { type LedReading, type LedState } from "@/lib/led";
import { useLoop, useMotionSetting } from "@/ui/motion";
import { radius, space, type, useColors, type Colors } from "@/ui/theme";

/**
 * The LED board (owner's pick, "LED night"; spec in .claude/design.md): a dark panel whose one
 * figure is a 5x7 round-dot matrix (lib/glyphs.ts) over its unlit dots, glowing in the colour
 * of the state. Built on
 * React Native's Animated with the native driver (opacity and transform only), so it ships as an
 * over-the-air update. With Android's "Remove animations" on, nothing blinks, steps or scrolls.
 */

export function ledColor(c: Colors, state: LedState): string {
  return state === "late" ? c.ledDanger : state === "in" ? c.ledGood : c.led;
}

/** 0, 0.25, 0.5, 0.75, 1: a panel lighting up in steps, not a fade. */
const stepped = (t: number): number => Math.min(1, Math.floor(t * 5) / 4);

export function LedFigure({
  reading,
  size = 80,
}: {
  reading: LedReading;
  /** Size of the figure: the dot panel is 0.8 x size tall (dots stay at least 3 dp). */
  size?: number;
}): ReactNode {
  const c = useColors();
  const color = ledColor(c, reading.state);
  const reduced = useMotionSetting();
  const [lit] = useState(() => new Animated.Value(1));
  const [colon] = useState(() => new Animated.Value(1));
  const lightened = useRef(false);

  // First appearance: light up in steps (~600 ms), once. Visible from the first frame if the
  // setting never answers, so the figure never depends on an animation to be seen.
  useEffect(() => {
    if (reduced !== false || lightened.current) {
      if (reduced) lit.setValue(1);
      return;
    }
    lightened.current = true;
    lit.setValue(0);
    const up = Animated.timing(lit, {
      toValue: 1,
      duration: 600,
      easing: stepped,
      useNativeDriver: true,
    });
    up.start();
    return () => {
      up.stop();
      lit.setValue(1);
    };
  }, [reduced, lit]);

  const blinks = reading.text.includes(":");
  useLoop(
    () =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(colon, {
            toValue: 0.25,
            duration: 500,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(colon, {
            toValue: 1,
            duration: 500,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ),
    () => colon.setValue(1),
    blinks,
  );

  const { columns, chars } = useMemo(() => layout(reading.text), [reading.text]);
  // Dot pitch: the panel is 0.8 x size tall, seven rows. Round dots with a clear gap between.
  const pitch = Math.max(4, Math.round((size * 0.8) / ROWS));
  const d = Math.max(3, Math.round(pitch * 0.72));
  const dotAt = (key: string, x: number, y: number, fill: string, glow?: string): ReactNode => (
    <View
      key={key}
      style={{
        position: "absolute",
        left: x * pitch + (pitch - d) / 2,
        top: y * pitch + (pitch - d) / 2,
        width: d,
        height: d,
        borderRadius: d / 2,
        backgroundColor: fill,
        boxShadow: glow,
      }}
    />
  );
  const glow = `0 0 ${Math.round(pitch * 0.7)}px ${color}b3`;
  const panel = { width: columns * pitch, height: ROWS * pitch };
  const layer = { position: "absolute", left: 0, top: 0, ...panel } as const;

  const unlit: ReactNode[] = [];
  for (let x = 0; x < columns; x += 1)
    for (let y = 0; y < ROWS; y += 1) unlit.push(dotAt(`${x}.${y}`, x, y, `${color}21`));

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={reading.label}
      style={{ flexDirection: "row", alignItems: "flex-end", gap: space(2), flexWrap: "wrap" }}
    >
      {/* The panel: every dot present and dim, the figure's dots lit over them. Decoration, so
          screen readers skip it and read the label. */}
      <View
        testID="led-panel"
        style={panel}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        <View testID="led-unlit" style={layer}>
          {unlit}
        </View>
        <Animated.View testID="led-lit" style={[layer, { opacity: lit }]}>
          {chars.map((ch, index) => {
            // Keyed by position, so digits change in place (no re-light) as the time ticks.
            const lights = ch.dots.map(([x, y]) => dotAt(`${x}.${y}`, x, y, color, glow));
            return ch.colon ? (
              <Animated.View key={index} testID="led-colon" style={[layer, { opacity: colon }]}>
                {lights}
              </Animated.View>
            ) : (
              <View key={index} style={layer}>
                {lights}
              </View>
            );
          })}
        </Animated.View>
      </View>
      {reading.unit ? (
        <Text style={[type.label, { fontSize: 16, color: c.boardMuted, lineHeight: 18 }]}>
          {reading.unit}
        </Text>
      ) : null}
    </View>
  );
}

/** The breathing orange light behind a board (a pre-rendered radial, opacity only). */
function BoardGlow(): ReactNode {
  const [breath] = useState(() => new Animated.Value(1));
  useLoop(
    () =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(breath, {
            toValue: 0.55,
            duration: 2600,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(breath, {
            toValue: 1,
            duration: 2600,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      ),
    () => breath.setValue(0.8),
  );
  return (
    <Animated.Image
      source={require("../../assets/led/glow.png")}
      resizeMode="stretch"
      accessible={false}
      importantForAccessibility="no"
      style={{
        position: "absolute",
        left: -48,
        right: -48,
        top: -64,
        bottom: -64,
        width: undefined,
        height: undefined,
        opacity: breath,
      }}
    />
  );
}

/** A slow scrolling line along the bottom of the board. Never the only place its words are. */
function Ticker({ text }: { text: string }): ReactNode {
  const c = useColors();
  const reduced = useMotionSetting();
  const [width, setWidth] = useState(0);
  const [shift] = useState(() => new Animated.Value(0));
  const line: TextStyle = { ...type.caption, color: c.boardMuted, paddingRight: space(10) };

  useLoop(
    () =>
      Animated.loop(
        Animated.timing(shift, {
          toValue: -width,
          duration: Math.max(4000, (width / 28) * 1000), // ~28 dp a second
          easing: Easing.linear, // an endless loop: the one place linear is right
          useNativeDriver: true,
        }),
      ),
    () => shift.setValue(0),
    width > 0,
    width,
  );

  return (
    <View
      testID="led-ticker"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{
        overflow: "hidden",
        borderTopWidth: 1,
        borderTopColor: c.boardLine,
        paddingTop: space(3),
      }}
    >
      {reduced !== false ? (
        <Text style={line} numberOfLines={1}>
          {text}
        </Text>
      ) : (
        <Animated.View style={{ flexDirection: "row", transform: [{ translateX: shift }] }}>
          <Text
            style={line}
            numberOfLines={1}
            onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
          >
            {text}
          </Text>
          <Text style={line} numberOfLines={1}>
            {text}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

/**
 * The status board: a label row (state on the left, a time on the right), the LED figure, then
 * whatever the screen puts under it (title, actions). `glow` adds the breathing light behind it.
 */
export function LedBoard({
  label,
  labelTone = "muted",
  aside,
  asideTone = "muted",
  reading,
  figureSize,
  ticker,
  glow = false,
  children,
}: {
  label: string;
  labelTone?: "muted" | LedState;
  aside?: string;
  asideTone?: "muted" | LedState;
  reading: LedReading;
  figureSize?: number;
  ticker?: string;
  glow?: boolean;
  children?: ReactNode;
}): ReactNode {
  const c = useColors();
  const labelColor = labelTone === "muted" ? c.boardMuted : ledColor(c, labelTone);
  return (
    <View>
      {glow ? <BoardGlow /> : null}
      <View
        style={{
          backgroundColor: c.board,
          borderRadius: radius.board,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: c.boardLine,
          padding: space(6),
          gap: space(5),
          overflow: "hidden",
          boxShadow: c.shadow,
        }}
      >
        <View style={{ gap: space(2) }}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              gap: space(3),
            }}
          >
            <Text style={[type.label, { color: labelColor, flexShrink: 1 }]}>{label}</Text>
            {aside ? (
              <Text
                style={[
                  type.label,
                  {
                    color: asideTone === "muted" ? c.boardMuted : ledColor(c, asideTone),
                    fontVariant: ["tabular-nums"],
                    flexShrink: 1,
                    textAlign: "right",
                  },
                ]}
              >
                {aside}
              </Text>
            ) : null}
          </View>
          <LedFigure reading={reading} size={figureSize} />
        </View>
        {children}
        {ticker ? <Ticker text={ticker} /> : null}
      </View>
    </View>
  );
}
