import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import { ROLE_LABEL } from "@/lib/office";
import { useAuth } from "@/lib/auth";
import type { ViewAsRole } from "@/lib/types";
import { clearViewAs, useViewAs, viewAsLine } from "@/lib/view-as";
import { haptic } from "@/ui/haptics";
import { Press } from "@/ui/kit";
import { fonts, layout, radius, space, type, useColors } from "@/ui/theme";

/**
 * The signed-in app, with the View as banner on top while a developer views it as a role. The
 * screens below sit in their own safe-area provider, so with the banner showing they lose the
 * status-bar inset it already takes (no double gap), and the dock keeps its bottom inset.
 * The tree is the same either way, so choosing or stopping never remounts the screens.
 */
export function ViewAsFrame({ children }: { children: ReactNode }): ReactNode {
  const c = useColors();
  const role = useViewAs();
  return (
    <View style={{ flex: 1, backgroundColor: c.page }}>
      {role ? <ViewAsBanner role={role} /> : null}
      <SafeAreaProvider style={{ flex: 1 }}>{children}</SafeAreaProvider>
    </View>
  );
}

function ViewAsBanner({ role }: { role: ViewAsRole }): ReactNode {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { refreshUser } = useAuth();
  const [stopping, setStopping] = useState(false);

  // Back to Developer: the developer's own view, on their home.
  const stop = async (): Promise<void> => {
    if (stopping) return;
    setStopping(true);
    haptic.tap();
    try {
      await clearViewAs();
      await refreshUser().catch(() => undefined);
      router.navigate("/today");
    } finally {
      setStopping(false);
    }
  };

  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        paddingTop: insets.top + space(2),
        paddingBottom: space(2),
        paddingLeft: Math.max(insets.left, layout.gutter),
        paddingRight: Math.max(insets.right, space(3)),
        flexDirection: "row",
        alignItems: "center",
        gap: space(3),
        backgroundColor: c.warnSoft,
        borderBottomWidth: 1,
        borderBottomColor: c.warn,
      }}
    >
      <Ionicons name="eye-outline" size={20} color={c.warn} accessibilityElementsHidden />
      <Text
        style={[type.label, { flex: 1, color: c.warn }]}
        accessibilityRole="text"
        numberOfLines={2}
      >
        {viewAsLine(role)}
      </Text>
      <Press
        onPress={() => void stop()}
        disabled={stopping}
        accessibilityLabel={`Stop viewing as ${ROLE_LABEL[role]}`}
        accessibilityState={{ busy: stopping }}
        style={{
          minHeight: 44,
          minWidth: 64,
          paddingHorizontal: space(4),
          borderRadius: radius.control,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: c.warn,
          backgroundColor: c.surface,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {stopping ? (
          <ActivityIndicator color={c.ink} size="small" />
        ) : (
          <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: c.ink }}>Stop</Text>
        )}
      </Press>
    </View>
  );
}
