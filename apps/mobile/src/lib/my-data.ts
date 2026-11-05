/**
 * "Download my data": the server's export of everything kept about the signed-in person, saved
 * as a JSON file in a folder they pick (Android's folder picker, through expo-file-system, which
 * the app already ships for self-updates: no new native module).
 *
 * The folder is picked first, so backing out costs nothing (the export is rate-limited).
 * The picker and the download come in as arguments, so this runs in tests without either.
 */

/** The parts of expo-file-system's Directory and File used here. */
export interface Folder {
  readonly name: string;
  createFile(
    name: string,
    mimeType: string | null,
  ): { readonly name: string; write(text: string): void };
}

export interface SaveDeps {
  pickFolder: () => Promise<Folder>;
  loadExport: () => Promise<unknown>;
  now?: Date;
}

export type SaveResult = { kind: "saved"; folder: string; file: string } | { kind: "cancelled" };

/** lumiback-data-2026-11-05.json, on the phone's own calendar. */
export function exportFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `lumiback-data-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/** The picker throws when the person backs out (expo-file-system's PickerCancelledException). */
export function isPickerCancel(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    (typeof code === "string" && /CANCEL/i.test(code)) ||
    (typeof message === "string" && /cancel/i.test(message))
  );
}

export async function saveMyData({
  pickFolder,
  loadExport,
  now = new Date(),
}: SaveDeps): Promise<SaveResult> {
  let folder: Folder;
  try {
    folder = await pickFolder();
  } catch (error) {
    if (isPickerCancel(error)) return { kind: "cancelled" };
    throw error;
  }
  const data = await loadExport();
  const name = exportFileName(now);
  const file = folder.createFile(name, "application/json");
  file.write(JSON.stringify(data, null, 2));
  // Android adds " (1)" when the folder already has a file of that name.
  return { kind: "saved", folder: folder.name, file: file.name || name };
}
