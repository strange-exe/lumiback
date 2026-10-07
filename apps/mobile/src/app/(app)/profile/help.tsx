import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";

import { Screen, Section, T } from "@/ui/kit";
import { space, useColors } from "@/ui/theme";

const FAQ: { q: string; a: string }[] = [
  {
    q: "Who can see my location?",
    a: "Only people you approve while you're sharing. You see everyone who can view you on the Share tab, and you can remove anyone at any time. Sharing stops when the time runs out or when you stop it.",
  },
  {
    q: "Does Lumiback track me in the background?",
    a: "Only while you are sharing, and Android shows a notification the whole time. When sharing ends, location stops. The app never asks for background location access.",
  },
  {
    q: "What happens if I'm late?",
    a: "You get a reminder 10 minutes before you're due and another when you're due. Add time from the Today tab so nobody worries.",
  },
  {
    q: "Why did my share end by itself?",
    a: "Shares end when their time runs out, or if your phone stops sending its location for 15 minutes (for example with no signal or a flat battery).",
  },
  {
    q: "Someone sent me a code. What do I do?",
    a: "Open Live, choose Follow someone and enter the code, or paste the whole message. You'll see their location once they approve you.",
  },
  {
    q: "How do I delete my data?",
    a: "Profile, then Delete account. Your outings, shares and contacts are removed permanently, and anyone watching you loses access straight away.",
  },
];

export default function Help(): ReactNode {
  const c = useColors();
  const [open, setOpen] = useState<number | null>(0);
  return (
    <Screen edges={["bottom"]}>
      <Section>
        {FAQ.map((item, i) => {
          const expanded = open === i;
          return (
            <Pressable
              key={item.q}
              onPress={() => setOpen(expanded ? null : i)}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              android_ripple={{ color: c.line }}
              style={{ paddingHorizontal: space(4), paddingVertical: space(4), gap: space(2) }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: space(3) }}>
                <T tone="label" style={{ flex: 1, fontSize: 16, lineHeight: 22 }}>
                  {item.q}
                </T>
                <Ionicons
                  name={expanded ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={c.muted}
                />
              </View>
              {expanded ? <T tone="muted">{item.a}</T> : null}
            </Pressable>
          );
        })}
      </Section>
    </Screen>
  );
}
