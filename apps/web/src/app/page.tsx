import { ArrowRight, LockSimple } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { HeroVisual } from "@/components/hero/HeroVisual";
import { Lantern } from "@/components/illustrations/Lantern";
import { SiteFooter } from "@/components/ui/SiteFooter";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: { absolute: "Lumiback: head out, get back safe" },
};

const PRIMARY =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-accent px-6 font-bold text-on-accent shadow-[0_1px_0_rgba(255,255,255,0.18)_inset,0_10px_24px_-10px_rgba(31,63,209,0.45)] transition hover:-translate-y-px hover:brightness-110 active:translate-y-0";
const SECONDARY =
  "inline-flex min-h-12 items-center justify-center rounded-control bg-surface px-6 font-bold text-accent ring-1 ring-line transition hover:-translate-y-px hover:ring-accent/40 active:translate-y-0";

/** A real, static slice of the app's UI (not a screenshot): the check-out form. */
function ReturnChips(): ReactNode {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        {["+1 h", "+2 h", "+3 h"].map((label, i) => (
          <span
            key={label}
            className={`flex min-h-11 items-center justify-center rounded-control text-sm font-bold ${
              i === 1 ? "bg-accent text-on-accent" : "bg-page text-ink ring-1 ring-line"
            }`}
          >
            {label}
          </span>
        ))}
      </div>
      <p className="text-sm text-muted">
        Back by <span className="font-display text-base text-ink">8:30 PM</span>
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
        <section className="grid items-center gap-8 pb-16 pt-6 md:grid-cols-[1fr_1.1fr] md:gap-12 md:pb-24 md:pt-14">
          <div className="reveal flex flex-col gap-6">
            <h1 className="font-display text-[2.6rem] leading-[1.02] text-ink sm:text-5xl lg:text-6xl">
              Head out.
              <br />
              <span className="text-accent">Get back safe.</span>
            </h1>
            <p className="max-w-[34ch] text-lg leading-relaxed text-muted">
              Log where you&apos;re going and when you&apos;ll be back. Share your live location
              only with people you approve.
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
          </div>
          <HeroVisual className="mx-auto max-w-xl md:max-w-none" />
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
                  Say where you&apos;re going and when you&apos;ll be back. Tap once more when
                  you&apos;re home, and your history keeps itself.
                </p>
              </div>
              <ReturnChips />
            </article>
            <article className="lift reveal flex flex-col gap-5 rounded-sheet bg-accent p-6 text-on-accent md:p-8">
              <div>
                <h3 className="font-display text-2xl">You choose who sees you</h3>
                <p className="mt-2 leading-relaxed opacity-85">
                  People join with a one-time code and see nothing until you approve them.
                </p>
              </div>
              <span
                aria-hidden="true"
                className="self-start rounded-control border-2 border-dashed border-on-accent/50 px-4 py-2 font-mono text-lg font-bold tracking-[0.18em]"
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
          className="reveal my-16 flex flex-col gap-4 border-l-4 border-accent py-2 pl-6 md:my-24"
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
            ends. Hostel staff see when you left and came back, never where you are. No ads, no
            tracking.{" "}
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
