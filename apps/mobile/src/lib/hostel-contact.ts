/**
 * The hostel contact form (warden name and phone), as on the website's My hostel page
 * (HostelContactForm). The server checks everything again and stores the phone in one dialable
 * form; these checks only catch a mistake before it is sent, with the server's own words.
 */
import type { OfficeHostel } from "@/lib/types";

/** Who sees the number (the owner chose to show it to students and contacts, 2026-11-08). */
export const CONTACT_NOTE =
  "The warden's number is shown to the office when a late student doesn't answer, to students while they're out, and in the email their emergency contact gets when they press Help.";

const NAME_MAX = 80;
const PHONE_MAX = 24;

export interface ContactForm {
  name: string;
  phone: string;
}

export interface ContactBody {
  warden_name: string | null;
  warden_phone: string | null;
}

export function contactForm(
  hostel: Pick<OfficeHostel, "warden_name" | "warden_phone">,
): ContactForm {
  return { name: hostel.warden_name ?? "", phone: hostel.warden_phone ?? "" };
}

const INDIAN_MOBILE = "Enter a 10-digit Indian mobile number, or add the country code (+).";

/**
 * "98765 43210", "+91-98765-43210", "09876543210" -> "+919876543210"; other countries need
 * their + code. The same rules as the server's (backend/app/schemas.py, _phone).
 */
export function normalizePhone(typed: string): { phone: string } | { error: string } {
  const value = typed.trim();
  if (value.length > PHONE_MAX) {
    return { error: `Keep the phone number to ${PHONE_MAX} characters.` };
  }
  let digits = value.replace(/[\s\-().]/g, "");
  if (digits.startsWith("+")) {
    const rest = digits.slice(1);
    if (!/^\d{8,15}$/.test(rest)) {
      return { error: "Phone numbers have 8 to 15 digits after the country code." };
    }
    return { phone: `+${rest}` };
  }
  if (!/^\d+$/.test(digits)) return { error: "A phone number can only have digits." };
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length !== 10 || !"6789".includes(digits.charAt(0))) return { error: INDIAN_MOBILE };
  return { phone: `+91${digits}` };
}

// Control and invisible characters, which the server refuses in a name.
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** PATCH /admin/hostels/{id}/contact's body: both fields, an emptied one null (clears it). */
export function contactBody(form: ContactForm): { body: ContactBody } | { error: string } {
  const name = form.name.trim();
  const phone = form.phone.trim();
  let wardenName: string | null = null;
  if (name) {
    if (CONTROL.test(name)) return { error: "Write the name on one line." };
    if (!LETTER_OR_DIGIT.test(name)) return { error: "Enter the warden's name." };
    if ([...name].length > NAME_MAX) return { error: `Keep the name to ${NAME_MAX} characters.` };
    wardenName = name;
  }
  let wardenPhone: string | null = null;
  if (phone) {
    const checked = normalizePhone(phone);
    if ("error" in checked) return checked;
    wardenPhone = checked.phone;
  }
  return { body: { warden_name: wardenName, warden_phone: wardenPhone } };
}

/** After a save, the hostel as the server now has it (the reply lists every hostel). */
export function contactSaved<H extends { id: string }>(hostels: H[], id: string): H | null {
  return hostels.find((h) => h.id === id) ?? null;
}
