import { AndroidLogo, ArrowRight, LockSimple } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { DemoBoard } from "@/components/hero/DemoBoard";
import { Lantern } from "@/components/illustrations/Lantern";
import { SiteFooter } from "@/components/ui/SiteFooter";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: { absolute: "Lumiback: head out, get back safe" },
};

const PRIMARY =
  "press inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-accent px-6 font-bold text-on-accent shadow-[0_10px_24px_-12px_color-mix(in_srgb,var(--accent)_70%,transparent)] hover:brightness-105";
const SECONDARY =
  "press inline-flex min-h-12 items-center justify-center rounded-control bg-surface px-6 font-bold text-accent ring-1 ring-line hover:ring-accent/40";

/** A real, static slice of the app's UI (not a screenshot): today's rules and check-out. */
function CheckOutPreview(): ReactNode {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5 rounded-control bg-page px-4 py-3 ring-1 ring-line">
        <span className="text-sm font-bold text-ink">Weekday outings: 6:00 PM–8:00 PM</span>
        <span className="text-sm text-muted">Set by your hostel</span>
      </div>
      <p className="text-sm text-muted">
        Back by <span className="font-display text-base text-ink">8:00 PM</span>
      </p>
      <span className="flex min-h-12 items-center rounded-control bg-page px-4 text-muted ring-1 ring-line">
        Where to? <span className="ml-2 text-ink">Clock Tower market</span>
      </span>
      <span className="flex min-h-12 items-center justify-center rounded-control bg-accent font-bold text-on-accent">
        Check out
      </span>
    </div>
  );
}

