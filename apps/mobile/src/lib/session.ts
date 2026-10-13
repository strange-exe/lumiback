import * as SecureStore from "expo-secure-store";

import { API_URL } from "@/lib/config";
import type { TokenPair } from "@/lib/types";

/**
 * Tokens. The refresh token lives in the Android Keystore (expo-secure-store); the short-lived
 * access token only in memory. No biometric gate on the stored token: the background location
 * task must be able to read it with the screen locked.
 */
const REFRESH_KEY = "lumiback.refresh";
const EARLY_MS = 60_000; // refresh a minute before the access token expires

let access: { token: string; expiresAt: number } | null = null;
let inFlight: Promise<string | null> | null = null;
const signedOutListeners = new Set<() => void>();

export function onSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener);
  return () => signedOutListeners.delete(listener);
}

export async function storeTokens(tokens: TokenPair): Promise<void> {
  access = {
    token: tokens.access_token,
    expiresAt: Date.now() + tokens.expires_in * 1000 - EARLY_MS,
  };
  await SecureStore.setItemAsync(REFRESH_KEY, tokens.refresh_token);
}

export async function clearTokens(): Promise<void> {
  access = null;
  await SecureStore.deleteItemAsync(REFRESH_KEY);
  signedOutListeners.forEach((listener) => listener());
}

export async function storedRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_KEY);
}

/**
 * The server couldn't be asked (offline, or it's down for a moment). Not the same as being signed
 * out: the refresh token is kept, and callers treat this like any other network failure.
 */
export class SessionUnavailable extends Error {
  constructor() {
    super("Couldn't reach Lumiback to renew the sign-in.");
  }
}

/** A valid access token, refreshing if needed; null when signed out. Throws SessionUnavailable. */
export async function accessToken(): Promise<string | null> {
  if (access && access.expiresAt > Date.now()) return access.token;
  return refresh();
}

/**
 * Exactly one refresh at a time. The backend rotates refresh tokens and treats a reused one as
 * theft (it revokes the whole login), so two screens refreshing at once must share one request.
 * Resolves to null only when the backend refused the token (or there is none); offline or server
 * trouble rejects with SessionUnavailable, keeping the token for the next try.
 */
export function refresh(): Promise<string | null> {
  inFlight ??= (async () => {
    try {
      const token = await storedRefreshToken();
      if (!token) return null;
      let response: Response;
      try {
        response = await fetch(`${API_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ refresh_token: token }),
        });
      } catch {
        throw new SessionUnavailable(); // offline: keep everything, the next call retries
      }
      if (response.status === 401) {
        await clearTokens(); // revoked, expired, or reused: sign in again
        return null;
      }
      // Server trouble (5xx, rate limited): keep the refresh token, try again later.
      if (!response.ok) throw new SessionUnavailable();
      const tokens = (await response.json()) as TokenPair;
      await storeTokens(tokens);
      return tokens.access_token;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
