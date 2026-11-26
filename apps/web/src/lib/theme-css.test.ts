import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { themeColor, THEMES, type ThemeName } from "./theme.ts";

/**
 * The colour themes as globals.css defines them: every theme x mode is one complete block of
 * CSS variables (gate on :root, the others under [data-theme]), and every pair the app shows
 * text or a control on passes WCAG 2.2 AA there.
 */
const CSS = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);
const DARK = "@media (prefers-color-scheme: dark)";
type Mode = "light" | "dark";

interface Rule {
  media: string | null;
  selectors: string[];
  body: string;
}

/** Flat list of rules with the @media they sit in (enough for the token blocks). */
function rules(css: string): Rule[] {
  const out: Rule[] = [];
  const stack: string[] = [];
  let buf = "";
  for (const ch of css) {
    if (ch === "{") {
      // The selector is what follows the last statement (an @import, a declaration).
      stack.push((buf.split(";").pop() ?? "").trim());
      buf = "";
    } else if (ch === "}") {
      const prelude = stack.pop() ?? "";
      if (!prelude.startsWith("@")) {
        out.push({
          media: stack.find((s) => s.startsWith("@media")) ?? null,
          selectors: prelude.split(",").map((s) => s.trim()),
          body: buf,
        });
      }
      buf = "";
    } else {
      buf += ch;
    }
  }
  return out;
}

