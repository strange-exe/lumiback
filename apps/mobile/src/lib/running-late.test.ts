import {
  confirmLine,
  dueLine,
  lateChoices,
  lateReason,
  MAX_LATE_REASON,
  movedDue,
  officeLateNote,
  runningLateBody,
  runningLateError,
} from "@/lib/running-late";

const DUE = "2026-11-08T21:30:00+05:30";

describe("lateChoices", () => {
  test("keeps only 15, 30 and 60, in order, without repeats", () => {
    expect(lateChoices([60, 15, 30])).toEqual([15, 30, 60]);
    expect(lateChoices([30, 30, 45, 0, -15, 90])).toEqual([30]);
  });

  test("nothing offered (or an older server without the field) shows no control", () => {
    expect(lateChoices([])).toEqual([]);
    expect(lateChoices(undefined)).toEqual([]);
    expect(lateChoices(null)).toEqual([]);
  });
});

describe("lateReason", () => {
  test("blank is null, the rest is trimmed", () => {
    expect(lateReason("")).toEqual({ ok: true, value: null });
    expect(lateReason("   ")).toEqual({ ok: true, value: null });
    expect(lateReason("  Bus is stuck in traffic  ")).toEqual({
      ok: true,
      value: "Bus is stuck in traffic",
    });
  });

  test("at most 120 characters, counting what the student sees", () => {
    expect(MAX_LATE_REASON).toBe(120);
    expect(lateReason("a".repeat(120))).toEqual({ ok: true, value: "a".repeat(120) });
    const tooLong = lateReason("a".repeat(121));
    expect(tooLong.ok).toBe(false);
    // An emoji is one character to the student, two UTF-16 units to JavaScript.
    const smile = String.fromCodePoint(0x1f600);
    expect(lateReason(smile.repeat(120)).ok).toBe(true);
  });

  test("line breaks, control and invisible characters are refused", () => {
    for (const bad of [
      "Bus\nlate",
      "Bus\tlate",
      `Bus${String.fromCodePoint(0x200b)}late`, // zero-width space
      `Bus${String.fromCodePoint(0x202e)}late`, // right-to-left override
      `Bus${String.fromCodePoint(0x2028)}late`, // line separator
      `Bus${String.fromCodePoint(0x7f)}late`,
    ]) {
      const result = lateReason(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("Write the reason as one line of plain text.");
    }
  });

  test("the joiners Indic scripts need are allowed", () => {
    const word = `${String.fromCodePoint(0x915, 0x94d, 0x200d, 0x937)}`;
    expect(lateReason(word)).toEqual({ ok: true, value: word });
  });
});

describe("runningLateBody", () => {
  test("sends the minutes and the cleaned reason, null when blank", () => {
    expect(runningLateBody(30, "  Missed the bus ")).toEqual({
      body: { minutes: 30, reason: "Missed the bus" },
    });
    expect(runningLateBody(15, "")).toEqual({ body: { minutes: 15, reason: null } });
  });

  test("an invalid reason is not sent", () => {
    expect(runningLateBody(60, "a".repeat(121))).toEqual({
      error: "Keep the reason to 120 characters.",
    });
  });
});

test("movedDue adds the minutes to the due time", () => {
  expect(Date.parse(movedDue(DUE, 30))).toBe(Date.parse("2026-11-08T22:00:00+05:30"));
  expect(Date.parse(movedDue(DUE, 60))).toBe(Date.parse("2026-11-08T22:30:00+05:30"));
});

describe("dueLine", () => {
  test("the new time, and the original once it moved", () => {
    expect(dueLine("2026-11-08T22:00:00+05:30", DUE)).toBe("Due back 10:00 PM, was 9:30 PM");
  });

  test("just the time when it never moved", () => {
    expect(dueLine(DUE, null)).toBe("Due back 9:30 PM");
    expect(dueLine(DUE, undefined)).toBe("Due back 9:30 PM");
  });

  test("nothing without a due time", () => {
    expect(dueLine(null, DUE)).toBeNull();
    expect(dueLine(undefined, null)).toBeNull();
  });
});

test("the confirm step states the new time and that it's once per outing", () => {
  expect(confirmLine(DUE, 30)).toBe(
    "You'll be due back at 10:00 PM instead of 9:30 PM. You can only do this once per outing.",
  );
});

test("refusals: the server's words, except a plain line when not out", () => {
  expect(runningLateError(409, "That time has already passed. Choose a longer time.")).toBe(
    "That time has already passed. Choose a longer time.",
  );
  expect(runningLateError(403, "Read-only while viewing as another role")).toBe(
    "Read-only while viewing as another role",
  );
  expect(runningLateError(404, "You are not on an outing")).toBe(
    "You're not out right now, so there's nothing to move. Pull down to refresh.",
  );
});

describe("officeLateNote", () => {
  const fmt = (iso: string): string => `<${iso}>`;

  test("says how much more and the original time, with the reason", () => {
    expect(
      officeLateNote(
        {
          original_return_at: DUE,
          running_late_minutes: 30,
          running_late_reason: "Bus broke down",
        },
        fmt,
      ),
    ).toEqual({ moved: `Running late: 30 min more, was due <${DUE}>`, reason: "Bus broke down" });
  });

  test("no reason, or no minutes from an older server", () => {
    expect(officeLateNote({ original_return_at: DUE, running_late_reason: "" }, fmt)).toEqual({
      moved: `Running late: was due <${DUE}>`,
      reason: null,
    });
  });

  test("nothing when running late wasn't used", () => {
    expect(officeLateNote({ original_return_at: null }, fmt)).toBeNull();
    expect(officeLateNote({}, fmt)).toBeNull();
  });
});
