/**
 * The longest incoming link Expo Router is allowed to parse. Real Lumiback links are short (a
 * gate code link is about 120 characters, a join code fewer), and expo-router 57 parses query
 * strings with decode-uri-component 0.2.2, which can be made very slow by a long, crafted run
 * of percent escapes (GHSA-vcc3-ghjq-m6fr, GHSA-qr28-fpjm-wq7f). The patched releases are
 * ESM-only and can't replace it under expo-router 57, so the length is capped before parsing.
 */
export const MAX_LINK_LENGTH = 2048;

/** Where an incoming link goes: itself when it's a sensible length, else the home screen. */
export function safeIncomingPath(path: string): string {
  return path.length > MAX_LINK_LENGTH ? "/" : path;
}
