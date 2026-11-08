/**
 * Calling the hostel office, Help, the office's follow-up and its notices: the wording and the
 * small decisions, free of React so they are unit-tested. The server checks every call.
 */
import { formatTime } from "@/lib/time";
import type {
  CallOutcome,
  Escalation,
  EscalationCall,
  HelpFix,
  HelpRequest,
  HelpSent,
  OfficeContact,
} from "@/lib/types";

function isCoordinate(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  );
}

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

/** An OpenStreetMap link to one position (null for anything that isn't a coordinate). */
export function osmLink(lat: number, lng: number): string | null {
  if (!isCoordinate(lat, lng)) return null;
  const a = round6(lat);
  const b = round6(lng);
  return `https://www.openstreetmap.org/?mlat=${a}&mlon=${b}#map=17/${a}/${b}`;
}

/** A tap-to-call URL: only digits and a leading plus reach it (as on the website). */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/** "within 25 m", "within 1.5 km" (null without a usable accuracy). */
export function accuracyText(metres: number | null): string | null {
  if (metres === null || !Number.isFinite(metres) || metres < 0) return null;
  if (metres < 1000) return `within ${Math.max(1, Math.round(metres))} m`;
  return `within ${(metres / 1000).toFixed(1)} km`;
}

/** Where a student who pressed Help was, for the office: a sentence and a map link. */
export function helpPlace(help: HelpRequest): { text: string; map: string | null } {
  const map = help.lat !== null && help.lng !== null ? osmLink(help.lat, help.lng) : null;
  if (!map) {
    return {
      text: "No location: the phone didn't send one, or it was cleared after a day.",
      map: null,
    };
  }
  const near = accuracyText(help.accuracy_m);
  return { text: `Location sent with it${near ? `, ${near}` : ""}.`, map };
}

/** The outcomes a call can have, in the order the "Log a call" sheet lists them. */
export const CALL_OUTCOMES: { value: CallOutcome; label: string }[] = [
  { value: "reached_student", label: "Reached the student" },
  { value: "reached_contact", label: "Reached their emergency contact" },
  { value: "no_answer", label: "No answer" },
  { value: "left_message", label: "Left a message" },
];

export function outcomeLabel(outcome: string): string {
  return CALL_OUTCOMES.find((o) => o.value === outcome)?.label ?? "Call";
}

/** "9:12 PM, Meena Joshi: No answer", with the note in quotes when there is one. */
export function callLine(call: EscalationCall): string {
  const who = call.by ?? "a former staff member";
  const note = call.note ? `. "${call.note}"` : "";
  return `${formatTime(call.at)}, ${who}: ${outcomeLabel(call.outcome)}${note}`;
}

/** Who said "I'm on it" (null: nobody has it). */
export function claimLine(e: Pick<Escalation, "claimed_by" | "claimed_by_me">): string | null {
  if (!e.claimed_by) return null;
  return e.claimed_by_me ? "You're on it" : `Claimed by ${e.claimed_by}`;
}

/** A student who is out: call the office's number, or ask the office to call when there's none. */
export type OfficeAction = { kind: "call"; phone: string } | { kind: "ask" };

export function officeAction(office: OfficeContact | null | undefined): OfficeAction {
  const phone = office?.phone?.trim();
  return phone ? { kind: "call", phone } : { kind: "ask" };
}

export const CALL_ME_SENT = "The office has been asked to call you";

export function callMeError(status: number, detail: string): string {
  return status === 429
    ? "You've already asked a few times this hour. The office has been told; wait for their call."
    : detail;
}

/** "a", "a and b", "a, b and c" */
function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** What the student sees after Help: never says the office was told when it wasn't. */
export function helpResult(
  sent: HelpSent,
  withLocation: boolean,
): { title: string; detail: string } {
  const told: string[] = [];
  if (sent.office_told > 0) told.push("the hostel office");
  if (sent.followers_told > 0) {
    told.push(
      sent.followers_told === 1
        ? "1 person who follows you"
        : `${sent.followers_told} people who follow you`,
    );
  }
  if (sent.contact_told) told.push("your emergency contact");
  const where = withLocation ? "Your location was sent once." : "No location was sent.";
  if (told.length === 0) {
    return {
      title: "No one could be told",
      detail: `Call the hostel office or someone you trust now. ${where}`,
    };
  }
  return {
    title:
      sent.office_told > 0 ? "Help is on its way to the hostel office" : "Your help alert was sent",
    detail: `Told: ${list(told)}. ${where}`,
  };
}

export function helpError(status: number, detail: string): string {
  return status === 429
    ? "You've sent several help alerts this hour. The office already has them; call them if you can."
    : detail;
}

export function noticeResult(sent: number): string {
  if (sent <= 0) return "No one is out right now";
  return sent === 1 ? "Sent to 1 student" : `Sent to ${sent} students`;
}

export function noticeError(status: number, detail: string): string {
  return status === 429
    ? "You've sent 10 notices this hour. Wait a while before sending another."
    : detail;
}

/** A notice is one line: runs of spaces, tabs and line breaks become one space. */
export function noticeText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** The shape expo-location's fix has (only what Help reads). */
interface PhoneFix {
  coords: { latitude: number; longitude: number; accuracy: number | null };
  mocked?: boolean;
}

/** One fix as the help alert sends it, or null when it isn't a real coordinate. */
export function toHelpFix(fix: PhoneFix | null): HelpFix | null {
  if (!fix) return null;
  const { latitude: lat, longitude: lng, accuracy } = fix.coords;
  if (!isCoordinate(lat, lng)) return null;
  const metres = accuracy !== null && Number.isFinite(accuracy) ? accuracy : 0;
  return {
    lat,
    lng,
    accuracy_m: Math.min(100_000, Math.max(0, metres)),
    // Android's flag for a fix from a mock-location app, as the live share sends it.
    mocked: fix.mocked ?? false,
  };
}
