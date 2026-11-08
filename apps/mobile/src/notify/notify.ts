import { router } from "expo-router";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { Platform } from "react-native";

import { loadPrefs } from "@/lib/prefs";
import type { Viewer } from "@/lib/types";
import { loadViewAs } from "@/lib/view-as";
import {
  APP_UPDATES_CHANNEL,
  endedMessage,
  followRequestNotice,
  isAppUpdate,
  notificationRoute,
  RETURN_DUE,
  RETURN_SOON,
  returnReminders,
  sendProblemNotice,
  type NotificationRoute,
} from "@/notify/plan";
import { registerPush } from "@/notify/push";
import { openAnnouncedUpdate } from "@/updates/announced";

/**
 * Local notifications for what this phone knows itself: the location service that runs while
 * sharing (join requests, share ended) and the outing (return reminders). Server push (see
 * push.ts) adds what only the server knows, and replaces the local join-request alert once this
 * phone has a push token, so nothing arrives twice.
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
  if (current.granted) {
    void registerPush();
    return true;
  }
  if (!current.canAskAgain) return false;
  const granted = (await Notifications.requestPermissionsAsync()).granted;
  if (granted) void registerPush();
  return granted;
}

/** After sign-in and at launch: register for server push if notifications are already allowed. */
export async function syncPush(): Promise<void> {
  await ensureChannels().catch(() => undefined); // Android needs a channel before a token
  await registerPush();
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
  url: NotificationRoute;
}

export async function notifyFollowRequest(viewer: Pick<Viewer, "name" | "kind">): Promise<void> {
  if (!(await loadPrefs()).followRequests) return;
  return show(CHANNELS.requests, {
    ...followRequestNotice(viewer),
    data: { url: "/live" } satisfies NotificationData,
  });
}

export async function notifyShareEnded(reason: string | null): Promise<void> {
  if (!(await loadPrefs()).shareStatus) return;
  return show(CHANNELS.status, {
    title: "Live location sharing ended",
    body: endedMessage(reason),
    data: { url: "/live" } satisfies NotificationData,
  });
}

/**
 * The server is refusing this phone's location for a share, so the people following see no
 * position. Sent once per problem, whatever the switches say: the share isn't working.
 */
export async function notifySendProblem(problem: "clock" | "refused"): Promise<void> {
  return show(CHANNELS.status, {
    ...sendProblemNotice(problem),
    data: { url: "/live" } satisfies NotificationData,
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
    // Viewing as another role (developers): no reminders from a preview.
    const enabled = (await loadPrefs()).returnReminders && !(await loadViewAs());
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

/**
 * Opens the screen a tapped notification points at, including the tap that launched the app.
 * Waits until signed in, so a tap that launched the app is handled after sign-in, not lost.
 * A notification without a known `url` (the escalation push has none) opens Today. An "app
 * updated" announcement checks for the update instead (see UpdatePrompt).
 */
export function useNotificationRoutes(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const open = (response: Notifications.NotificationResponse | null): void => {
      if (!response) return;
      Notifications.clearLastNotificationResponse(); // handled: don't reopen on the next mount
      const data = response.notification.request.content.data;
      if (isAppUpdate(data)) {
        openAnnouncedUpdate();
        return;
      }
      router.navigate(notificationRoute(data));
    };
    open(Notifications.getLastNotificationResponse());
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [enabled]);
}
