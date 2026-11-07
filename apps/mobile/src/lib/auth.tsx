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
import { AppState, Platform } from "react-native";

import { clearSafeReturn } from "@/gate/intent";
import { api, ApiError } from "@/lib/api";
import { deviceLabel } from "@/lib/devices";
import { clearTokens, onSignedOut, storedRefreshToken, storeTokens } from "@/lib/session";
import type { Registered, ShareSession, TokenPair, User, ViewAsRole } from "@/lib/types";
import { clearViewAs, loadViewAs, parseViewAsRole, useViewAs, viewingAs } from "@/lib/view-as";
import { sendingShareIds, stopSending } from "@/location/task";
import { syncPush, syncReturnReminders } from "@/notify/notify";
import { forgetPushToken, unregisterPush, watchPushToken } from "@/notify/push";

/** "offline": a session is stored but the launch check couldn't reach the server (no signal,
 * a 5xx or 429). The session is kept, nothing is stopped, and the app retries. */
type Status = "loading" | "signedOut" | "signedIn" | "offline";

/** While offline at launch, how often to try again on its own (also on returning to the app). */
const OFFLINE_RETRY_MS = 15_000;

// Android's Platform.Version is the API level (34); Release is the "14" people know.
const release: unknown = (Platform.constants as { Release?: unknown } | undefined)?.Release;
const THIS_DEVICE = deviceLabel({
  OS: Platform.OS,
  Version: Platform.Version,
  release: typeof release === "string" ? release : undefined,
});

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
  /** Offline at launch: try the stored session again. Resolves either way. */
  retry(): Promise<void>;
  /** Offline at launch: leave the kept session for the sign-in form (signIn forgets it). */
  switchAccount(): void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

/** Forget one student's local safety state: an armed safe-return intent, the share this phone
 * sends, and the "due back" reminders. Best effort; each step is idempotent. Resolves once the
 * location service has stopped. */
async function forgetStudentOnPhone(): Promise<void> {
  clearSafeReturn();
  void syncReturnReminders(null).catch(() => undefined);
  await stopSending().catch(() => undefined);
}

/**
 * Checks `/auth/me` against the role the app asked to view as. When the server didn't honour
 * it (no `viewing_as`, or another role), the app shows the developer's own view, so the stored
 * role is cleared and the banner never says otherwise. Returns the role `me` was loaded as.
 */
async function settleViewAs(as: ViewAsRole | null, me: User): Promise<ViewAsRole | null> {
  if (!as) return null;
  if (parseViewAsRole(me.viewing_as) === as) return as;
  await clearViewAs(as);
  return null;
}

