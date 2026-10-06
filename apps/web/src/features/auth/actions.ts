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

function failure(error: unknown): FormState {
  if (error instanceof ApiError) return { error: error.detail };
  throw error; // unexpected: let the error boundary handle it
}

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  const email = text(form, "email").toLowerCase();
  const password = form.get("password");
  if (!email || typeof password !== "string" || !password) {
    return { error: "Enter your university email and password." };
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
    return failure(error);
  }
  await storeTokens(tokens);
  redirect("/home");
}

export async function register(_: FormState, form: FormData): Promise<FormState> {
  const email = text(form, "email").toLowerCase();
  try {
    await callBackend("/auth/register", {
      method: "POST",
      body: {
        name: text(form, "name"),
        email,
        password: form.get("password"),
        roll_no: text(form, "roll_no") || null,
        hostel: text(form, "hostel") || null,
      },
      clientIp: await visitorIp(),
    });
  } catch (error) {
    return failure(error);
  }
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
  redirect(`/?verified=${encodeURIComponent(email)}`);
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
