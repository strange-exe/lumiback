import "server-only";

import type { IpTrust } from "@/lib/client-ip";

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

/** Where the visitor's IP comes from (see client-ip.ts). Both unset in local development. */
function requireIpTrust(): IpTrust {
  const header = process.env.CLIENT_IP_HEADER?.trim().toLowerCase() || null;
  const edgeSecret = process.env.EDGE_SECRET || null;
  if (header && !edgeSecret) {
    throw new Error("CLIENT_IP_HEADER needs EDGE_SECRET, or anyone could fake their IP.");
  }
  return { header, edgeSecret };
}

export const IP_TRUST = requireIpTrust();
/** Shared with the API so it can trust the visitor IP we forward. */
export const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || null;
