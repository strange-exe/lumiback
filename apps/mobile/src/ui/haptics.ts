import * as Haptics from "expo-haptics";

/** Light physical confirmation for the moments that matter; never the only feedback. */
export const haptic = {
  tap: () => void Haptics.selectionAsync().catch(() => undefined),
  success: () =>
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined),
  warning: () =>
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined),
};
