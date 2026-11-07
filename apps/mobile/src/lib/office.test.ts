import {
  accountLabel,
  campusToday,
  canEditRules,
  clock,
  dayLine,
  everyHostel,
  formatPhone,
  isAdmin,
  isDeveloper,
  isStaff,
  kioskLink,
  parseHolidayDate,
  passwordLinkCopy,
  ROLE_LABEL,
  scanDistance,
  scanQuery,
} from "@/lib/office";

describe("scanQuery", () => {
  it("asks for 30 a page and adds only the filters that are set", () => {
    expect(scanQuery({})).toBe("limit=30");
    expect(scanQuery({ before: 120, gateId: "g 1", result: "too_far" })).toBe(
      "limit=30&before=120&gate_id=g+1&result=too_far",
    );
    expect(scanQuery({ before: null, gateId: null, result: null })).toBe("limit=30");
  });
});

describe("scanDistance", () => {
  it("says how far from the gate, with the GPS accuracy when known", () => {
    const scan = { distance_m: 12.4, accuracy_m: 8.6 };
    expect(scanDistance(scan)).toBe("12 m from the gate (GPS ±9 m)");
    expect(scanDistance({ ...scan, accuracy_m: null })).toBe("12 m from the gate");
    expect(scanDistance({ distance_m: null, accuracy_m: 5 })).toBeNull();
  });
});

describe("campusToday", () => {
  it("is the date on the campus clock (IST), not the device's", () => {
    // 20:00 UTC on 31 Dec is already 1 Jan in India.
    expect(campusToday(new Date("2026-12-31T20:00:00Z"))).toBe("2027-01-01");
    expect(campusToday(new Date("2026-12-31T18:00:00Z"))).toBe("2026-12-31");
  });
});

describe("parseHolidayDate", () => {
  const today = "2026-11-05";

  it("reads day/month/year the way people in India write it, and ISO dates", () => {
    expect(parseHolidayDate("25/12/2026", today)).toEqual({ day: "2026-12-25" });
    expect(parseHolidayDate(" 1-1-2027 ", today)).toEqual({ day: "2027-01-01" });
    expect(parseHolidayDate("5.11.2026", today)).toEqual({ day: "2026-11-05" });
    expect(parseHolidayDate("2026-12-25", today)).toEqual({ day: "2026-12-25" });
  });

  it("refuses dates that don't exist, that have passed, or that aren't dates", () => {
    expect(parseHolidayDate("31/02/2027", today)).toHaveProperty("error");
    expect(parseHolidayDate("4/11/2026", today)).toEqual({
      error: "That date has passed. Pick today or a later date.",
    });
    expect(parseHolidayDate("", today)).toHaveProperty("error");
    expect(parseHolidayDate("Diwali", today)).toHaveProperty("error");
    expect(parseHolidayDate("25/12/26", today)).toHaveProperty("error");
    expect(parseHolidayDate("25/12/2101", today)).toHaveProperty("error");
  });
});

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

  it("counts a developer as staff (the dock, the office)", () => {
    expect(isStaff("developer")).toBe(true);
  });
});

describe("a developer has every admin power", () => {
  it("is an admin, looks after every hostel and edits the rules", () => {
    expect(isAdmin("developer")).toBe(true);
    expect(isAdmin("admin")).toBe(true);
    expect(isAdmin("head_warden")).toBe(false);
    expect(isAdmin("warden")).toBe(false);
    expect(isAdmin("student")).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
    expect(everyHostel("developer")).toBe(true);
    expect(canEditRules("developer")).toBe(true);
  });

  it("is the only role that may view as another role", () => {
    expect(isDeveloper("developer")).toBe(true);
    for (const role of ["admin", "head_warden", "warden", "student", undefined] as const) {
      expect(isDeveloper(role)).toBe(false);
    }
    expect(ROLE_LABEL.developer).toBe("Developer");
  });
});

describe("formatPhone", () => {
  it("groups Indian mobile numbers and leaves anything else as stored", () => {
    expect(formatPhone("+919876543210")).toBe("+91 98765 43210");
    expect(formatPhone("+441632960123")).toBe("+441632960123");
  });
});

describe("accountLabel", () => {
  it("says nothing for an account in use, and names the other states", () => {
    expect(accountLabel("active")).toBeNull();
    expect(accountLabel("invited")).toBe("Hasn't set up");
    expect(accountLabel("reset")).toBe("Password reset sent");
    expect(accountLabel("off")).toBe("Turned off");
  });
});

describe("passwordLinkCopy", () => {
  it("warns that an active account's password stops working now", () => {
    const { message } = passwordLinkCopy("active");
    expect(message).toBe(
      "Their current password stops working now and they're signed out everywhere. They get an email to choose a new one (valid 24 hours).",
    );
  });

  it("only resends the set-up link to an invited student, with its 7-day validity", () => {
    const { message } = passwordLinkCopy("invited");
    expect(message).toBe("Sends their set-up link again (valid 7 days).");
    expect(message).not.toMatch(/stops working now/);
  });

  it("replaces an earlier reset link, valid 24 hours", () => {
    const { message } = passwordLinkCopy("reset");
    expect(message).toMatch(/valid 24 hours/);
    expect(message).toMatch(/link sent before stops working/);
  });

  it("gives each state its own title", () => {
    const titles = new Set(
      (["active", "invited", "reset"] as const).map((a) => passwordLinkCopy(a).title),
    );
    expect(titles.size).toBe(3);
  });
});
