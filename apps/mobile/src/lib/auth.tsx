import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { api, ApiError } from "@/lib/api";
import { clearTokens, onSignedOut, storedRefreshToken, storeTokens } from "@/lib/session";
import type { Registered, TokenPair, User } from "@/lib/types";
import { syncPush } from "@/notify/notify";
import { forgetPushToken, unregisterPush, watchPushToken } from "@/notify/push";

type Status = "loading" | "signedOut" | "signedIn";

interface SignUp {
  name: string;
  email: string;
  password: string;
  rollNo: string;
}

interface AuthValue {
  status: Status;
  user: User | null;
  signIn(email: string, password: string): Promise<void>;
  /** Starts a sign-up; the account exists only after verify(). */
  register(details: SignUp): Promise<Registered>;
  /** Checks the emailed code and creates the account; true if it could also sign straight in. */
  verify(email: string, code: string): Promise<boolean>;
  resend(email: string): Promise<void>;
  signOut(): Promise<void>;
  deleteAccount(password: string): Promise<void>;
  refreshUser(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  // Kept in memory between "create account" and "enter the code" only, so the student is signed
  // in after verifying without typing the password again. Never written anywhere.
  const pendingPassword = useRef<{ email: string; password: string } | null>(null);

  const loadUser = useCallback(async () => {
    const me = await api<User>("/auth/me");
    setUser(me);
    setStatus("signedIn");
    void syncPush();
  }, []);

  useEffect(() => (status === "signedIn" ? watchPushToken() : undefined), [status]);

  useEffect(() => {
    const off = onSignedOut(() => {
      setUser(null);
      setStatus("signedOut");
    });
    void (async () => {
      if (!(await storedRefreshToken())) return setStatus("signedOut");
      try {
        await loadUser();
      } catch (error) {
        // Offline at launch: stay signed out on screen; the token is kept for the next try.
        if (!(error instanceof ApiError) || error.status !== 0) await clearTokens();
        setStatus("signedOut");
      }
    })();
    return off;
  }, [loadUser]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const tokens = await api<TokenPair>("/auth/login", {
        method: "POST",
        auth: false,
        body: { email: email.trim().toLowerCase(), password },
      });
      await storeTokens(tokens);
      await loadUser();
    },
    [loadUser],
  );

  const register = useCallback(async (details: SignUp) => {
    const email = details.email.trim().toLowerCase();
    const result = await api<Registered>("/auth/register", {
      method: "POST",
      auth: false,
      body: {
        name: details.name.trim(),
        email,
        password: details.password,
        roll_no: details.rollNo.trim() || null,
      },
    });
    pendingPassword.current = { email, password: details.password };
    return result ?? { email, code_expires_in_minutes: 15 };
  }, []);

  const verify = useCallback(
    async (email: string, code: string) => {
      const normalized = email.trim().toLowerCase();
      await api<User>("/auth/verify-email", {
        method: "POST",
        auth: false,
        body: { email: normalized, code: code.replace(/\s/g, "") },
      });
      const pending = pendingPassword.current;
      pendingPassword.current = null;
      if (!pending || pending.email !== normalized) return false;
      await signIn(normalized, pending.password);
      return true;
    },
    [signIn],
  );

  const resend = useCallback(async (email: string) => {
    await api("/auth/resend-verification", {
      method: "POST",
      auth: false,
      body: { email: email.trim().toLowerCase() },
    });
  }, []);

  const signOut = useCallback(async () => {
    await unregisterPush(); // while still signed in: the server checks who owns the token
    const token = await storedRefreshToken();
    if (token) {
      // Revoke on the server too; a failure must not keep the student signed in here.
      await api("/auth/logout", {
        method: "POST",
        auth: false,
        body: { refresh_token: token },
      }).catch(() => undefined);
    }
    await clearTokens();
  }, []);

  const deleteAccount = useCallback(async (password: string) => {
    await api("/auth/delete-account", { method: "POST", body: { password } });
    await forgetPushToken();
    await clearTokens();
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      user,
      signIn,
      register,
      verify,
      resend,
      signOut,
      deleteAccount,
      refreshUser: loadUser,
    }),
    [status, user, signIn, register, verify, resend, signOut, deleteAccount, loadUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
