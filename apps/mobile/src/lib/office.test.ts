import { formatPhone, isStaff, officeStart } from "@/lib/office";

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
