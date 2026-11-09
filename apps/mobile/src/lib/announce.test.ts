import {
  ANNOUNCE_CONFIRM,
  ANNOUNCE_KINDS,
  AUDIENCE_ROLES,
  announceBody,
  announceConfirm,
  announceDraft,
  announceError,
  announceTiming,
  audienceLabel,
  BEST_TITLE,
  canAnnounce,
  historyAudience,
  KIND_LABEL,
  KIND_PATTERN,
  MAX_ANNOUNCE_BODY,
  MAX_ANNOUNCE_TITLE,
  reachedLine,
  titleGuidance,
} from "@/lib/announce";
import { CURRENT } from "@/updates/changelog";

describe("announceDraft", () => {
  test("is the release's title, summary and kind", () => {
    expect(
      announceDraft({ title: "Faster", summary: "It's quicker.", kind: "fix", points: ["A."] }),
    ).toEqual({ title: "Faster", body: "It's quicker.", kind: "fix" });
  });

  test("falls back to a short first point, leaves too-long text empty, and is a notice", () => {
    expect(announceDraft({ title: "Faster", points: ["Opens quicker."] })).toEqual({
      title: "Faster",
      body: "Opens quicker.",
      kind: "notice",
    });
    const long = { title: "t".repeat(51), summary: "s".repeat(141), points: ["p".repeat(141)] };
    expect(announceDraft(long)).toEqual({ title: "", body: "", kind: "notice" });
    expect(announceDraft({ title: "x", kind: "release", points: ["y"] }).kind).toBe("notice");
  });

  test("the current release can be announced as it is (add a summary up to 140)", () => {
    const draft = announceDraft(CURRENT);
    expect(announceBody(draft.title, draft.body).ok).toBe(true);
    expect(ANNOUNCE_KINDS).toContain(draft.kind);
  });
});

describe("wave 5: kind, audience, banner (same as the website)", () => {
  test("four kinds named as the v2 string table names them, with their title patterns", () => {
    expect(ANNOUNCE_KINDS).toEqual(["feature", "fix", "maintenance", "notice"]);
    expect(KIND_LABEL).toEqual({
      feature: "Release",
      fix: "Patch",
      maintenance: "Maintenance",
      notice: "Staff notice",
    });
    expect(KIND_PATTERN).toEqual({
      feature: "Now live: <feature>",
      fix: "Patch: <area>",
      maintenance: "Scheduled maintenance: <day>",
      notice: "<Subject> updated",
    });
  });

  test("the choices go with the text; a banner only on a feature launch", () => {
    expect(
      announceBody("Now live: Reports", "See your hostel's numbers.", {
        kind: "feature",
        audience: ["head_warden", "warden"],
        image: "lantern",
      }),
    ).toEqual({
      ok: true,
      body: {
        title: "Now live: Reports",
        body: "See your hostel's numbers.",
        kind: "feature",
        audience: ["warden", "head_warden"],
        image: "lantern",
      },
    });
    const fix = announceBody("Patch: sign-in", "Fixed.", {
      kind: "fix",
      audience: "everyone",
      image: "lantern",
    });
    expect(fix.ok && "image" in fix.body).toBe(false);
    expect(announceBody("T", "B", { kind: "notice", audience: [], image: null })).toEqual({
      ok: false,
      error: "Choose at least one role, or Everyone.",
    });
  });

  test("title guidance: best under 40, up to 50", () => {
    expect(BEST_TITLE).toBe(40);
    expect(titleGuidance("")).toBe("Best under 40 characters (up to 50).");
    expect(titleGuidance("x".repeat(12))).toBe("12 characters. Best under 40 (up to 50).");
    expect(titleGuidance("x".repeat(44))).toBe(
      "44 characters: over 40, so some phones may cut it short.",
    );
  });

  test("the audience in words, for the confirm step and the history", () => {
    expect(AUDIENCE_ROLES).toEqual(["student", "warden", "head_warden", "admin", "developer"]);
    expect(audienceLabel("everyone")).toBe("every phone with Lumiback");
    expect(audienceLabel(["head_warden", "warden"])).toBe("wardens and head wardens");
    expect(audienceLabel(["developer", "admin", "student"])).toBe(
      "students, admins and developers",
    );
    expect(announceConfirm(["student"])).toBe(
      "Send this to students? It goes out as soon as you send it.",
    );
    expect(historyAudience("everyone")).toBe("Everyone");
    expect(historyAudience(["warden", "head_warden"])).toBe("Wardens, head wardens");
  });
});

const fmt = (iso: string): string => `<${iso}>`;

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
  test("never announced", () => {
    expect(announceTiming({ last_at: null, next_at: null }, fmt)).toBe("No update announced yet.");
  });

  test("says only when the last one went out: no daily limit", () => {
    const last = "2026-11-08T09:00:00+05:30";
    expect(announceTiming({ last_at: last, next_at: null }, fmt)).toBe(`Last announced <${last}>.`);
    // An older API's next_at changes nothing.
    expect(announceTiming({ last_at: last, next_at: "2026-11-09T09:00:00+05:30" }, fmt)).toBe(
      `Last announced <${last}>.`,
    );
  });
});

test("reachedLine says how many phones it went to", () => {
  expect(reachedLine(1)).toBe("Sending to 1 phone.");
  expect(reachedLine(42)).toBe("Sending to 42 phones.");
  expect(reachedLine(0)).toBe("Announced, but no phones have the app to receive it.");
});

test("the server's refusals are shown as given", () => {
  const noPush = "Push notifications aren't set up on this server, so nothing was sent.";
  expect(announceError(503, noPush)).toBe(noPush);
  expect(announceError(403, "Developers only")).toBe("Developers only");
  expect(announceError(500, "")).toBe("Something went wrong. Try again.");
});

test("the confirm step asks before anything is sent", () => {
  expect(ANNOUNCE_CONFIRM).toBe(
    "Send this to every phone with Lumiback? It goes out as soon as you send it.",
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
