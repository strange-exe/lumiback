import { formatTime } from "@/lib/time";

/** The join link and message, worded the same as the web app's invite. */
export function inviteLink(webUrl: string, code: string): string {
  return `${webUrl}/join#code=${encodeURIComponent(code)}`;
}

export function inviteMessage(webUrl: string, code: string, expiresAt: string): string {
  return (
    `Follow my way back on Lumiback: ${inviteLink(webUrl, code)}\n` +
    `Or enter code ${code}. It works once, until ${formatTime(expiresAt)}.`
  );
}

/**
 * wa.me opens WhatsApp when it's installed (Android App Link) and its web page otherwise, so no
 * package-visibility query is needed. No number: the student picks the chat in WhatsApp.
 */
export function whatsappUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
