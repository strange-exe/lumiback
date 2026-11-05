import { SUPPORT_EMAIL } from "./support.ts";

export interface ErrorCopy {
  title: string;
  body: string;
}

/**
 * What a failed page says. Offline is the one cause the browser can tell us for certain; anything
 * else is the server, which on our free hosting can take up to a minute to wake.
 * (Production hides server error messages, so we never show `error.message`.)
 */
export function errorCopy({ online }: { online: boolean }): ErrorCopy {
  if (!online) {
    return {
      title: "You're offline",
      body: "This page needs a connection. Check your Wi-Fi or mobile data, then try again.",
    };
  }
  return {
    title: "This page didn't load",
    body: "Lumiback's server didn't answer. It may be starting up, which can take up to a minute. Try again in a moment.",
  };
}

/** A support email that carries the error's reference, so we can find it in the server logs. */
export function supportHref(digest?: string): string {
  const params = [`subject=${encodeURIComponent("Lumiback: a page didn't load")}`];
  const reference = digest?.trim();
  if (reference) params.push(`body=${encodeURIComponent(`Error reference: ${reference}`)}`);
  return `mailto:${SUPPORT_EMAIL}?${params.join("&")}`;
}
