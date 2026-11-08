/**
 * Today offline: the last trip Lumiback showed this student, kept on the phone so Today can
 * still say "out, due back 10:00 PM" when the server can't be reached (no signal at the gate,
 * or the server waking). Read-only: nothing here is ever sent anywhere.
 *
 * Kept in SecureStore (today-cache-store.ts: encrypted, already a dependency, no native
 * change), like the other on-device state. It holds only what the offline card shows, and
 * belongs to one account: it is written only for a student's own Today, and cleared on every
 * sign-in and sign-out (see auth.tsx), so a stored copy can only be the stored session's. When
 * signed in, the account id must match as well. This file is pure, so it is unit-tested.
 */
import { istDay } from "@/lib/corrections";
import { dueLine } from "@/lib/running-late";
import { formatStamp, formatTime } from "@/lib/time";
import type { Outing, Role, ViewAsRole } from "@/lib/types";

/** SecureStore values are kept small (some platforms refused values over about 2 KB). */
export const MAX_CACHE_LENGTH = 2048;
/** Older than this, the trip is too stale to show. */
export const TODAY_CACHE_MAX_AGE_MS = 24 * 60 * 60_000;

/** The parts of the current outing the offline card shows (no ids, purpose or shares). */
export interface CachedOuting {
  destination: string | null;
  left_at: string;
  expected_return_at: string;
  original_return_at: string | null;
  out_via: "self" | "gate";
  /** Who to call: works without the server. */
  office: { hostel: string | null; phone: string | null } | null;
}

export interface TodayCache {
  v: 1;
  userId: string;
  /** When Today last loaded (ms since the epoch). */
  savedAt: number;
  /** Null: on campus (no trip open). */
  outing: CachedOuting | null;
}

export interface OfflineView {
  /** "Offline: as of 9:14 PM" (or with the day, when it wasn't today). */
  asOf: string;
  state: "out" | "late" | "in";
  outing: CachedOuting | null;
  /** "Due back 10:00 PM, was 9:30 PM"; null on campus. */
  due: string | null;
}

/** Only a student's own Today is kept: never staff, never a developer's View as preview. */
export function shouldCache(
  user: { role?: Role; viewing_as?: ViewAsRole | null } | null | undefined,
): boolean {
  return user?.role === "student" && !user.viewing_as;
}

/** The server couldn't give an answer: no connection (0) or a server error (5xx). */
export function unreachable(status: number): boolean {
  return status === 0 || status >= 500;
}

export function todaySnapshot(userId: string, outing: Outing | null, now: number): TodayCache {
  return {
    v: 1,
    userId,
    savedAt: now,
    outing: outing
      ? {
          destination: outing.destination,
          left_at: outing.left_at,
          expected_return_at: outing.expected_return_at,
          original_return_at: outing.original_return_at ?? null,
          out_via: outing.out_via,
          office: outing.office
            ? { hostel: outing.office.hostel, phone: outing.office.phone }
            : null,
        }
      : null,
  };
}

export function serializeTodayCache(cache: TodayCache): string {
  return JSON.stringify(cache);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function time(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= max ? value : null;
}

// A number to dial: an optional + and digits only (the server stores phones that way).
const PHONE = /^\+?\d{6,15}$/;

function cachedOuting(value: unknown): CachedOuting | null | undefined {
  if (value === null) return null;
  const o = record(value);
  if (!o) return undefined;
  const left = time(o.left_at);
  const due = time(o.expected_return_at);
  if (!left || !due) return undefined;
  if (o.out_via !== "self" && o.out_via !== "gate") return undefined;
  const office = record(o.office);
  const phone = office ? text(office.phone, 16) : null;
  return {
    destination: text(o.destination, 200),
    left_at: left,
    expected_return_at: due,
    original_return_at: time(o.original_return_at),
    out_via: o.out_via,
    office: office
      ? { hostel: text(office.hostel, 200), phone: phone && PHONE.test(phone) ? phone : null }
      : null,
  };
}

/** The stored copy, checked field by field; anything else is ignored (null). */
export function parseTodayCache(raw: string | null): TodayCache | null {
  if (!raw || raw.length > MAX_CACHE_LENGTH) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const all = record(parsed);
  if (!all || all.v !== 1) return null;
  if (typeof all.userId !== "string" || !all.userId || all.userId.length > 64) return null;
  if (typeof all.savedAt !== "number" || !Number.isFinite(all.savedAt)) return null;
  const outing = cachedOuting(all.outing);
  if (outing === undefined) return null;
  return { v: 1, userId: all.userId, savedAt: all.savedAt, outing };
}

/**
 * What Today shows offline, or null (nothing kept, another account, or too old). `userId` null:
 * offline at launch, before the account is known; the stored copy is then the stored
 * session's, since every sign-in and sign-out clears it.
 */
export function offlineView(
  cache: TodayCache | null,
  userId: string | null,
  now: number,
): OfflineView | null {
  if (!cache) return null;
  if (userId !== null && cache.userId !== userId) return null;
  if (now - cache.savedAt > TODAY_CACHE_MAX_AGE_MS) return null;
  const sameDay = istDay(cache.savedAt) === istDay(now);
  const asOf = `Offline: as of ${sameDay ? formatTime(new Date(cache.savedAt)) : formatStamp(new Date(cache.savedAt))}`;
  const o = cache.outing;
  if (!o) return { asOf, state: "in", outing: null, due: null };
  const late = now > Date.parse(o.expected_return_at);
  return {
    asOf,
    state: late ? "late" : "out",
    outing: o,
    due: dueLine(o.expected_return_at, o.original_return_at),
  };
}
