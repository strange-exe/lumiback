/**
 * The Android downloads the website offers, from public/app/android.json (the same file the app
 * reads, so the page and the app always agree).
 *
 * Builds from 3 on come as one APK per processor type (ABI) next to the universal one. New
 * people get the modern-phone APK by default (arm64-v8a: practically every phone today), and
 * can pick another under "Other versions". Until a build has per-ABI APKs, the universal one is
 * the only download.
 */

export interface Apk {
  url: string;
  size?: number;
  md5?: string;
}

export interface Channel extends Apk {
  build: number;
  apks?: Partial<Record<string, Apk>>;
}

export interface Download {
  /** Visible label, e.g. "Older phones (32-bit)". */
  label: string;
  /** One line on who it's for. */
  hint: string;
  url: string;
  /** Bytes, when published. */
  size: number | null;
}

/** Processor types with their own APK, in the order they're offered. */
const VARIANTS: { abi: string; label: string; hint: string }[] = [
  {
    abi: "arm64-v8a",
    label: "Modern phones (64-bit)",
    hint: "Almost every Android phone from the last several years.",
  },
  {
    abi: "armeabi-v7a",
    label: "Older phones (32-bit)",
    hint: "For phones that can only run 32-bit apps.",
  },
];

const UNIVERSAL = {
  label: "Any Android device",
  hint: "Works everywhere, including tablets and Chromebooks, but it's the biggest file.",
};

const https = (url: unknown): url is string =>
  typeof url === "string" && url.startsWith("https://");

function download(apk: Apk, label: string, hint: string): Download {
  const size = Number.isInteger(apk.size) && (apk.size ?? 0) > 0 ? (apk.size as number) : null;
  return { label, hint, url: apk.url, size };
}

/** The default download, then the alternatives (empty when there's only the universal APK). */
export function androidDownloads(channel: Channel): { primary: Download; others: Download[] } {
  // The listed universal APK; files without one have it at the top level. (Once listed, the
  // top-level url is this page itself, for build 1's "open in the browser".)
  const listed = channel.apks?.universal;
  const universal = download(
    listed && https(listed.url) ? listed : channel,
    UNIVERSAL.label,
    UNIVERSAL.hint,
  );
  const variants = VARIANTS.flatMap(({ abi, label, hint }) => {
    const apk = channel.apks?.[abi];
    return apk && https(apk.url) ? [{ abi, ...download(apk, label, hint) }] : [];
  });
  // Only the 64-bit APK is a safe default: newer phones can't run 32-bit-only apps.
  const modern = variants.find((v) => v.abi === "arm64-v8a");
  const strip = ({ abi: _abi, ...d }: Download & { abi: string }): Download => d;
  if (!modern) return { primary: universal, others: variants.map(strip) };
  return {
    primary: strip(modern),
    others: [...variants.filter((v) => v !== modern).map(strip), universal],
  };
}

/** "55 MB". */
export function megabytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
}
