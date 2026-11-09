import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";

import { ensureCategories, ensureChannels } from "@/notify/notify";
import { APP_UPDATE_CATEGORY, APP_UPDATES_CHANNEL, updateFromTask } from "@/notify/plan";

/**
 * Draws the developers' update announcement with its Changelog and Update buttons, even with
 * the app closed. Android draws a visible push itself when the app isn't open, without the
 * buttons; so phones that register with draws_updates (push.ts) get it data-only, and this task
 * draws it (lead's spike, 2026-11-09). Older apps, without this task, get the visible push.
 *
 * Defined and registered at module scope, imported early by the root layout: Expo runs it in a
 * headless JS run when the app is closed. Expo also runs it while the app is open
 * (expo-notifications 57.0.25 android/.../service/delegates/FirebaseMessagingDelegate.kt:
 * onMessageReceived calls runTaskManagerTasks whatever the app's state), so it is the only
 * place the notice is drawn; the notification handler in notify.ts hides the push itself.
 *
 * No banner picture: a local notification on Android can't carry one (in 57.0.25 the content's
 * `attachments` are iOS only, and NotificationContent.getImage returns the app's large icon).
 */
export const UPDATE_TASK = "lumiback-update-push";

export async function drawUpdate(taskData: unknown): Promise<void> {
  try {
    const update = updateFromTask(taskData);
    if (!update) return; // a button tap, another push, or a malformed one
    await ensureChannels();
    await ensureCategories();
    await Notifications.scheduleNotificationAsync({
      // The tag: a newer announcement replaces the one shown, as the visible push does.
      identifier: update.identifier,
      content: {
        title: update.title,
        body: update.body,
        data: update.data,
        categoryIdentifier: APP_UPDATE_CATEGORY,
      },
      trigger: { channelId: APP_UPDATES_CHANNEL },
    });
  } catch {
    // Never throw out of a background task. A notice is a nudge: the update is still there.
  }
}

TaskManager.defineTask(UPDATE_TASK, ({ data }) => drawUpdate(data));

void Notifications.registerTaskAsync(UPDATE_TASK).catch(() => undefined);
