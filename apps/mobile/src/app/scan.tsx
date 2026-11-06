import Ionicons from "@expo/vector-icons/Ionicons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Linking, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { consumeSafeReturn, safeReturnFor } from "@/gate/intent";
import {
  blockedTapCopy,
  confirmCopy,
  gateCode,
  phaseForNewLink,
  refusal,
  startPhase,
  toFix,
  type Fix,
} from "@/gate/scan";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { safeReturnNotice } from "@/lib/safe-return";
import { formatMinutes, formatTime } from "@/lib/time";
import type { GateScanned, Outing } from "@/lib/types";
import { stopOutingShare } from "@/location/task";
import { allowNotifications } from "@/notify/notify";
import { sendForOuting } from "@/screens/safe-return";
import { haptic } from "@/ui/haptics";
import { Illustration } from "@/ui/illustration";
import { Button, Press } from "@/ui/kit";
import { radius, space, type, useColors } from "@/ui/theme";
import { TouchGuard } from "../../modules/touch-guard";

type Phase =
  | { kind: "camera" }
  /** A code that came with the screen (a link): nothing happens until the student confirms. */
  | { kind: "confirm"; qr: string }
  | { kind: "checking"; step: "location" | "server" }
  | { kind: "done"; result: GateScanned; notice: string | null }
  | { kind: "refused"; message: string; retry: boolean; fallback: boolean; settings?: boolean };

const LOCATION_TIMEOUT_MS = 20_000;

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
 * Tap out or back in at a gate: scan the kiosk's code, then the server checks the code is current,
 * the phone is at that gate, and the hostel's outing rules allow it. Also opened as
 * lumiback://scan?qr=... with a code already read: that one waits for the student to confirm.
 */
