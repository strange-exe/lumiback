import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/ui/SiteFooter";
import { CHANGELOG } from "@/lib/changelog";

export const metadata: Metadata = { title: "What's new" };

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

/** Every Lumiback release, newest first (the same list the app shows). */
export default function WhatsNewPage(): ReactNode {
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col px-5">
      <header className="flex h-16 items-center">
        <Link href="/" className="font-display text-xl text-accent">
          Lumiback
        </Link>
      </header>
      <main className="flex flex-1 flex-col gap-10 pb-16 pt-6">
        <div>
          <h1 className="font-display text-title text-ink">What&apos;s new</h1>
          <p className="mt-2 max-w-[60ch] leading-relaxed text-muted">
            Changes to the Lumiback app and website. The app updates itself; you&apos;ll see a
            prompt when a new version is ready.
          </p>
        </div>
        {CHANGELOG.map((release) => (
          <section
            key={release.version}
            aria-labelledby={`v${release.version}`}
            className="flex flex-col gap-3 border-t border-line pt-6 first-of-type:border-t-0 first-of-type:pt-0"
          >
            <div className="flex flex-col gap-1">
              <h2 id={`v${release.version}`} className="font-display text-xl text-ink">
                {release.title}
              </h2>
              <p className="text-sm text-muted">
                Version {release.version} ·{" "}
                <time dateTime={release.date}>
                  {dateFormat.format(new Date(`${release.date}T12:00:00+05:30`))}
                </time>
              </p>
            </div>
            <ul className="flex list-disc flex-col gap-2 pl-5 leading-relaxed text-ink marker:text-accent">
              {release.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </section>
        ))}
      </main>
      <SiteFooter />
    </div>
  );
}
