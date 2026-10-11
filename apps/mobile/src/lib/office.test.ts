import { canEditRules, clock, dayLine, formatPhone, isStaff, kioskLink } from "@/lib/office";

describe("canEditRules", () => {
  it("is admins and head wardens; wardens only read the rules", () => {
    expect(canEditRules("admin")).toBe(true);
    expect(canEditRules("head_warden")).toBe(true);
    expect(canEditRules("warden")).toBe(false);
    expect(canEditRules("student")).toBe(false);
  });
});

describe("dayLine", () => {
  it("says a day's rules the way the website does", () => {
    const base = { day_type: "sunday" as const, opens_at: "10:00", return_by: "20:00" };
    expect(dayLine({ ...base, needs_form: true, max_minutes: 180, no_form_from: "18:00" })).toBe(
      "10:00 AM–8:00 PM · needs approval · up to 3 h · no form needed from 6:00 PM",
    );
    expect(dayLine({ ...base, needs_form: false, max_minutes: null, no_form_from: null })).toBe(
      "10:00 AM–8:00 PM · no form needed",
    );
    expect(dayLine({ ...base, needs_form: true, max_minutes: 90, no_form_from: null })).toBe(
      "10:00 AM–8:00 PM · needs approval · up to 1.5 h",
    );
  });

  it("reads midnight and noon right", () => {
    expect(clock("00:05")).toBe("12:05 AM");
    expect(clock("12:00")).toBe("12:00 PM");
  });
});

describe("kioskLink", () => {
  it("keeps the token in the fragment", () => {
    expect(kioskLink("https://lumiback.test", "abc")).toBe("https://lumiback.test/kiosk#k=abc");
  });
});

describe("isStaff", () => {
  it("is wardens, head wardens and admins, never students or an older server without roles", () => {
    expect(isStaff("warden")).toBe(true);
    expect(isStaff("head_warden")).toBe(true);
    expect(isStaff("admin")).toBe(true);
    expect(isStaff("student")).toBe(false);
    expect(isStaff(undefined)).toBe(false);
  });
});

describe("formatPhone", () => {
  it("groups Indian mobile numbers and leaves anything else as stored", () => {
    expect(formatPhone("+919876543210")).toBe("+91 98765 43210");
    expect(formatPhone("+441632960123")).toBe("+441632960123");
  });
});
