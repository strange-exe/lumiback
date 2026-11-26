import { readFileSync } from "fs";
import { join } from "path";

// 2026-11-26: at a large font setting the Scan screen's title ("Scan the gate screen") is wider
// than its row, and a Text in a row does not shrink by default, so it pushed the 44 dp Close
// button past the right edge. The title shrinks (and wraps) to leave Close its room.
describe("the Scan screen's header", () => {
  const source = readFileSync(join(__dirname, "..", "app", "scan.tsx"), "utf8");
  // The title Text: from its opening tag up to the heading text it shows.
  const title =
    /<Text\s+style=\{\[type\.headline,([^\]]*)\]\}[^>]*>[^<]*"Scan the gate screen"/.exec(source);

  it("is found (not vacuous)", () => {
    expect(title).not.toBeNull();
  });

  it("lets the title shrink so Close stays on screen", () => {
    expect(title?.[1]).toMatch(/flexShrink:\s*1/);
  });

  it("keeps a gap between the title and Close", () => {
    const row = source.slice(source.lastIndexOf("flexDirection", title?.index), title?.index);
    expect(row).toMatch(/gap:\s*space\(\d\)/);
  });
});
