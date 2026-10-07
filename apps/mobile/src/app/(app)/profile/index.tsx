import Ionicons from "@expo/vector-icons/Ionicons";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { Linking, Text, View } from "react-native";

import { useAuth } from "@/lib/auth";
import { WEB_URL } from "@/lib/config";
import { usePrefs } from "@/lib/prefs";
import { formatDate } from "@/lib/time";
import { stopSending } from "@/location/task";
import { syncReturnReminders } from "@/notify/notify";
import { Row, Screen, Section, T } from "@/ui/kit";
import { fonts, space, useColors } from "@/ui/theme";

const APPEARANCE = { system: "Match phone", light: "Light", dark: "Dark" } as const;

export default function Profile(): ReactNode {
  const { user, signOut } = useAuth();
  const prefs = usePrefs();
  const c = useColors();
  const [signingOut, setSigningOut] = useState(false);
  if (!user) return null;

  const initials = user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  const icon = (name: React.ComponentProps<typeof Ionicons>["name"], color = c.pine) => (
    <Ionicons name={name} size={22} color={color} />
  );
  const chevron = <Ionicons name="chevron-forward" size={18} color={c.stone} />;

  return (
    <Screen edges={["top"]}>
      <View style={{ alignItems: "center", gap: space(3), paddingTop: space(4) }}>
        <View
          accessible={false}
          style={{
            width: 88,
            height: 88,
            borderRadius: 44,
            backgroundColor: c.hero,
            alignItems: "center",
            justifyContent: "center",
            boxShadow: c.shadow,
          }}
        >
          <Text style={{ fontFamily: fonts.semibold, fontSize: 32, color: c.onHero }}>
            {initials || "?"}
          </Text>
        </View>
        <View style={{ alignItems: "center", gap: space(1) }}>
          <T tone="title" accessibilityRole="header" style={{ textAlign: "center" }}>
            {user.name}
          </T>
          <T tone="muted" selectable>
            {user.email}
          </T>
          <T tone="caption">
            {[
              user.roll_no ? `Roll no. ${user.roll_no}` : null,
              `Joined ${formatDate(user.created_at)}`,
            ]
              .filter(Boolean)
              .join("  ·  ")}
          </T>
        </View>
      </View>

      <Section title="Settings">
        <Row
          leading={icon("notifications-outline")}
          title="Notifications"
          detail={
            [prefs.followRequests, prefs.returnReminders, prefs.shareStatus].every(Boolean)
              ? "All on"
              : "Some off"
          }
          trailing={chevron}
          onPress={() => router.push("/profile/notifications")}
        />
        <Row
          leading={icon("contrast-outline")}
          title="Appearance"
          detail={APPEARANCE[prefs.appearance]}
          trailing={chevron}
          onPress={() => router.push("/profile/appearance")}
        />
      </Section>

      <Section title="Support">
        <Row
          leading={icon("help-circle-outline")}
          title="Help and questions"
          trailing={chevron}
          onPress={() => router.push("/profile/help")}
        />
        <Row
          leading={icon("shield-checkmark-outline")}
          title="Privacy notice"
          detail="What we collect and who can see it"
          trailing={<Ionicons name="open-outline" size={18} color={c.stone} />}
          onPress={() => void Linking.openURL(`${WEB_URL}/privacy`)}
        />
      </Section>

      <Section title="Account">
        <Row
          leading={icon("log-out-outline")}
          title={signingOut ? "Signing out…" : "Sign out"}
          onPress={() => {
            if (signingOut) return;
            setSigningOut(true);
            void stopSending()
              .then(() => syncReturnReminders(null))
              .then(signOut)
              .finally(() => setSigningOut(false));
          }}
        />
        <Row
          leading={icon("trash-outline", c.ember)}
          title="Delete account"
          danger
          trailing={chevron}
          onPress={() => router.push("/profile/delete-account")}
        />
      </Section>

      <T tone="caption" style={{ textAlign: "center" }}>
        Lumiback {Constants.expoConfig?.version ?? ""}
      </T>
    </Screen>
  );
}
