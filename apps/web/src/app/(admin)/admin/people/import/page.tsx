import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { StudentImport } from "@/features/admin/components/StudentImport";
import { requireAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Add people" };

const COLUMNS: { name: string; note: string }[] = [
  { name: "name", note: "Required. Their full name." },
  {
    name: "student_id",
    note: 'Required for students: their roll number ("roll no" works too).',
  },
  {
    name: "email",
    note: "Optional for students: leave it out to use <student_id>@geu.ac.in. Staff without a student ID need it.",
  },
  {
    name: "role",
    note: "Optional. student (the default when blank), warden, head warden, or admin.",
  },
  {
    name: "hostel",
    note: "Optional for students (where they live). Required for a warden: the hostel they look after. Must match a hostel's name under Rules.",
  },
  { name: "phone number", note: "Optional. Their own number." },
  { name: "parent's name", note: "Optional. A student's emergency contact." },
  { name: "parent's number", note: 'Optional. A column headed just "number" works too.' },
];

export default async function ImportStudentsPage(): Promise<ReactNode> {
  await requireAdmin();
  return (
    <section aria-labelledby="import-heading" className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/admin/people"
          className="flex min-h-11 items-center self-start text-sm font-bold text-accent underline-offset-4 hover:underline"
        >
          Back to People
        </Link>
        <h1 id="import-heading" className="font-display text-title text-ink">
          Add people from a CSV
        </h1>
        <p className="max-w-[65ch] text-muted">
          Save the list as a CSV (in Excel or Google Sheets: save or download as CSV) and choose it
          below. It can hold students and hostel office staff. Nothing is added until you&apos;ve
          checked the file and confirmed. Each new account is emailed a link to choose its password;
          nobody else sees it.
        </p>
      </div>

      <StudentImport />

      <div className="flex flex-col gap-2">
        <h2 className="text-base font-bold text-ink">Columns</h2>
        <p className="max-w-[65ch] text-sm text-muted">
          The first row names the columns, in any order. Other columns (like an index) are ignored.
          Up to 512 KB and 2000 people per file.
        </p>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
          {COLUMNS.map((c) => (
            <div key={c.name} className="contents">
              <dt className="font-mono font-bold text-ink">{c.name}</dt>
              <dd className="mb-1 text-muted sm:mb-0">{c.note}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
