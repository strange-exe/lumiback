import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { ACCOUNT_LABEL, accountFilter } from "@/features/admin/accounts";
import { adminApi } from "@/features/admin/api";
import { AccountControls, type AccountPerson } from "@/features/admin/components/AccountControls";
import { AddPersonForm } from "@/features/admin/components/AddPersonForm";
import { BULK_FORM, BulkActions, SelectAllShown } from "@/features/admin/components/BulkActions";
import { MoveForm } from "@/features/admin/components/MoveForm";
import { PasswordLinkForm } from "@/features/admin/components/PasswordLinkForm";
import {
  listSource,
  onePage,
  PEOPLE_PAGE,
  resultCount,
  ROLE_CHIPS,
  type ChipRole,
} from "@/features/admin/people-roles";
import { recordHref } from "@/features/admin/record";
import { RoleForm } from "@/features/admin/components/RoleForm";
import { extrasFrom, filterHref, pageHref, resolveFilters } from "@/lib/filters";
import { isUuid } from "@/lib/ids";
import { rememberedFilters, requireStaff } from "@/lib/session";
import {
  isAdminRole,
  ROLE_LABEL,
  type AdminUser,
  type Hostel,
  type OfficeStudent,
} from "@/lib/types";

export const metadata: Metadata = { title: "People" };

type Account = "invited" | "off" | undefined;

interface PageProps {
  searchParams: Promise<{
    q?: string | string[];
    account?: string | string[];
    hostel?: string | string[];
    role?: string | string[];
    cancelled?: string | string[];
    after?: string | string[];
  }>;
}

/**
 * One row. `full`: the role can be changed here. Always so for the admin search; from the
 * lists (GET /admin/students) only for students, since those don't say which hostels a warden
 * looks after (and a student looks after none).
 */
interface Row {
  person: AdminUser;
  full: boolean;
}

function fromStudent(s: OfficeStudent): Row {
  return {
    person: {
      id: s.id,
      name: s.name,
      email: s.email,
      roll_no: s.roll_no,
      role: s.role,
      hostel_ids: [],
      hostels: [],
      home_hostel_id: s.hostel_id,
      home_hostel: s.hostel,
      account: s.account,
      phone: s.phone,
    },
    full: s.role === "student",
  };
}

/**
 * Who's listed: everyone in the hostels the viewer looks after (every hostel for an admin, as
 * in the app), one hostel, a filter, or an admin's search or role chip, which also find staff.
 * Every list comes PEOPLE_PAGE at a time (the office list and a role chip by name, a search
 * staff first): `after` is the last id of the page before, and `next` the id the following
 * page starts after (null: none follows). One more than a page is asked for, to know whether a
 * next page exists without linking to an empty one.
 */
async function load(
  token: string,
  isAdmin: boolean,
  q: string,
  account: Account,
  hostel: string | undefined,
  role: ChipRole | undefined,
  after: string | undefined,
): Promise<{ rows: Row[]; next: string | null }> {
  const search = q.length >= 2 ? q : undefined;
  const limit = PEOPLE_PAGE + 1;
  if (listSource({ isAdmin, search, role, account, hostel }) === "students") {
    const filters = { q: search, account, hostel, role, after, limit };
    const { rows, next } = onePage(await adminApi.students(token, filters));
    return { rows: rows.map(fromStudent), next };
  }
  // The search knows roles, a warden's hostels and phone numbers.
  const { rows, next } = onePage(await adminApi.users(token, { q: search, role, after, limit }));
  return { rows: rows.map((person) => ({ person, full: true })), next };
}