/** Only the server refusing the session ends it, as in refresh(): not a 5xx or 429. */
function refusedSession(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  // Kept in memory between "create account" and "enter the code" only, so the student is signed
  // in after verifying without typing the password again. Never written anywhere.
  const pendingPassword = useRef<{ email: string; password: string } | null>(null);
  // Developer View as: which role `user` was loaded as (null: the developer's own), and the
  // load under way, so a View as change and a screen asking at once share one request.
  const loadedFor = useRef<ViewAsRole | null>(null);
  const userLoad = useRef<{ as: ViewAsRole | null; run: Promise<void> } | null>(null);

  const loadUser = useCallback(async () => {
    const as = await loadViewAs();
    const running = userLoad.current;
    if (running && running.as === as) return running.run;
    const run = (async () => {
      const me = await api<User>("/auth/me");
      // View as changed while this was loading: the load for the new role sets the user.
      if (viewingAs() !== as) return;
      loadedFor.current = await settleViewAs(as, me);
      setUser(me);
      setStatus("signedIn");
      void syncPush(); // skipped while viewing as a role (push.ts)
    })();
    userLoad.current = { as, run };
    try {
      await run;
    } finally {
      if (userLoad.current?.run === run) userLoad.current = null;
    }
  }, []);

  // The latest status for callbacks that outlive a render (a retry still in flight).
  const statusRef = useRef<Status>("loading");
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  /** The launch check of a stored session, and its retries while offline. */
  const checkStored = useCallback(async () => {
    // Only while launching or offline: a sign-in or "use another account" since then wins.
    const stillChecking = (): boolean =>
      statusRef.current === "loading" || statusRef.current === "offline";
    try {
      const as = await loadViewAs();
      const me = await api<User>("/auth/me");
      if (!stillChecking()) return;
      loadedFor.current = await settleViewAs(as, me);
      setUser(me);
      setStatus("signedIn");
      void syncPush();
    } catch (error) {
      if (!stillChecking()) return;
      // A refusal ends the session. Offline, rate-limited or a server error keeps it, as
      // refresh() does: the student stays signed in (a safe-return share keeps sending) and
      // the app shows "Can't reach Lumiback" and tries again.
      if (refusedSession(error)) {
        await clearTokens();
        setStatus("signedOut");
      } else {
        setStatus("offline");
      }
    }
  }, []);

  useEffect(() => (status === "signedIn" ? watchPushToken() : undefined), [status]);

  // View as chosen, stopped, or ended by the server ("developers only"): load the role the app
  // now shows. A flow that already asked (refreshUser) shares that request.
  const viewAsRole = useViewAs();
  useEffect(() => {
    if (statusRef.current !== "signedIn" || loadedFor.current === viewAsRole) return;
    void loadUser().catch(() => undefined);
  }, [viewAsRole, loadUser]);

  useEffect(() => {
    const off = onSignedOut(() => {
      void clearViewAs(); // nobody views as a role once signed out
      setUser(null);
      setStatus("signedOut");
      // Also when the server ended the session (a refused refresh): nothing of this student
      // stays on the phone for the next one to sign in, best effort.
      void forgetStudentOnPhone();
    });
    void (async () => {
      if (!(await storedRefreshToken())) {
        // The session may have ended while no screen was open (the location task got the
        // refusal), so this listener never ran: clean up before anyone signs in.
        await forgetStudentOnPhone();
        return setStatus("signedOut");
      }
      await checkStored();
    })();
    return off;
  }, [checkStored]);

  const retry = useCallback(async () => {
    if (statusRef.current === "offline") await checkStored();
  }, [checkStored]);

  const switchAccount = useCallback(() => {
    if (statusRef.current !== "offline") return;
    statusRef.current = "signedOut"; // a retry still in flight no longer applies
    setStatus("signedOut");
  }, []);

  // Offline at launch: try again every so often and whenever the student comes back to the app.
  useEffect(() => {
    if (status !== "offline") return;
    const timer = setInterval(() => void retry(), OFFLINE_RETRY_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void retry();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [status, retry]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const tokens = await api<TokenPair>("/auth/login", {
        method: "POST",
        auth: false,
        // Names this phone in the signed-in devices list ("Lumiback app on Android 14").
        body: { email: email.trim().toLowerCase(), password, device: THIS_DEVICE },
      });
      // A session kept through a server error at launch (see above) may be another student's:
      // forget its local state and end it on the server before this one takes its place.
      const kept = await storedRefreshToken();
      if (kept) {
        // Waits for the location service, so no queued fix of theirs goes out with our tokens.
        await forgetStudentOnPhone();
        await api("/auth/logout", {
          method: "POST",
          auth: false,
          body: { refresh_token: kept },
        }).catch(() => undefined);
      }
      await clearViewAs(); // a new sign-in starts as itself
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
    // First, so everything below (the push token, shares, the logout call) goes out without the
    // read-only View as header.
    await clearViewAs();
    clearSafeReturn();
    // A share must not keep sending this phone's location (or keep its stored session) after
    // the student signs out. Best effort: a failure here never keeps them signed in.
    // Read before stopSending clears them.
    const sending = await sendingShareIds().catch((): string[] => []);
    await stopSending().catch(() => undefined);
    await syncReturnReminders(null).catch(() => undefined); // no "you're due back" for them
    // End a share started from this app on the server too (while still signed in), or viewers
    // keep seeing the last position. After the service stops, so the loop never reports it as
    // "ended elsewhere". A safe-return share stays: ending it would also cancel the contact's
    // overdue email while the student is still out (the website leaves it running as well).
    for (const id of sending) {
      const share = await api<ShareSession>(`/sessions/${id}`).catch(() => null);
      if (share?.source === "app") {
        await api(`/sessions/${id}/stop`, { method: "POST", body: {} }).catch(() => undefined);
      }
    }
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
    // The server refuses (409) while the student is out or has an open escalation: then nothing
    // here may stop, so the safe-return share and the "due back" reminders keep going.
    await api("/auth/delete-account", { method: "POST", body: { password } });
    clearSafeReturn();
    // Deleted: stop sending location and drop the stored share (best effort, as on sign-out).
    await stopSending().catch(() => undefined);
    await syncReturnReminders(null).catch(() => undefined);
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
      retry,
      switchAccount,
    }),
    [
      status,
      user,
      signIn,
      register,
      verify,
      resend,
      signOut,
      deleteAccount,
      loadUser,
      retry,
      switchAccount,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
