import {
  canAsk,
  clockText,
  correctionAsk,
  correctionStatus,
  dayChoices,
  dayText,
  isCancelled,
  istDay,
  istInstant,
  istMinutes,
  parseClock,
  reasonError,
  returnAt,
  timeKind,
} from "@/lib/corrections";
import type { Correction } from "@/lib/types";

const DAY = 86_400_000;

function correction(over: Partial<Correction> = {}): Correction {
  return {
    id: "c1",
    kind: "return",
    status: "pending",
    returned_at: "2026-11-04T19:40:00+05:30",
    reason: "Forgot to tap in",
    by_staff: false,
    old_returned_at: null,
    note: null,
    created_at: "2026-11-05T09:00:00+05:30",
    ...over,
  };
}

describe("IST times", () => {
  it("reads the campus clock from any instant, whatever the offset it was written in", () => {
    // 18:45 UTC on 4 Nov is 00:15 on 5 Nov in India.
    expect(istDay("2026-11-04T18:45:00Z")).toBe("2026-11-05");
    expect(istMinutes("2026-11-04T18:45:00Z")).toBe(15);
    expect(clockText("2026-11-04T18:45:00Z")).toBe("12:15 am");
    expect(clockText("2026-11-04T19:40:00+05:30")).toBe("7:40 pm");
    expect(clockText("2026-11-04T12:05:00+05:30")).toBe("12:05 pm");
  });

  it("never depends on the device timezone", () => {
    const before = process.env.TZ;
    try {
      for (const tz of ["America/Los_Angeles", "Pacific/Kiritimati", "UTC"]) {
        process.env.TZ = tz;
        expect(istDay("2026-11-04T18:45:00Z")).toBe("2026-11-05");
        expect(clockText("2026-11-04T18:45:00Z")).toBe("12:15 am");
        expect(dayText("2026-11-05")).toBe("Thu 5 Nov");
      }
    } finally {
      process.env.TZ = before;
    }
  });

  it("parses the ways people type a time", () => {
    expect(parseClock("7:40 pm")).toBe(19 * 60 + 40);
    expect(parseClock("7.40PM")).toBe(19 * 60 + 40);
    expect(parseClock(" 7 pm ")).toBe(19 * 60);
    expect(parseClock("7:40 p.m.")).toBe(19 * 60 + 40);
    expect(parseClock("12:15 am")).toBe(15);
    expect(parseClock("12:15 pm")).toBe(12 * 60 + 15);
    expect(parseClock("19:40")).toBe(19 * 60 + 40);
    expect(parseClock("00:05")).toBe(5);
  });

  it("refuses times it can't be sure of", () => {
    for (const bad of ["", "7", "25:00", "7:60 pm", "13:00 pm", "0 am", "seven", "7:4 pm"]) {
      expect(parseClock(bad)).toBeNull();
    }
  });

  it("writes the instant with the +05:30 offset, and round-trips", () => {
    const iso = istInstant("2026-11-04", 19 * 60 + 40);
    expect(iso).toBe("2026-11-04T19:40:00+05:30");
    expect(new Date(iso).toISOString()).toBe("2026-11-04T14:10:00.000Z");
    expect(istInstant("2026-11-05", 5)).toBe("2026-11-05T00:05:00+05:30");
    expect(clockText(iso)).toBe("7:40 pm");
  });
});

describe("dayChoices", () => {
  const now = Date.parse("2026-11-06T10:00:00+05:30");

  it("runs from the day they left to today, oldest first", () => {
    expect(dayChoices("2026-11-04T18:00:00+05:30", now)).toEqual([
      { value: "2026-11-04", label: "Wed 4 Nov" },
      { value: "2026-11-05", label: "Yesterday" },
      { value: "2026-11-06", label: "Today" },
    ]);
  });

  it("is just today for an outing that started today", () => {
    expect(dayChoices("2026-11-06T08:00:00+05:30", now)).toEqual([
      { value: "2026-11-06", label: "Today" },
    ]);
  });

  it("uses the IST day at the edges of midnight", () => {
    // 23:30 IST on 5 Nov is still 5 Nov; 00:15 IST on 6 Nov is today.
    expect(dayChoices("2026-11-05T18:00:00Z", now).map((d) => d.value)).toEqual([
      "2026-11-05",
      "2026-11-06",
    ]);
    expect(dayChoices("2026-11-05T18:45:00Z", now).map((d) => d.label)).toEqual(["Today"]);
  });

  it("offers at most eight days", () => {
    expect(dayChoices("2026-10-01T10:00:00+05:30", now)).toHaveLength(8);
  });
});

