import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import * as Location from "expo-location";
import { useCallback, useState, type ReactNode } from "react";
import { Alert, Linking, RefreshControl, Share, View } from "react-native";

import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { WEB_URL } from "@/lib/config";
import { kioskLink } from "@/lib/office";
import { office } from "@/lib/office-api";
import type { Gate } from "@/lib/types";
import { useData } from "@/lib/use-data";
import { haptic } from "@/ui/haptics";
import { Button, Card, Field, FormError, Heading, Screen, StatusChip, T } from "@/ui/kit";
import { Sheet } from "@/ui/sheet";
import { fonts, space, useColors } from "@/ui/theme";

/** The gates taking scans. Admins add one standing at it, switch it off, or get a new kiosk link. */
export default function Gates(): ReactNode {
  const { user } = useAuth();
  const c = useColors();
  const admin = user?.role === "admin";
  const load = useCallback(() => office.gates(), []);
  const { data, error, loading, refreshing, reload, refetch } = useData(load);
  const [link, setLink] = useState<{ gate: string; url: string } | null>(null);

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
      <Heading
        title="Gates"
        lede="Each gate has a tablet showing a code that changes every 20 seconds. Students scan it with the app, and their phone's location has to agree they're at the gate."
      />
      {error && !data ? (
        <T tone="muted" accessibilityRole="alert">
          {error} Pull down to try again.
        </T>
      ) : loading && !data ? (
        <T tone="muted">Loading…</T>
      ) : (data ?? []).length === 0 ? (
        <T tone="muted" style={{ textAlign: "center", paddingVertical: space(6) }}>
          No gates yet.{admin ? " Add one below, standing at the gate." : ""}
        </T>
      ) : (
        (data ?? []).map((g) => (
          <GateCard
            key={g.id}
            gate={g}
            admin={admin}
            onChanged={() => void refetch()}
            onLink={(url) => setLink({ gate: g.name, url })}
          />
        ))
      )}
      {admin ? (
        <AddGate
          onAdded={(gate, url) => {
            void refetch();
            setLink({ gate, url });
          }}
        />
      ) : (
        <T tone="caption">Only an admin can add or change gates.</T>
      )}
      {link ? <KioskLinkSheet {...link} onClose={() => setLink(null)} /> : null}
    </Screen>
  );
}

function GateCard({
  gate: g,
  admin,
  onChanged,
  onLink,
}: {
  gate: Gate;
  admin: boolean;
  onChanged: () => void;
  onLink: (url: string) => void;
}): ReactNode {
  const [busy, setBusy] = useState<"switch" | "link" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = async (kind: "switch" | "link"): Promise<void> => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "switch") {
        await office.switchGate(g.id, !g.active);
        onChanged();
      } else {
        const created = await office.newKioskLink(g.id);
        onLink(kioskLink(WEB_URL, created.kiosk_token));
      }
      haptic.success();
    } catch (e) {
      haptic.warning();
      setError(e instanceof ApiError ? e.detail : "Couldn't save that. Try again.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <T tone="headline" style={{ flex: 1 }}>
          {g.name}
        </T>
        <StatusChip
          label={g.active ? "Taking scans" : "Switched off"}
          tone={g.active ? "good" : "muted"}
        />
      </View>
      <T tone="caption">
        Counts scans within {g.radius_m} m of {g.lat.toFixed(5)}, {g.lng.toFixed(5)}
      </T>
      {admin ? (
        <View style={{ gap: space(3) }}>
          <FormError message={error} />
          <View style={{ flexDirection: "row", gap: space(3) }}>
            <View style={{ flex: 1 }}>
              <Button
                label={g.active ? "Switch off" : "Switch on"}
                variant="secondary"
                busy={busy === "switch"}
                onPress={() =>
                  g.active
                    ? Alert.alert(
                        `Switch off ${g.name}?`,
                        "Scans there are refused until you switch it back on.",
                        [
                          { text: "Cancel", style: "cancel" },
                          { text: "Switch off", onPress: () => void act("switch") },
                        ],
                      )
                    : void act("switch")
                }
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label="New kiosk link"
                variant="secondary"
                busy={busy === "link"}
                onPress={() =>
                  Alert.alert(
                    "Make a new kiosk link?",
                    `The tablet at ${g.name} stops working until it opens the new link. Use this if the tablet or its link was lost.`,
                    [
                      { text: "Cancel", style: "cancel" },
                      { text: "Make new link", onPress: () => void act("link") },
                    ],
                  )
                }
              />
            </View>
          </View>
        </View>
      ) : null}
    </Card>
  );
}

