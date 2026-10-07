/**
 * The API's public address, baked in at build time from EXPO_PUBLIC_API_URL (see .env.example
 * and eas.json). Fail loudly: a missing URL must never fall back to a default.
 * Parsed by hand: React Native's URL implementation lacks parts of the web API.
 */
const ORIGIN = /^(https?):\/\/([^/:?#]+)(:\d+)?\/?$/;
const LOCAL = /^(localhost|127\.|10\.|192\.168\.)/;

function requireApiUrl(): string {
  const raw = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (!raw) throw new Error("EXPO_PUBLIC_API_URL is not set. Copy .env.example to .env.");
  const match = ORIGIN.exec(raw);
  if (!match) throw new Error("EXPO_PUBLIC_API_URL must look like https://api.example.com");
  const [, scheme, host = ""] = match;
  if (scheme !== "https" && !LOCAL.test(host)) {
    throw new Error("EXPO_PUBLIC_API_URL must use https outside a local network.");
  }
  return raw.replace(/\/$/, "");
}

export const API_URL = requireApiUrl();
export const WS_URL = `${API_URL.replace(/^http/, "ws")}/ws`;

/** The public web app: privacy notice, and the join page invite links open for viewers. */
export const WEB_URL = "https://lumiback.abhinesh.codes";
