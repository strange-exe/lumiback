import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState, type ReactNode } from "react";
import { Text, View } from "react-native";

import { api } from "@/lib/api";
import { safeReturnNotice, type OutingShareStart, type SafeReturnOffer } from "@/lib/safe-return";
import type { ShareSession } from "@/lib/types";
import { openLocationSettings, settingsLabel } from "@/location/settings";
import { isSending, startOutingShare } from "@/location/task";
import { haptic } from "@/ui/haptics";
import { Button, Press } from "@/ui/kit";
import { space, type, useColors } from "@/ui/theme";

/** Starts the location service for an outing's safe-return share; never throws. */
export async function sendForOuting(sessionId: string): Promise<OutingShareStart> {
  try {
    return await startOutingShare(sessionId);
  } catch {
    return "error";
  }
}

/**
 * On the "Heading out?" card: the tick (when the profile has an emergency email), or a short
 * hint to add one. Applies to both scanning at the gate and logging a trip.
 */
export function SafeReturnTick({
  offer,
  checked,
  onChange,
}: {
  offer: SafeReturnOffer;
  checked: boolean;
  onChange: (next: boolean) => void;
}): ReactNode {
  const c = useColors();
  if (offer.kind === "none") return null;
  if (offer.kind === "hint") {
    return (
      <Press
        onPress={() => {
          haptic.tap();
          router.navigate("/profile/outing-details");
        }}
        accessibilityRole="link"
        accessibilityLabel="Add your emergency contact's email so they can follow you until you're back"
        style={{ flexDirection: "row", alignItems: "center", gap: space(2), minHeight: 44 }}
      >
        <Ionicons name="mail-outline" size={18} color={c.heroAccent} />
        <Text style={[type.caption, { flex: 1, color: c.heroMuted }]}>
          Add your emergency contact&apos;s email to let them follow until you&apos;re back.
        </Text>
        <Ionicons name="chevron-forward" size={16} color={c.heroMuted} />
      </Press>
    );
  }
  const label = `Let ${offer.name} follow until I'm back`;
  return (
    <Press
      onPress={() => {
        haptic.tap();
        onChange(!checked);
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={`${label}. Emails them a link to your live location; it stops when you're back.`}
      style={{ flexDirection: "row", alignItems: "flex-start", gap: space(3), minHeight: 44 }}
    >
      <Ionicons
        name={checked ? "checkbox" : "square-outline"}
        size={24}
        color={checked ? c.heroAccent : c.onHero}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.label, { color: c.onHero }]}>{label}</Text>
        <Text style={[type.caption, { color: c.heroMuted }]}>
          We email them a link to your live location. It stops when you&apos;re back, and
          they&apos;re told if you&apos;re 30 minutes late.
        </Text>
      </View>
    </Press>
  );
}

type Status = "loading" | "sending" | "paused" | "stopped";

/**
 * On the "You're out" card: whether the emergency contact can follow, and a way to send the
 * location again if this phone isn't (app closed from recents, location turned off).
 */
export function SafeReturnStatus({
  sessionId,
  notice,
}: {
  sessionId: string;
  notice: string | null;
}): ReactNode {
  const c = useColors();
  const [status, setStatus] = useState<Status>("loading");
  const [problem, setProblem] = useState<string | null>(notice);
  // What the last tap couldn't get past, so the settings that fix it are one tap away.
  const [fix, setFix] = useState<"denied" | "servicesOff" | null>(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async (): Promise<void> => {
    const [share, sending] = await Promise.all([
      api<ShareSession>(`/sessions/${sessionId}`).catch(() => null),
      isSending(),
    ]);
    // Unknown (offline): what the student chose, so say it's on.
    if (share && share.status !== "active") setStatus("stopped");
    else setStatus(sending ? "sending" : "paused");
  }, [sessionId]);

  useFocusEffect(
    useCallback(() => {
      void check();
    }, [check]),
  );

  const send = async (): Promise<void> => {
    setBusy(true);
    const result = await sendForOuting(sessionId);
    setProblem(safeReturnNotice(true, sessionId, result));
    setFix(result === "denied" || result === "servicesOff" ? result : null);
    if (result === "started") haptic.success();
    else haptic.warning();
    await check();
    setBusy(false);
  };

  if (status === "loading") return null;
  if (status === "stopped") {
    return (
      <Text style={[type.caption, { color: c.heroMuted }]} accessibilityRole="text">
        You stopped sharing with your emergency contact. Their link no longer works.
      </Text>
    );
  }
  return (
    <View style={{ gap: space(2) }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <Ionicons
          name={status === "sending" ? "radio" : "pause-circle-outline"}
          size={18}
          color={status === "sending" ? c.heroAccent : c.heroMuted}
        />
        <Text style={[type.label, { flex: 1, color: c.onHero }]}>
          {status === "sending"
            ? "Your emergency contact can follow you until you're back"
            : "Your emergency contact can't see where you are right now"}
        </Text>
      </View>
      {status === "paused" ? (
        <>
          {problem ? (
            <Text style={[type.caption, { color: c.heroMuted }]} accessibilityRole="alert">
              {problem}
            </Text>
          ) : null}
          {fix ? (
            <Button
              label={settingsLabel(fix)}
              variant="onHeroOutline"
              style={{ minHeight: 44 }}
              onPress={() => void openLocationSettings(fix)}
            />
          ) : null}
          <Button
            label="Send my location"
            variant="onHeroOutline"
            busy={busy}
            busyLabel="Starting…"
            style={{ minHeight: 44 }}
            onPress={() => void send()}
          />
        </>
      ) : null}
    </View>
  );
}