/** Landing: what it is, who it's for, why it matters, what to do next. */
export default async function Landing(): Promise<ReactNode> {
  if (await currentUser()) redirect("/home");

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-5">
      <header className="flex h-16 items-center justify-between gap-3">
        <span className="font-display text-xl text-accent">Lumiback</span>
        <nav aria-label="Account" className="flex items-center gap-1 text-sm">
          <Link
            href="/join"
            className="hidden min-h-11 items-center rounded-control px-3 font-bold text-accent hover:bg-accent-soft sm:flex"
          >
            Have a join code?
          </Link>
          <Link
            href="/sign-in"
            className="flex min-h-11 items-center rounded-control px-3 font-bold text-ink hover:bg-accent-soft"
          >
            Sign in
          </Link>
        </nav>
      </header>

      <main className="flex flex-1 flex-col">
        <section className="grid grid-cols-[minmax(0,1fr)] items-center gap-8 pb-16 pt-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:gap-12 md:pb-24 md:pt-14">
          <div className="reveal flex flex-col gap-6">
            <h1 className="font-display text-[2.6rem] leading-[1.02] text-ink sm:text-5xl lg:text-6xl">
              Head out.
              <br />
              <span className="text-muted">Get back safe.</span>
            </h1>
            <p className="max-w-[40ch] text-lg leading-relaxed text-muted">
              Tap out at the gate or log your trip; your hostel&apos;s rules set when you&apos;re
              due back. Share your live location only with people you approve.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/register" className={PRIMARY}>
                Create account
                <ArrowRight size={18} weight="bold" aria-hidden="true" />
              </Link>
              <Link href="/sign-in" className={SECONDARY}>
                Sign in
              </Link>
            </div>
            <Link
              href="/download"
              className="inline-flex min-h-11 items-center gap-2 self-start font-bold text-accent underline-offset-4 hover:underline"
            >
              <AndroidLogo size={20} weight="fill" aria-hidden="true" />
              Get the Android app
            </Link>
          </div>
          <DemoBoard className="mx-auto w-full max-w-xl md:max-w-none" />
        </section>

        <section
          aria-labelledby="consent-heading"
          className="flex flex-col gap-8 pb-16 pt-4 md:pb-24 md:pt-6"
        >
          <h2
            id="consent-heading"
            className="reveal max-w-[18ch] font-display text-title text-ink md:text-[2.5rem] md:leading-[1.1]"
          >
            Built around your consent
          </h2>
          <div className="grid gap-4 md:grid-cols-[1.25fr_1fr] md:grid-rows-2">
            <article className="lift reveal flex flex-col justify-between gap-8 rounded-sheet bg-surface p-6 ring-1 ring-line md:row-span-2 md:p-8">
              <div>
                <h3 className="font-display text-2xl text-ink">Check out in two taps</h3>
                <p className="mt-2 max-w-[40ch] leading-relaxed text-muted">
                  Scan the code at the gate, or say where you&apos;re going. Your hostel&apos;s
                  rules set when you&apos;re due back, and your history keeps itself.
                </p>
              </div>
              <CheckOutPreview />
            </article>
            <article className="led-board reveal flex flex-col gap-5 p-6 md:p-8">
              <div>
                <h3 className="font-display text-2xl text-on-board">You choose who sees you</h3>
                <p className="mt-2 leading-relaxed text-board-muted">
                  People join with a one-time code and see nothing until you approve them.
                </p>
              </div>
              <span
                aria-hidden="true"
                className="self-start rounded-control border border-dashed border-board-line px-4 py-2 font-led text-2xl font-black text-led"
              >
                7KQ2M-XW4PD
              </span>
            </article>
            <article className="lift reveal flex flex-col gap-5 rounded-sheet bg-accent-soft p-6 md:p-8">
              <div>
                <h3 className="font-display text-2xl text-ink">Stop whenever you want</h3>
                <p className="mt-2 leading-relaxed text-ink/80">
                  One tap ends sharing for everyone, and your location is deleted right then.
                </p>
              </div>
              <span
                aria-hidden="true"
                className="self-start rounded-control bg-danger px-5 py-2.5 font-bold text-surface"
              >
                Stop sharing
              </span>
            </article>
          </div>
        </section>

        <section
          aria-labelledby="follow-heading"
          className="reveal grid items-center gap-8 rounded-sheet bg-surface p-6 ring-1 ring-line md:grid-cols-[1.4fr_1fr] md:p-12"
        >
          <div className="flex flex-col gap-4">
            <h2 id="follow-heading" className="font-display text-title text-ink">
              Waiting for someone?
            </h2>
            <p className="max-w-[46ch] leading-relaxed text-muted">
              Parents and friends follow along in any browser with the code they were sent. No
              account, no app. They see one dot, and only while it&apos;s shared.
            </p>
            <Link
              href="/join"
              className="self-start font-bold text-accent underline-offset-4 hover:underline"
            >
              Have a join code?
            </Link>
          </div>
          <div className="grid aspect-[4/3] place-items-center rounded-sheet bg-accent-soft">
            <Lantern lit className="w-24 md:w-32" />
          </div>
        </section>

        <section
          aria-labelledby="privacy-heading"
          className="reveal my-16 flex flex-col gap-4 border-t border-line pt-10 md:my-24"
        >
          <h2
            id="privacy-heading"
            className="flex items-center gap-3 font-display text-2xl text-ink"
          >
            <LockSimple size={26} weight="duotone" aria-hidden="true" className="text-accent" />
            Your location stays yours
          </h2>
          <p className="max-w-[60ch] leading-relaxed text-muted">
            Only your latest position is stored while you share, and it is deleted when sharing
            ends. Hostel staff see when you left and came back, not where you are. The one exception
            is safety: if you&apos;re 30 minutes late and don&apos;t answer within 10 minutes while
            you&apos;re sharing, they see that last position, and you see that they looked. No ads,
            no tracking.{" "}
            <Link
              href="/privacy"
              className="font-bold text-accent underline-offset-4 hover:underline"
            >
              Read the privacy notice
            </Link>
          </p>
        </section>

        <section className="reveal flex flex-col items-start gap-5 pb-20">
          <h2 className="font-display text-title text-ink">Ready when you head out.</h2>
          <Link href="/register" className={PRIMARY}>
            Create account
            <ArrowRight size={18} weight="bold" aria-hidden="true" />
          </Link>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
