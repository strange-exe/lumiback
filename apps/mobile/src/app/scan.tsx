import Ionicons from "@expo/vector-icons/Ionicons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Linking, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { AFTER_CURFEW_CHOICES, gateCode, refusal, toFix, type Fix } from "@/gate/scan";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { clockParts, expectedReturn, formatTime } from "@/lib/time";
import type { GateScanned } from "@/lib/types";
import { allowNotifications } from "@/notify/notify";
import { haptic } from "@/ui/haptics";
import { Illustration } from "@/ui/illustration";
import { Button, Chips, Clock, Press } from "@/ui/kit";
import { radius, space, type, useColors } from "@/ui/theme";

type Phase =
  | { kind: "camera" }
  | { kind: "checking"; step: "location" | "server" }
  | { kind: "needs-time"; qr: string; fix: Fix; message: string }
  | { kind: "done"; result: GateScanned }
  | { kind: "refused"; message: string; retry: boolean; settings?: boolean };

const LOCATION_TIMEOUT_MS = 20_000;
type Minutes = (typeof AFTER_CURFEW_CHOICES)[number]["value"];

class NoFix extends Error {
  constructor(
    message: string,
    readonly settings = false,
  ) {
    super(message);
  }
}

/** A fresh, precise fix: the server checks it against the gate. Never a cached position. */
async function freshFix(): Promise<Fix> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    throw new NoFix(
      "Lumiback needs your location for a moment to check you're at the gate.",
      !permission.canAskAgain,
    );
  }
  if (!(await Location.hasServicesEnabledAsync())) {
    throw new NoFix("Your phone's location is switched off. Turn it on, then scan again.");
  }
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new NoFix("Couldn't get your location. Step into the open and scan again.")),
      LOCATION_TIMEOUT_MS,
    ),
  );
  const ask = async (): Promise<Location.LocationObject> => {
    try {
      // Android may first offer Google's "Location Accuracy" (Wi-Fi assisted, faster indoors).
      return await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    } catch {
      // Declining it rejects the request; plain GPS is still enough for a gate check.
      return Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        mayShowUserSettingsDialog: false,
      });
    }
  };
  return toFix(await Promise.race([ask(), timeout]));
}

/**
 * Tap out or back in at a gate: scan the kiosk's code, then the server checks the code is current
 * and the phone is at that gate. Also opened as lumiback://scan?qr=... with a code already read.
 */
