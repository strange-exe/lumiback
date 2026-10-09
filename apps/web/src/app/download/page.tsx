import { AndroidLogo, AppleLogo, DownloadSimple } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { Gate } from "@/components/illustrations/Gate";
import { SiteFooter } from "@/components/ui/SiteFooter";
import { CURRENT } from "@/lib/changelog";

// The same file the app reads to offer new builds, so the page and the app agree on the link.
import builds from "../../../public/app/android.json";

export const metadata: Metadata = {
  title: "Get the app",
  description: "Download the Lumiback app for Android.",
};

const APK_URL = builds.preview.url;

const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: "Download",
    body: "Tap the button on your Android phone. The file is about 120 MB, so Wi-Fi helps.",
  },
  {
    title: "Install",
    body: (
      <>
        Open the downloaded file. Android asks whether your browser may install apps: choose{" "}
        <strong className="text-ink">Settings</strong>, allow it for this browser, then go back and
        tap <strong className="text-ink">Install</strong>.
      </>
    ),
  },
  {
    title: "Sign in",
    body: "Open Lumiback and sign in with your university email, or create an account there.",
  },
];

/** Where students get the Android app (an APK until there's a store listing). */
export default function DownloadPage(): ReactNode {
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col px-5">
      <header className="flex h-16 items-center">
        <Link href="/" className="font-display text-xl text-accent">
          Lumiback
        </Link>
      </header>
      <main className="flex flex-1 flex-col gap-12 pb-16 pt-6">
        <section aria-labelledby="download-heading" className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <h1 id="download-heading" className="font-display text-title text-ink">
              Get the Lumiback app
            </h1>
            <p className="max-w-[52ch] leading-relaxed text-muted">
              For Graphic Era hostel students. Tap out at the gate, see your outing hours, and get a
              reminder before you&apos;re due back, even with the app closed.
            </p>
          </div>
          <div className="flex flex-col items-start gap-2">
            <a
              href={APK_URL}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-accent px-6 font-bold text-on-accent transition hover:-translate-y-px hover:brightness-110 active:translate-y-0"
            >
              <DownloadSimple size={20} weight="bold" aria-hidden="true" />
              Download for Android
            </a>
            <p className="text-sm text-muted">
              Version {CURRENT.version} ·{" "}
              <Link
                href="/whats-new"
                className="font-bold text-accent underline-offset-4 hover:underline"
              >
                What&apos;s new
              </Link>
            </p>
          </div>
          <Gate className="w-full max-w-[14rem]" />
        </section>

        <section aria-labelledby="install-heading" className="flex flex-col gap-4">
          <h2
            id="install-heading"
            className="flex items-center gap-2 font-display text-xl text-ink"
          >
            <AndroidLogo size={24} weight="fill" aria-hidden="true" className="text-accent" />
            Installing on Android
          </h2>
          <ol className="flex flex-col gap-4">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-4">
                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft font-bold text-accent"
                >
                  {i + 1}
                </span>
                <div className="flex flex-col gap-1">
                  <h3 className="font-bold text-ink">{step.title}</h3>
                  <p className="leading-relaxed text-muted">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="max-w-[60ch] text-sm leading-relaxed text-muted">
            The app keeps itself up to date: it asks before updating, and if a new version ever
            needs a fresh download, it brings you back here. Only download Lumiback from this page.
          </p>
        </section>

        <section
          aria-labelledby="iphone-heading"
          className="flex flex-col gap-3 border-t border-line pt-8"
        >
          <h2 id="iphone-heading" className="flex items-center gap-2 font-display text-xl text-ink">
            <AppleLogo size={24} weight="fill" aria-hidden="true" className="text-accent" />
            On an iPhone?
          </h2>
          <p className="max-w-[60ch] leading-relaxed text-muted">
            There&apos;s no iPhone app yet. Everything works on this website: check out, see your
            outing hours, ask for weekend outings and share your location. Approvals and the
            &ldquo;Are you OK?&rdquo; alert come to your university email instead of as
            notifications.
          </p>
          <Link
            href="/sign-in"
            className="inline-flex min-h-11 items-center self-start font-bold text-accent underline-offset-4 hover:underline"
          >
            Sign in on the website
          </Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
