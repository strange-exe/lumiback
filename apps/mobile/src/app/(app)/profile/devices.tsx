import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useCallback, useState, type ReactNode } from "react";
import { Alert, RefreshControl, View } from "react-native";

import { api } from "@/lib/api";
import {
  canSignOut,
  canSignOutOthers,
  deviceError,
  deviceKind,
  deviceName,
  hasCurrent,
  onlyThisDevice,
  signedOutMessage,
} from "@/lib/devices";
import { formatStamp } from "@/lib/time";
import type { Device, SignedOutOthers } from "@/lib/types";
import { useData } from "@/lib/use-data";
import { haptic } from "@/ui/haptics";
import {
  Button,
  FormError,
  LoadFailed,
  Notice,
  Row,
  Screen,
  Section,
  StatusChip,
  T,
} from "@/ui/kit";
import { fonts, space, useColors } from "@/ui/theme";

const ICON = {
  phone: "phone-portrait-outline",
  computer: "desktop-outline",
  unknown: "help-circle-outline",
} as const;

/**
 * Where this account is signed in, so a lost phone can be signed out from another one. This
 * device isn't signed out from here: the normal Sign out on Profile does that.
 */
export default function Devices(): ReactNode {
  const c = useColors();
  const load = useCallback(() => api<Device[]>("/auth/devices"), []);
  const { data, error, loading, refreshing, reload } = useData(load);
  // Which sign-out is running: a device id, "others", or none.
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const run = async (
    which: string,
    call: () => Promise<string>,
    fallback: string,
  ): Promise<void> => {
    setBusy(which);
    setActionError(null);
    setDone(null);
    try {
      setDone(await call());
      haptic.success();
    } catch (e) {
      haptic.warning();
      setActionError(deviceError(e, fallback));
    } finally {
      setBusy(null);
      // Either way the list may have changed (a 404 means that device was already gone).
      await reload();
    }
  };

  const signOut = (device: Device): void => {
    const name = deviceName(device);
    Alert.alert(
      `Sign out ${name}?`,
      `Signed in ${formatStamp(device.signed_in_at)}. It's signed out straight away and gets no more notifications.`,
      [
        { text: "Keep it signed in", style: "cancel" },
        {
          text: "Sign out",
          style: "destructive",
          onPress: () =>
            void run(
              device.id,
              async () => {
                await api(`/auth/devices/${encodeURIComponent(device.id)}`, { method: "DELETE" });
                return `${name} is signed out.`;
              },
              "Couldn't sign that device out. Try again.",
            ),
        },
      ],
    );
  };

  const signOutOthers = (count: number): void => {
    Alert.alert(
      "Sign out of all other devices?",
      `${count === 1 ? "The other device is" : `All ${count} other devices are`} signed out straight away. This phone stays signed in.`,
      [
        { text: "Keep them signed in", style: "cancel" },
        {
          text: "Sign out others",
          style: "destructive",
          onPress: () =>
            void run(
              "others",
              async () => {
                const result = await api<SignedOutOthers>("/auth/devices/sign-out-others", {
                  method: "POST",
                });
                return signedOutMessage(result.signed_out);
              },
              "Couldn't sign the other devices out. Try again.",
            ),
        },
      ],
    );
  };

  const others = data ? data.filter((d) => !d.current).length : 0;

  return (
    <Screen
      edges={["bottom"]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void reload()}
          colors={[c.accent]}
          tintColor={c.accent}
        />
      }
    >
      <T tone="muted">Lost your phone? Sign it out here, then change your password.</T>

      {!data && loading ? (
        <T tone="muted">Loading…</T>
      ) : !data ? (
        <LoadFailed
          title="Couldn't load your devices"
          message={error}
          after="The phones and browsers signed in to your account show here once Lumiback can be reached."
          busy={refreshing}
          onRetry={reload}
        />
      ) : (
        <>
          <FormError message={error} />
          {done ? <Notice>{done}</Notice> : null}
          {hasCurrent(data) ? null : (
            <Notice tone="warn">
              This phone signed in before Lumiback named devices, so it isn&apos;t marked below, and
              signing out every other device at once needs it. Sign out on Profile and sign back in
              to fix that.
            </Notice>
          )}
          <Section
            title="Signed in now"
            footer={
              data.length === 0
                ? "No devices are signed in."
                : onlyThisDevice(data)
                  ? "Only this phone is signed in."
                  : undefined
            }
          >
            {data.map((device) => (
              <DeviceRow
                key={device.id}
                device={device}
                busy={busy === device.id}
                disabled={busy !== null}
                onSignOut={() => signOut(device)}
              />
            ))}
          </Section>
          <FormError message={actionError} />
          {canSignOutOthers(data) ? (
            <Button
              label="Sign out of all other devices"
              variant="secondary"
              busy={busy === "others"}
              busyLabel="Signing out…"
              onPress={() => (busy ? undefined : signOutOthers(others))}
              icon={<Ionicons name="log-out-outline" size={20} color={c.accentText} />}
            />
          ) : null}
        </>
      )}

      <Section
        title="Password"
        footer="Changing your password signs out every other device. This phone stays signed in."
      >
        <Row
          leading={<Ionicons name="key-outline" size={22} color={c.accentText} />}
          title="Change password"
          detail="Enter your current password, then a new one"
          trailing={<Ionicons name="chevron-forward" size={18} color={c.muted} />}
          onPress={() => router.push("/profile/password")}
        />
      </Section>
    </Screen>
  );
}

function DeviceRow({
  device,
  busy,
  disabled,
  onSignOut,
}: {
  device: Device;
  busy: boolean;
  disabled: boolean;
  onSignOut: () => void;
}): ReactNode {
  const c = useColors();
  const name = deviceName(device);
  const signedIn = formatStamp(device.signed_in_at);
  return (
    <View
      style={{
        paddingHorizontal: space(4),
        paddingVertical: space(4),
        flexDirection: "row",
        alignItems: "flex-start",
        gap: space(3),
      }}
    >
      <Ionicons name={ICON[deviceKind(device)]} size={22} color={c.accentText} />
      <View style={{ flex: 1, gap: space(1) }}>
        <T tone="body" style={{ fontFamily: fonts.medium }}>
          {name}
        </T>
        {device.current ? <StatusChip label="This device" tone="accent" /> : null}
        <T tone="caption">Signed in {signedIn}</T>
        <T tone="caption">Last active {formatStamp(device.last_active_at)}</T>
        {canSignOut(device) ? (
          <Button
            label="Sign out"
            variant="secondary"
            busy={busy}
            busyLabel="Signing out…"
            accessibilityLabel={`Sign out ${name}, signed in ${signedIn}`}
            onPress={() => (disabled ? undefined : onSignOut())}
            style={{ alignSelf: "flex-start", minHeight: 44, marginTop: space(2) }}
          />
        ) : null}
      </View>
    </View>
  );
}
