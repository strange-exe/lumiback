/**
 * New app builds (a new APK, or a store update) that over-the-air updates can't deliver.
 * The website publishes the latest build per channel at /app/android.json; this decides
 * whether the installed app should ask to download it, and which APK fits this phone. Plain
 * functions, tested without the network.
 */

/** One downloadable APK. */
export interface Apk {
  /** Where to get it: the APK download, or the store page. */
  url: string;
  /** The APK's size in bytes and MD5, so a download is checked before it's installed. */
  size?: number;
  md5?: string;
}

export interface BuildInfo extends Apk {
  /** The latest build's number (see NATIVE_BUILDS in changelog.ts). */
  build: number;
  /** Builds below this can't keep working (the server changed): no "Later". */
  min_build: number;
  /** One sentence on what the new build brings. */
  notes?: string;
  /**
   * The APKs this app downloads itself: one per processor type (ABI), e.g. "arm64-v8a", plus
   * "universal", which installs everywhere. The top-level `url` is for apps that only open a
   * link in the browser (build 1): the download page, which offers the small APK. Older builds
   * that download the top-level `url` themselves check it against the top-level size and MD5
   * (the universal APK's), so a page never gets installed: they fall back to the browser.
   */
  apks?: Partial<Record<string, Apk>>;
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
  /** The processor type the APK is for; null: the universal APK. */
  abi: string | null;
}

const isHttps = (url: unknown): url is string => typeof url === "string" && /^https:\/\//.test(url);

/**
 * The APK for this phone: the first of its ABIs (Android lists the preferred one first) that
 * has its own APK, else the universal one (else the top-level link, from older files).
 */
function pick(info: BuildInfo, abis: readonly string[] | null): { apk: Apk; abi: string | null } {
  const apks = typeof info.apks === "object" && info.apks !== null ? info.apks : {};
  const listed = (key: string): Apk | null => {
    const apk = Object.prototype.hasOwnProperty.call(apks, key) ? apks[key] : undefined;
    return apk && isHttps(apk.url) ? apk : null;
  };
  for (const abi of abis ?? []) {
    if (abi === "universal") continue;
    const apk = listed(abi);
    if (apk) return { apk, abi };
  }
  return { apk: listed("universal") ?? info, abi: null };
}

/**
 * The build to ask for, or null. Quiet whenever anything is unknown (no channel, an
 * unrecognised installed build, a malformed file), so a mistake can never nag everyone.
 * `abis`: the phone's supported ABIs, preferred first (null: unknown, so the universal APK).
 */
export function nativeUpdateFor(
  file: unknown,
  channel: string | null,
  installed: number | undefined,
  abis: readonly string[] | null = null,
): NativeUpdate | null {
  if (!channel || installed === undefined || typeof file !== "object" || file === null) {
    return null;
  }
  const info = (file as BuildFile)[channel];
  if (!info || !Number.isInteger(info.build) || !isHttps(info.url)) return null;
  if (info.build <= installed) return null;
  const { apk, abi } = pick(info, abis);
  return {
    build: info.build,
    url: apk.url,
    notes: typeof info.notes === "string" && info.notes ? info.notes : null,
    required: Number.isInteger(info.min_build) && installed < info.min_build,
    size: Number.isInteger(apk.size) && (apk.size ?? 0) > 0 ? (apk.size as number) : null,
    md5:
      typeof apk.md5 === "string" && /^[0-9a-f]{32}$/i.test(apk.md5) ? apk.md5.toLowerCase() : null,
    abi,
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

/** "52 MB", for telling people how big a download is. */
export function megabytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
}