describe("returnAt", () => {
  const left = "2026-11-04T18:10:30+05:30";
  const now = Date.parse("2026-11-06T10:00:00+05:30");

  it("builds the instant from the chosen day and time", () => {
    expect(returnAt("2026-11-04", "9:30 pm", left, now)).toEqual({
      iso: "2026-11-04T21:30:00+05:30",
    });
    expect(returnAt("2026-11-05", "00:20", left, now)).toEqual({
      iso: "2026-11-05T00:20:00+05:30",
    });
  });

  it("refuses a time before they left, after now, or unreadable", () => {
    expect(returnAt("2026-11-04", "6:10 pm", left, now)).toEqual({
      error: "That's before the outing started (Wed 4 Nov, 6:10 pm). Choose a later time.",
    });
    expect(returnAt("2026-11-06", "10:01 am", left, now)).toEqual({
      error: "That time hasn't come yet. Choose a time up to now.",
    });
    expect(returnAt("2026-11-04", "late", left, now)).toEqual({
      error: "Type the time like 7:40 pm.",
    });
  });
});

describe("reasonError", () => {
  it("matches the server's 3 to 300 characters", () => {
    expect(reasonError("  ok ")).toBe("Say briefly what happened.");
    expect(reasonError("Forgot")).toBeNull();
    expect(reasonError("x".repeat(300))).toBeNull();
    expect(reasonError("x".repeat(301))).toBe("Keep the reason under 300 characters.");
  });
});

describe("canAsk", () => {
  const now = Date.parse("2026-11-12T10:00:00+05:30");

  it("allows an open outing, and one that ended in the last 7 days", () => {
    expect(canAsk({ returned_at: null, correction: null }, now)).toBe(true);
    expect(canAsk({ returned_at: new Date(now - 7 * DAY).toISOString() }, now)).toBe(true);
  });

  it("refuses older outings", () => {
    expect(canAsk({ returned_at: new Date(now - 7 * DAY - 60_000).toISOString() }, now)).toBe(
      false,
    );
  });

  it("refuses while an ask is waiting, and once the trip is cancelled", () => {
    const recent = new Date(now - DAY).toISOString();
    expect(canAsk({ returned_at: recent, correction: correction() }, now)).toBe(false);
    expect(canAsk({ returned_at: null, correction: correction() }, now)).toBe(false);
    expect(
      canAsk(
        { returned_at: recent, correction: correction({ kind: "cancel", status: "approved" }) },
        now,
      ),
    ).toBe(false);
  });

  it("allows asking again after an answer", () => {
    const recent = new Date(now - DAY).toISOString();
    for (const status of ["approved", "declined", "cancelled"] as const) {
      expect(canAsk({ returned_at: recent, correction: correction({ status }) }, now)).toBe(true);
    }
  });
});

describe("labels", () => {
  it("picks the time correction for open and closed outings", () => {
    expect(timeKind({ returned_at: null })).toBe("return");
    expect(timeKind({ returned_at: "2026-11-04T19:40:00+05:30" })).toBe("return_time");
  });

  it("knows a cancelled trip only once the office approved it", () => {
    expect(isCancelled({ correction: correction({ kind: "cancel", status: "approved" }) })).toBe(
      true,
    );
    expect(isCancelled({ correction: correction({ kind: "cancel" }) })).toBe(false);
    expect(isCancelled({ correction: null })).toBe(false);
  });

  it("says where a correction stands, never by colour alone", () => {
    expect(correctionStatus(null)).toBeNull();
    expect(correctionStatus(correction())).toEqual({
      label: "Correction asked",
      tone: "accent",
      detail: "Waiting for the hostel office.",
    });
    expect(correctionStatus(correction({ status: "approved" }))).toMatchObject({
      label: "Corrected by the office",
      detail: "Your correction was approved.",
    });
    expect(
      correctionStatus(correction({ status: "approved", by_staff: true, reason: "Warden saw" })),
    ).toMatchObject({ label: "Corrected by the office", detail: "Warden saw" });
    expect(
      correctionStatus(correction({ status: "declined", note: "Gate log says 11 pm" })),
    ).toEqual({ label: "Correction declined", tone: "danger", detail: "Gate log says 11 pm" });
    expect(correctionStatus(correction({ status: "declined" }))?.detail).toBe(
      "Ask the hostel office if you have questions.",
    );
    expect(correctionStatus(correction({ status: "cancelled" }))).toBeNull();
  });

  it("puts the ask in one line", () => {
    expect(correctionAsk(correction())).toBe("Came back Wed 4 Nov, 7:40 pm");
    expect(correctionAsk(correction({ kind: "cancel", returned_at: null }))).toBe(
      "The trip didn't happen",
    );
  });
});
