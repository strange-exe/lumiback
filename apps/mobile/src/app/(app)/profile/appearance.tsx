import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";

import { setPrefs, usePrefs, type Prefs } from "@/lib/prefs";
import { haptic } from "@/ui/haptics";
import { Row, Screen, Section } from "@/ui/kit";
import { useColors } from "@/ui/theme";

const OPTIONS: { value: Prefs["appearance"]; title: string; detail?: string }[] = [
  { value: "system", title: "Match phone", detail: "Follows Android's dark theme setting" },
  { value: "light", title: "Light" },
  { value: "dark", title: "Dark" },
];

export default function Appearance(): ReactNode {
  const c = useColors();
  const { appearance } = usePrefs();
  return (
    <Screen edges={["bottom"]}>
      <Section>
        {OPTIONS.map((o) => {
          const selected = o.value === appearance;
          return (
            <Row
              key={o.value}
              title={o.title}
              detail={o.detail}
              accessibilityLabel={`${o.title}${selected ? ", selected" : ""}`}
              onPress={() => {
                haptic.tap();
                void setPrefs({ appearance: o.value });
              }}
              trailing={
                <Ionicons
                  name={selected ? "radio-button-on" : "radio-button-off"}
                  size={22}
                  color={selected ? c.accent : c.muted}
                />
              }
            />
          );
        })}
      </Section>
    </Screen>
  );
}
