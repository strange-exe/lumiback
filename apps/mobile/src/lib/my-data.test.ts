import { exportFileName, isPickerCancel, saveMyData, type Folder } from "@/lib/my-data";

const NOW = new Date(2026, 10, 5, 9, 30);

function folder(): Folder & { written: Map<string, string> } {
  const written = new Map<string, string>();
  return {
    name: "Download",
    written,
    createFile: (name) => ({ name, write: (text) => void written.set(name, text) }),
  };
}

describe("exportFileName", () => {
  it("uses the phone's calendar date, zero-padded", () => {
    expect(exportFileName(new Date(2026, 0, 5, 23, 59))).toBe("lumiback-data-2026-01-05.json");
    expect(exportFileName(new Date(2026, 10, 25, 0, 1))).toBe("lumiback-data-2026-11-25.json");
  });
});

describe("isPickerCancel", () => {
  it("treats backing out of the folder picker as a cancel", () => {
    expect(isPickerCancel({ code: "ERR_PICKER_CANCELLED", message: "x" })).toBe(true);
    expect(isPickerCancel(new Error("The file picker was cancelled by the user"))).toBe(true);
  });

  it("keeps real failures as errors", () => {
    expect(isPickerCancel(new Error("Unable to write to a file handle"))).toBe(false);
    expect(isPickerCancel(null)).toBe(false);
    expect(isPickerCancel("cancel")).toBe(false);
  });
});

describe("saveMyData", () => {
  it("writes the export as readable JSON into the picked folder", async () => {
    const target = folder();
    const result = await saveMyData({
      pickFolder: async () => target,
      loadExport: async () => ({ account: { email: "riya@geu.ac.in" } }),
      now: NOW,
    });
    expect(result).toEqual({
      kind: "saved",
      folder: "Download",
      file: "lumiback-data-2026-11-05.json",
    });
    const text = target.written.get("lumiback-data-2026-11-05.json") ?? "";
    expect(JSON.parse(text)).toEqual({ account: { email: "riya@geu.ac.in" } });
  });

  it("never downloads when the person backs out of the picker", async () => {
    const loadExport = jest.fn(async () => ({}));
    const result = await saveMyData({
      pickFolder: async () => {
        throw Object.assign(new Error("cancelled"), { code: "ERR_PICKER_CANCELLED" });
      },
      loadExport,
    });
    expect(result).toEqual({ kind: "cancelled" });
    expect(loadExport).not.toHaveBeenCalled();
  });

  it("passes a failed download on, with nothing written", async () => {
    const target = folder();
    await expect(
      saveMyData({
        pickFolder: async () => target,
        loadExport: async () => {
          throw new Error("Too many attempts");
        },
      }),
    ).rejects.toThrow("Too many attempts");
    expect(target.written.size).toBe(0);
  });
});