function palette(theme: ThemeName, mode: Mode): Map<string, string> {
  const selector = `[data-theme="${theme}"]`;
  const found = rules(CSS).filter(
    (r) =>
      r.selectors.includes(selector) &&
      (mode === "dark" ? r.media === DARK : r.media === null) &&
      /--page\s*:/.test(r.body),
  );
  assert.equal(found.length, 1, `one ${theme}/${mode} token block`);
  const vars = new Map<string, string>();
  for (const decl of found[0].body.split(";")) {
    const m = /^\s*(--[\w-]+|color-scheme)\s*:\s*([\s\S]+?)\s*$/.exec(decl);
    if (m) vars.set(m[1], m[2]);
  }
  return vars;
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  assert.ok(m, `${hex} is an opaque #rrggbb colour`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** [text or control, background, minimum]: 4.5 for text, 3 for large figures and controls. */
const PAIRS: [string, string, number][] = [
  ["--ink", "--page", 4.5],
  ["--ink", "--surface", 4.5],
  ["--ink", "--raised", 4.5],
  ["--muted", "--surface", 4.5],
  ["--muted", "--page", 4.5],
  ["--link", "--surface", 4.5],
  ["--link", "--page", 4.5],
  ["--on-accent", "--accent", 4.5],
  // Secondary buttons and chips: link-coloured words on the soft accent fill.
  ["--link", "--accent-soft", 4.5],
  ["--ink", "--accent-soft", 4.5],
  ["--on-board", "--board", 4.5],
  ["--board-muted", "--board", 4.5],
  ["--led", "--board", 3],
  ["--led-danger", "--board", 3],
  ["--led-good", "--board", 3],
  ["--out-text", "--out-soft", 4.5],
  ["--out-text", "--surface", 4.5],
  ["--ink", "--out-soft", 4.5],
  ["--good", "--good-soft", 4.5],
  ["--danger", "--danger-soft", 4.5],
  ["--warn", "--warn-soft", 4.5],
  ["--danger", "--surface", 4.5],
  ["--good", "--surface", 4.5],
  ["--field", "--surface", 3],
  ["--focus", "--page", 3],
  ["--focus", "--surface", 3],
  ["--on-hero", "--hero", 4.5],
  ["--hero-accent", "--hero", 3],
];

const MODES: Mode[] = ["light", "dark"];

test("every theme and mode defines the same complete set of tokens", () => {
  const names = (t: ThemeName, m: Mode) => [...palette(t, m).keys()].sort().join(" ");
  const reference = names("gate", "light");
  for (const { id } of THEMES) {
    for (const mode of MODES) assert.equal(names(id, mode), reference, `${id}/${mode}`);
  }
  for (const token of ["--link", "--focus", "--out-text", "--out-soft", "--led-ghost"]) {
    assert.ok(reference.split(" ").includes(token), `${token} is a token`);
  }
});

test("Gate glass is also the :root default (no attribute, or an unknown one)", () => {
  for (const media of [null, DARK]) {
    const gate = rules(CSS).filter(
      (r) => r.media === media && r.selectors.includes('[data-theme="gate"]'),
    );
    assert.ok(
      gate.some((r) => r.selectors.includes(":root")),
      `${media ?? "light"}: gate's block is :root`,
    );
  }
});

for (const { id } of THEMES) {
  for (const mode of MODES) {
    test(`${id}/${mode}: text and controls pass AA`, () => {
      const p = palette(id, mode);
      const failures = PAIRS.flatMap(([fg, bg, min]) => {
        const r = ratio(p.get(fg) ?? "", p.get(bg) ?? "");
        return r >= min ? [] : [`${fg} on ${bg}: ${r.toFixed(2)} < ${min}`];
      });
      assert.deepEqual(failures, []);
      assert.equal(p.get("color-scheme"), mode);
    });

    test(`${id}/${mode}: the browser bar colours match the page and the board`, () => {
      const p = palette(id, mode);
      const pick = (which: "page" | "board") =>
        themeColor(id, which).find((c) => c.media.includes(mode))?.color;
      assert.equal(pick("page"), p.get("--page"));
      assert.equal(pick("board"), p.get("--board"));
    });
  }
}

/** Every rule that isn't a theme's token block (those hold --page). */
const OTHER_RULES = rules(CSS).filter((r) => !/--page\s*:/.test(r.body));

/** The three channels of a literal colour, or null when it isn't one we can read. */
function channels(literal: string): number[] | null {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(literal);
  if (hex) {
    const h = hex[1].length <= 4 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(literal);
  return rgb ? rgb.slice(1, 4).map(Number) : null;
}

test("outside the theme blocks every literal colour is a neutral: hues come from the tokens", () => {
  const hued = OTHER_RULES.flatMap((r) =>
    (r.body.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) ?? []).flatMap((literal) => {
      const c = channels(literal);
      return c && new Set(c).size > 1 ? [`${r.selectors.join(", ")}: ${literal}`] : [];
    }),
  );
  assert.deepEqual(hued, []);
});

test("decorative glows in the accent colour are LED night's alone", () => {
  const unscoped = OTHER_RULES.filter(
    (r) =>
      /color-mix\(\s*in srgb,\s*var\(--accent\)/.test(r.body) &&
      !r.selectors.every((s) => s.startsWith('[data-theme="led"]')),
  ).map((r) => r.selectors.join(", "));
  assert.deepEqual(unscoped, []);
  // The stage's breathing glow and scan band: no content (so nothing drawn) in other themes.
  const fx = OTHER_RULES.filter((r) => r.selectors.some((s) => s.includes(".led-stage-fx::")));
  assert.ok(fx.length >= 2, "the glow and the scan band exist");
  for (const r of fx) assert.ok(r.selectors.every((s) => s.startsWith('[data-theme="led"]')));
});

test("no component casts an accent glow inline (a Tailwind value can't be scoped to LED night)", () => {
  const src = new URL("../", import.meta.url);
  const inline = readdirSync(src, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".test.ts"))
    .filter((file) =>
      /color-mix\(\s*in[_\s]srgb,\s*var\(--accent\)/.test(
        readFileSync(new URL(file.replaceAll("\\", "/"), src), "utf8"),
      ),
    );
  assert.deepEqual(inline, []);
  // The landing page's primary button keeps its glow in LED night only, from globals.css.
  assert.ok(
    OTHER_RULES.some((r) => r.selectors.includes('[data-theme="led"] .hero-primary')),
    "LED night's hero-primary glow",
  );
});

test("links use the link role, and the live map's person is the theme's signal colour", () => {
  const accentText = OTHER_RULES.filter((r) => r.body.includes("var(--accent-text)")).map((r) =>
    r.selectors.join(", "),
  );
  assert.deepEqual(accentText, [], "text in the accent colour is --link (or --out-text)");
  const dot = OTHER_RULES.filter((r) =>
    r.selectors.some((s) => s === ".live-dot" || s === ".live-accuracy"),
  );
  assert.equal(dot.length, 2);
  for (const r of dot) {
    // Gate glass's accent is ink (a button fill), not a hue: the dot would read as a black blob.
    assert.doesNotMatch(r.body, /var\(--accent\)/, r.selectors.join(", "));
    assert.match(r.body, /var\(--led\)/, r.selectors.join(", "));
  }
  const halo = /@keyframes live-halo\s*\{([\s\S]*?)\n\}/.exec(CSS);
  assert.ok(halo, "the live dot's halo");
  assert.doesNotMatch(halo[1], /var\(--accent\)/);
});
