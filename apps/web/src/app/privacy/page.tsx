import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/ui/SiteFooter";

export const metadata: Metadata = { title: "Privacy" };

/** Optional public contact for privacy requests; the line is left out when unset. */
const CONTACT = process.env.PRIVACY_CONTACT_EMAIL?.trim() || null;

interface Part {
  heading: string;
  items: ReactNode[];
}

/** Each statement here describes what the code does today. Change the code, change this page. */
const PARTS: Part[] = [
  {
    heading: "What we collect",
    items: [
      "Your account: name, university email, an optional roll number, and your password, stored only as a one-way hash.",
      "Your outings: when you left, when you expect to be back, when you returned, and an optional destination.",
      "Your location, only while you are sharing it. We keep just your latest position, never a trail.",
      "Who looked at your share and when, so you can see it. Guests who follow you give a name for you to recognise.",
    ],
  },
  {
    heading: "Who can see it",
    items: [
      "Nobody sees your location unless you start sharing and approve them. There is no admin, warden or staff access.",
      "We don't sell your data, show ads, or use analytics or tracking cookies.",
      "The only cookies keep you signed in, and they can't be read by scripts on the page.",
    ],
  },
  {
    heading: "How long we keep it",
    items: [
      "Your location is deleted as soon as you stop sharing or close the tab. If a share ends on its own (its time runs out, or your tab goes quiet for 5 minutes), it is deleted within a minute.",
      "Outings and your list of past shares stay until you delete your account.",
      "Join codes are deleted a day after they expire. You are signed out after 30 days without using the app.",
    ],
  },
  {
    heading: "Where it's stored",
    items: [
      "The app runs on Render, the database on Supabase, and sign-up emails are sent through Resend. They process data only to run Lumiback.",
    ],
  },
  {
    heading: "Your choices",
    items: [
      "Stop a share or remove a viewer at any time; they lose access at once.",
      <>
        Delete your account from the <Link href="/account">Account</Link> page. Everything tied to
        it is erased immediately and can&apos;t be recovered.
      </>,
    ],
  },
];

export default function PrivacyPage(): ReactNode {
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col px-5">
      <header className="flex h-16 items-center">
        <Link href="/" className="font-display text-xl text-pine">
          Lumiback
        </Link>
      </header>
      <main className="flex flex-1 flex-col gap-10 pb-16 pt-6">
        <div>
          <h1 className="font-display text-title text-ink">Privacy</h1>
          <p className="mt-2 max-w-[60ch] leading-relaxed text-stone">
            Lumiback exists to share your location with people you choose, so this page says exactly
            what is kept, who can see it, and for how long. Last updated 6 October 2026.
          </p>
        </div>
        {PARTS.map((part) => (
          <section key={part.heading} aria-labelledby={slug(part.heading)}>
            <h2 id={slug(part.heading)} className="font-display text-xl text-ink">
              {part.heading}
            </h2>
            <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 leading-relaxed text-ink marker:text-pine [&_a]:font-bold [&_a]:text-pine [&_a]:underline [&_a]:underline-offset-4">
              {part.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
        {CONTACT && (
          <p className="leading-relaxed text-stone">
            Questions or requests:{" "}
            <a
              href={`mailto:${CONTACT}`}
              className="font-bold text-pine underline underline-offset-4"
            >
              {CONTACT}
            </a>
          </p>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z]+/g, "-");
}