export default function Scan(): ReactNode {
  const { status } = useAuth();
  const c = useColors();
  const params = useLocalSearchParams<{ qr?: string; intent?: string }>();
  const linked = params.qr;
  // Today's "Let my emergency contact follow until I'm back" was ticked: Today armed an
  // in-memory intent and passed its id. Any other parameter (safe=1 included) is ignored, and a
  // code that came by link never asks for safe return. Read once, when the screen opens.
  const [safeReturn, setSafeReturn] = useState(() => !linked && safeReturnFor(params));
  useEffect(() => {
    consumeSafeReturn(params.intent);
  }, [params.intent]);
  const [permission, requestPermission] = useCameraPermissions();
  // A code handed over by a link skips the camera and waits on a confirm step.
  const [phase, setPhase] = useState<Phase>(() => startPhase(linked));
  // Out on a trip? Then a scan taps in, and the fallback is "I'm back", not logging a trip.
  // Unknown (loading, offline) is null: the confirm step stays neutral, and the fallback reads
  // as at the hostel (Today shows the right card either way).
  const [out, setOut] = useState<boolean | null>(null);
  useEffect(() => {
    if (status !== "signedIn") return;
    let alive = true;
    void api<Outing | null>("/outings/current")
      .then((o) => {
        if (alive) setOut(o !== null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [status]);
  const [notGate, setNotGate] = useState(false);
  // The camera reports the same code many times a second: handle one at a time.
  const busy = useRef(false);
  const lastIgnored = useRef<string | null>(null);
  const insets = useSafeAreaInsets();

  // A new link can arrive while this screen is open (expo-router keeps it and swaps the params):
  // that code gets its own confirm step, with safe return off, instead of an endless spinner.
  const shownLink = useRef(linked);
  useEffect(() => {
    const previous = shownLink.current;
    if (previous === linked) return;
    shownLink.current = linked;
    const next = phaseForNewLink(previous, linked, phase.kind);
    if (!next) return;
    busy.current = false;
    lastIgnored.current = null;
    setNotGate(false);
    setSafeReturn(next.safeReturn);
    setPhase(next.phase);
  }, [linked, phase.kind]);

  const send = useCallback(
    async (qr: string, fix: Fix): Promise<void> => {
      setPhase({ kind: "checking", step: "server" });
      let result: GateScanned;
      try {
        result = await api<GateScanned>("/gates/scan", {
          method: "POST",
          body: { qr, ...fix, safe_return: safeReturn },
        });
      } catch (e) {
        haptic.warning();
        setPhase(
          e instanceof ApiError
            ? refusal(e.status, e.detail)
            : refusal(500, "Something went wrong. Scan again."),
        );
        return;
      }
      haptic.success();
      const sessionId = result.outing.safe_return_session_id;
      let notice: string | null = null;
      if (result.direction === "out") {
        void allowNotifications().catch(() => false); // reminders
        // Ticked: send location for the share the check-out started, like a manual share.
        const started = safeReturn && sessionId ? await sendForOuting(sessionId) : null;
        notice = safeReturnNotice(safeReturn, sessionId, started);
      } else {
        // Back in: the server ended the safe-return share; stop this phone sending for it.
        await stopOutingShare(sessionId).catch(() => undefined);
      }
      setPhase({ kind: "done", result, notice });
    },
    [safeReturn],
  );

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
          fallback: true, // a phone/GPS problem, not the rules
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

  /** The student tapped the confirm step's button for a linked code: only now is it checked. */
  const confirmLinked = (qr: string): void => {
    if (busy.current || status !== "signedIn") return;
    busy.current = true;
    haptic.tap();
    setPhase({ kind: "checking", step: "location" });
    void check(qr);
  };

  const leave = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/today");
  };

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
            {phase.kind === "done" || phase.kind === "confirm" ? "Gate" : "Scan the gate screen"}
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
          out={out}
          ready={status === "signedIn"}
          onScanAgain={scanAgain}
          onConfirm={confirmLinked}
          onCancel={leave}
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
  out: knownOut,
  ready,
  onScanAgain,
  onConfirm,
  onCancel,
}: {
  phase: Phase;
  permission: ReturnType<typeof useCameraPermissions>[0];
  requestPermission: ReturnType<typeof useCameraPermissions>[1];
  notGate: boolean;
  linked: boolean;
  out: boolean | null;
  /** Signed in, so a confirmed code can be checked. */
  ready: boolean;
  onScanAgain: () => void;
  onConfirm: (qr: string) => void;
  onCancel: () => void;
}): ReactNode {
  const c = useColors();
  const out = knownOut === true;
  switch (phase.kind) {
    case "confirm": {
      const copy = confirmCopy(knownOut);
      return (
        <Panel art>
          <Title>{copy.title}</Title>
          <Detail>{copy.detail}</Detail>
          <GuardedConfirm label={copy.action} busy={!ready} onPress={() => onConfirm(phase.qr)} />
          <Button
            label="Cancel"
            variant="onHeroOutline"
            accessibilityLabel="Cancel, don't use this gate code"
            onPress={onCancel}
          />
        </Panel>
      );
    }
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
            <CantScan out={out} />
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
          {/* Tapping in has no rules to get round, so "I'm back" is always a fair way out. */}
          {phase.retry && (phase.fallback || out) ? <CantScan out={out} /> : null}
        </Panel>
      );
    case "done":
      return <Done result={phase.result} notice={phase.notice} />;
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

function Done({ result, notice }: { result: GateScanned; notice: string | null }): ReactNode {
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
          ? `Tapped out at ${result.gate}. Back by ${formatTime(result.outing.expected_return_at)}.`
          : result.outing.late_minutes > 0
            ? `Tapped in at ${result.gate}, ${formatMinutes(result.outing.late_minutes)} late. This is recorded as late.`
            : `Tapped in at ${result.gate}. Your trip is closed.`}
      </Detail>
      {out && result.outing.safe_return_session_id && !notice ? (
        <Detail>Your emergency contact can follow you until you&apos;re back.</Detail>
      ) : null}
      {notice ? (
        <Text
          accessibilityRole="alert"
          style={[type.body, { color: c.onHero, textAlign: "center" }]}
        >
          {notice}
        </Text>
      ) : null}
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

/**
 * The linked code's confirm button, behind the native touch guard: while another app draws over
 * Lumiback, Android's tap is refused and the student is told why, instead of a hidden overlay
 * steering them into tapping in or out.
 */
function GuardedConfirm({
  label,
  busy,
  onPress,
}: {
  label: string;
  busy: boolean;
  onPress: () => void;
}): ReactNode {
  const c = useColors();
  const [blocked, setBlocked] = useState(false);
  return (
    <View style={{ gap: space(3) }}>
      <TouchGuard
        onBlockedTouch={() => {
          haptic.warning();
          setBlocked(true);
        }}
      >
        <Button
          label={label}
          variant="onHero"
          busy={busy}
          onPress={() => {
            setBlocked(false);
            onPress();
          }}
        />
      </TouchGuard>
      {blocked ? (
        <Text accessibilityRole="alert" style={[type.body, { color: c.onHero }]}>
          {blockedTapCopy}
        </Text>
      ) : null}
    </View>
  );
}

/** The way round a scan that can't work: log the trip, or (when out) tap I'm back on Today. */
function CantScan({ out }: { out: boolean }): ReactNode {
  const c = useColors();
  return (
    <Press
      onPress={() =>
        out
          ? router.replace("/today")
          : router.replace({
              pathname: "/today",
              params: { action: "log", at: String(Date.now()) },
            })
      }
      accessibilityLabel={
        out ? "Go to Today to tap I'm back without scanning" : "Log a trip without scanning"
      }
      style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}
    >
      <Text style={[type.label, { color: c.heroAccent }]}>
        {out ? "Can't scan? Tap I'm back instead" : "Can't scan? Log a trip instead"}
      </Text>
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
