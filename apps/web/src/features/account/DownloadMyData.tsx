"use client";

import { DownloadSimple } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";

type State =
  { kind: "idle" } | { kind: "working" } | { kind: "done" } | { kind: "error"; message: string };

const FALLBACK = "We couldn't get your data just now. Try again in a minute.";

/** The file name the server chose, so the saved file matches what the app saves. */
function fileNameOf(response: Response): string {
  const match = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "");
  return match?.[1] ?? "lumiback-data.json";
}

async function errorOf(response: Response): Promise<string> {
  if (response.status === 401) return "You've been signed out. Sign in again to download.";
  if (response.status === 429)
    return "You've downloaded a few times already. Try again in an hour.";
  const payload = (await response.json().catch(() => null)) as { detail?: unknown } | null;
  return typeof payload?.detail === "string" ? payload.detail : FALLBACK;
}

/** Fetched, then saved from memory: an error shows here instead of downloading as a file. */
export function DownloadMyData(): ReactNode {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function download(): Promise<void> {
    if (state.kind === "working") return;
    setState({ kind: "working" });
    try {
      const response = await fetch("/api/account/export", { cache: "no-store" });
      if (!response.ok) {
        setState({ kind: "error", message: await errorOf(response) });
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameOf(response);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setState({ kind: "done" });
    } catch {
      setState({ kind: "error", message: FALLBACK });
    }
  }

  const working = state.kind === "working";
  return (
    <section aria-labelledby="my-data-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="my-data-heading" className="font-display text-xl text-ink">
          Your data
        </h2>
        <p className="text-sm text-muted">
          A copy of everything Lumiback keeps about you: your account, contacts, outings, requests,
          shares and who viewed them, gate scans and phones. It saves as a JSON file.
        </p>
      </div>
      <button
        type="button"
        onClick={() => void download()}
        aria-disabled={working}
        className={`inline-flex min-h-12 items-center justify-center gap-2 self-start rounded-control bg-surface px-5 text-base font-bold text-accent ring-1 ring-line transition hover:ring-accent/40 active:scale-[0.98] ${
          working ? "cursor-progress opacity-75" : ""
        }`}
      >
        <DownloadSimple size={20} weight="bold" aria-hidden="true" />
        <span aria-live="polite">{working ? "Preparing your file…" : "Download my data"}</span>
      </button>
      <p aria-live="polite" className="text-sm">
        {state.kind === "error" ? (
          <span role="alert" className="font-bold text-danger">
            {state.message}
          </span>
        ) : state.kind === "done" ? (
          <span className="text-good">Downloaded. Check your downloads folder.</span>
        ) : (
          ""
        )}
      </p>
    </section>
  );
}
