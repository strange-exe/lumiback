import { readFileSync } from "fs";
import { join } from "path";

// 2026-11-26: at font_scale 2.0 Today's "Recent trips" heading and its "92% on time, see all"
// link sat in one non-wrapping row with no gap: they ran together ("Recent trips92% on time,
// see") and the link ran off the right edge, so its chevron and part of its words were cut.
// The row wraps the link onto its own line when both no longer fit, with a gap between them,
// and the link's words may wrap themselves when even a line of its own is too narrow.
describe("Today's Recent trips heading", () => {
  const source = readFileSync(join(__dirname, "..", "app", "(app)", "today", "index.tsx"), "utf8");
  const start = source.indexOf("function Recent(");
  const block = start < 0 ? "" : source.slice(start, source.indexOf("</Press>", start));
  const row = /<View\s+style=\{\{([^}]*)\}\}\s*>\s*<T[^>]*>\s*Recent trips/.exec(block);
  const press = /<Press[\s\S]*?style=\{\{([^}]*)\}\}\s*>/.exec(block);
  const link = /<T tone="label" style=\{\{([^}]*)\}\}>\s*\{rate \?/.exec(block);

  it("is found (not vacuous)", () => {
    expect(row).not.toBeNull();
    expect(press).not.toBeNull();
    expect(link).not.toBeNull();
  });

  it("wraps the link under the heading when both don't fit, with a gap between them", () => {
    expect(row?.[1]).toMatch(/flexWrap:\s*"wrap"/);
    expect(row?.[1]).toMatch(/columnGap:\s*space\(\d\)/);
  });

  // The link's text is what shrinks (Press puts its style on an inner view, so a flexShrink
  // there would act on the wrong axis): its words wrap beside the fixed 16 dp chevron.
  it("lets the link's words wrap rather than run off the screen", () => {
    expect(link?.[1]).toMatch(/flexShrink:\s*1/);
  });
});
