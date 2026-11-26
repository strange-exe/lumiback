import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { View } from "react-native";

import { setPrefs, THEME_NAMES, usePrefs, type Prefs, type ThemeName } from "@/lib/prefs";
import { haptic } from "@/ui/haptics";
import { Row, Screen, Section } from "@/ui/kit";
import { space, themes, useColors, useIsDark, type Colors } from "@/ui/theme";

/** One plain line under each colour theme's name: the website's picker uses the same three. */
const THEME_LINES: Record<ThemeName, string> = {
  gate: "Calm paper and dark ink, teal when you're out",
  led: "Graphite and signal orange, like a station's LED board",
  dusk: "Soft paper with orchid and indigo",
};

const OPTIONS: { value: Prefs["appearance"]; title: string; detail?: string }[] = [
  { value: "system", title: "Match phone", detail: "Follows Android's dark theme setting" },
  { value: "light", title: "Light" },
  { value: "dark", title: "Dark" },
];

/**
 * A theme in miniature: a chip of its page colour (edged with its own line colour) holding its
 * accent and LED dots. Decoration only: the row's name says which theme it is.
 */
function Swatch({ colors }: { colors: Colors }): ReactNode {
  const dot = { width: 10, height: 10, borderRadius: 5 };
  return (
    <View
      testID="theme-swatch"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <View
        testID="swatch-dot"
        style={{
          backgroundColor: colors.page,
          borderColor: colors.line,
          borderWidth: 1,
          borderRadius: 8,
          flexDirection: "row",
          gap: space(1),
          paddingHorizontal: space(1.5),
          paddingVertical: space(2),
        }}
      >
        <View testID="swatch-dot" style={{ ...dot, backgroundColor: colors.accent }} />
        <View testID="swatch-dot" style={{ ...dot, backgroundColor: colors.led }} />
      </View>
    </View>
  );
}

function Radio({ selected }: { selected: boolean }): ReactNode {
  const c = useColors();
  return (
    <Ionicons
      name={selected ? "radio-button-on" : "radio-button-off"}
      size={22}
      color={selected ? c.accent : c.muted}
    />
  );
}

export default function Appearance(): ReactNode {
  const dark = useIsDark();
  const { appearance, theme } = usePrefs();
  return (
    <Screen edges={["bottom"]}>
      <Section title="Colour theme" radiogroup>
        {THEME_NAMES.map((name) => {
          const selected = name === theme;
          const { name: title } = themes[name];
          return (
            <Row
              key={name}
              title={title}
              detail={THEME_LINES[name]}
              accessibilityRole="radio"
              selected={selected}
              onPress={() => {
                haptic.tap();
                void setPrefs({ theme: name });
              }}
              leading={<Swatch colors={dark ? themes[name].dark : themes[name].light} />}
              trailing={<Radio selected={selected} />}
            />
          );
        })}
      </Section>
      <Section title="Light or dark" radiogroup>
        {OPTIONS.map((o) => {
          const selected = o.value === appearance;
          return (
            <Row
              key={o.value}
              title={o.title}
              detail={o.detail}
              accessibilityRole="radio"
              selected={selected}
              onPress={() => {
                haptic.tap();
                void setPrefs({ appearance: o.value });
              }}
              trailing={<Radio selected={selected} />}
            />
          );
        })}
      </Section>
    </Screen>
  );
}
