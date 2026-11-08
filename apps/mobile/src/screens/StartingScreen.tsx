import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  handoffSteps,
  startingLines,
  waitedLabel,
  SLOW_AFTER_MS,
  type HandoffStep,
  type StartOutcome,
} from "@/lib/starting";
import { useLoop, useReducedMotion } from "@/ui/motion";
import { space, type, useColors } from "@/ui/theme";

/**
 * Shown at launch while a stored session is checked, which can take up to a minute when the
 * free server has to wake. An opening title on the dark LED board: a line draws, "Lumiback"
 * rises letter by letter above it, and an orange segment sweeps the line while the server
 * wakes. After a few seconds it says why, with a clock. Once the server answers it plays a short
 * hand-off ("Server started", "Signing you in", "Welcome back, Riya": only lines that are true
 * by then, see handoffSteps), fills the line, fades out and calls onDone. Offline hands over at
 * once to "Can't reach Lumiback". Everything honours Android's "Remove animations": the words
 * still change, nothing moves.
 *
 * Motion is React Native's Animated on the native driver (opacity and transform only), so it
 * ships in an over-the-air update.
 */

const CHARS = [..."Lumiback"];
const WORD_LINE = 72;
/** Entrances ease out, exits ease in, loops ease in and out; nothing linear. */
const OUT_EXPO = Easing.bezier(0.16, 1, 0.3, 1);
const OUT_QUINT = Easing.bezier(0.22, 1, 0.36, 1);
const IN = Easing.bezier(0.55, 0, 1, 0.45);
const IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);
/** The sweeping segment, as a share of the line. */
const SEGMENT = 0.38;
/** Where the segment rests when nothing moves: its left end at the line's start. */
const SEGMENT_REST = SEGMENT / (1 + SEGMENT);
/** The hand-off opens the app by this long after it starts, even if an animation never ends. */
const GUARD_MS = 6000;

type Timer = ReturnType<typeof setTimeout>;

