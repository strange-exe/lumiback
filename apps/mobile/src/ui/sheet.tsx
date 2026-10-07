import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { T } from "@/ui/kit";
import { layout, radius, space, useColors } from "@/ui/theme";

/**
 * A bottom sheet on React Native's Modal: a real native window that slides up, closes with
 * Android's back gesture or a tap on the scrim, and resizes for the keyboard. Used for short
 * tasks that shouldn't leave the screen (log a trip, invite someone).
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}): ReactNode {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: "rgba(10, 18, 16, 0.45)",
          }}
        />
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: c.page,
            borderTopLeftRadius: radius.sheet + 4,
            borderTopRightRadius: radius.sheet + 4,
            borderCurve: "continuous",
            maxHeight: "90%",
            paddingBottom: insets.bottom + space(4),
          }}
        >
          <View style={{ alignItems: "center", paddingTop: space(3), paddingBottom: space(2) }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: c.line }} />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              paddingHorizontal: layout.gutter,
              gap: space(5),
              paddingTop: space(2),
            }}
          >
            <T tone="headline" accessibilityRole="header">
              {title}
            </T>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
