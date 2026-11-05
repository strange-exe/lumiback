import "server-only";

import { accessFromStatus, type Access, type Credential } from "@/features/watch/access";
import { ApiError, callBackend, visitorIp } from "@/lib/backend";

/**
 * What one credential may do on one share. Exactly one credential per call: the backend prefers
 * a bearer token over X-Guest-Token when both are sent, so mixing them would test the wrong one.
 */
export async function probeWatchAccess(sessionId: string, credential: Credential): Promise<Access> {
  try {
    // The visitor's IP, so the backend's per-IP limits count this caller, not the web server.
    const clientIp = await visitorIp();
    await callBackend<unknown>(
      `/sessions/${encodeURIComponent(sessionId)}`,
      credential.kind === "user"
        ? { token: credential.token, clientIp }
        : { guestToken: credential.token, clientIp },
    );
    return "granted";
  } catch (error) {
    return accessFromStatus(error instanceof ApiError ? error.status : null);
  }
}
