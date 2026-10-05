import "server-only";

/** Read once, fail loudly: a missing backend URL must never fall back to a default. */
function requireBackendUrl(): string {
  const raw = process.env.BACKEND_URL;
  if (!raw) {
    throw new Error("BACKEND_URL is not set. Copy .env.example to .env.local and set it.");
  }
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("BACKEND_URL must be an http(s) URL.");
  }
  return url.origin;
}

export const BACKEND_URL = requireBackendUrl();
export const IS_PRODUCTION = process.env.NODE_ENV === "production";
