"use client";

import { CheckCircle, Warning } from "@phosphor-icons/react";
import Link from "next/link";
import { useId, useRef, useState, useTransition, type ChangeEvent, type ReactNode } from "react";

import { FormError } from "@/components/ui/Field";
import { importStudents, type ImportState } from "@/features/admin/actions";
import { addLabel, csvFileProblem, importSummary } from "@/features/admin/student-import";
import { ROLE_LABEL, type StudentImportRow } from "@/lib/types";

const BUTTON =
  "press min-h-12 rounded-control px-5 text-base font-bold disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY = `${BUTTON} bg-accent text-on-accent shadow-[0_2px_0_rgba(0,0,0,0.12)] enabled:hover:brightness-105`;
const SECONDARY = `${BUTTON} bg-surface text-accent ring-1 ring-line enabled:hover:ring-accent/40`;

/** Each row's state in words; problems also carry an icon and bold text, never colour alone. */
function Status({ row }: { row: StudentImportRow }): ReactNode {
  if (row.status === "error") {
    return (
      <span className="inline-flex items-start gap-1.5 font-bold text-danger">
        <Warning size={18} weight="bold" aria-hidden="true" className="mt-0.5 shrink-0" />
        <span>Problem: {row.error ?? "this row can't be added"}</span>
      </span>
    );
  }
  if (row.status === "added") {
    return (
      <span className="inline-flex items-center gap-1.5 font-bold text-good">
        <CheckCircle size={18} weight="bold" aria-hidden="true" className="shrink-0" />
        Added
      </span>
    );
  }
  if (row.status === "exists") return <span className="text-muted">Already has an account</span>;
  return <span className="font-bold text-ink">New</span>;
}

