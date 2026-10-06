import "server-only";

import { NextResponse } from "next/server";

import { ApiError } from "@/lib/backend";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * Route Handlers have no built-in CSRF check (Server Actions do), so state-changing handlers
 * call this. Browsers send Sec-Fetch-Site on every request and Origin on every POST/PUT,
 * including navigator.sendBeacon; a cross-site page can set neither.
 */
export function isSameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (origin === null) return site === "same-origin";
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

/** Relay a backend error to the page with the same status and a safe message. */
export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ detail: error.detail }, { status: error.status });
  }
  throw error;
}

/** A fresh response each time: a Response body can only be sent once. */
export function plainError(status: 401 | 403 | 404 | 422, detail: string): NextResponse {
  return NextResponse.json({ detail }, { status });
}
