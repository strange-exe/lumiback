/** Adding people from a CSV: the checks and wording the browser needs (no server code here). */

/** The backend refuses larger files (services/student_import.py MAX_BYTES). */
export const MAX_CSV_BYTES = 512 * 1024;

/** Why this file can't be sent, or null if it can. Checked before the file is read. */
export function csvFileProblem(file: { name: string; size: number; type: string }): string | null {
  const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv";
  if (!isCsv)
    return "Choose a .csv file. In Excel or Google Sheets, save or download the sheet as CSV.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_CSV_BYTES) {
    const kb = Math.ceil(file.size / 1024);
    return `That file is ${kb} KB. Files up to 512 KB can be added at once: split it into smaller files.`;
  }
  return null;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "3 new, 1 already has an account, 2 with problems" for a checked file. */
export function importSummary(result: { new: number; existing: number; errors: number }): string {
  return [
    `${result.new} new`,
    `${count(result.existing, "already has", "already have")} an account`,
    `${result.errors} with ${result.errors === 1 ? "a problem" : "problems"}`,
  ].join(", ");
}

/** The confirm button's label. */
export function addLabel(n: number): string {
  return `Add ${n} ${n === 1 ? "person" : "people"}`;
}
