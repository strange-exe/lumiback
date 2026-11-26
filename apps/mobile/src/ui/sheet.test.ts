import { readFileSync } from "fs";
import { join } from "path";

// The sheet's backdrop must take its colour from the active palette (c.scrim), never from a
// pre-theme literal: a literal stays the same in every theme, so the scrim would not follow
// Gate glass, LED night or Dusk. This reads the source, like role-tokens.test.ts does.
const source = readFileSync(join(__dirname, "sheet.tsx"), "utf8");

describe("the bottom sheet's scrim", () => {
  it("has no colour literal (rgba or hex) in the sheet", () => {
    const literal = /rgba\(|#[0-9a-fA-F]{3,8}\b/;
    const offenders = source
      .split("\n")
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => literal.test(line))
      .map(({ n }) => `sheet.tsx:${n}`);
    expect(offenders).toEqual([]);
  });

  it("paints the scrim layer from the palette's c.scrim", () => {
    expect(source).toMatch(/backgroundColor:\s*c\.scrim/);
  });

  it("still contains the scrim style it is painted with (the check above is not vacuous)", () => {
    expect(source).toContain("scrimStyle");
  });
});
