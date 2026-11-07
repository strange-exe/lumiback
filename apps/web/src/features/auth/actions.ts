"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { isDeviceId, signedOutNotice } from "@/features/account/devices";
import { changePasswordProblem, passwordChangedNotice } from "@/features/account/password";
import { isLinkToken } from "@/features/auth/link-token";
import { shareApi } from "@/features/share/api";
import { ApiError, callBackend, visitorIp } from "@/lib/backend";
import { accessToken, clearTokens, refreshToken, storeTokens, viewingAs } from "@/lib/session";
import type { FormState, PasswordLinkInfo, TokenPair } from "@/lib/types";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function failure(error: unknown, fields?: Record<string, string>): FormState {
  if (error instanceof ApiError) return { error: error.detail, fields };
  throw error; // unexpected: let the error boundary handle it
}

/**
 * The browser's User-Agent, for /auth/login to name this sign-in ("Chrome on Windows") in the
 * signed-in devices list. The backend keeps only that name, never the raw string.
 */
async function browserAgent(): Promise<string | undefined> {
  const agent = (await headers()).get("user-agent")?.trim();
  return agent ? agent.slice(0, 512) : undefined;
}

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  const email = text(form, "email").toLowerCase();
  const password = form.get("password");
  if (!email || typeof password !== "string" || !password) {
    return { error: "Enter your university email and password.", fields: { email } };
  }
  let tokens: TokenPair;
  try {
    tokens = await callBackend<TokenPair>("/auth/login", {
      method: "POST",
      body: { email, password, user_agent: await browserAgent() },
      clientIp: await visitorIp(),
    });
  } catch (error) {
    // 403 is either "Email not verified" (send them to enter their code) or an account the
    // hostel office turned off, whose message is shown as the backend wrote it.
    if (
      error instanceof ApiError &&
      error.status === 403 &&
      error.detail === "Email not verified"
    ) {
      redirect(`/verify?email=${encodeURIComponent(email)}`);
    }
    return failure(error, { email });
  }
  await storeTokens(tokens);
  redirect("/home");
}

export async function register(_: FormState, form: FormData): Promise<FormState> {
  const fields = {
    name: text(form, "name"),
    email: text(form, "email").toLowerCase(),
    roll_no: text(form, "roll_no"),
  };
  try {
    await callBackend("/auth/register", {
      method: "POST",
      body: { ...fields, password: form.get("password"), roll_no: fields.roll_no || null },
      clientIp: await visitorIp(),
    });
  } catch (error) {
    return failure(error, fields);
  }
  const { email } = fields;
  redirect(`/verify?email=${encodeURIComponent(email)}`);
}

export async function verifyEmail(_: FormState, form: FormData): Promise<FormState> {
  const email = text(form, "email").toLowerCase();
  const code = text(form, "code").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { error: "Enter the 6-digit code from your email." };
  try {
    await callBackend("/auth/verify-email", {
      method: "POST",
      body: { email, code },
      clientIp: await visitorIp(),
    });
  } catch (error) {
    return failure(error);
  }
  redirect(`/sign-in?verified=${encodeURIComponent(email)}`);
}

export async function resendCode(_: FormState, form: FormData): Promise<FormState> {
  try {
    await callBackend("/auth/resend-verification", {
      method: "POST",
      body: { email: text(form, "email").toLowerCase() },
      clientIp: await visitorIp(),
    });
  } catch (error) {
    return failure(error);
  }
  return { error: null, notice: "If that account needs it, a new code is on its way." };
}

export async function signOut(): Promise<void> {
  const access = await accessToken();
  // While viewing as another role the API refuses every change, so this would only fail.
  if (access && !(await viewingAs())) {
    // Signing out of the device you're sharing from ends the share: nobody is left to stop it.
    // Not a safe-return share: it belongs to the outing (the app may be sending it) and ends
    // when the student is back.
    const live = await shareApi.activeTabShare(access).catch(() => null);
    if (live?.source === "tab_live") {
      await callBackend(`/sessions/${live.id}/stop`, { method: "POST", token: access }).catch(
        () => undefined,
      );
    }
  }
  const token = await refreshToken();
  if (token) {
    // Revoke on the server too; a failure here must not keep the student signed in locally.
    await callBackend("/auth/logout", { method: "POST", body: { refresh_token: token } }).catch(
      () => undefined,
    );
  }
  await clearTokens();
  redirect("/");
}

