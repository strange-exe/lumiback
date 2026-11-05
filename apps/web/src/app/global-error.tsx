"use client";

import { Geist } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";

import { errorCopy, supportHref } from "@/lib/error-copy";
import { useOnline } from "@/lib/use-online";

import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });

/**
 * Last resort: the root layout itself failed, so this replaces the whole document (its own html
 * and body, styles and font).
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}): ReactNode {
  const copy = errorCopy({ online: useOnline() });
  return (
    <html lang="en-IN" className={geist.variable}>
      <body className="min-h-dvh">
        <title>{`${copy.title} · Lumiback`}</title>
        <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5">
          <header className="flex h-16 items-center">
            <Link href="/" className="font-display text-xl text-accent">
              Lumiback
            </Link>
          </header>
          <main
            aria-labelledby="error-heading"
            data-state="error"
            className="flex flex-1 flex-col justify-center gap-5 pb-10"
          >
            <div className="flex flex-col gap-2">
              <h1 id="error-heading" className="font-display text-title text-ink">
                {copy.title}
              </h1>
              <p className="text-muted">{copy.body}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => retry()}
                className="min-h-12 rounded-control bg-accent px-6 font-bold text-on-accent hover:brightness-110"
              >
                Try again
              </button>
              <a
                href={supportHref(error.digest)}
                className="flex min-h-12 items-center rounded-control px-3 font-bold text-accent hover:bg-accent-soft"
              >
                Email us
              </a>
            </div>
            {error.digest ? (
              <p className="text-sm text-muted">
                Reference <span className="tabular-nums text-ink">{error.digest}</span>
              </p>
            ) : null}
          </main>
        </div>
      </body>
    </html>
  );
}
