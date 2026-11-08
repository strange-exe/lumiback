import {
  MAX_CACHE_LENGTH,
  offlineView,
  parseTodayCache,
  serializeTodayCache,
  shouldCache,
  todaySnapshot,
  TODAY_CACHE_MAX_AGE_MS,
  unreachable,
  type TodayCache,
} from "@/lib/today-cache";
import type { Outing } from "@/lib/types";

const ME = "11111111-1111-4111-8111-111111111111";
const SOMEONE_ELSE = "22222222-2222-4222-8222-222222222222";

const SAVED = Date.parse("2026-11-08T20:14:00+05:30");
const MINUTE = 60_000;

const outing: Outing = {
  id: "33333333-3333-4333-8333-333333333333",
  destination: "Rajpur Road",
  purpose: "Dinner",
  left_at: "2026-11-08T18:02:00+05:30",
  expected_return_at: "2026-11-08T22:00:00+05:30",
  original_return_at: "2026-11-08T21:30:00+05:30",
  returned_at: null,
  status: "out",
  late_minutes: 0,
  duration_minutes: null,
  out_via: "gate",
  in_via: null,
  late_reply: null,
  safe_return_session_id: "44444444-4444-4444-8444-444444444444",
  correction: null,
  office: { hostel: "Kailash", name: "Mr Rawat", phone: "+919876543210" },
  running_late_choices: [],
};

describe("shouldCache", () => {
  test("only a student's own Today is kept", () => {
    expect(shouldCache({ role: "student", viewing_as: null })).toBe(true);
    expect(shouldCache({ role: "student" })).toBe(true);
    expect(shouldCache({ role: "warden" })).toBe(false);
    expect(shouldCache({ role: "admin" })).toBe(false);
    expect(shouldCache(null)).toBe(false);
  });

  test("never a developer's preview of the student view", () => {
    expect(shouldCache({ role: "student", viewing_as: "student" })).toBe(false);
  });
});

describe("todaySnapshot", () => {
  test("keeps only what the offline card shows", () => {
    const cache = todaySnapshot(ME, outing, SAVED);
    expect(cache).toEqual({
      v: 1,
      userId: ME,
      savedAt: SAVED,
      outing: {
        destination: "Rajpur Road",
        left_at: outing.left_at,
        expected_return_at: outing.expected_return_at,
        original_return_at: outing.original_return_at,
        out_via: "gate",
        office: { hostel: "Kailash", phone: "+919876543210" },
      },
    });
    // No ids, purpose, share or correction details are written to the phone.
    const text = serializeTodayCache(cache);
    expect(text).not.toContain(outing.id);
    expect(text).not.toContain("Dinner");
    expect(text).not.toContain("44444444");
  });

  test("on campus is kept too, as no trip", () => {
    expect(todaySnapshot(ME, null, SAVED).outing).toBeNull();
  });

  test("a trip without an office contact keeps none", () => {
    const cache = todaySnapshot(ME, { ...outing, office: null }, SAVED);
    expect(cache.outing?.office).toBeNull();
  });
});

describe("parseTodayCache", () => {
  test("reads back what was written", () => {
    const cache = todaySnapshot(ME, outing, SAVED);
    expect(parseTodayCache(serializeTodayCache(cache))).toEqual(cache);
    const home = todaySnapshot(ME, null, SAVED);
    expect(parseTodayCache(serializeTodayCache(home))).toEqual(home);
  });

  test("anything malformed, too long or from another version is ignored", () => {
    expect(parseTodayCache(null)).toBeNull();
    expect(parseTodayCache("")).toBeNull();
    expect(parseTodayCache("{not json")).toBeNull();
    expect(
      parseTodayCache(JSON.stringify({ v: 2, userId: ME, savedAt: SAVED, outing: null })),
    ).toBeNull();
    expect(
      parseTodayCache(JSON.stringify({ v: 1, userId: "", savedAt: SAVED, outing: null })),
    ).toBeNull();
    expect(
      parseTodayCache(JSON.stringify({ v: 1, userId: ME, savedAt: "x", outing: null })),
    ).toBeNull();
    const bad = { ...todaySnapshot(ME, outing, SAVED) } as unknown as { outing: object };
    bad.outing = { ...bad.outing, expected_return_at: "not a time" };
    expect(parseTodayCache(JSON.stringify(bad))).toBeNull();
    expect(parseTodayCache("x".repeat(MAX_CACHE_LENGTH + 1))).toBeNull();
  });

  test("a stored phone that isn't a phone number is dropped, not offered to call", () => {
    const cache = todaySnapshot(ME, outing, SAVED) as TodayCache;
    const tampered = JSON.parse(serializeTodayCache(cache)) as {
      outing: { office: { phone: string } };
    };
    tampered.outing.office.phone = "javascript:alert(1)";
    expect(parseTodayCache(JSON.stringify(tampered))?.outing?.office?.phone).toBeNull();
  });
});

describe("offlineView", () => {
  const cache = todaySnapshot(ME, outing, SAVED);

  test("the same account sees its last trip, marked with when it was saved", () => {
    const view = offlineView(cache, ME, SAVED + 5 * MINUTE);
    expect(view).toEqual({
      asOf: "Offline: as of 8:14 PM",
      state: "out",
      outing: cache.outing,
      due: "Due back 10:00 PM, was 9:30 PM",
    });
  });

  test("past the due time it reads late, from the phone's clock", () => {
    const view = offlineView(cache, ME, Date.parse("2026-11-08T22:05:00+05:30"));
    expect(view?.state).toBe("late");
  });

  test("on campus is shown as on campus", () => {
    const view = offlineView(todaySnapshot(ME, null, SAVED), ME, SAVED + MINUTE);
    expect(view).toEqual({
      asOf: "Offline: as of 8:14 PM",
      state: "in",
      outing: null,
      due: null,
    });
  });

  test("another account never sees it", () => {
    expect(offlineView(cache, SOMEONE_ELSE, SAVED + MINUTE)).toBeNull();
  });

  test("offline at launch (no account known yet) shows the stored session's trip", () => {
    // The cache is cleared on every sign-in and sign-out, so it can only be this session's.
    expect(offlineView(cache, null, SAVED + MINUTE)?.state).toBe("out");
  });

  test("a saved day other than today names the day", () => {
    const view = offlineView(cache, ME, Date.parse("2026-11-09T07:00:00+05:30"));
    expect(view?.asOf).toBe("Offline: as of Sun 8 Nov, 8:14 PM");
  });

  test("older than a day is too stale to show", () => {
    expect(offlineView(cache, ME, SAVED + TODAY_CACHE_MAX_AGE_MS)).not.toBeNull();
    expect(offlineView(cache, ME, SAVED + TODAY_CACHE_MAX_AGE_MS + 1)).toBeNull();
    expect(TODAY_CACHE_MAX_AGE_MS).toBe(24 * 60 * MINUTE);
  });

  test("nothing saved, nothing shown", () => {
    expect(offlineView(null, ME, SAVED)).toBeNull();
  });
});

test("unreachable: no connection or a server error, not a refusal", () => {
  expect(unreachable(0)).toBe(true);
  expect(unreachable(502)).toBe(true);
  expect(unreachable(503)).toBe(true);
  expect(unreachable(500)).toBe(true);
  expect(unreachable(401)).toBe(false);
  expect(unreachable(403)).toBe(false);
  expect(unreachable(404)).toBe(false);
  expect(unreachable(429)).toBe(false);
});
