/**
 * Change password while signed in: the pure rules behind profile/password.tsx. Backend:
 * `change_password` in backend/app/api/auth.py (POST /auth/change-password).
 */
import { ApiError } from "@/lib/api";

/** The backend refuses longer passwords (ChangePasswordIn.password, MAX_LENGTH). */
export const MAX_PASSWORD = 128;

const FALLBACK = "Couldn't change your password. Try again.";

export interface PasswordForm {
  current: string;
  password: string;
  again: string;
}

/**
 * What stops the form being sent, or null when it can go. Only what the phone can know: the
 * server judges strength (too short, too common, breached, same as now) and says why.
 * Passwords are compared exactly, never trimmed, as the backend never alters them either.
 */
export function formProblem({ current, password, again }: PasswordForm): string | null {
  if (!current) return "Enter your current password.";
  if (!password) return "Choose a new password.";
  if (password.length > MAX_PASSWORD) {
    return `Password must be ${MAX_PASSWORD} characters or fewer.`;
  }
  if (!again) return "Type the new password again.";
  if (password !== again) return "The new passwords don't match.";
  return null;
}

/** After a change: how many other devices were signed out. */
export function changedMessage(signedOut: number): string {
  if (signedOut <= 0) return "Password changed. No other devices were signed in.";
  return signedOut === 1
    ? "Password changed. Signed out of 1 other device."
    : `Password changed. Signed out of ${signedOut} other devices.`;
}

/**
 * What to say when the change fails. 403 (wrong current password), 422 (the new one is too
 * short, too common, breached, or the same) and 429 (rate limited) carry the backend's own
 * sentence, as do offline (status 0) and a lost session (401). A server fault or anything that
 * isn't an API error gets the fallback.
 */
export function changeError(error: unknown): string {
  if (!(error instanceof ApiError) || error.status >= 500) return FALLBACK;
  return error.detail || FALLBACK;
}