/**
 * Permanently delete the signed-in account. The backend checks the password again (a session
 * left open on a shared laptop isn't enough) and erases everything tied to the account.
 */
export async function deleteAccount(_: FormState, form: FormData): Promise<FormState> {
  const fields = { confirm: text(form, "confirm") };
  if (fields.confirm.toLowerCase() !== "delete") {
    return { error: 'Type "delete" to confirm.', fields };
  }
  const password = form.get("password");
  if (typeof password !== "string" || !password) return { error: "Enter your password.", fields };
  const token = await accessToken();
  if (!token) redirect("/sign-in");
  try {
    await callBackend("/auth/delete-account", { method: "POST", token, body: { password } });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect("/sign-in");
    return failure(error, fields);
  }
  await clearTokens();
  redirect("/sign-in?deleted=1");
}

// ---------- signed-in devices (a lost phone) ----------

/** A device action's result failed: a lost session goes to sign in, the rest is shown. */
function deviceFailure(error: unknown): FormState {
  if (error instanceof ApiError && error.status === 401) redirect("/sign-in");
  return failure(error);
}

/** Signs one other device out at once: its sign-in stops working on its next request. */
export async function signOutDevice(_: FormState, form: FormData): Promise<FormState> {
  const id = form.get("device_id");
  if (!isDeviceId(id)) return { error: "That device couldn't be found. Reload the page." };
  // Only for the message, shown to this same person as text.
  const name = text(form, "device_name").slice(0, 80) || "that device";
  const token = await accessToken();
  if (!token) redirect("/sign-in");
  try {
    await callBackend(`/auth/devices/${id}`, { method: "DELETE", token });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      revalidatePath("/account"); // already gone (signed out elsewhere): refresh the list
      return { error: null, notice: `${name} was already signed out.` };
    }
    return deviceFailure(error);
  }
  revalidatePath("/account");
  return { error: null, notice: `Signed out of ${name}.` };
}

/** Every device except this one. 409: this device signed in before devices were named. */
export async function signOutOtherDevices(_: FormState): Promise<FormState> {
  const token = await accessToken();
  if (!token) redirect("/sign-in");
  let count: number;
  try {
    ({ signed_out: count } = await callBackend<{ signed_out: number }>(
      "/auth/devices/sign-out-others",
      { method: "POST", token },
    ));
  } catch (error) {
    return deviceFailure(error);
  }
  revalidatePath("/account");
  return { error: null, notice: signedOutNotice(count) };
}

// ---------- changing the password while signed in ----------

/**
 * A new password, knowing the current one. The backend signs out every other device and keeps
 * this one, unless this sign-in is from before devices had ids (`still_signed_in: false`): then
 * it was revoked too, so the cookies go and the person signs in again with the new password.
 * Its 403 (wrong current password), 422 (a weak new one) and 429 messages are shown as written.
 * Passwords are never handed back to the form.
 */
export async function changePassword(_: FormState, form: FormData): Promise<FormState> {
  const current = form.get("current_password");
  const password = form.get("password");
  const problem = changePasswordProblem(current, password, form.get("confirm"));
  if (problem) return { error: problem };
  const token = await accessToken();
  if (!token) redirect("/sign-in");
  let result: { signed_out: number; still_signed_in: boolean };
  try {
    result = await callBackend("/auth/change-password", {
      method: "POST",
      token,
      body: { current_password: current, password },
      clientIp: await visitorIp(),
    });
  } catch (error) {
    return deviceFailure(error);
  }
  if (!result.still_signed_in) {
    await clearTokens();
    redirect("/sign-in?changed=1");
  }
  revalidatePath("/account");
  return { error: null, notice: passwordChangedNotice(result.signed_out) };
}