export default async function PeoplePage({ searchParams }: PageProps): Promise<ReactNode> {
  const { token, user } = await requireStaff();
  const params = await searchParams;
  // ?q=a&q=b arrives as an array: treat anything but one string as no search.
  const q = (typeof params.q === "string" ? params.q : "").trim().slice(0, 100);
  const isAdmin = isAdminRole(user.role);
  // The address's hostel and filter, or on a bare visit the ones chosen last time.
  const [{ values }, hostels, mine] = await Promise.all([
    rememberedFilters().then((kept) => resolveFilters("people", params, kept)),
    isAdmin ? adminApi.hostels(token) : Promise.resolve<Hostel[]>([]),
    // The hostels this person looks after: the hostel filter's choices.
    adminApi.myHostels(token),
  ]);
  const account = accountFilter(values.account);
  // A hostel that isn't (or is no longer) one of theirs is simply not applied.
  const hostel = mine.some((h) => h.id === values.hostel) ? values.hostel : undefined;
  // The role chips are for admins and developers only; anyone else's ?role= is ignored (and
  // the API ignores it from them too).
  const role = isAdmin ? (extrasFrom("people", params).role as ChipRole | undefined) : undefined;
  // A later page: the last id of the page before (anything but one id is the first page).
  const after = isUuid(params.after) ? params.after : undefined;
  const { rows, next } = await load(token, isAdmin, q, account, hostel, role, after);
  // The list as shown, for a form that reloads the page (cancelling an invite).
  const back = {
    q,
    account: account ?? "",
    hostel: hostel ?? "",
    role: role ?? "",
    after: after ?? "",
  };
  // The list's own address with the same filters: the first page, and the next one.
  const first = pageHref(
    "people",
    { ...(hostel ? { hostel } : {}), ...(account ? { account } : {}) },
    { q, role },
  );
  const later = after !== undefined;
  const more = next === null ? null : `${first}${first.includes("?") ? "&" : "?"}after=${next}`;

  // Who each row's checkbox may act on (the same tests as the row's own controls).
  const marks = rows.map(({ person }) => {
    const isMe = person.id === user.id;
    const locked = person.role === "developer";
    const move = isAdmin && person.role === "student" && person.account !== "off";
    const link = isAdmin && !isMe && !locked && person.account === "invited";
    const off =
      !isMe && !locked && (isAdmin || person.role === "student") && person.account !== "off";
    return { move, link, off, any: move || link || off };
  });
  const names = Object.fromEntries(rows.map(({ person }) => [person.id, person.name]));
  const anyTickable = marks.some((m) => m.any);

  return (
    <section aria-labelledby="people-heading" className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 id="people-heading" className="font-display text-title text-ink">
          People
        </h1>
        {isAdmin ? (
          <p className="max-w-[65ch] text-muted">
            Find someone and choose their role, correct their details, or turn their account off. A{" "}
            <strong>warden</strong> handles outing requests and escalations, and sees who&apos;s out
            and gate scans, for their own hostels&apos; students only. A{" "}
            <strong>head warden</strong> does that for every hostel and also sets the outing rules.
            An <strong>admin</strong> can do everything, including gates, people and settings. None
            of them sees a live location, except a sharing student&apos;s last position when that
            student is late and hasn&apos;t answered.
          </p>
        ) : (
          <p className="max-w-[65ch] text-muted">
            {user.role === "warden" ? "Your hostels' students." : "Every hostel's students."}{" "}
            Correct a name, roll no. or phone, or turn an account off when someone leaves. An admin
            changes email addresses and adds people.
          </p>
        )}
      </div>

      {isAdmin && (
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <AddPersonForm hostels={hostels} />
          <Link
            href="/admin/people/import"
            className="flex min-h-12 items-center font-bold text-accent underline-offset-4 hover:underline"
          >
            Add people from a CSV
          </Link>
        </div>
      )}

      {params.cancelled === "1" && (
        <p role="status" className="rounded-sheet border border-line px-4 py-3 text-ink">
          Invite cancelled. The emailed set-up link no longer works.
        </p>
      )}

      <div className="flex flex-col gap-3">
        <form method="get" role="search" className="flex flex-wrap items-end gap-3">
          {account && <input type="hidden" name="account" value={account} />}
          {hostel && <input type="hidden" name="hostel" value={hostel} />}
          {role && <input type="hidden" name="role" value={role} />}
          <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-bold text-ink">
            Name, email or roll number
            <input
              type="search"
              name="q"
              defaultValue={q}
              minLength={2}
              maxLength={100}
              className="min-h-12 rounded-control border border-line bg-surface px-4 text-base font-normal text-ink"
            />
          </label>
          <button
            type="submit"
            className="min-h-12 rounded-control bg-ink px-5 font-bold text-page hover:opacity-90"
          >
            Search
          </button>
        </form>
        {mine.length > 1 && (
          <HostelFilter q={q} account={account} hostel={hostel} role={role} hostels={mine} />
        )}
        <Filters q={q} account={account} hostel={hostel} role={role} isAdmin={isAdmin} />
        {/* Last: on a phone the six chips take two rows, and the account filter above stays
            in the first screen. */}
        {isAdmin && <RoleFilter q={q} account={account} hostel={hostel} role={role} />}
      </div>

      {/* Always mounted: its results must outlive the rows they changed (everyone turned off,
          or moved out of this filter); the bar itself only shows while someone is ticked. */}
      <BulkActions isAdmin={isAdmin} hostels={hostels} names={names} />

      {later && (
        <p className="text-sm text-muted">
          Showing more people.{" "}
          <Link
            href={first}
            prefetch={false}
            className="font-bold text-accent-text underline-offset-4 hover:underline"
          >
            Back to the first page
          </Link>
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-sheet border border-dashed border-line px-5 py-8 text-center text-muted">
          {later
            ? "No more people to show."
            : emptyMessage(q, account, isAdmin, mine.find((h) => h.id === hostel)?.name, role)}
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">{resultCount(rows.length)}</p>
          {anyTickable && <SelectAllShown />}
          <ul
            aria-labelledby="people-heading"
            className="divide-y divide-line border-y border-line"
          >
            {rows.map(({ person, full }, index) => {
              // A developer's account is changed only by a server script: no controls (the
              // backend refuses them too), as for your own account.
              const isMe = person.id === user.id;
              const locked = person.role === "developer";
              // A warden or head warden may change students only (the backend says the same).
              const canControl = !isMe && !locked && (isAdmin || person.role === "student");
              const controlled: AccountPerson = {
                ...person,
                account: person.account ?? "active",
              };
              const mark = marks[index]!;
              return (
                <li
                  key={person.id}
                  className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-2 gap-y-3 py-4 sm:grid-cols-[2.75rem_minmax(0,1fr)_minmax(0,22rem)] sm:items-start sm:gap-x-4"
                >
                  {mark.any ? (
                    // Belongs to the bulk form below the list (form attribute): ticking works
                    // without JavaScript; the bar appears by CSS (globals.css).
                    <label className="-mt-2.5 flex size-11 cursor-pointer items-center justify-center rounded-control hover:bg-accent-soft">
                      <input
                        type="checkbox"
                        name="ids"
                        value={person.id}
                        form={BULK_FORM}
                        data-bulk=""
                        data-move={mark.move ? "1" : "0"}
                        data-link={mark.link ? "1" : "0"}
                        data-off={mark.off ? "1" : "0"}
                        aria-label={`Tick ${person.name}`}
                        className="size-5 accent-[var(--color-accent)]"
                      />
                    </label>
                  ) : (
                    <span aria-hidden="true" />
                  )}
                  <Who person={person} isMe={isMe} />
                  <div className="col-start-2 flex min-w-0 flex-col gap-4 sm:col-start-3">
                    {isAdmin && person.role === "student" && person.account !== "off" && (
                      <MoveForm person={person} hostels={hostels} />
                    )}
                    {/* Your own password: Account or Forgot password (the API refuses it here).
                        An account that's off gets turned on first. */}
                    {isAdmin && !isMe && !locked && person.account !== "off" && (
                      <PasswordLinkForm person={person} />
                    )}
                    {isAdmin && full && !locked && (
                      <RoleForm person={person} hostels={hostels} isMe={isMe} />
                    )}
                    {canControl && (
                      <AccountControls person={controlled} isAdmin={isAdmin} back={back} />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {more && (
        <Link
          href={more}
          prefetch={false}
          className="flex min-h-11 items-center self-center font-bold text-accent-text underline-offset-4 hover:underline"
        >
          More people
        </Link>
      )}
    </section>
  );
}

function emptyMessage(
  q: string,
  account: Account,
  isAdmin: boolean,
  hostel?: string,
  role?: ChipRole,
) {
  const matching = q.length >= 2 ? ` matching "${q}"` : "";
  const where = hostel ? ` in ${hostel}` : "";
  if (role && !account) {
    const who = ROLE_CHIPS.find((c) => c.value === role)!.label.toLowerCase();
    return `No ${who}${matching}${where}.`;
  }
  if (account === "invited") return `Everyone${matching}${where} has set up their account.`;
  if (account === "off") return `No accounts${matching}${where} are turned off.`;
  if (isAdmin && q.length >= 2 && !hostel) {
    return `Nobody matches "${q}". Add them with Add a person, or ask them to sign up and verify their email.`;
  }
  if (q.length >= 2) return `No students${where} match "${q}".`;
  return hostel ? `No students live in ${hostel} yet.` : "No students live here yet.";
}

/** Name, role and the account's state in words, then email, roll no., phone and hostel. */
function Who({ person, isMe }: { person: Row["person"]; isMe: boolean }): ReactNode {
  const state = person.account && person.account !== "active" ? person.account : null;
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-2 font-bold text-ink">
        {person.role === "student" ? (
          // Their record: outings, requests, corrections and gate scans.
          <Link
            href={recordHref(person.id)}
            prefetch={false}
            className="truncate underline decoration-line underline-offset-4 hover:decoration-ink"
          >
            {person.name}
          </Link>
        ) : (
          <span className="truncate">{person.name}</span>
        )}
        {person.role !== "student" && (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
            {ROLE_LABEL[person.role]}
          </span>
        )}
        {isMe && <span className="text-xs text-muted">(you)</span>}
      </p>
      {state && (
        <p className="mt-1">
          <span
            className={`inline-block rounded-full border px-2 py-0.5 text-xs font-bold ${
              state === "off" ? "border-danger text-danger" : "border-line text-muted"
            }`}
          >
            {ACCOUNT_LABEL[state]}
          </span>
        </p>
      )}
      <p className="truncate text-sm text-muted">
        {[person.email, person.roll_no, person.phone].filter(Boolean).join(" · ")}
      </p>
      {person.role === "warden" && person.hostels.length > 0 && (
        <p className="text-sm text-muted">Warden of {person.hostels.join(", ")}</p>
      )}
      {person.role === "student" && (
        <p className="text-sm text-muted">{person.home_hostel ?? "No hostel chosen"}</p>
      )}
    </div>
  );
}

const CHIP = "flex min-h-11 items-center rounded-control px-3 text-sm font-bold";
const CHIP_ON = "bg-accent-soft text-ink ring-1 ring-accent";
const CHIP_OFF = "text-muted ring-1 ring-line hover:text-ink";

/**
 * Plain links (no prefetch) through /admin/filter, which remembers the choice for the next
 * visit, then opens the list with it in the address.
 */
function Chip({
  href,
  current,
  children,
}: {
  href: string;
  current: boolean;
  children: ReactNode;
}) {
  return (
    <li>
      <a
        href={href}
        aria-current={current ? "page" : undefined}
        className={`${CHIP} ${current ? CHIP_ON : CHIP_OFF}`}
      >
        {children}
      </a>
    </li>
  );
}

/** Admins and developers: everyone, or one role's people (with or without a search). */
function RoleFilter({
  q,
  account,
  hostel,
  role,
}: {
  q: string;
  account: Account;
  hostel: string | undefined;
  role: ChipRole | undefined;
}): ReactNode {
  return (
    <nav aria-label="Role">
      <ul className="flex flex-wrap gap-1">
        {ROLE_CHIPS.map((chip) => (
          <Chip
            key={chip.label}
            href={filterHref(
              "people",
              { ...(hostel ? { hostel } : {}), ...(account ? { account } : {}) },
              { q, role: chip.value },
            )}
            current={chip.value === role}
          >
            {chip.label}
          </Chip>
        ))}
      </ul>
    </nav>
  );
}

/** All of the viewer's hostels, or one. */
function HostelFilter({
  q,
  account,
  hostel,
  role,
  hostels,
}: {
  q: string;
  account: Account;
  hostel: string | undefined;
  role: ChipRole | undefined;
  hostels: Hostel[];
}): ReactNode {
  const href = (id: string | undefined) =>
    filterHref(
      "people",
      { ...(id ? { hostel: id } : {}), ...(account ? { account } : {}) },
      { q, role },
    );
  return (
    <nav aria-label="Hostel">
      <ul className="flex flex-wrap gap-1">
        <Chip href={href(undefined)} current={hostel === undefined}>
          All hostels
        </Chip>
        {hostels.map((h) => (
          <Chip key={h.id} href={href(h.id)} current={hostel === h.id}>
            {h.name}
          </Chip>
        ))}
      </ul>
    </nav>
  );
}

/** All / not set up / turned off (the list is in the address, like the search). */
function Filters({
  q,
  account,
  hostel,
  role,
  isAdmin,
}: {
  q: string;
  account: Account;
  hostel: string | undefined;
  role: ChipRole | undefined;
  isAdmin: boolean;
}): ReactNode {
  const options = [
    {
      value: undefined,
      label:
        isAdmin && role
          ? "All accounts"
          : isAdmin && q.length >= 2 && !hostel
            ? "Search results"
            : "All students",
    },
    { value: "invited", label: "Hasn't set up" },
    { value: "off", label: "Turned off" },
  ] as const;
  return (
    <nav aria-label="Show">
      <ul className="flex flex-wrap gap-1">
        {options.map((option) => (
          <Chip
            key={option.label}
            href={filterHref(
              "people",
              { ...(hostel ? { hostel } : {}), ...(option.value ? { account: option.value } : {}) },
              { q, role },
            )}
            current={option.value === account}
          >
            {option.label}
          </Chip>
        ))}
      </ul>
    </nav>
  );
}
