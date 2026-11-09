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
      "Your hostel (it decides your outing hours), and, if you add them, your phone number and an emergency contact's name, relation, phone number and email.",
      "Outing requests for days that need approval (the hostel office chooses which days, such as Sundays and holidays): where and why, how long, and the phone numbers on the form, with the hostel office's decision.",
      "If you're late: your answer to the “Are you OK?” alert, and whether the hostel office followed it up.",
      "If you say you're running late: how much later (15, 30 or 60 minutes), when you said it, the due-back time before and after, and the optional reason you give.",
      "Your location, only while you are sharing it. We keep just your latest position, never a trail.",
      "Who looked at your share and when, so you can see it. Guests who follow you give a name for you to recognise.",
      "When you tap out or in at a gate: which gate, the time, whether the scan was accepted, how far your phone was from the gate and how precise its GPS was. Never your coordinates.",
      "If you allow notifications in the app: a push token for your phone, used to tell you about follow requests, approvals, reminders before you're due back, when you're 30 minutes past your return time, news about someone you follow (back, late, running late, sharing timed out), and app update notices. If you don't use the app, request decisions and the late alert are emailed to your university address instead.",
      "On your phone, while you're out: a copy of your current trip (destination, times and your hostel office's number) so the app can show it without a connection. The app drops it the next time it loads after you're back, and deletes it when you sign in or out.",
      "Error reports: when something breaks on the website or in the app, it sends us what went wrong so we can fix it: the error message, where in the code it happened, the page's path (never what follows a ? or #), the app version and whether it was the website, Android or iPhone. Before anything is stored, our server removes emails, phone numbers, roll numbers, your name, coordinates, tokens and other secrets from it. The same error is counted together, and only the latest report is kept with a link to your account, if you were signed in.",
    ],
  },
  {
    heading: "Who can see it",
    items: [
      "Nobody sees your location unless you start sharing and approve them. That includes hostel admins, with one safety exception below.",
      "Hostel admins (wardens and security staff given admin access) see the outing register: your name, email, roll number, hostel, destination, when you left, when you're due and when you returned, and whether each was scanned at a gate or self-reported. They also see gate scans, including refused ones, and can download the register as a spreadsheet.",
      "Admins see your outing requests, including the phone numbers on them, so they can decide and call if needed.",
      "Running late: the hostel office is told (your hostel's wardens; if it has none, the head wardens, or else the admins). Hostel admins see the new due-back time, the earlier one and your reason in the outing register, and the wardens' phone notification shows your name and reason (it passes through Expo and Google's push service, and may show on a locked screen). The people you share your location with see only the times, never the reason.",
      "While you share your location and are out on an outing, the people following you see when you're due back (and the earlier time if you said you're running late). People who follow you with a Lumiback account are also notified, in the app or by email if they don't use it, when you're back, when you're 30 minutes late, when you say you're running late, and when a share with them times out while you're still out (its time ran out, or your phone or tab stopped sending your location). That last notice says only that it timed out, not that you're out or when you're due. If you stop sharing yourself, nobody is told.",
      "App update notices: when a new version of Lumiback is released, the team may send one notification to every phone with the app. It contains no personal data.",
      "If you're 30 minutes late and don't answer the alert within 10 minutes, admins are told and see your phone number, your emergency contact and your hostel warden's number. If you are sharing your location at that moment, they also see your latest shared position, and that look is listed in your share's viewer history. Otherwise they see only your last gate scan: which gate, and when. Nothing new is collected for this.",
      "Help: if you press Help while out, your phone takes one location fix and the hostel office is told at once (your hostel's wardens and the head wardens), with that position. The people you share your location with, your emergency contact and your safe-return contact are told you asked for help, with your phone number and the hostel office's, but not where you are. The position is deleted after a day; the office keeps the time it was pressed and when they handled it, with the outing.",
      "Safe return: only if you tick “Let my emergency contact follow until I'm back” when you check out, we email that contact a link. It says you chose to send it, shows your location while you share it from the app or website, and stops working when you're back or stop sharing. They're also emailed if you're 30 minutes late, and when you're back. Their views are listed in your share's viewer history like anyone else's. Their email address is kept with that outing only until you're back.",
      "Hostel office reports show counts per hostel (trips, late returns, escalations, requests), never a student's name.",
      "Error reports are seen only by the Lumiback developers, without saying who sent them. Once a day, a summary of new errors may be emailed to the team.",
      "We don't sell your data, show ads, or use analytics or tracking cookies.",
      "The only cookies keep you signed in, or let a guest keep following one share, and they can't be read by scripts on the page.",
    ],
  },
  {
    heading: "How long we keep it",
    items: [
      "Your location is deleted as soon as you stop sharing or close the tab. If a share ends on its own (its time runs out, or your tab goes quiet for 5 minutes), it is deleted within a minute.",
      "Outings and records of your past shares stay until you delete your account. After that, the hostel keeps your outing and late follow-up records for the campus retention period below, then they are deleted.",
      "Gate scans, outing requests, records of who viewed your share, and handled late follow-ups are deleted automatically after 180 days (admins can set this between 7 and 730 days). A late follow-up still open stays until the hostel office handles it.",
      "Join codes are deleted a day after they expire. You are signed out after 30 days without using the app.",
      "A phone's push token is deleted when you sign out on it, or after 90 days without the app being opened on it.",
      "Records of changes staff make in the admin area (roles, gates, kiosk links, settings) are deleted after 365 days.",
      "Error reports are deleted 30 days after that error was last seen. Deleting your account removes its link to any of them.",
    ],
  },
  {
    heading: "Where it's stored",
    items: [
      "The app runs on Render, the database on Supabase, emails (sign-up and password codes, request decisions and “Are you OK?” alerts to students who don't use the app, late-student alerts to admins, and safe-return emails to an emergency contact you chose) are sent through Resend, and app notifications through Expo's push service (Firebase on Android). They process data only to run Lumiback.",
      `Emails to ${SUPPORT_EMAIL} are forwarded to the Lumiback team's inbox and answered from there; an automatic reply confirms we got it.`,
      "Map images come from OpenStreetMap's tile servers, which see your IP address and the map area shown; “Open in Google Maps” sends the position to Google only when you click it.",
    ],
  },
  {
    heading: "Your choices",
    items: [
      "Stop a share or remove a viewer at any time; they lose access at once.",
      <>
        Download a copy of your data from the <Link href="/account">Account</Link> page, or Profile
        in the app: a JSON file with your account, contacts, outings, requests, shares and who
        viewed them, gate scans, phones and the error reports last sent while you were signed in. It
        holds only your own records, plus the names of the people who viewed your shares.
      </>,
      <>
        Delete your account from the <Link href="/account">Account</Link> page. Your account,
        contacts, shares, requests, gate scans and phones are erased immediately and can&apos;t be
        recovered. The hostel keeps your outing records and any late follow-ups, with your name and
        roll number, for the campus retention period (180 days by default), so the office can still
        account for past trips; then they are deleted too. You can&apos;t delete your account while
        you are out or a late follow-up is still open, and the last admin can&apos;t delete theirs.
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
            what is kept, who can see it, and for how long. Last updated 8 November 2026.
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