/** Forgot password, step 1: the API answers the same whether or not the account exists. */
export async function requestPasswordReset(_: FormState, form: FormData): Promise<FormState> {
  const email = text(form, "email").toLowerCase();
  if (!email.includes("@")) return { error: "Enter your university email.", fields: { email } };
  try {
    await sendResetCode(email);
  } catch (error) {
    return failure(error, { email });
  }
  redirect(`/forgot-password?sent=1&email=${encodeURIComponent(email)}`);
}

/** "Send a new code" on step 2: stays on the page and says what happened. */
export async function resendPasswordReset(_: FormState, form: FormData): Promise<FormState> {
  const email = text(form, "email").toLowerCase();
  if (!email.includes("@")) return { error: "Start again with your university email." };
  try {
    await sendResetCode(email);
  } catch (error) {
    return failure(error);
  }
  return { error: null, notice: "If that account exists, a new code is on its way." };
}

async function sendResetCode(email: string): Promise<void> {
  await callBackend("/auth/forgot-password", {
    method: "POST",
    body: { email },
    clientIp: await visitorIp(),
  });
}

/** Step 2: the emailed code sets a new password (signing out every device), then sign in here. */
export async function resetPassword(_: FormState, form: FormData): Promise<FormState> {
  const email = text(form, "email").toLowerCase();
  const code = text(form, "code").replace(/\s/g, "");
  const password = form.get("password");
  if (!/^\d{6}$/.test(code)) return { error: "Enter the 6-digit code from your email." };
  if (typeof password !== "string" || !password) return { error: "Choose a new password." };
  const clientIp = await visitorIp();
  try {
    await callBackend("/auth/reset-password", {
      method: "POST",
      body: { email, code, password },
      clientIp,
    });
  } catch (error) {
    return failure(error);
  }
  let tokens: TokenPair;
  try {
    tokens = await callBackend<TokenPair>("/auth/login", {
      method: "POST",
      body: { email, password, user_agent: await browserAgent() },
      clientIp,
    });
  } catch {
    // The password is changed; if signing in fails right now, let them do it by hand.
    redirect(`/sign-in?reset=${encodeURIComponent(email)}`);
  }
  await storeTokens(tokens);
  redirect("/home");
}

// ---------- set-password links (imported students, or sent by an admin) ----------

const LINK_GONE = "This link has expired or was already used.";

/** Whose link this is, so the page can greet them. `gone`: the link doesn't work any more. */
export type LinkLookup = { info: PasswordLinkInfo } | { error: string; gone: boolean };

/**
 * The page reads the token from the URL fragment and passes it here; it travels only in
 * request bodies (Server Action, then the backend's POST), never in a URL.
 */
export async function lookUpPasswordLink(token: string): Promise<LinkLookup> {
  if (!isLinkToken(token)) return { error: LINK_GONE, gone: true };
  try {
    const info = await callBackend<PasswordLinkInfo>("/auth/password-link", {
      method: "POST",
      body: { token },
      clientIp: await visitorIp(),
    });
    return { info: { name: info.name, email: info.email, invite: info.invite } };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 422) return { error: LINK_GONE, gone: true }; // malformed token
      return { error: error.detail, gone: error.status === 404 };
    }
    throw error;
  }
}

export interface SetPasswordState extends FormState {
  /** Set once the password is saved: the account's email, to sign in with. */
  email?: string | null;
  /** The link expired or was used meanwhile. */
  gone?: boolean;
}

export async function setPasswordWithLink(
  _: SetPasswordState,
  form: FormData,
): Promise<SetPasswordState> {
  const token = form.get("token");
  const password = form.get("password");
  const confirm = form.get("confirm");
  if (!isLinkToken(token)) return { error: LINK_GONE, gone: true };
  if (typeof password !== "string" || !password) return { error: "Choose a password." };
  if (password !== confirm) return { error: "The two passwords don't match. Type them again." };
  try {
    const done = await callBackend<{ email: string }>("/auth/set-password", {
      method: "POST",
      body: { token, password },
      clientIp: await visitorIp(),
    });
    return { error: null, email: done.email };
  } catch (error) {
    if (error instanceof ApiError) {
      return { error: error.detail, gone: error.status === 404 };
    }
    throw error;
  }
}
