"use server";

import { redirect } from "next/navigation";

import { ApiError, callBackend } from "@/lib/backend";
import { isUuid } from "@/lib/route";
import { accessToken } from "@/lib/session";
import type { JoinCode, ShareSession } from "@/lib/types";

/** What the share screen gets back: fresh data, or a message it can show as is. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const DURATIONS = new Set([60, 120, 240]); // tab shares last at most 4 h (backend enforces too)

async function call<T>(path: string, body?: unknown): Promise<Result<T>> {
  const token = await accessToken();
  if (!token) redirect("/sign-in");
  try {
    return { ok: true, data: await callBackend<T>(path, { method: "POST", token, body }) };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) redirect("/sign-in");
      return { ok: false, error: error.detail };
    }
    throw error;
  }
}

function badId(...ids: string[]): Result<never> | null {
  return ids.every(isUuid) ? null : { ok: false, error: "That share no longer exists." };
}

export async function startShare(minutes: number): Promise<Result<ShareSession>> {
  if (!DURATIONS.has(minutes)) return { ok: false, error: "Choose how long to share." };
  return call<ShareSession>("/sessions", { source: "tab_live", duration_minutes: minutes });
}

export async function createJoinCode(sessionId: string): Promise<Result<JoinCode>> {
  return badId(sessionId) ?? call<JoinCode>(`/sessions/${sessionId}/codes`);
}

export async function approveViewer(
  sessionId: string,
  viewerId: string,
): Promise<Result<ShareSession>> {
  return (
    badId(sessionId, viewerId) ??
    call<ShareSession>(`/sessions/${sessionId}/viewers/${viewerId}/approve`)
  );
}

/** Declining a request and removing someone who is watching are the same: revoke. */
export async function removeViewer(
  sessionId: string,
  viewerId: string,
): Promise<Result<ShareSession>> {
  return (
    badId(sessionId, viewerId) ??
    call<ShareSession>(`/sessions/${sessionId}/viewers/${viewerId}/revoke`)
  );
}

export async function stopShare(sessionId: string): Promise<Result<ShareSession>> {
  return badId(sessionId) ?? call<ShareSession>(`/sessions/${sessionId}/stop`);
}