export default function Scan(): ReactNode {
  const { status } = useAuth();
  const c = useColors();
  const { qr: linked } = useLocalSearchParams<{ qr?: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  // A code handed over by a link skips the camera, so it starts out already checking.
  const [phase, setPhase] = useState<Phase>(() =>
    !linked
      ? { kind: "camera" }
      : gateCode(linked)
        ? { kind: "checking", step: "location" }
        : { kind: "refused", message: "That link isn't a Lumiback gate code.", retry: true },
  );
  const [notGate, setNotGate] = useState(false);
  // The camera reports the same code many times a second: handle one at a time.
  const busy = useRef(false);
  const lastIgnored = useRef<string | null>(null);
  const insets = useSafeAreaInsets();

  const send = useCallback(async (qr: string, fix: Fix, minutes?: Minutes): Promise<void> => {
    setPhase({ kind: "checking", step: "server" });
    const back = minutes ? expectedReturn(minutes) : null;
    try {
      const result = await api<GateScanned>("/gates/scan", {
        method: "POST",
        body: { qr, ...fix, expected_return_at: back ? back.toISOString() : undefined },
      });
      haptic.success();
      setPhase({ kind: "done", result });
      if (result.direction === "out") void allowNotifications().catch(() => false); // reminders
    } catch (e) {
      const outcome =
        e instanceof ApiError
          ? refusal(e.status, e.detail)
          : refusal(500, "Something went wrong. Scan again.");
      haptic.warning();
      setPhase(outcome.kind === "needs-time" ? { ...outcome, qr, fix } : outcome);
    }
  }, []);

  /** Location, then the server. Every state change here comes after an await. */
  const check = useCallback(
    async (qr: string): Promise<void> => {
      try {
        await send(qr, await freshFix());
      } catch (e) {
        haptic.warning();
        setPhase({
          kind: "refused",
          message: e instanceof NoFix ? e.message : "Couldn't get your location. Scan again.",
          retry: true,
          settings: e instanceof NoFix && e.settings,
        });
      }
    },
    [send],
  );

  const onScanned = (scanned: string): void => {
    if (busy.current) return;
    const qr = gateCode(scanned);
    if (!qr) {
      if (lastIgnored.current !== scanned) {
        lastIgnored.current = scanned;
        haptic.warning();
        setNotGate(true);
      }
      return;
    }
    busy.current = true;
    setNotGate(false);
    haptic.tap();
    setPhase({ kind: "checking", step: "location" });
    void check(qr);
  };

  useEffect(() => {
    const qr = linked ? gateCode(linked) : null;
    if (!qr || status !== "signedIn" || busy.current) return;
    busy.current = true;
    void check(qr);
  }, [linked, status, check]);

  const scanAgain = (): void => {
    busy.current = false;
    lastIgnored.current = null;
    if (linked) router.setParams({ qr: undefined });
    setPhase({ kind: "camera" });
  };

  if (status === "signedOut") return <Redirect href="/sign-in" />;
  const cameraOn = phase.kind === "camera" && Boolean(permission?.granted) && !linked;

  return (
    <View style={{ flex: 1, backgroundColor: c.hero }}>
      {/* Always a dark screen, whatever the app's theme: light status bar icons. */}
      <StatusBar style="light" />
      {cameraOn ? (
        <CameraView
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={(result) => onScanned(result.data)}
        />
      ) : null}
      <SafeAreaView style={{ flex: 1 }} edges={["bottom"]}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: space(4),
            paddingTop: insets.top + space(2),
            paddingBottom: space(3),
            // Over a live camera the title and status bar need their own backdrop to stay legible.
            backgroundColor: cameraOn ? "rgba(11, 12, 16, 0.6)" : "transparent",
          }}
        >
          <Text style={[type.headline, { color: c.onHero }]} accessibilityRole="header">
            {phase.kind === "done" ? "Gate" : "Scan the gate screen"}
          </Text>
          <Press
            onPress={() => router.back()}
            accessibilityLabel="Close"
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(11, 12, 16, 0.55)",
            }}
          >
            <Ionicons name="close" size={24} color={c.onHero} />
          </Press>
        </View>
        <Body
          phase={phase}
          permission={permission}
          requestPermission={requestPermission}
          notGate={notGate}
          linked={Boolean(linked)}
          onScanAgain={scanAgain}
          onPickTime={(minutes) => {
            if (phase.kind === "needs-time") void send(phase.qr, phase.fix, minutes);
          }}
        />
      </SafeAreaView>
    </View>
  );
}

function Body({
  phase,
  permission,
  requestPermission,
  notGate,
  linked,
  onScanAgain,
  onPickTime,
}: {
  phase: Phase;
  permission: ReturnType<typeof useCameraPermissions>[0];
  requestPermission: ReturnType<typeof useCameraPermissions>[1];
  notGate: boolean;
  linked: boolean;
  onScanAgain: () => void;
  onPickTime: (minutes: Minutes) => void;
}): ReactNode {
  const c = useColors();
  switch (phase.kind) {
    case "camera":
      if (linked) return <Working label="Checking the code…" />;
      if (!permission) return <Working label="Starting the camera…" />;
      if (!permission.granted) {
        return (
          <Panel art>
            <Title>Scan the code at the gate</Title>
            <Detail>
              Lumiback uses the camera only while this screen is open, to read the gate&apos;s QR
              code. Nothing is recorded.
            </Detail>
            {permission.canAskAgain ? (
              <Button
                label="Allow camera"
                variant="onHero"
                onPress={() => void requestPermission()}
              />
            ) : (
              <Button
                label="Open settings"
                variant="onHero"
                onPress={() => void Linking.openSettings()}
              />
            )}
            <LogInstead />
          </Panel>
        );
      }
      return <Viewfinder notGate={notGate} />;
    case "checking":
      return (
        <Working
          label={
            phase.step === "location" ? "Checking you're at the gate…" : "Talking to Lumiback…"
          }
        />
      );
    case "needs-time":
      return <AfterCurfew message={phase.message} onPick={onPickTime} />;
    case "refused":
      return (
        <Panel>
          <Ionicons name="alert-circle" size={44} color={c.heroDanger} />
          <Title>That didn&apos;t go through</Title>
          <Detail>{phase.message}</Detail>
          {phase.settings ? (
            <Button
              label="Open settings"
              variant="onHero"
              onPress={() => void Linking.openSettings()}
            />
          ) : null}
          {phase.retry ? (
            <Button label="Scan again" variant="onHero" onPress={onScanAgain} />
          ) : (
            <Button label="Done" variant="onHero" onPress={() => router.back()} />
          )}
          {phase.retry ? <LogInstead /> : null}
        </Panel>
      );
    case "done":
      return <Done result={phase.result} />;
  }
}

