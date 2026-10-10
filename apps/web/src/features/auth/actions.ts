"use server";

import { redirect } from "next/navigation";

import { shareApi } from "@/features/share/api";
import { ApiError, callBackend, visitorIp } from "@/lib/backend";
import { accessToken, clearTokens, refreshToken, storeTokens } from "@/lib/session";
import type { FormState, TokenPair } from "@/lib/types";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function failure(error: unknown, fields?: Record<string, string>): FormState {
  if (error instanceof ApiError) return { error: error.detail, fields };
  throw error; // unexpected: let the error boundary handle it
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
      body: { email, password },
      clientIp: await visitorIp(),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
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
  if (access) {
    // Signing out of the device you're sharing from ends the share: nobody is left to stop it.
    const live = await shareApi.activeTabShare(access).catch(() => null);
    if (live) {
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
      body: { email, password },
      clientIp,
    });
  } catch {
    // The password is changed; if signing in fails right now, let them do it by hand.
    redirect(`/sign-in?reset=${encodeURIComponent(email)}`);
  }
  await storeTokens(tokens);
  redirect("/home");
}
