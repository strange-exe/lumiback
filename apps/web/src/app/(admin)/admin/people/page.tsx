import type { Metadata } from "next";
import type { ReactNode } from "react";

import { adminApi } from "@/features/admin/api";
import { RoleForm } from "@/features/admin/components/RoleForm";
import { requireAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "People" };

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function PeoplePage({ searchParams }: PageProps): Promise<ReactNode> {
  const { token, user } = await requireAdmin();
  const q = ((await searchParams).q ?? "").trim().slice(0, 100);
  const results = q.length >= 2 ? await adminApi.users(token, q) : null;

  return (
    <section aria-labelledby="people-heading" className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 id="people-heading" className="font-display text-title text-ink">
          People
        </h1>
        <p className="max-w-[65ch] text-muted">
          Find a student or staff member who has signed up, and give or remove admin access. Admins
          see the register, outing requests (with phone numbers), escalations (with emergency and
          warden contacts), gate scans, rules and settings. They never see a live location, except a
          sharing student&apos;s last position when that student is late and hasn&apos;t answered.
        </p>
      </div>
      <form method="get" role="search" className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-bold text-ink">
          Name, email or roll number
          <input
            type="search"
            name="q"
            defaultValue={q}
            minLength={2}
            maxLength={100}
            required
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

      {results !== null &&
        (results.length === 0 ? (
          <p className="rounded-sheet border border-dashed border-line px-5 py-8 text-center text-muted">
            Nobody matches &ldquo;{q}&rdquo;. They need to sign up and verify their email first.
          </p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {results.map((person) => (
              <li key={person.id} className="flex items-center justify-between gap-4 py-3.5">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-bold text-ink">
                    <span className="truncate">{person.name}</span>
                    {person.role === "admin" && (
                      <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
                        Admin
                      </span>
                    )}
                    {person.id === user.id && <span className="text-xs text-muted">(you)</span>}
                  </p>
                  <p className="truncate text-sm text-muted">
                    {[person.email, person.roll_no].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <RoleForm person={person} isMe={person.id === user.id} />
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}
