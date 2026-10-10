import Ionicons from "@expo/vector-icons/Ionicons";
import * as Notifications from "expo-notifications";
import { router, useFocusEffect } from "expo-router";
import * as Updates from "expo-updates";
import { useCallback, useState, type ReactNode } from "react";
import { Linking, Text, View } from "react-native";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { buildLines } from "@/lib/build-info";
import { WEB_URL } from "@/lib/config";
import { usePrefs } from "@/lib/prefs";
import { formatDate } from "@/lib/time";
import type { Profile as ProfileData } from "@/lib/types";
import { useData } from "@/lib/use-data";
import { stopSending } from "@/location/task";
import { syncReturnReminders } from "@/notify/notify";
import { Press, Row, Screen, Section, T } from "@/ui/kit";
import { fonts, radius, space, useColors } from "@/ui/theme";
import { CURRENT, NATIVE_BUILDS } from "@/updates/changelog";
import { showUpdatePrompt, useNativeUpdate } from "@/updates/UpdatePrompt";

const APPEARANCE = { system: "Match phone", light: "Light", dark: "Dark" } as const;

export default function Profile(): ReactNode {
  const { user, signOut } = useAuth();
  const prefs = usePrefs();
  const loadProfile = useCallback(() => api<ProfileData>("/profile"), []);
  const { data: profile } = useData(loadProfile);
  const c = useColors();
  const [signingOut, setSigningOut] = useState(false);
  // Re-checked on focus: the student may come back from Android settings.
  const [blocked, setBlocked] = useState(false);
  useFocusEffect(
    useCallback(() => {
      void Notifications.getPermissionsAsync()
        .then((p) => setBlocked(!p.granted))
        .catch(() => undefined);
    }, []),
  );
  if (!user) return null;

  const initials = user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  const icon = (name: React.ComponentProps<typeof Ionicons>["name"], color = c.accent) => (
    <Ionicons name={name} size={22} color={color} />
  );
  const chevron = <Ionicons name="chevron-forward" size={18} color={c.muted} />;

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

      <Section title="Outings">
        <Row
          leading={icon("home-outline")}
          title="Hostel and contacts"
          detail={
            profile
              ? [profile.hostel ?? "Hostel not chosen", profile.phone ? null : "add your number"]
                  .filter(Boolean)
                  .join(" · ")
              : undefined
          }
          trailing={chevron}
          onPress={() => router.push("/profile/outing-details")}
        />
      </Section>

      <Section title="Settings">
        <Row
          leading={icon("notifications-outline")}
          title="Notifications"
          detail={
            blocked
              ? "Blocked in Android settings"
              : [prefs.followRequests, prefs.returnReminders, prefs.shareStatus].every(Boolean)
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
          leading={icon("sparkles-outline")}
          title="What's new"
          detail={`Version ${CURRENT.version}: ${CURRENT.title}`}
          trailing={chevron}
          onPress={() => router.push("/profile/whats-new")}
        />
        <Row
          leading={icon("shield-checkmark-outline")}
          title="Privacy notice"
          detail="What we collect and who can see it"
          trailing={<Ionicons name="open-outline" size={18} color={c.muted} />}
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
          leading={icon("trash-outline", c.danger)}
          title="Delete account"
          danger
          trailing={chevron}
          onPress={() => router.push("/profile/delete-account")}
        />
      </Section>

      <VersionLine />
    </Screen>
  );
}

function Badge({ text, tone }: { text: string; tone: "accent" | "good" }): ReactNode {
  const c = useColors();
  const color = tone === "accent" ? c.accent : c.good;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space(1),
        minHeight: 28,
        paddingHorizontal: space(3),
        borderRadius: radius.pill,
        backgroundColor: tone === "accent" ? c.accentSoft : c.goodSoft,
      }}
    >
      <Ionicons
        name={tone === "accent" ? "arrow-down-circle" : "checkmark-circle"}
        size={16}
        color={color}
      />
      <T tone="small" style={{ color, fontWeight: "700" }}>
        {text}
      </T>
    </View>
  );
}

/** "Version 1.3.0 · 9 October 2026", whether it's the latest, and the build underneath. */
function VersionLine(): ReactNode {
  const { isUpdateAvailable, isUpdatePending, lastCheckForUpdateTimeSinceRestart } =
    Updates.useUpdates();
  const nativeUpdate = useNativeUpdate();
  const [head, detail] = buildLines(
    {
      version: CURRENT.version,
      date: CURRENT.date,
      runtimeVersion: Updates.runtimeVersion,
      updateId: Updates.updateId,
      isEmbeddedLaunch: Updates.isEmbeddedLaunch,
      builds: NATIVE_BUILDS,
    },
    formatDate,
  );
  // Either kind: an over-the-air update, or a new app build to download.
  const newer = isUpdateAvailable || isUpdatePending || nativeUpdate !== null;
  // Unknown until the update server has answered once (offline, or a development build).
  const status = !Updates.isEnabled
    ? null
    : newer
      ? "Update available"
      : lastCheckForUpdateTimeSinceRestart
        ? "Up to date"
        : null;

  return (
    <View style={{ alignItems: "center", gap: space(1) }}>
      <T tone="caption" selectable style={{ textAlign: "center" }}>
        {head}
      </T>
      {status && newer ? (
        <Press
          onPress={showUpdatePrompt}
          accessibilityLabel="Update available. Opens the update."
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Badge text={status} tone="accent" />
        </Press>
      ) : status ? (
        <Badge text={status} tone="good" />
      ) : null}
      {detail ? (
        <T tone="caption" selectable style={{ textAlign: "center" }}>
          {detail}
        </T>
      ) : null}
    </View>
  );
}
