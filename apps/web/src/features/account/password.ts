/**
 * Changing a password while signed in: pure helpers (no React, no server), shared by the form
 * (checked before anything is sent), the Server Action (checked again) and their unit tests.
 */

/** The backend's limit on a new password (it bounds the hashing cost of each request). */
export const MAX_PASSWORD_LENGTH = 128;

/** The same strength hint as the set-password and reset pages. */
export const NEW_PASSWORD_HINT = "At least 10 characters. Avoid your name or email.";

export const PASSWORDS_DIFFER = "The two new passwords don't match. Type them again.";

/**
 * What's wrong with the form before it's sent, or null. Only what can be known here: the
 * strength rules (length, common, breached, same as now) are the backend's, and it says why.
 */
export function changePasswordProblem(
  current: unknown,
  password: unknown,
  confirm: unknown,
): string | null {
  if (typeof current !== "string" || !current) return "Enter your current password.";
  if (typeof password !== "string" || !password) return "Choose a new password.";
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters`;
  }
  if (password !== confirm) return PASSWORDS_DIFFER;
  return null;
}

/** The success message: how many other devices the change signed out. */
export function passwordChangedNotice(signedOut: number): string {
  if (signedOut <= 0) return "Password changed. No other devices were signed in.";
  return signedOut === 1
    ? "Password changed. Signed out of 1 other device."
    : `Password changed. Signed out of ${signedOut} other devices.`;
}
