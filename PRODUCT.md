# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

The web app (Next.js) and the Android app (Expo, React Native) are one product. On Android, the app
follows Android and Material conventions for structure, navigation and interaction; the web keeps
its own conventions. Brand expresses through theming on both. (Owner, 2026-11-14.)

## Users

- **Primary: hostel students** at Graphic Era University, about 18 to 22, on mid-range Android
  phones, often outdoors at the hostel gate in the evening. Their job: tap out and back in at the
  gate in seconds, log a trip that has no gate, share their live location with people they choose,
  and follow a friend who shares with them. Design decisions serve students first. (Owner, 2026-11-14.)
- **Secondary: hostel staff** (wardens, security, admins) on the web dashboard. They see who is out,
  who is late, gate scans, requests and corrections, and they manage gates, hostels, rules and people.
- **Secondary: viewers**, a student's accepted contacts or code holders the student approved, who
  watch a live share for its limited time.
- **Gate kiosk:** a tablet at each gate shows a rotating QR code for students to scan.

## Product Purpose

Replace the paper outing register with a campus outing log that students control. A student taps
out and in at the gate with the app (QR scan plus a GPS check that they are at the gate), or logs a
trip without a gate, which is labelled self-reported. Staff see gate, time and a verified-at-gate
mark, not a map. Separately, a student can share live location for a limited time with people they
approve.

Success means a student finishes a gate tap in under 10 seconds, staff can trust the log without a
paper register, and no one's location is ever shared without the student knowing.

## Positioning

Consent is enforced by the backend, not promised in copy:

- Location sharing is always visible to the sharer, revocable in one tap, time-limited by default,
  and started only by the student. There is no covert mode.
- Viewers are the sharer's accepted contacts, or code holders the sharer approves.
- Only the latest location is stored, and it is deleted when the share ends.
- Every viewer read is logged and visible only to the sharer.
- Gate scans store the distance to the gate, not raw coordinates.
- The Android app shares through a foreground service with a visible notification, using
  while-in-use location only, never background location.

A conventional hostel tracker gives staff a map of students; Lumiback gives staff a verified gate
log and leaves location in the student's hands.

## Operating Context

- Students use the Android app at the gate, often at night, one-handed, on patchy mobile data. They
  also get push notifications: requests, approvals, late alerts, followers, app updates.
- Staff use the web dashboard on desktop: overview, out-now and late lists, scan log, CSV export,
  requests, corrections, escalations, rules and holidays per hostel.
- Hostel rules set curfew and return times; outing times are in IST.
- Hosting is the Render free tier, so the API can be asleep and a cold start shows a waking screen.
- Android app updates arrive over the air (EAS Update) when only JavaScript changes.

## Capabilities and Constraints

- Sign-up only with verified `@geu.ac.in` addresses.
- Roles: student, staff roles, admin; staff scope is per hostel.
- Gate tap in/out uses a rotating QR (about a 20 s window) plus a GPS radius check; mocked
  locations are rejected.
- Outing requests, late replies, corrections, escalations, followers, and a per-student record.
- India DPDP Act 2023 applies: state the purpose of the data, minimise it, keep gate scans for a
  set retention period (180 days), and record changed outings for 180 days.
- Undecided: whether the university adopts it, and production hosting beyond the free tier.

## Brand Commitments

- Name: **Lumiback**. Internal identifiers stay "outing".
- Web domain: lumiback.abhinesh.codes.
- Voice: calm and trustworthy, never alarming and never playful-silly. Plain words, no em dashes.
  Professional enough for faculty to back it.
- Product copy does not describe Lumiback as a Graphic Era or university system.

## Evidence on Hand

- A working pilot: web, Android app (native builds 3 and 4), API, gate kiosk page.
- Changelog: `apps/web/src/lib/changelog.json` and `apps/mobile/src/updates/changelog.json`.
- Privacy page: `apps/web/src/app/privacy`.
- No testimonials, adoption, usage numbers, press or institutional endorsement exist. Lumiback has
  not been adopted by, or proposed to, the college authorities (owner, 2026-11-14). Future work must
  not invent any of these.

## Product Principles

1. The student is in control: every share is visible, time-limited and stoppable in one tap.
2. Speed at the gate beats features: the tap in/out path stays under 10 seconds.
3. Staff get facts, not surveillance: a verified log, distances rather than coordinates.
4. Calm under stress: a late or overdue state informs and offers the next step; it never alarms.
5. Honest claims: no adoption, endorsement or numbers the product doesn't have.

## Accessibility & Inclusion

WCAG 2.2 AA on web and Android: contrast, a full keyboard path on web, screen-reader names,
48 dp touch targets on Android, the system font size respected, and Reduce Motion / Remove
animations honoured. Readable outdoors at night on mid-range screens.
