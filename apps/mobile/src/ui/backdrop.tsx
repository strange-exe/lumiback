import { useMemo, useState, type ReactNode } from "react";
import { Animated, Easing, Image, StyleSheet, useWindowDimensions, View } from "react-native";

import { useLoop, useMotionSetting } from "@/ui/motion";
import { useColors, useIsDark } from "@/ui/theme";

const DOTS = {
  light: require("../../assets/led/dot-light.png"),
  dark: require("../../assets/led/dot-dark.png"),
};
const SCAN = require("../../assets/led/scan.png");
const BAND = 140;

/** The grid's pitch (dp), and where each dot sits inside its tile (the tile's centre). */
export const PITCH = 9;
const CENTRE = PITCH / 2;
/** About one grid dot in this many can light up. */
const SPARSE = 11;
/** One pass of the wave across the screen, then a rest before the next (ms). */
const WAVE_MS = 7000;
const REST_MS = 1600;

/**
 * The app's background (owner's asks: "there is no background in APP UI", then "give it an
 * actual animated motion background component"): the page colour with a 9 dp dot grid, from a
 * tiny tile repeated by the image view, and the LED field over it: a sparse set of the grid's
 * own dots that a slow diagonal wave lights up, like a board warming, and lets fade. Status
 * screens add `scan`, a faint band passing down the grid. All of it stops with Android's
 * Remove animations (a still grid). Purely decorative and behind everything: put it first
 * inside a view that paints `page`.
 */
export function DotBackground({ scan = false }: { scan?: boolean }): ReactNode {
  const dark = useIsDark();
  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={StyleSheet.absoluteFill}
    >
      <Image
        source={dark ? DOTS.dark : DOTS.light}
        resizeMode="repeat"
        style={{ width: "100%", height: "100%" }}
      />
      <LedField />
      {scan ? <ScanBand /> : null}
    </View>
  );
}

/** A fixed pseudo-random number in [0, 1) for a grid cell: the same dots light on every visit. */
function noise(col: number, row: number, salt: number): number {
  const n = Math.sin(col * 127.1 + row * 311.7 + salt * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

export type FieldDot = { x: number; y: number; at: number; peak: number };

/**
 * The dots that can light on a screen this size, each with the moment in the wave's pass (0 to 1)
 * it peaks at and how bright it gets. The wave runs from the top left to the bottom right, with a
 * little jitter so it reads as light, not a ruler.
 */
export function fieldDots(width: number, height: number): FieldDot[] {
  const cols = Math.ceil(width / PITCH);
  const rows = Math.ceil(height / PITCH);
  const dots: FieldDot[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (noise(col, row, 1) * SPARSE >= 1) continue;
      const diagonal = (col / cols) * 0.55 + (row / rows) * 0.45;
      dots.push({
        x: col * PITCH + CENTRE,
        y: row * PITCH + CENTRE,
        // In [0.06, 0.84], so its rise (-0.05) and fade (+0.16) stay inside the 0..1 pass.
        at: 0.1 + diagonal * 0.7 + (noise(col, row, 2) - 0.5) * 0.08,
        peak: 0.35 + noise(col, row, 3) * 0.55,
      });
    }
  }
  return dots;
}

const DOT = 4;

function LedField(): ReactNode {
  const c = useColors();
  const { width, height } = useWindowDimensions();
  const reduced = useMotionSetting();
  const [wave] = useState(() => new Animated.Value(0));
  const dots = useMemo(() => fieldDots(width, height), [width, height]);
  useLoop(
    () =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(wave, {
            toValue: 1,
            duration: WAVE_MS,
            easing: Easing.linear, // an endless sweep: constant speed reads as a passing wave
            useNativeDriver: true,
          }),
          Animated.delay(REST_MS),
          Animated.timing(wave, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ),
    () => wave.setValue(0),
    true,
    dots.length,
  );
  // Still until Android says animations are on, and never for someone who turned them off.
  if (reduced !== false) return null;
  return (
    <View testID="led-field" style={StyleSheet.absoluteFill}>
      {dots.map((d) => (
        <Animated.View
          key={`${d.x},${d.y}`}
          style={{
            position: "absolute",
            left: d.x - DOT / 2,
            top: d.y - DOT / 2,
            width: DOT,
            height: DOT,
            borderRadius: DOT / 2,
            backgroundColor: c.led,
            // Dark until the wave reaches it, brightest as it passes, then a slower fade.
            opacity: wave.interpolate({
              inputRange: [0, d.at - 0.05, d.at, d.at + 0.16, 1],
              outputRange: [0, 0, d.peak, 0, 0],
            }),
          }}
        />
      ))}
    </View>
  );
}

function ScanBand(): ReactNode {
  const { height } = useWindowDimensions();
  const [y] = useState(() => new Animated.Value(-BAND));
  useLoop(
    () =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(y, {
            toValue: height,
            duration: 2800,
            easing: Easing.linear, // an endless sweep: constant speed reads as a scanner
            useNativeDriver: true,
          }),
          Animated.delay(3200),
          Animated.timing(y, { toValue: -BAND, duration: 0, useNativeDriver: true }),
        ]),
      ),
    () => y.setValue(-BAND),
    true,
    height,
  );
  return (
    <Animated.Image
      source={SCAN}
      resizeMode="stretch"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        width: "100%",
        height: BAND,
        transform: [{ translateY: y }],
      }}
    />
  );
}
