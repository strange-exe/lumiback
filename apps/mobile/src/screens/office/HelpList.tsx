import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ReactNode } from "react";
import { AccessibilityInfo, Alert, Linking, View } from "react-native";

import { helpPlace } from "@/lib/alerts";
import { ApiError } from "@/lib/api";
import { office } from "@/lib/office-api";
import { formatStamp } from "@/lib/time";
import type { HelpRequest } from "@/lib/types";
import { Contact } from "@/screens/office/Contact";
import { haptic } from "@/ui/haptics";
import { Button, Card, Field, FormError, Press, StatusChip, T } from "@/ui/kit";
import { radius, space, useColors } from "@/ui/theme";

/** Students who pressed Help and nobody has handled yet, newest first. `items` null: the list
 * didn't load (never shown as "nobody"). */
export function HelpList({
  items,
  error,
  onChanged,
}: {
  items: HelpRequest[] | null;
  error: string | null;
  onChanged: () => void;
}): ReactNode {
  const c = useColors();
  return (
    <View style={{ gap: space(3) }}>
      <T
        tone="headline"
        accessibilityRole="header"
        style={items?.length ? { color: c.danger } : undefined}
      >
        Asked for help
      </T>
      {items === null ? (
        <T tone="muted" accessibilityRole="alert">
          Couldn&apos;t load help alerts. {error ?? "Something went wrong."} Pull down to try again.
        </T>
      ) : items.length === 0 ? (
        <T tone="muted">Nobody has pressed Help.</T>
      ) : (
        <View style={{ gap: space(4) }}>
          {items.map((h) => (
            <HelpCard key={h.id} help={h} onHandled={onChanged} />
          ))}
        </View>
      )}
    </View>
  );
}

function HelpCard({ help: h, onHandled }: { help: HelpRequest; onHandled: () => void }): ReactNode {
  const c = useColors();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const place = helpPlace(h);
  const map = place.map;

  const handle = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await office.handleHelp(h.id, note.trim() || null);
      haptic.success();
      AccessibilityInfo.announceForAccessibility(`${h.name}'s help alert marked handled`);
      onHandled();
    } catch (e) {
      haptic.warning();
      setError(e instanceof ApiError ? e.detail : "Couldn't save that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ borderColor: c.danger }}>
      <View style={{ gap: space(1) }}>
        <T tone="headline">{h.name}</T>
        <T tone="caption">{[h.roll_no, h.hostel].filter(Boolean).join(" · ")}</T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
          <StatusChip label={`Asked ${formatStamp(h.created_at)}`} tone="danger" />
          {h.returned ? <StatusChip label="Back at the hostel" tone="muted" /> : null}
        </View>
      </View>
      <Contact label="Student" phone={h.phone} />
      <View
        style={{
          flexDirection: "row",
          gap: space(2),
          padding: space(3),
          borderRadius: radius.control,
          backgroundColor: c.accentSoft,
        }}
      >
        <Ionicons name="location-outline" size={18} color={c.accentText} style={{ marginTop: 3 }} />
        <View style={{ flex: 1, gap: space(1) }}>
          <T>{place.text}</T>
          {map && h.mocked ? (
            <T style={{ color: c.danger }}>
              Their phone said this came from a mock-location app. It may not be where they are.
            </T>
          ) : null}
          {map ? (
            <Press
              onPress={() =>
                void Linking.openURL(map).catch(() =>
                  Alert.alert("Couldn't open the map", `${h.lat}, ${h.lng}`),
                )
              }
              accessibilityRole="link"
              accessibilityLabel={`Open map of ${h.name}'s location`}
              style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}
            >
              <T tone="label" style={{ color: c.accentText }}>
                Open map
              </T>
            </Press>
          ) : null}
        </View>
      </View>
      <View
        style={{ gap: space(3), borderTopWidth: 1, borderTopColor: c.line, paddingTop: space(4) }}
      >
        <Field
          label="What happened (optional)"
          placeholder="Reached her, she's with friends"
          value={note}
          onChangeText={setNote}
          maxLength={200}
        />
        <FormError message={error} />
        <Button
          label="Mark handled"
          accessibilityLabel={`Mark ${h.name}'s help alert handled`}
          onPress={() => void handle()}
          busy={busy}
          busyLabel="Saving…"
        />
      </View>
    </Card>
  );
}