export function StartingScreen({
  outcome,
  userName,
  onDone,
}: {
  /** null while the launch check is still waiting. */
  outcome: StartOutcome | null;
  userName: string | null;
  onDone(): void;
}): ReactNode {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  // The latest props for the hand-off's timers, which outlive a render.
  const latest = useRef({ reduced, onDone, userName });
  useEffect(() => {
    latest.current = { reduced, onDone, userName };
  });

  // The clock: one tick a second is enough for "Waiting 0:12" and the slow switch.
  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState(mountedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const elapsed = now - mountedAt;
  const slow = elapsed >= SLOW_AFTER_MS;

  // The hand-off line on show (null while waiting); set by the hand-off's timers below.
  const [line, setLine] = useState<string | null>(null);
  const handing = line !== null;

  // Animated values, made once.
  const [letters] = useState(() => CHARS.map(() => new Animated.Value(0)));
  const [draw] = useState(() => new Animated.Value(0));
  const [sweep] = useState(() => new Animated.Value(SEGMENT_REST));
  const [fill] = useState(() => new Animated.Value(0));
  const [exit] = useState(() => new Animated.Value(0));
  const [width, setWidth] = useState(0);

  // The title: the line draws, then the letters rise from behind it, one after another.
  useEffect(() => {
    if (reduced) {
      for (const v of letters) v.setValue(1);
      draw.setValue(1);
      return;
    }
    const intro = Animated.parallel([
      Animated.timing(draw, {
        toValue: 1,
        duration: 700,
        delay: 100,
        easing: OUT_QUINT,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(200),
        Animated.stagger(
          45,
          letters.map((v) =>
            Animated.timing(v, {
              toValue: 1,
              duration: 760,
              easing: OUT_EXPO,
              useNativeDriver: true,
            }),
          ),
        ),
      ]),
    ]);
    intro.start();
    return () => intro.stop();
  }, [reduced, letters, draw]);

  // The segment sweeps the line while the server wakes; it stops for the hand-off.
  useLoop(
    () =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(sweep, { toValue: 0, duration: 0, useNativeDriver: true }),
          Animated.timing(sweep, {
            toValue: 1,
            duration: 1800,
            easing: IN_OUT,
            useNativeDriver: true,
          }),
        ]),
      ),
    () => sweep.setValue(SEGMENT_REST),
    width > 0 && !handing,
    width,
  );

  // The hand-off: fill the line, show each line for its hold, fade out, hand over.
  // The lines are decided when the check ends: how long it waited picks them (handoffSteps).
  // Each hold starts when its line has finished rolling in (onShown), so a busy JS thread
  // delays a line instead of skipping it.
  const handoff = useRef<{ steps: HandoffStep[]; index: number; timer?: Timer }>({
    steps: [],
    index: -1,
  });
  useEffect(() => {
    if (!outcome) return;
    const h = handoff.current;
    const { reduced: still, userName: name } = latest.current;
    const steps = handoffSteps(outcome, Date.now() - mountedAt, name);
    const done = () => latest.current.onDone();
    const first = steps[0];
    if (!first) {
      h.timer = setTimeout(done, 0);
      return () => clearTimeout(h.timer);
    }
    if (still) fill.setValue(1);
    else
      Animated.timing(fill, {
        toValue: 1,
        duration: 420,
        easing: OUT_QUINT,
        useNativeDriver: true,
      }).start();
    h.steps = steps;
    h.index = 0;
    h.timer = setTimeout(() => setLine(first.line), 0);
    // A safety net: whatever happens to the animations, the app opens.
    const guard = setTimeout(done, GUARD_MS);
    return () => {
      clearTimeout(h.timer);
      clearTimeout(guard);
      h.index = -1;
    };
  }, [outcome, mountedAt, fill, exit]);

  const onShown = useCallback(
    (shownTitle: string) => {
      const h = handoff.current;
      const step = h.steps[h.index];
      if (!step || step.line !== shownTitle) return;
      h.index += 1;
      const next = h.steps[h.index];
      h.timer = setTimeout(() => {
        if (next) return setLine(next.line);
        const done = () => latest.current.onDone();
        if (latest.current.reduced) return done();
        Animated.timing(exit, {
          toValue: 1,
          duration: 240,
          easing: IN,
          useNativeDriver: true,
        }).start(done);
      }, step.holdMs);
    },
    [exit],
  );

  const waiting = startingLines(elapsed);
  const title = line ?? waiting.title;
  const detail = handing ? null : waiting.detail;
  const spoken = title === "Starting" ? "Starting Lumiback" : title;

  const onLine = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  return (
    <View style={{ flex: 1, backgroundColor: c.page }}>
      <Animated.View
        style={{
          flex: 1,
          backgroundColor: c.board,
          opacity: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          paddingTop: insets.top + space(6),
          paddingBottom: insets.bottom + space(12),
          paddingHorizontal: space(6),
        }}
      >
        {/* How long it has waited, once it is slow; the words below say the same for screen readers. */}
        <View
          importantForAccessibility="no-hide-descendants"
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            opacity: slow && !handing ? 1 : 0,
          }}
        >
          <Animated.Text style={[type.caption, { color: c.boardMuted }]}>Waiting</Animated.Text>
          <Animated.Text
            style={[type.caption, { color: c.boardMuted, fontVariant: ["tabular-nums"] }]}
          >
            {waitedLabel(elapsed)}
          </Animated.Text>
        </View>

        <View style={{ flex: 1 }} />

        <Animated.View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={detail ? `${title}. ${detail}` : spoken}
          accessibilityLiveRegion="polite"
          style={{
            transform: [
              { translateY: exit.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) },
            ],
          }}
        >
          {/* The wordmark: each letter rises from behind the line's top edge. */}
          <View
            importantForAccessibility="no-hide-descendants"
            style={{ flexDirection: "row", overflow: "hidden", height: WORD_LINE + 4 }}
          >
            {letters.map((rise, i) => (
              <Animated.Text
                key={i}
                allowFontScaling={false}
                style={{
                  fontFamily: type.title.fontFamily,
                  fontSize: 64,
                  lineHeight: WORD_LINE,
                  letterSpacing: -2,
                  color: c.onBoard,
                  transform: [
                    {
                      translateY: rise.interpolate({
                        inputRange: [0, 1],
                        outputRange: [WORD_LINE + 6, 0],
                      }),
                    },
                  ],
                }}
              >
                {CHARS[i]}
              </Animated.Text>
            ))}
          </View>

          {/* The line: draws in, carries the sweeping segment, fills orange on the hand-off. */}
          <Animated.View
            onLayout={onLine}
            style={{
              marginTop: space(4),
              height: 3,
              borderRadius: 2,
              backgroundColor: c.boardLine,
              overflow: "hidden",
              transform: [
                {
                  translateX: draw.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-width / 2, 0],
                  }),
                },
                { scaleX: draw },
              ],
            }}
          >
            <Animated.View
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: 0,
                width: width * SEGMENT,
                borderRadius: 2,
                backgroundColor: c.led,
                transform: [
                  {
                    translateX: sweep.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-width * SEGMENT, width],
                    }),
                  },
                ],
              }}
            />
            <Animated.View
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: 0,
                width,
                backgroundColor: c.led,
                transform: [
                  {
                    translateX: fill.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] }),
                  },
                ],
              }}
            />
          </Animated.View>

          <Rolling title={title} detail={detail} reduced={reduced} onShown={onShown} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/**
 * The status words. A new line rolls in: the old one lifts away (ease in), the new one rises
 * from below (ease out). With animations off it simply changes.
 */
