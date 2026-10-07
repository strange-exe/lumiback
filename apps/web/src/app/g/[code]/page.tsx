import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { Lantern } from "@/components/illustrations/Lantern";
import { SiteFooter } from "@/components/ui/SiteFooter";

export const metadata: Metadata = {
  title: "Scan with the app",
  robots: { index: false, follow: false },
};

/**
 * Where a gate code leads if it's scanned with a phone's ordinary camera. The code only works
 * inside the Lumiback app, which also checks the phone is at the gate, so this page explains
 * that and records nothing.
 */
export default function GateCodePage(): ReactNode {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-5">
      <main className="flex flex-1 flex-col items-start justify-center gap-6 py-12">
        <Lantern lit className="h-24 w-20" />
        <div className="flex flex-col gap-3">
          <h1 className="font-display text-title text-ink">Scan this in the Lumiback app</h1>
          <p className="text-lg text-muted">
            That&apos;s a gate code for tapping out and back in. Your camera app can&apos;t use it:
            open Lumiback, tap <strong className="text-ink">Scan</strong>, and point it at the gate
            screen again.
          </p>
          <p className="text-muted">
            The app checks you&apos;re at the gate using your phone&apos;s location at that moment.
            Nothing is recorded from this page.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/sign-in"
            className="flex min-h-12 items-center rounded-control bg-accent px-5 font-bold text-on-accent hover:brightness-110"
          >
            Sign in on the web
          </Link>
          <Link
            href="/privacy"
            className="flex min-h-12 items-center rounded-control px-5 font-bold text-accent ring-1 ring-line hover:bg-accent-soft"
          >
            How gate scans work
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
