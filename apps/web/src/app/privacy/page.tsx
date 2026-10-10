import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/ui/SiteFooter";
import { SUPPORT_EMAIL } from "@/lib/support";

export const metadata: Metadata = { title: "Privacy" };

/** Contact for privacy requests: PRIVACY_CONTACT_EMAIL when set, otherwise support. */
const CONTACT = process.env.PRIVACY_CONTACT_EMAIL?.trim() || SUPPORT_EMAIL;

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
      "Your hostel (it decides your outing hours), and, if you add them, your phone number and an emergency contact's name, relation and phone number.",
      "Weekend and holiday outing requests: where and why, how long, and the phone numbers on the form, with the hostel office's decision.",
      "If you're late: your answer to the “Are you OK?” alert, and whether the hostel office followed it up.",
      "Your location, only while you are sharing it. We keep just your latest position, never a trail.",
      "Who looked at your share and when, so you can see it. Guests who follow you give a name for you to recognise.",
      "When you tap out or in at a gate: which gate, the time, whether the scan was accepted, how far your phone was from the gate and how precise its GPS was. Never your coordinates.",
      "If you allow notifications in the app: a push token for your phone, used to tell you about follow requests, approvals, and when you're 30 minutes past your return time. If you don't use the app, the approval and the late alert are emailed to your university address instead.",
    ],
  },
  {
    heading: "Who can see it",
    items: [
      "Nobody sees your location unless you start sharing and approve them. That includes hostel admins, with one safety exception below.",
      "Hostel admins (wardens and security staff given admin access) see the outing register: your name, email, roll number, hostel, destination, when you left, when you're due and when you returned, and whether each was scanned at a gate or self-reported. They also see gate scans, including refused ones, and can download the register as a spreadsheet.",
      "Admins see your outing requests, including the phone numbers on them, so they can decide and call if needed.",
      "If you're 30 minutes late and don't answer the alert within 10 minutes, admins are told and see your phone number, your emergency contact and your hostel warden's number. If you are sharing your location at that moment, they also see your latest shared position, and that look is listed in your share's viewer history. Otherwise they see only your last gate scan: which gate, and when. Nothing new is collected for this.",
      "We don't sell your data, show ads, or use analytics or tracking cookies.",
      "The only cookies keep you signed in, and they can't be read by scripts on the page.",
    ],
  },
  {
    heading: "How long we keep it",
    items: [
      "Your location is deleted as soon as you stop sharing or close the tab. If a share ends on its own (its time runs out, or your tab goes quiet for 5 minutes), it is deleted within a minute.",
      "Outings and your list of past shares stay until you delete your account.",
      "Gate scans, outing requests, records of who viewed your share, and handled late follow-ups are deleted automatically after 180 days (admins can set this between 7 and 730 days). A late follow-up still open stays until the hostel office handles it.",
      "Join codes are deleted a day after they expire. You are signed out after 30 days without using the app.",
    ],
  },
  {
    heading: "Where it's stored",
    items: [
      "The app runs on Render, the database on Supabase, emails (sign-up and password codes, and late-student alerts to admins) are sent through Resend, and app notifications through Expo's push service (Firebase on Android). They process data only to run Lumiback.",
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
        <Link href="/" className="font-display text-xl text-accent">
          Lumiback
        </Link>
      </header>
      <main className="flex flex-1 flex-col gap-10 pb-16 pt-6">
        <div>
          <h1 className="font-display text-title text-ink">Privacy</h1>
          <p className="mt-2 max-w-[60ch] leading-relaxed text-muted">
            Lumiback exists to share your location with people you choose, so this page says exactly
            what is kept, who can see it, and for how long. Last updated 9 October 2026.
          </p>
        </div>
        {PARTS.map((part) => (
          <section key={part.heading} aria-labelledby={slug(part.heading)}>
            <h2 id={slug(part.heading)} className="font-display text-xl text-ink">
              {part.heading}
            </h2>
            <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 leading-relaxed text-ink marker:text-accent [&_a]:font-bold [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-4">
              {part.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
        <p className="leading-relaxed text-muted">
          Questions or requests:{" "}
          <a
            href={`mailto:${CONTACT}`}
            className="font-bold text-accent underline underline-offset-4"
          >
            {CONTACT}
          </a>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z]+/g, "-");
}
