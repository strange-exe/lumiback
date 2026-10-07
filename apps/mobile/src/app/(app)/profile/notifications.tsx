import * as Notifications from "expo-notifications";
import { useFocusEffect } from "expo-router";
import { useCallback, useState, type ReactNode } from "react";
import { Linking, Switch } from "react-native";

import { setPrefs, usePrefs, type Prefs } from "@/lib/prefs";
import { allowNotifications } from "@/notify/notify";
import { haptic } from "@/ui/haptics";
import { Button, Card, Row, Screen, Section, T } from "@/ui/kit";
import { useColors } from "@/ui/theme";

type Toggle = "followRequests" | "returnReminders" | "shareStatus";

const TOGGLES: { key: Toggle; title: string; detail: string }[] = [
  {
    key: "followRequests",
    title: "Follow requests",
    detail: "When someone enters your code while you're sharing.",
  },
  {
    key: "returnReminders",
    title: "Return reminders",
    detail: "10 minutes before you're due back, and when you're due.",
  },
  {
    key: "shareStatus",
    title: "Sharing ended",
    detail: "When a live share ends on its own, with the reason.",
  },
];

export default function NotificationSettings(): ReactNode {
  const c = useColors();
  const prefs = usePrefs();
  const [system, setSystem] = useState<"granted" | "denied" | "undetermined" | null>(null);

  // Re-checked on focus: the student may come back from Android settings.
  useFocusEffect(
    useCallback(() => {
      void Notifications.getPermissionsAsync().then((p) => setSystem(p.status));
    }, []),
  );

  const toggle = (key: Toggle, value: boolean): void => {
    haptic.tap();
    void setPrefs({ [key]: value } as Partial<Prefs>);
  };

  return (
    <Screen edges={["bottom"]}>
      {system && system !== "granted" ? (
        <Card style={{ borderColor: c.lantern }}>
          <T tone="headline">Notifications are off</T>
          <T tone="muted">
            Android is blocking notifications from Lumiback, so none of the choices below can reach
            you.
          </T>
          {system === "undetermined" ? (
            <Button
              label="Allow notifications"
              onPress={() =>
                void allowNotifications().then((ok) => setSystem(ok ? "granted" : "denied"))
              }
            />
          ) : (
            <Button label="Open Android settings" onPress={() => void Linking.openSettings()} />
          )}
        </Card>
      ) : null}

      <Section footer="Changes apply straight away, on this phone.">
        {TOGGLES.map((t) => (
          <Row
            key={t.key}
            title={t.title}
            detail={t.detail}
            accessibilityLabel={t.title}
            onPress={() => toggle(t.key, !prefs[t.key])}
            trailing={
              <Switch
                value={prefs[t.key]}
                onValueChange={(v) => toggle(t.key, v)}
                accessibilityLabel={t.title}
                trackColor={{ true: c.pine, false: c.line }}
                thumbColor={c.surface}
              />
            }
          />
        ))}
      </Section>
    </Screen>
  );
}
