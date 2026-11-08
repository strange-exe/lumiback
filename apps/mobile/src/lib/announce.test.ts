import {
  ANNOUNCE_CONFIRM,
  announceBody,
  announceError,
  announceTiming,
  canAnnounce,
  MAX_ANNOUNCE_BODY,
  MAX_ANNOUNCE_TITLE,
  reachedLine,
} from "@/lib/announce";

const fmt = (iso: string): string => `<${iso}>`;
const NOW = Date.parse("2026-11-08T20:00:00+05:30");

describe("announceBody", () => {
  test("trims and sends a title and one line", () => {
    expect(announceBody("  Version 1.18.0  ", " Running late and Today offline. ")).toEqual({
      ok: true,
      body: { title: "Version 1.18.0", body: "Running late and Today offline." },
    });
  });

  test("both are needed", () => {
    expect(announceBody("  ", "Line")).toEqual({ ok: false, error: "Add a title." });
    expect(announceBody("Title", " ")).toEqual({
      ok: false,
      error: "Add a line about the update.",
    });
  });

  test("one line of plain text each", () => {
    expect(announceBody("Two\nlines", "Line")).toEqual({
      ok: false,
      error: "Write the title as one line of plain text.",
    });
    const hidden = "Line" + String.fromCodePoint(0x202e) + "evil";
    expect(announceBody("Title", hidden)).toEqual({
      ok: false,
      error: "Write the line as one line of plain text.",
    });
    expect(announceBody("Title", "a" + String.fromCodePoint(0x2028) + "b").ok).toBe(false);
  });

  test("joiners that Indic words need are allowed", () => {
    // Devanagari "ksha" spelled with a virama and a zero-width joiner.
    const word = String.fromCodePoint(0x0915, 0x094d, 0x200d, 0x0937);
    expect(announceBody(word, word).ok).toBe(true);
  });

  test("50 characters of title and 140 of line, counted as characters", () => {
    expect(MAX_ANNOUNCE_TITLE).toBe(50);
    expect(MAX_ANNOUNCE_BODY).toBe(140);
    expect(announceBody("t".repeat(50), "b".repeat(140)).ok).toBe(true);
    expect(announceBody("t".repeat(51), "b")).toEqual({
      ok: false,
      error: "Keep the title to 50 characters.",
    });
    expect(announceBody("t", "b".repeat(141))).toEqual({
      ok: false,
      error: "Keep the line to 140 characters.",
    });
    // An emoji is one character, as the server counts it.
    const smile = String.fromCodePoint(0x1f600);
    expect(announceBody(smile.repeat(50), "b").ok).toBe(true);
  });
});

describe("announceTiming", () => {
  test("never announced: allowed now", () => {
    expect(announceTiming({ last_at: null, next_at: null }, NOW, fmt)).toEqual({
      last: "No update announced yet.",
      next: "You can announce now.",
      allowed: true,
    });
  });

  test("announced in the last day: says when the next is allowed", () => {
    const next = "2026-11-09T09:00:00+05:30";
    expect(
      announceTiming({ last_at: "2026-11-08T09:00:00+05:30", next_at: next }, NOW, fmt),
    ).toEqual({
      last: "Last announced <2026-11-08T09:00:00+05:30>.",
      next: `You can announce again after <${next}>.`,
      allowed: false,
    });
  });

  test("a next time already passed, or unreadable, allows it", () => {
    const past = { last_at: "2026-11-07T09:00:00+05:30", next_at: "2026-11-08T09:00:00+05:30" };
    expect(announceTiming(past, NOW, fmt).allowed).toBe(true);
    expect(announceTiming({ last_at: null, next_at: "soon" }, NOW, fmt).allowed).toBe(true);
  });
});

test("reachedLine says how many phones it went to", () => {
  expect(reachedLine(1)).toBe("Sending to 1 phone.");
  expect(reachedLine(42)).toBe("Sending to 42 phones.");
  expect(reachedLine(0)).toBe("Announced, but no phones have the app to receive it.");
});

test("the server's refusals are shown as given", () => {
  const once =
    "An update was already announced in the last 24 hours. You can announce again after 9:00 AM.";
  expect(announceError(409, once)).toBe(once);
  expect(announceError(403, "Developers only")).toBe("Developers only");
  expect(announceError(500, "")).toBe("Something went wrong. Try again.");
});

test("the confirm step asks before anything is sent", () => {
  expect(ANNOUNCE_CONFIRM).toBe(
    "Send this to every phone with Lumiback? You can announce once a day.",
  );
});

describe("canAnnounce", () => {
  test("a developer as themselves", () => {
    expect(canAnnounce({ role: "developer", viewing_as: null })).toBe(true);
  });

  test("nobody else, and not while viewing as another role", () => {
    expect(canAnnounce({ role: "developer", viewing_as: "student" })).toBe(false);
    expect(canAnnounce({ role: "student", viewing_as: "student" })).toBe(false);
    for (const role of ["admin", "head_warden", "warden", "student"] as const) {
      expect(canAnnounce({ role, viewing_as: null })).toBe(false);
    }
    expect(canAnnounce(null)).toBe(false);
  });
});
