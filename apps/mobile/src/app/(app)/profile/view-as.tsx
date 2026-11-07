import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";

import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/office";
import type { ViewAsRole } from "@/lib/types";
import {
  canViewAs,
  clearViewAs,
  setViewAs,
  useViewAs,
  VIEW_AS_ROLES,
  viewingAs,
} from "@/lib/view-as";
import { haptic } from "@/ui/haptics";
import { FormError, Press, Screen, Section, T } from "@/ui/kit";
import { fonts, space, useColors } from "@/ui/theme";

/** null: the developer's own view. */
type Choice = ViewAsRole | null;

const DETAIL: Record<"developer" | ViewAsRole, string> = {
  developer: "Your own view, with every power",
  admin: "The office, with gates, roles and settings",
  head_warden: "The office for every hostel, and the outing rules",
  warden: "The office a warden works in",
  student: "The student app (your own data, so mostly empty)",
};

const OPTIONS: { value: Choice; title: string; detail: string }[] = [
  { value: null, title: ROLE_LABEL.developer, detail: DETAIL.developer },
  ...VIEW_AS_ROLES.map((role) => ({ value: role, title: ROLE_LABEL[role], detail: DETAIL[role] })),
];

/**
 * Developers only: see the app as another role does, with the developer's own data. Nothing
 * can be changed while viewing (the server refuses it). Reachable while viewing too, to switch.
 */
export default function ViewAs(): ReactNode {
  const { user, refreshUser } = useAuth();
  const current = useViewAs();
  // undefined: nothing under way; otherwise the choice being switched to.
  const [pending, setPending] = useState<Choice | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  if (!canViewAs(user)) {
    return (
      <Screen edges={["bottom"]}>
        <T tone="muted">This is for developers only.</T>
      </Screen>
    );
  }

  const choose = async (value: Choice): Promise<void> => {
    if (pending !== undefined || value === current) return;
    haptic.tap();
    setPending(value);
    setError(null);
    try {
      if (value) await setViewAs(value);
      else await clearViewAs();
      await refreshUser();
      // The server didn't take the role (refused, or an older server): back to your own view.
      if (viewingAs() !== value) throw new Error("not switched");
    } catch (e) {
      if (value) await clearViewAs(value);
      await refreshUser().catch(() => undefined);
      haptic.warning();
      setError(e instanceof ApiError ? e.detail : "Couldn't switch the view. Try again.");
      setPending(undefined);
      return;
    }
    haptic.success();
    setPending(undefined);
    // Every role starts on Today: students' home, and staff run the office from there.
    router.navigate("/today");
  };

  return (
    <Screen edges={["bottom"]}>
      <T tone="muted">
        See the app as another role does, with your own data. Nothing can be changed while you view.
      </T>
      <View accessibilityRole="radiogroup" accessibilityLabel="View as">
        <Section>
          {OPTIONS.map((o) => (
            <Option
              key={o.value ?? "developer"}
              title={o.title}
              detail={o.detail}
              checked={o.value === current}
              busy={pending === o.value}
              disabled={pending !== undefined}
              onPress={() => void choose(o.value)}
            />
          ))}
        </Section>
      </View>
      <FormError message={error} />
    </Screen>
  );
}

function Option({
  title,
  detail,
  checked,
  busy,
  disabled,
  onPress,
}: {
  title: string;
  detail: string;
  checked: boolean;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}): ReactNode {
  const c = useColors();
  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={`${title}. ${detail}`}
      accessibilityState={{ checked, busy, disabled }}
      style={{
        minHeight: 60,
        paddingHorizontal: space(4),
        paddingVertical: space(3),
        flexDirection: "row",
        alignItems: "center",
        gap: space(3),
        opacity: disabled && !busy ? 0.6 : 1,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <T tone="body" style={{ fontFamily: fonts.medium }}>
          {title}
        </T>
        <T tone="caption">{detail}</T>
      </View>
      {busy ? (
        <ActivityIndicator color={c.accentText} size="small" />
      ) : (
        <Ionicons
          name={checked ? "radio-button-on" : "radio-button-off"}
          size={22}
          color={checked ? c.accent : c.muted}
        />
      )}
    </Press>
  );
}
