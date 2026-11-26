import { palettes, themes, type ThemeName } from "@/ui/theme";

import { ringLook } from "./store";

/** WCAG contrast of two #rrggbb colours. */
function ratio(a: string, b: string): number {
  const lum = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("the tour's ring around a control", () => {
  for (const [key, c] of Object.entries(palettes)) {
    const theme = key.split("/")[0] as ThemeName;
    const glow = themes[theme].glow;

    it(`${key}: is drawn in the focus colour, as on the website`, () => {
      expect(ringLook(c, glow).borderColor).toBe(c.focus);
      // The ring edges the lit hole, which shows the page: 3:1 for a ring (WCAG 1.4.11).
      expect(ratio(c.focus, c.page)).toBeGreaterThanOrEqual(3);
    });

    it(`${key}: ${glow ? "keeps its glow (LED night)" : "has no decorative glow"}`, () => {
      if (glow) expect(ringLook(c, glow).boxShadow).toBe(`0 0 18px ${c.led}99`);
      else expect(ringLook(c, glow)).not.toHaveProperty("boxShadow");
    });
  }
});
