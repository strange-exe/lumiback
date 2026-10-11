import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Alert, Linking, View } from "react-native";

import { formatPhone } from "@/lib/office";
import { Press, T } from "@/ui/kit";
import { fonts, radius, space, useColors } from "@/ui/theme";

/** Who to call, with a tap-to-call button (the number stays readable if calling fails). */
export function Contact({
  label,
  name,
  phone,
}: {
  label: string;
  name?: string | null;
  phone: string | null;
}): ReactNode {
  const c = useColors();
  const call = (): void => {
    if (!phone) return;
    Linking.openURL(`tel:${phone}`).catch(() =>
      Alert.alert("Couldn't start a call", `Call ${formatPhone(phone)} from your phone app.`),
    );
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space(3) }}>
      <View style={{ flex: 1, gap: 2 }}>
        <T tone="caption">{label}</T>
        {name ? <T style={{ fontFamily: fonts.medium }}>{name}</T> : null}
        <T selectable style={{ color: phone ? c.ink : c.muted }}>
          {phone ? formatPhone(phone) : "Not given"}
        </T>
      </View>
      {phone ? (
        <Press
          onPress={call}
          accessibilityLabel={`Call ${name ?? label}, ${formatPhone(phone)}`}
          style={{
            width: 48,
            height: 48,
            borderRadius: radius.pill,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: c.accentSoft,
          }}
        >
          <Ionicons name="call" size={20} color={c.accent} />
        </Press>
      ) : null}
    </View>
  );
}
