import { HandPalm, MapPinArea, UsersThree } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { Gate } from "@/components/illustrations/Gate";
import { Lantern } from "@/components/illustrations/Lantern";
import { SiteFooter } from "@/components/ui/SiteFooter";
import { SignInForm } from "@/features/auth/components/SignInForm";
import { currentUser } from "@/lib/session";

interface PageProps {
  searchParams: Promise<{ verified?: string; deleted?: string }>;
}

const HOW = [
  {
    icon: MapPinArea,
    title: "Check out in two taps",
    body: "Say where you're going and when you'll be back. Tap once more when you're home.",
  },
  {
    icon: UsersThree,
    title: "You choose who sees you",
    body: "Friends and family join with a one-time code, and see nothing until you approve them.",
  },
  {
    icon: HandPalm,
    title: "Stop whenever you want",
    body: "One tap ends sharing for everyone. Only your latest position is kept, and it's deleted then.",
  },
] as const;

/**
 * Above the fold: what it is, who it's for, why it matters, and the sign-in form.
 * On phones the order is intro, then sign in, so the form is on the first screen.
 */
export default async function Landing({ searchParams }: PageProps): Promise<ReactNode> {
  if (await currentUser()) redirect("/home");
  const { verified, deleted } = await searchParams;

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-5">
      <header className="flex h-16 items-center justify-between">
        <span className="font-display text-xl text-pine">Lumiback</span>
        <Link
          href="/join"
          className="flex min-h-11 items-center rounded-control px-3 text-sm font-bold text-pine hover:bg-pine-soft"
        >
          Have a join code?
        </Link>
      </header>

      <main className="flex flex-1 flex-col">
        <section className="grid content-center gap-x-16 gap-y-6 pb-12 pt-4 md:min-h-[min(calc(100dvh-4rem),44rem)] md:grid-cols-[1.1fr_1fr] md:grid-rows-[auto_auto] md:pb-16">
          <div className="flex flex-col gap-4 md:self-end">
            <h1 className="font-display text-title text-ink md:text-hero md:leading-[1.02]">
              Head out.
              <br />
              <span className="text-pine">Get back safe.</span>
            </h1>
            <p className="max-w-md text-lg leading-relaxed text-stone">
              Log where you&apos;re going and when you&apos;ll be back. Share your live location
              only with people you approve.
            </p>
          </div>

          <section
            aria-labelledby="sign-in-heading"
            className="rounded-sheet bg-surface p-5 shadow-[0_1px_2px_rgba(35,78,70,0.06),0_12px_32px_-12px_rgba(35,78,70,0.18)] ring-1 ring-line md:row-span-2 md:self-center md:p-8"
          >
            <h2 id="sign-in-heading" className="font-display text-2xl text-ink">
              Sign in
            </h2>
            <p className="mb-5 mt-1 text-sm text-stone">With your university email.</p>
            {deleted && (
              <p role="status" className="mb-5 rounded-control bg-sage-soft px-4 py-3 text-ink">
                Your account and all its data were deleted.
              </p>
            )}
            {verified && (
              <p role="status" className="mb-5 rounded-control bg-sage-soft px-4 py-3 text-sage">
                Email verified. Sign in to continue.
              </p>
            )}
            <SignInForm email={verified} />
          </section>

          <Gate className="mx-auto hidden w-full max-w-sm md:col-start-1 md:mx-0 md:block md:self-start" />
        </section>

        <section
          aria-labelledby="how-heading"
          className="grid items-center gap-10 border-t border-line py-16 md:grid-cols-[1.4fr_1fr] md:py-24"
        >
          <div className="flex flex-col gap-8">
            <h2 id="how-heading" className="font-display text-title text-ink">
              Built around your consent
            </h2>
            <ul className="flex flex-col gap-7">
              {HOW.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-4">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-control bg-pine-soft text-pine">
                    <Icon size={22} weight="duotone" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="font-display text-lg text-ink">{title}</h3>
                    <p className="mt-1 max-w-[52ch] leading-relaxed text-stone">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid aspect-[4/3] place-items-center rounded-sheet bg-pine-soft md:aspect-square">
            <Lantern lit className="w-24 md:w-36" />
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
