import { SCAN_RESULT_LABEL } from "@/lib/office";
import { parseOfficeFilters } from "@/lib/office-filters";
import { correctionLines, lateTodayRow, recordPath } from "@/lib/record";
import type { Correction } from "@/lib/types";

const ID = "5f0c2a1e-0000-4000-8000-000000000001";

const base: Correction = {
  id: "c1",
  kind: "return_time",
  status: "approved",
  returned_at: "2026-11-01T20:40:00+05:30",
  reason: "Scanned in late",
  by_staff: false,
  old_returned_at: "2026-11-01T22:05:00+05:30",
  note: null,
  created_at: "2026-11-02T09:00:00+05:30",
};

describe("lateTodayRow (the office's Late today list)", () => {
  const fmt = (iso: string): string => `<${iso.slice(11, 16)}>`;
  const late = {
    expected_return_at: "2026-11-08T22:00:00+05:30",
    returned_at: null,
    late_minutes: 25,
  };

  test("still out: how late, and not back yet", () => {
    expect(lateTodayRow(late, fmt)).toEqual({
      chip: "25 min late",
      back: false,
      detail: "due <22:00>, not back yet",
    });
  });

  test("back late: when they came in", () => {
    expect(
      lateTodayRow({ ...late, returned_at: "2026-11-08T23:10:00+05:30", late_minutes: 70 }, fmt),
    ).toEqual({ chip: "1 h 10 min late", back: true, detail: "due <22:00>, back <23:10>" });
  });
});

test("history pages ask for a page at a time, older ones by cursor", () => {
  expect(recordPath(ID, "outings")).toBe(`/admin/students/${ID}/outings?limit=20`);
  expect(recordPath(ID, "scans", 120)).toBe(`/admin/students/${ID}/scans?limit=20&before=120`);
  expect(recordPath(ID, "requests", "2026-11-01T20:15:00+05:30")).toBe(
    `/admin/students/${ID}/requests?limit=20&before=2026-11-01T20%3A15%3A00%2B05%3A30`,
  );
  expect(recordPath(ID, "outings", null)).toBe(`/admin/students/${ID}/outings?limit=20`);
  // An id is always one path segment.
  expect(recordPath("../users", "outings")).toBe("/admin/students/..%2Fusers/outings?limit=20");
});

test("a scan refused by the outing rules has words, and can be the remembered filter", () => {
  expect(SCAN_RESULT_LABEL.not_allowed).toBe("Outside the outing rules");
  const saved = parseOfficeFilters(
    JSON.stringify({ scans: { gate: "all", result: "not_allowed" } }),
  );
  expect(saved.scans.result).toBe("not_allowed");
});

test("corrections read in the office's words", () => {
  const line = correctionLines(base);
  expect(line.title).toMatch(/^Student asked: Came back /);
  expect(line.detail).toBe("Applied · Reason: Scanned in late");
  expect(
    correctionLines({ ...base, kind: "cancel", returned_at: null, by_staff: true }).title,
  ).toBe("Office: The trip didn't happen");
  expect(correctionLines({ ...base, status: "declined", note: "Gate log disagrees" }).detail).toBe(
    "Declined · Reason: Scanned in late · Office note: Gate log disagrees",
  );
});
