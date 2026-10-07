import { router } from "expo-router";
import { useRef, useState, type ReactNode } from "react";
import { ScrollView, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { setPrefs } from "@/lib/prefs";
import { allowNotifications } from "@/notify/notify";
import { haptic } from "@/ui/haptics";
import { Illustration, type IllustrationName } from "@/ui/illustration";
import { Button, T } from "@/ui/kit";
import { FadeIn } from "@/ui/motion";
import { layout, radius, space, type, useColors } from "@/ui/theme";

interface Step {
  art: IllustrationName;
  eyebrow: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    art: "gate",
    eyebrow: "Going out",
    title: "Tap out at the gate",
    body: "Scan the code at the gate when you leave and again when you're back. No register, no queue.",
  },
  {
    art: "pin",
    eyebrow: "On your terms",
    title: "Share your way back",
    body: "Friends and family see your live location only after you approve them, and only until you stop.",
  },
  {
    art: "lantern-lit",
    eyebrow: "Stay in the loop",
    title: "Nudges that matter",
    body: "A reminder before you're due back, and a ping when someone asks to follow you. Nothing else.",
  },
];

export default function Onboarding(): ReactNode {
  const c = useColors();
  const { width } = useWindowDimensions();
  const pager = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const last = index === STEPS.length - 1;

  const go = (i: number): void => {
    haptic.tap();
    pager.current?.scrollTo({ x: i * width, animated: true });
    setIndex(i);
  };

  const finish = async (askForNotifications: boolean): Promise<void> => {
    setBusy(true);
    if (askForNotifications) await allowNotifications().catch(() => false);
    await setPrefs({ onboarded: true });
    haptic.success();
    router.replace("/today");
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.page }}>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", padding: layout.gutter }}>
        {!last ? (
          <Button label="Skip" variant="quiet" onPress={() => void finish(false)} />
        ) : (
          <View style={{ height: 52 }} />
        )}
      </View>

      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        style={{ flex: 1 }}
      >
        {STEPS.map((step, i) => (
          <View
            key={step.art}
            accessibilityElementsHidden={i !== index}
            importantForAccessibility={i === index ? "auto" : "no-hide-descendants"}
            style={{
              width,
              paddingHorizontal: layout.gutter,
              gap: space(6),
              justifyContent: "center",
            }}
          >
            <View
              style={{
                height: 300,
                borderRadius: radius.sheet,
                borderCurve: "continuous",
                backgroundColor: c.surface,
                borderWidth: 1,
                borderColor: c.line,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {i === index ? (
                <FadeIn>
                  <Illustration name={step.art} size={250} />
                </FadeIn>
              ) : (
                <Illustration name={step.art} size={250} />
              )}
            </View>
            <View style={{ gap: space(2) }}>
              <T style={[type.eyebrow, { color: c.accent }]}>{step.eyebrow}</T>
              <T tone="title" accessibilityRole="header">
                {step.title}
              </T>
              <T tone="muted">{step.body}</T>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={{ padding: layout.gutter, gap: space(5) }}>
        <View
          accessibilityLabel={`Step ${index + 1} of ${STEPS.length}`}
          style={{ flexDirection: "row", gap: space(2), justifyContent: "center" }}
        >
          {STEPS.map((step, i) => (
            <View
              key={step.art}
              style={{
                width: i === index ? 24 : 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: i === index ? c.accent : c.line,
              }}
            />
          ))}
        </View>
        {last ? (
          <View style={{ gap: space(2) }}>
            <Button
              label="Turn on notifications"
              busy={busy}
              busyLabel="Setting up…"
              onPress={() => void finish(true)}
            />
            <Button label="Not now" variant="quiet" onPress={() => void finish(false)} />
          </View>
        ) : (
          <Button label="Next" onPress={() => go(index + 1)} />
        )}
      </View>
    </SafeAreaView>
  );
}