function Viewfinder({ notGate }: { notGate: boolean }): ReactNode {
  const c = useColors();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space(6) }}>
      <View
        accessibilityLabel="Camera viewfinder"
        style={{
          width: 250,
          height: 250,
          borderRadius: 28,
          borderWidth: 3,
          borderColor: c.onHero,
          borderCurve: "continuous",
        }}
      />
      <View
        style={{
          marginHorizontal: space(6),
          paddingVertical: space(3),
          paddingHorizontal: space(4),
          borderRadius: radius.control,
          backgroundColor: "rgba(11, 12, 16, 0.7)",
          gap: space(1),
        }}
      >
        <Text
          accessibilityLiveRegion="polite"
          style={[type.label, { color: notGate ? c.heroDanger : c.onHero, textAlign: "center" }]}
        >
          {notGate ? "That's not a Lumiback gate code" : "Point at the code on the gate's screen"}
        </Text>
        <Text style={[type.caption, { color: c.heroMuted, textAlign: "center" }]}>
          Your location is checked once, when the code is read.
        </Text>
      </View>
    </View>
  );
}

function AfterCurfew({
  message,
  onPick,
}: {
  message: string;
  onPick: (minutes: Minutes) => void;
}): ReactNode {
  const c = useColors();
  const [minutes, setMinutes] = useState<Minutes>("60");
  const back = expectedReturn(minutes);
  const parts = back ? clockParts(back) : null;
  return (
    <Panel>
      <Title>When will you be back?</Title>
      <Detail>{message}</Detail>
      <Chips
        label="Back in about"
        onHero
        options={AFTER_CURFEW_CHOICES.map((o) => ({ value: o.value, label: o.label }))}
        value={minutes}
        onChange={(v) => {
          haptic.tap();
          setMinutes(v);
        }}
      />
      {parts ? <Clock time={parts.time} period={parts.period} color={c.onHero} size={44} /> : null}
      <Button label="Tap out" variant="onHero" onPress={() => onPick(minutes)} />
    </Panel>
  );
}

function Done({ result }: { result: GateScanned }): ReactNode {
  const c = useColors();
  const out = result.direction === "out";
  return (
    <Panel>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: c.good,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name="checkmark" size={44} color={c.hero} />
      </View>
      <Title>{out ? "You're out" : "Welcome back"}</Title>
      <Detail>
        {out
          ? `Tapped out at ${result.gate}. Back by ${formatTime(result.outing.expected_return_at)}. You can change that on Today.`
          : `Tapped in at ${result.gate}. Your trip is closed.`}
      </Detail>
      <Button
        label="Done"
        variant="onHero"
        onPress={() => {
          if (router.canGoBack()) router.back();
          else router.replace("/today");
        }}
      />
    </Panel>
  );
}

function LogInstead(): ReactNode {
  const c = useColors();
  return (
    <Press
      onPress={() =>
        router.replace({ pathname: "/today", params: { action: "log", at: String(Date.now()) } })
      }
      accessibilityLabel="Log a trip without scanning"
      style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}
    >
      <Text style={[type.label, { color: c.heroAccent }]}>Can&apos;t scan? Log a trip instead</Text>
    </Press>
  );
}

function Working({ label }: { label: string }): ReactNode {
  const c = useColors();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space(4) }}>
      <ActivityIndicator size="large" color={c.onHero} />
      <Text accessibilityLiveRegion="polite" style={[type.label, { color: c.onHero }]}>
        {label}
      </Text>
    </View>
  );
}

function Panel({ children, art = false }: { children: ReactNode; art?: boolean }): ReactNode {
  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        paddingHorizontal: space(6),
        gap: space(4),
      }}
    >
      {art ? (
        <View importantForAccessibility="no-hide-descendants" style={{ alignItems: "center" }}>
          <Illustration name="gate" size={160} variant="hero" />
        </View>
      ) : null}
      {children}
    </View>
  );
}

function Title({ children }: { children: ReactNode }): ReactNode {
  const c = useColors();
  return (
    <Text style={[type.title, { color: c.onHero }]} accessibilityRole="header">
      {children}
    </Text>
  );
}

function Detail({ children }: { children: ReactNode }): ReactNode {
  const c = useColors();
  return <Text style={[type.body, { color: c.heroMuted }]}>{children}</Text>;
}
