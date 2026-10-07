import { router } from "expo-router";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { Platform } from "react-native";

import { loadPrefs } from "@/lib/prefs";
import { endedMessage, RETURN_DUE, RETURN_SOON, returnReminders } from "@/notify/plan";

/**
 * Local notifications only: everything we notify about is known on this phone, either from the
 * location service that runs while sharing (join requests, share ended) or from the outing
 * (return reminders). No push server or Firebase project is needed.
 *
 * Reminders are scheduled with Android's inexact alarms: without the exact-alarm permission
 * (which Play reserves for alarm and calendar apps) they can land a few minutes late in doze.
 */
const CHANNELS = {
  requests: "follow-requests",
  reminders: "return-reminders",
  status: "share-status",
} as const;

// Show banners while the app is open too: a join request matters even on another tab.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let channels: Promise<void> | null = null;

function ensureChannels(): Promise<void> {
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
      name: "Sharing status",
      description: "When a live share ends on its own.",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  })().catch((error: unknown) => {
    channels = null; // try again next time
    throw error;
  });
  return channels;
}

/** Asks once (Android 13+ shows the system prompt); later calls just report the answer. */
export async function allowNotifications(): Promise<boolean> {
  await ensureChannels();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

async function show(channelId: string, content: Notifications.NotificationContentInput) {
  try {
    await ensureChannels();
    await Notifications.scheduleNotificationAsync({ content, trigger: { channelId } });
  } catch {
    // Notifications are a convenience: the same information is on screen in the app.
  }
}

/** Opened from a notification: where to go. Read by the root layout. */
export interface NotificationData {
  url: "/share" | "/today";
}

export async function notifyFollowRequest(name: string): Promise<void> {
  if (!(await loadPrefs()).followRequests) return;
  return show(CHANNELS.requests, {
    title: `${name} wants to follow you`,
    body: "Open Lumiback to approve or decline.",
    data: { url: "/share" } satisfies NotificationData,
  });
}

export async function notifyShareEnded(reason: string | null): Promise<void> {
  if (!(await loadPrefs()).shareStatus) return;
  return show(CHANNELS.status, {
    title: "Live location sharing ended",
    body: endedMessage(reason),
    data: { url: "/share" } satisfies NotificationData,
  });
}

/**
 * Make the scheduled reminders match the current outing (null: none open). Called whenever the
 * outing is loaded, so a change made on the web is picked up the next time the app opens.
 */
export async function syncReturnReminders(expectedReturnAt: string | null): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(RETURN_SOON);
    await Notifications.cancelScheduledNotificationAsync(RETURN_DUE);
    const enabled = (await loadPrefs()).returnReminders;
    const plan = enabled ? returnReminders(expectedReturnAt, Date.now()) : [];
    if (plan.length === 0) return;
    await ensureChannels();
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    for (const r of plan) {
      await Notifications.scheduleNotificationAsync({
        identifier: r.id,
        content: {
          title: r.title,
          body: r.body,
          data: { url: "/today" } satisfies NotificationData,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: r.at,
          channelId: CHANNELS.reminders,
        },
      });
    }
  } catch {
    // Same as above: reminders help, they are not the record.
  }
}

const ROUTES: readonly NotificationData["url"][] = ["/share", "/today"];

/**
 * Opens the screen a tapped notification points at, including the tap that launched the app.
 * Waits until signed in, so a tap that launched the app is handled after sign-in, not lost.
 */
export function useNotificationRoutes(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const open = (response: Notifications.NotificationResponse | null): void => {
      const url = (response?.notification.request.content.data as Partial<NotificationData>)?.url;
      if (!url || !ROUTES.includes(url)) return;
      Notifications.clearLastNotificationResponse(); // handled: don't reopen on the next mount
      router.navigate(url);
    };
    open(Notifications.getLastNotificationResponse());
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [enabled]);
}
