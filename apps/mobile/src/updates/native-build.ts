/**
 * New app builds (a new APK, or a store update) that over-the-air updates can't deliver.
 * The website publishes the latest build per channel at /app/android.json; this decides
 * whether the installed app should ask to download it. Plain functions, tested without
 * the network.
 */

export interface BuildInfo {
  /** The latest build's number (see NATIVE_BUILDS in changelog.ts). */
  build: number;
  /** Builds below this can't keep working (the server changed): no "Later". */
  min_build: number;
  /** Where to get it: the APK download, or the store page. */
  url: string;
  /** One sentence on what the new build brings. */
  notes?: string;
  /** The APK's size in bytes and MD5, so a download is checked before it's installed. */
  size?: number;
  md5?: string;
}

/** The published file: one entry per update channel ("preview", "production"). */
export type BuildFile = Partial<Record<string, BuildInfo | null>>;

export interface NativeUpdate {
  build: number;
  url: string;
  notes: string | null;
  /** This build is too old to keep using. */
  required: boolean;
  /** Present when the file gives them: the app downloads and checks the APK itself. */
  size: number | null;
  md5: string | null;
}

/**
 * The build to ask for, or null. Quiet whenever anything is unknown (no channel, an
 * unrecognised installed build, a malformed file), so a mistake can never nag everyone.
 */
export function nativeUpdateFor(
  file: unknown,
  channel: string | null,
  installed: number | undefined,
): NativeUpdate | null {
  if (!channel || installed === undefined || typeof file !== "object" || file === null) {
    return null;
  }
  const info = (file as BuildFile)[channel];
  if (!info || !Number.isInteger(info.build) || typeof info.url !== "string") return null;
  if (!/^https:\/\//.test(info.url) || info.build <= installed) return null;
  return {
    build: info.build,
    url: info.url,
    notes: typeof info.notes === "string" && info.notes ? info.notes : null,
    required: Number.isInteger(info.min_build) && installed < info.min_build,
    size: Number.isInteger(info.size) && (info.size ?? 0) > 0 ? (info.size as number) : null,
    md5:
      typeof info.md5 === "string" && /^[0-9a-f]{32}$/i.test(info.md5)
        ? info.md5.toLowerCase()
        : null,
  };
}

/** A downloaded APK is installable only if it's exactly the published file. */
export function apkMatches(
  update: Pick<NativeUpdate, "size" | "md5">,
  file: { size: number; md5: string | null },
): boolean {
  if (update.size !== null && file.size !== update.size) return false;
  if (update.md5 !== null && file.md5?.toLowerCase() !== update.md5) return false;
  return file.size > 0;
}
