import * as Haptics from "expo-haptics";

/** Light physical confirmation for the moments that matter; never the only feedback. */
export const haptic = {
  tap: () => void Haptics.selectionAsync().catch(() => undefined),
  /** Something let go and moved home: a sheet dragged shut. */
  snap: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined),
  success: () =>
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined),
  warning: () =>
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined),
};
