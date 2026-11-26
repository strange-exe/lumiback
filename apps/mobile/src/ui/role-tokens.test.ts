import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

// Screens never ask which colour theme is on: the "out" status has its own role colours
// (outText / outSoft), because the accent is a different thing in each theme (ink in Gate glass,
// orchid in Dusk). These checks read the source, so a new screen can't slip back to the accent.
const src = join(__dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

const sources = files(src).map((path) => ({
  path: relative(src, path).replace(/\\/g, "/"),
  text: readFileSync(path, "utf8"),
}));

describe("the out status's colours", () => {
  it("never give an Out chip or status the accent's tone", () => {
    const offenders: string[] = [];
    for (const { path, text } of sources) {
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        // A chip or status written over one or two lines: its "Out..." label, then its tone.
        const near = `${line}\n${lines[i + 1] ?? ""}`;
        if (/"Out( now)?"/.test(line) && /tone[=:]\s*\{?[^\n]*"accent"/.test(near)) {
          offenders.push(`${path}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("finds the Out chips it guards (the check above isn't passing on nothing)", () => {
    const outChips = sources.filter(({ text }) => /tone[=:]\s*\{?[^\n]*"out"/.test(text));
    expect(outChips.map((s) => s.path).sort()).toEqual(
      expect.arrayContaining([
        "app/(app)/today/index.tsx",
        "app/office/student/[id].tsx",
        "app/office/students.tsx",
        "screens/office/OutList.tsx",
        "ui/OutingRow.tsx",
      ]),
    );
  });

  it("writes text links and quiet text actions in the link colour", () => {
    // [file, the action's words]: each is written in c.link, within the few lines above it.
    const actions: [string, string][] = [
      ["app/(auth)/sign-in.tsx", "Forgot password?"],
      ["app/(auth)/sign-in.tsx", "Create your account"],
      ["app/(auth)/register.tsx", "privacy notice"],
      ["app/(auth)/register.tsx", "Sign in"],
      ["app/office/rules.tsx", "Edit rules on the website"],
      ["app/office/late.tsx", '{row.back ? "Correct" : "Record return"}'],
      ["app/office/late.tsx", "History"],
      ["screens/office/OutList.tsx", "Record return"],
      ["screens/office/OutList.tsx", "History"],
      ["screens/office/BackList.tsx", "Correct"],
      ["screens/office/HelpList.tsx", "Open map"],
      ["screens/office/EscalationCard.tsx", "Open map"],
      ["screens/board.tsx", "{more}"],
      ["ui/OutingRow.tsx", "Something wrong?"],
    ];
    const wrong: string[] = [];
    for (const [path, words] of actions) {
      const lines = sources.find((s) => s.path === path)!.text.split("\n");
      const at = lines.findIndex((l) => l.trim() === words);
      if (at < 0) {
        wrong.push(`${path}: "${words}" not found`);
        continue;
      }
      const above = lines.slice(Math.max(0, at - 6), at).join("\n");
      if (!/color: c\.link\b/.test(above)) wrong.push(`${path}: "${words}"`);
    }
    expect(wrong).toEqual([]);
    // And no router Link anywhere is written in the accent.
    const links = sources
      .filter(({ text }) => /<Link\b[^>]*c\.accent/.test(text))
      .map((s) => s.path);
    expect(links).toEqual([]);
  });

  it("lights the Out now step of Today's phase strip in the LED colour", () => {
    const file = sources.find((s) => s.path === "screens/phase-strip.tsx")!.text;
    const strip = file.slice(file.indexOf("function PhaseStrip("));
    const body = strip.slice(0, strip.indexOf("\n}\n"));
    expect(body).toMatch(/s\.state === "now"\s*\?\s*c\.led\b/);
    expect(body).not.toContain("c.accent");
  });

  it("gives Profile's update badge the kit's chip colours (teal is for Out alone)", () => {
    const profile = sources.find((s) => s.path === "app/(app)/profile/index.tsx")!.text;
    const badge = profile.slice(profile.indexOf("function Badge("));
    const body = badge.slice(0, badge.indexOf("\n}\n"));
    expect(body).toMatch(/chipColours\(c, tone\)/);
    expect(body).not.toMatch(/c\.accentSoft|c\.accentText/);
  });
});

describe("the status bar", () => {
  it("follows light or dark mode on every root screen, the starting board included", () => {
    // The starting screen paints the board (light by day in every theme) under the status bar.
    const root = sources.find((s) => s.path === "app/_layout.tsx")!.text;
    const bars = root.match(/<StatusBar\b[^>]*\/>/g) ?? [];
    expect(bars.length).toBeGreaterThanOrEqual(3);
    for (const bar of bars) expect(bar).toContain('style={scheme === "dark" ? "light" : "dark"}');
  });
});
