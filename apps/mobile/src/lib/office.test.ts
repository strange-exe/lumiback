import { clock, dayLine, formatPhone, isStaff, kioskLink, officeStart } from "@/lib/office";

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
  it("is wardens and admins, never students or an older server without roles", () => {
    expect(isStaff("warden")).toBe(true);
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

describe("officeStart", () => {
  it("opens an unanswered late student first, then requests, then who's out", () => {
    expect(officeStart({ open_escalations: 1, pending_requests: 3 })).toBe("escalations");
    expect(officeStart({ open_escalations: 0, pending_requests: 3 })).toBe("requests");
    expect(officeStart({})).toBe("out");
  });
});
