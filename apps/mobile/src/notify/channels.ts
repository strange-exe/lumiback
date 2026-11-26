import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { APP_UPDATES_CHANNEL, BOARD_CHANNEL } from "@/notify/plan";

/**
 * Android notification channels. Apart from notify.ts so push.ts can tell the server whether
 * they exist (notify.ts imports push.ts, so the other way round would be an import cycle).
 */
export const CHANNELS = {
  requests: "follow-requests",
  reminders: "return-reminders",
  status: "share-status",
} as const;

let channels: Promise<void> | null = null;

/** Exported for the update task, which can run before anything else in the app has. */
export function ensureChannels(): Promise<void> {
  if (Platform.OS !== "android") return Promise.resolve();
  channels ??= (async () => {
    await Notifications.setNotificationChannelAsync(CHANNELS.requests, {
      name: "Follow requests",
      description: "Someone asked to see your live location.",
      importance: Notifications.AndroidImportance.HIGH,
    });
    await Notifications.setNotificationChannelAsync(CHANNELS.reminders, {
      name: "Return reminders",
      description: "Before and when you're due back from an outing.",
      importance: Notifications.AndroidImportance.HIGH,
    });
    await Notifications.setNotificationChannelAsync(CHANNELS.status, {
      // Same id as before: Android keeps the student's settings and updates the name.
      name: "Sharing and requests",
      description:
        "When a live share ends on its own, and when the hostel office decides your outing request.",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    // New: Android sets a channel's importance once, when it's created. Default (sound, no
    // pop-up), and people can turn it off in Android's settings for Lumiback.
    await Notifications.setNotificationChannelAsync(APP_UPDATES_CHANNEL, {
      name: "App updates",
      description: "When a new version of Lumiback is ready.",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    // The hostel board: default importance (sound, no pop-up), fixed once created. Last, so
    // when it fails the phone tells the server board=false (push.ts) and gets no board pushes
    // in a fallback channel the student couldn't mute.
    await Notifications.setNotificationChannelAsync(BOARD_CHANNEL, {
      name: "Hostel board",
      description: "New posts from your hostel office: timings, mess, laundry.",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  })().catch((error: unknown) => {
    channels = null; // try again next time
    throw error;
  });
  return channels;
}
