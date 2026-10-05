import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { Gate } from "@/components/illustrations/Gate";
import { SignInForm } from "@/features/auth/components/SignInForm";
import { currentUser } from "@/lib/session";

interface PageProps {
  searchParams: Promise<{ verified?: string }>;
}

/**
 * Above the fold: what it is, who it's for, why it matters, and what to do next.
 * On phones the order is intro -> sign in -> illustration, so the form is on the first screen.
 */
export default async function Landing({ searchParams }: PageProps): Promise<ReactNode> {
  if (await currentUser()) redirect("/home");
  const { verified } = await searchParams;

  return (
    <main className="mx-auto grid min-h-dvh max-w-5xl content-center gap-x-16 gap-y-6 px-5 py-8 md:grid-cols-[1.1fr_1fr] md:grid-rows-[auto_auto]">
      <section className="flex flex-col gap-3 md:self-end">
        <p className="text-sm font-bold tracking-wide text-pine">Outing · Graphic Era hostels</p>
        <h1 className="font-display text-title text-ink md:text-hero md:leading-[1.05]">
          Head out. <span className="text-pine">Get back safe.</span>
        </h1>
        <p className="max-w-md text-stone md:text-lg">
          Log when you leave the hostel and when you&apos;ll be back. Only you decide who can see
          it, and every trip ends with one tap.
        </p>
      </section>

      <section
        aria-labelledby="sign-in-heading"
        className="rounded-sheet bg-surface p-5 ring-1 ring-line md:row-span-2 md:self-center md:p-8"
      >
        <h2 id="sign-in-heading" className="font-display text-2xl text-ink">
          Sign in
        </h2>
        <p className="mb-5 mt-1 text-sm text-stone">With your @geu.ac.in email.</p>
        {verified && (
          <p role="status" className="mb-5 rounded-control bg-sage-soft px-4 py-3 text-sage">
            Email verified. Sign in to continue.
          </p>
        )}
        <SignInForm email={verified} />
      </section>

      <Gate className="mx-auto w-full max-w-[15rem] md:col-start-1 md:mx-0 md:max-w-sm md:self-start" />
    </main>
  );
}
