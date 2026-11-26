import { readFileSync } from "fs";
import { join } from "path";

import { sheetSurface } from "@/ui/sheet-surface";
import { palettes } from "@/ui/theme";

// Owner, 2026-11-26 (M2): in dark mode a bottom sheet stands apart from the page behind it with
// the raised surface fill and a 1 px hairline along its top; light mode keeps the page fill.
describe("the bottom sheet's surface", () => {
  for (const theme of ["gate", "led", "dusk"] as const) {
    it(`${theme} dark: raised fill and a hairline top edge`, () => {
      const c = palettes[`${theme}/dark`];
      expect(sheetSurface(c, true)).toEqual({
        backgroundColor: c.surface,
        borderTopWidth: 1,
        borderColor: c.line,
      });
      // Not vacuous: the raised fill really differs from the page behind the scrim.
      expect(c.surface.toLowerCase()).not.toBe(c.page.toLowerCase());
    });

    it(`${theme} light: the page fill, no edge`, () => {
      const c = palettes[`${theme}/light`];
      expect(sheetSurface(c, false)).toEqual({ backgroundColor: c.page });
    });
  }

  it("is what the sheet paints itself with", () => {
    const source = readFileSync(join(__dirname, "sheet.tsx"), "utf8");
    expect(source).toMatch(/sheetSurface\(c, dark\)/);
    expect(source).not.toMatch(/backgroundColor:\s*c\.page/);
  });
});