function Rolling({
  title,
  detail,
  reduced,
  onShown,
}: {
  title: string;
  detail: string | null;
  reduced: boolean;
  /** Called with the title once it is fully on screen. */
  onShown(title: string): void;
}): ReactNode {
  const c = useColors();
  const [shown, setShown] = useState({ title, detail });
  const [opacity] = useState(() => new Animated.Value(1));
  const [lift] = useState(() => new Animated.Value(0));

  // With animations off the words simply change (set while rendering, React's pattern for
  // state that follows a prop).
  const changed = title !== shown.title || detail !== shown.detail;
  if (reduced && changed) setShown({ title, detail });
  useEffect(() => {
    if (reduced) onShown(shown.title);
  }, [reduced, shown.title, onShown]);

  // Each roll carries its own words: a newer line stops it and starts its own, so the roll that
  // ends always shows the words it was started for (never stale ones).
  useEffect(() => {
    if (reduced || !changed) return;
    const next = { title, detail };
    let current = true;
    const out = Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 160, easing: IN, useNativeDriver: true }),
      Animated.timing(lift, { toValue: -10, duration: 160, easing: IN, useNativeDriver: true }),
    ]);
    out.start(() => {
      if (!current) return;
      setShown(next);
      lift.setValue(12);
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 300,
          easing: OUT_QUINT,
          useNativeDriver: true,
        }),
        Animated.timing(lift, {
          toValue: 0,
          duration: 300,
          easing: OUT_QUINT,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) onShown(next.title);
      });
    });
    return () => {
      current = false;
      out.stop();
    };
  }, [title, detail, changed, reduced, opacity, lift, onShown]);

  return (
    <Animated.View
      style={{
        marginTop: space(5),
        gap: space(2),
        // Room for the title and three lines of detail, so the name and the line above don't
        // jump when the detail goes at the hand-off.
        minHeight: type.headline.lineHeight + space(2) + type.body.lineHeight * 3,
        opacity,
        transform: [{ translateY: lift }],
      }}
    >
      <Animated.Text style={[type.headline, { color: c.onBoard }]}>{shown.title}</Animated.Text>
      {shown.detail ? (
        <Animated.Text style={[type.body, { color: c.boardMuted }]}>{shown.detail}</Animated.Text>
      ) : null}
    </Animated.View>
  );
}
