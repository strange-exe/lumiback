/**
 * A student's ways to reach the hostel office while out: call its number, or ask it to call
 * (when the hostel has no number), and the Help alert with one location fix. The wording and
 * the decisions live here so they can be tested. Pure, so `node --test` can load it.
 */

import type { HelpSent, OfficeContact } from "../../lib/types.ts";

export type OfficeChoice = { kind: "call"; phone: string; who: string | null } | { kind: "ask" };

/** Call the office when its number is known; otherwise ask it to call. */
export function officeChoice(office: OfficeContact | null | undefined): OfficeChoice {
  const phone = office?.phone?.trim();
  if (!office || !phone) return { kind: "ask" };
  const who = [office.name, office.hostel].filter(Boolean).join(", ");
  return { kind: "call", phone, who: who || null };
}

export const CALL_ME_SENT = "The office has been asked to call you.";

export function callMeError(status: number, detail: string): string {
  if (status === 429) {
    return "You've asked 3 times in the last hour. The office has your request; wait for their call.";
  }
  if (status === 404) {
    return "You're not checked out, so there's nothing to ask about. Reload the page.";
  }
  return detail;
}

export function helpError(status: number, detail: string): string {
  if (status === 429) {
    return "You've sent 5 help alerts in the last hour. Call the hostel office or your emergency contact directly.";
  }
  if (status === 404) return "You're not checked out, so no help alert was sent. Reload the page.";
  return detail;
}

export interface HelpFix {
  lat: number;
  lng: number;
  accuracy_m: number;
}

/** The API's own limit on a fix's accuracy. */
const MAX_ACCURACY_M = 100_000;

function finite(raw: string): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * The one fix the browser sent with a help alert, read from the form on the server; null when
 * there was none or anything is off (the alert then goes without a location).
 */
export function helpFix(lat: string, lng: string, accuracy: string): HelpFix | null {
  const y = finite(lat);
  const x = finite(lng);
  const metres = finite(accuracy);
  if (y === null || x === null || metres === null) return null;
  if (Math.abs(y) > 90 || Math.abs(x) > 180 || metres < 0) return null;
  return { lat: y, lng: x, accuracy_m: Math.min(metres, MAX_ACCURACY_M) };
}

/** "Also told: your emergency contact and 2 people you share your location with." */
export function helpTold(
  sent: Pick<HelpSent, "followers_told" | "contact_told" | "office_told">,
): string | null {
  const who: string[] = [];
  if (sent.contact_told) who.push("your emergency contact");
  if (sent.followers_told > 0) {
    who.push(
      `${sent.followers_told} ${sent.followers_told === 1 ? "person" : "people"} you share your location with`,
    );
  }
  return who.length ? `Also told: ${who.join(" and ")}.` : null;
}
