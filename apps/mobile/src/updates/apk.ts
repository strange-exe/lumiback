/**
 * Downloads a new app build (APK) inside the app and hands it to Android's installer.
 *
 * Android never installs silently for an app outside the Play Store: the person taps Install
 * in the system dialog, and the first time Android asks them to allow "install unknown apps"
 * from Lumiback (REQUEST_INSTALL_PACKAGES in app.json). The new APK must be signed with the
 * same key as the installed one, which Android checks before upgrading.
 *
 * The download lives outside any screen, so closing the prompt doesn't stop it. A file that
 * isn't exactly the published one (size and MD5 from /app/android.json) is deleted, never
 * installed.
 */
import { Directory, File, Paths } from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";
import { AppState, Platform } from "react-native";

import { apkMatches, type NativeUpdate } from "./native-build";

// android.content.Intent constants (developer.android.com/reference/android/content/Intent).
const ACTION_VIEW = "android.intent.action.VIEW";
const FLAG_GRANT_READ_URI_PERMISSION = 0x00000001;
const FLAG_ACTIVITY_NEW_TASK = 0x10000000;
const APK_TYPE = "application/vnd.android.package-archive";

export type ApkState =
  | { kind: "idle" }
  | { kind: "downloading"; build: number; progress: number | null } // 0..1, null: size unknown
  | { kind: "ready"; build: number } // downloaded and checked; the installer is (or was) open
  | { kind: "failed"; build: number; message: string };

let state: ApkState = { kind: "idle" };
const listeners = new Set<() => void>();

function set(next: ApkState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function apkState(): ApkState {
  return state;
}

export function subscribeApk(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function canSelfUpdate(): boolean {
  return Platform.OS === "android";
}

function folder(): Directory {
  const dir = new Directory(Paths.cache, "updates");
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function apkFile(build: number): File {
  return new File(folder(), `lumiback-build-${build}.apk`);
}

function verified(update: NativeUpdate, file: File): boolean {
  if (!file.exists) return false;
  const info = file.info({ md5: update.md5 !== null });
  return apkMatches(update, { size: info.size ?? 0, md5: info.md5 ?? null });
}

/** Older builds' APKs are no use once a newer one is on the way. */
function removeOthers(keep: number): void {
  for (const item of folder().list()) {
    if (item instanceof File && !item.name.endsWith(`-${keep}.apk`)) item.delete();
  }
}

/** Opens Android's installer for a checked APK. Resolves when the person comes back. */
export async function openInstaller(update: NativeUpdate): Promise<void> {
  const file = apkFile(update.build);
  if (!verified(update, file)) {
    set({ kind: "failed", build: update.build, message: "The download didn't finish. Try again." });
    return;
  }
  await IntentLauncher.startActivityAsync(ACTION_VIEW, {
    data: file.contentUri,
    type: APK_TYPE,
    flags: FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK,
  });
}

let running: Promise<void> | null = null;

/**
 * Downloads the build (or reuses a checked copy), then opens the installer, at once if the app
 * is on screen, otherwise the next time it is. Calling it again while it runs does nothing.
 */
export function downloadAndInstall(update: NativeUpdate): Promise<void> {
  running ??= run(update).finally(() => {
    running = null;
  });
  return running;
}

async function run(update: NativeUpdate): Promise<void> {
  const file = apkFile(update.build);
  try {
    removeOthers(update.build);
    if (!verified(update, file)) {
      if (file.exists) file.delete();
      set({ kind: "downloading", build: update.build, progress: 0 });
      const task = File.createDownloadTask(update.url, file, {
        onProgress: ({ bytesWritten, totalBytes }) => {
          const total = totalBytes > 0 ? totalBytes : (update.size ?? -1);
          set({
            kind: "downloading",
            build: update.build,
            progress: total > 0 ? Math.min(1, bytesWritten / total) : null,
          });
        },
      });
      const done = await task.downloadAsync();
      if (!done || !verified(update, file)) {
        if (file.exists) file.delete();
        set({
          kind: "failed",
          build: update.build,
          message:
            "The download didn't come through complete. Check your connection and try again.",
        });
        return;
      }
    }
    set({ kind: "ready", build: update.build });
    await whenOnScreen();
    await openInstaller(update);
  } catch {
    if (file.exists) file.delete();
    set({
      kind: "failed",
      build: update.build,
      message: "Couldn't download the new version. Check your connection and try again.",
    });
  }
}

/** Android won't open the installer over another app: wait until Lumiback is in front. */
function whenOnScreen(): Promise<void> {
  if (AppState.currentState === "active") return Promise.resolve();
  return new Promise((resolve) => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      sub.remove();
      resolve();
    });
  });
}