/** Standing at the gate: name it, and the phone's location becomes the gate's. */
function AddGate({ onAdded }: { onAdded: (gate: string, url: string) => void }): ReactNode {
  const c = useColors();
  const [name, setName] = useState("");
  const [radius, setRadius] = useState("75");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (): Promise<void> => {
    const gateName = name.trim();
    const metres = Number(radius);
    if (!gateName) return setError("Give the gate a name, e.g. Main Gate.");
    if (!Number.isInteger(metres) || metres < 10 || metres > 500) {
      return setError("Use a scan radius between 10 and 500 metres.");
    }
    setBusy(true);
    setError(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setError("Lumiback needs your location once, to place the gate where you're standing.");
        return;
      }
      const here = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      }).catch(() => null); // location switched off, or no fix
      if (!here) {
        setError("Couldn't find your location. Turn on location (GPS) and try again.");
        return;
      }
      if ((here.coords.accuracy ?? 999) > 50) {
        setError(
          `Your location is only accurate to ${Math.round(here.coords.accuracy ?? 0)} m. Step into the open and try again.`,
        );
        return;
      }
      const created = await office.addGate({
        name: gateName,
        lat: here.coords.latitude,
        lng: here.coords.longitude,
        radius_m: metres,
      });
      haptic.success();
      setName("");
      onAdded(created.gate.name, kioskLink(WEB_URL, created.kiosk_token));
    } catch (e) {
      haptic.warning();
      setError(e instanceof ApiError ? e.detail : "Couldn't add the gate. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <View style={{ gap: space(1) }}>
        <T tone="headline">Add a gate</T>
        <T tone="caption">
          Stand at the gate: this phone&apos;s location becomes the gate&apos;s location.
        </T>
      </View>
      <Field
        label="Name"
        placeholder="Main Gate"
        value={name}
        onChangeText={setName}
        maxLength={60}
      />
      <Field
        label="Scan radius (metres)"
        value={radius}
        onChangeText={setRadius}
        keyboardType="number-pad"
        maxLength={3}
        hint="Scans count within this distance, plus some allowance for GPS error (up to 50 m)."
      />
      <FormError message={error} />
      <Button
        label="Add gate here"
        icon={<Ionicons name="locate" size={18} color={c.onAccent} />}
        busy={busy}
        busyLabel="Finding you…"
        onPress={() => void add()}
      />
    </Card>
  );
}

/** A kiosk link exists in plain text only now: copy or share it to the gate's tablet. */
function KioskLinkSheet({
  gate,
  url,
  onClose,
}: {
  gate: string;
  url: string;
  onClose: () => void;
}): ReactNode {
  const c = useColors();
  const [copied, setCopied] = useState(false);
  return (
    <Sheet open onClose={onClose} title={`Kiosk link for ${gate}`}>
      <View style={{ gap: space(4) }}>
        <T>
          Open this link on the tablet at {gate}, then leave it on. It&apos;s shown only once: if
          it&apos;s lost, make a new one.
        </T>
        <T selectable style={{ fontFamily: fonts.medium, color: c.ink }}>
          {url}
        </T>
        <Button
          label={copied ? "Copied" : "Copy link"}
          onPress={() =>
            void Clipboard.setStringAsync(url).then(() => {
              haptic.success();
              setCopied(true);
            })
          }
        />
        <Button
          label="Share link"
          variant="secondary"
          onPress={() => void Share.share({ message: url }).catch(() => undefined)}
        />
        <Button
          label="Open it on this phone"
          variant="quiet"
          onPress={() => void Linking.openURL(url).catch(() => undefined)}
        />
      </View>
    </Sheet>
  );
}