function RowsTable({ rows, caption }: { rows: StudentImportRow[]; caption: string }): ReactNode {
  return (
    <table className="block w-full text-left md:table">
      <caption className="sr-only">{caption}</caption>
      <thead className="hidden border-b border-line text-sm text-muted md:table-header-group">
        <tr>
          <th scope="col" className="py-2 pr-4 font-normal">
            Line
          </th>
          <th scope="col" className="py-2 pr-4 font-normal">
            Student ID
          </th>
          <th scope="col" className="py-2 pr-4 font-normal">
            Name
          </th>
          <th scope="col" className="py-2 pr-4 font-normal">
            Email
          </th>
          <th scope="col" className="py-2 pr-4 font-normal">
            Role
          </th>
          <th scope="col" className="py-2 pr-4 font-normal">
            Hostel
          </th>
          <th scope="col" className="py-2 font-normal">
            Status
          </th>
        </tr>
      </thead>
      <tbody className="block divide-y divide-line border-y border-line md:table-row-group md:border-t-0">
        {rows.map((r) => (
          <tr
            key={r.line}
            className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 py-3 text-sm md:table-row"
          >
            <td className="tabular-nums text-muted md:py-3 md:pr-4">
              <span className="md:hidden">Line </span>
              {r.line}
            </td>
            <td className="min-w-0 break-words font-mono text-ink md:py-3 md:pr-4">
              {r.student_id || <span className="font-sans text-muted">(none)</span>}
            </td>
            <td className="col-span-2 min-w-0 break-words font-bold text-ink md:py-3 md:pr-4 md:font-normal">
              {r.name || <span className="font-normal text-muted">(no name)</span>}
            </td>
            <td className="col-span-2 min-w-0 break-all text-muted md:py-3 md:pr-4">{r.email}</td>
            <td className="col-span-2 min-w-0 text-ink md:py-3 md:pr-4">
              <span className="text-muted md:hidden">Role: </span>
              {ROLE_LABEL[r.role ?? "student"]}
            </td>
            <td className="col-span-2 min-w-0 break-words text-muted md:py-3 md:pr-4">
              <span className="md:hidden">
                {r.role === "warden" ? "Looks after: " : "Hostel: "}
              </span>
              {r.hostel ?? "Not set"}
            </td>
            <td className="col-span-2 min-w-0 md:py-3">
              <Status row={r} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Choose a CSV, check it (nothing saved), then add the new people. The file is read here
 * and its text sent to a Server Action as a form field (never a multipart upload); the
 * backend checks every row again when adding.
 */
export function StudentImport(): ReactNode {
  const id = useId();
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [state, setState] = useState<ImportState | null>(null);
  const [step, setStep] = useState<"check" | "add">("check");
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  async function choose(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    setState(null);
    setFile(null);
    setOnlyProblems(false);
    const picked = event.target.files?.[0];
    if (!picked) {
      setFileError(null);
      return;
    }
    const problem = csvFileProblem(picked);
    if (problem) {
      setFileError(problem);
      return;
    }
    try {
      setFile({ name: picked.name, csv: await picked.text() });
      setFileError(null);
    } catch {
      setFileError("That file couldn't be read. Choose it again.");
    }
  }

  function send(confirm: boolean): void {
    if (!file) {
      setFileError(fileError ?? "Choose a CSV file first.");
      input.current?.focus();
      return;
    }
    const form = new FormData();
    form.set("csv", file.csv);
    form.set("confirm", String(confirm));
    setStep(confirm ? "add" : "check");
    startTransition(async () => {
      const next = await importStudents({ error: null }, form);
      // A failed add keeps the checked rows on screen, with the reason.
      setState((before) =>
        next.error && confirm && before?.result ? { ...before, error: next.error } : next,
      );
    });
  }

  function startOver(): void {
    setState(null);
    setFile(null);
    setFileError(null);
    setOnlyProblems(false);
    if (input.current) {
      input.current.value = "";
      input.current.focus();
    }
  }

  const result = state?.result ?? null;
  const added = Boolean(state?.confirmed && result);
  const rows = result
    ? onlyProblems
      ? result.rows.filter((r) => r.status === "error")
      : result.rows
    : [];

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          send(false);
        }}
        className="flex flex-col gap-4 rounded-sheet border border-line bg-surface p-5"
        noValidate
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-file`} className="text-sm font-bold text-ink">
            CSV file
          </label>
          <input
            ref={input}
            id={`${id}-file`}
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => void choose(event)}
            aria-describedby={`${id}-file-hint`}
            aria-invalid={fileError ? true : undefined}
            className="min-h-12 min-w-0 rounded-control border border-line bg-page px-3 py-2 text-base text-ink file:mr-3 file:min-h-9 file:cursor-pointer file:rounded-control file:border-0 file:bg-accent-soft file:px-3 file:font-bold file:text-accent"
          />
          <p id={`${id}-file-hint`} className="text-sm text-muted">
            Up to 512 KB. The file is read on this device and only its text is sent.
          </p>
        </div>
        <FormError message={fileError} />
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className={PRIMARY}>
            <span aria-live="polite">
              {pending && step === "check" ? "Checking…" : "Check file"}
            </span>
          </button>
          {file ? <p className="min-w-0 break-all text-sm text-muted">{file.name}</p> : null}
        </div>
      </form>

      {state?.error ? <FormError message={state.error} /> : null}

      {result ? (
        <section aria-labelledby={`${id}-result`} className="flex flex-col gap-4">
          <div role="status" className="flex flex-col gap-1">
            <h2 id={`${id}-result`} className="font-display text-xl text-ink">
              {added ? `Added ${result.added}.` : "Checked. Nothing is added yet."}
            </h2>
            <p className="text-ink">
              {added
                ? result.added > 0
                  ? "Each was emailed a link to choose a password."
                  : "Nobody new was added."
                : `${importSummary(result)}.`}
              {added && result.existing + result.errors > 0
                ? ` ${result.existing + result.errors} skipped (already had an account, or had a problem).`
                : ""}
            </p>
          </div>

          {added ? (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={startOver} className={SECONDARY}>
                Add another file
              </button>
              <Link
                href="/admin/people"
                className="flex min-h-11 items-center font-bold text-accent underline-offset-4 hover:underline"
              >
                Back to People
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => send(true)}
                  disabled={result.new === 0 || pending}
                  aria-describedby={`${id}-add-hint`}
                  className={PRIMARY}
                >
                  <span aria-live="polite">
                    {pending && step === "add" ? "Adding…" : addLabel(result.new)}
                  </span>
                </button>
              </div>
              <p id={`${id}-add-hint`} className="text-sm text-muted">
                {result.new === 0
                  ? "Nothing new to add. Fix the rows with problems and check the file again."
                  : "Rows with a problem and people who already have an account are skipped. Fix a row and check the file again to include it."}
              </p>
            </div>
          )}

          {result.errors > 0 && result.errors < result.rows.length ? (
            <label className="flex min-h-11 cursor-pointer items-center gap-2 self-start text-sm font-bold text-ink">
              <input
                type="checkbox"
                checked={onlyProblems}
                onChange={(event) => setOnlyProblems(event.target.checked)}
                className="size-5 accent-[var(--color-accent)]"
              />
              Show only rows with problems
            </label>
          ) : null}

          <RowsTable
            rows={rows}
            caption={`Rows in ${file?.name ?? "the file"}${onlyProblems ? ", only those with problems" : ""}`}
          />
        </section>
      ) : null}
    </div>
  );
}
