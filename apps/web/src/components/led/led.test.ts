import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { hasGlyphs, layout, ROWS } from "./glyphs.ts";
import { countdown, LED_TONE } from "./led.ts";
import { LedFigure } from "./LedFigure.ts";

const render = (props: Parameters<typeof LedFigure>[0]): string =>
  renderToStaticMarkup(createElement(LedFigure, props));

const svgOf = (html: string, cls: string): string =>
  html.match(new RegExp(`<svg class="${cls}"[^>]*>(.*?)</svg>`))?.[1] ?? "";
const dots = (svg: string): number => svg.match(/<circle /g)?.length ?? 0;

test("layout: 5-wide glyphs, a 1-wide colon, one unlit column between characters", () => {
  const clock = layout("1:12");
  assert.deepEqual(
    clock.chars.map((c) => [c.x, c.width, c.colon]),
    [
      [0, 5, false],
      [6, 1, true],
      [8, 5, false],
      [14, 5, false],
    ],
  );
  assert.equal(clock.columns, 19);
  // The colon is two dots, centred on the middle row.
  assert.deepEqual(clock.chars[1].dots, [
    [6, 2],
    [6, 4],
  ]);
  // Every lit dot sits inside its own character's cell and the panel's rows.
  for (const ch of layout("+99:59 IN OUT LATE").chars)
    for (const [x, y] of ch.dots) {
      assert.ok(x >= ch.x && x < ch.x + ch.width);
      assert.ok(y >= 0 && y < ROWS);
    }
  // Same width for every digit, so a ticking clock never shifts.
  const widths = new Set([..."0123456789"].map((d) => layout(d).columns));
  assert.deepEqual([...widths], [5]);
});

test("every figure the app shows has a glyph; lower case reads as upper", () => {
  for (const text of ["IN", "OUT", "LATE", "+99:59", "0123456789", "-", "in"])
    assert.ok(hasGlyphs(text), text);
  assert.equal(hasGlyphs("?"), false);
  assert.deepEqual(layout("in"), layout("IN"));
  // An unknown character is a blank cell, never a crash.
  assert.equal(layout("?").chars[0].dots.length, 0);
});

test("the countdown reads as a figure and in words", () => {
  const minute = 60_000;
  assert.deepEqual(countdown(72 * minute), {
    state: "out",
    text: "1:12",
    unit: "h",
    label: "1 hour 12 minutes left",
  });
  assert.deepEqual(countdown(45 * minute), {
    state: "out",
    text: "45",
    unit: "min",
    label: "45 minutes left",
  });
  assert.equal(countdown(60 * minute).label, "1 hour left");
  assert.equal(countdown(60 * minute).text, "1:00");
  // Rounded up: a few seconds left is still "1 minute left", never "0".
  assert.equal(countdown(5_000).label, "1 minute left");
});

test("past the return time the countdown turns late and counts up", () => {
  const minute = 60_000;
  assert.deepEqual(countdown(-18 * minute), {
    state: "late",
    text: "+18",
    unit: "min",
    label: "18 minutes late",
  });
  assert.equal(countdown(0).state, "late");
  assert.equal(countdown(0).text, "+1");
  // Whole minutes late, rounded down like the server's late_minutes: 18 min 40 s is "+18".
  assert.equal(countdown(-(18 * minute + 40_000)).text, "+18");
  assert.equal(countdown(-65 * minute).text, "+1:05");
  assert.equal(countdown(-65 * minute).label, "1 hour 5 minutes late");
  assert.equal(countdown(-1_000 * 60 * minute).text, "+99:59"); // capped, never overflows the board
});

test("LedFigure: the label is its accessible name, and the dot panel is hidden from screen readers", () => {
  const html = render({ text: "1:12", label: "1 hour 12 minutes left", unit: "h" });
  assert.match(html, /^<span role="img" aria-label="1 hour 12 minutes left"/);
  // One hidden panel holds both layers; the unit is hidden too.
  assert.match(html, /<span class="led-panel" aria-hidden="true" style="width:[\d.]+em">/);
  assert.match(html, /<span class="led-unit" aria-hidden="true">h<\/span>/);
  const hidden = html.indexOf('aria-hidden="true"');
  assert.ok(hidden > 0 && hidden < html.indexOf("<svg"), "the dots sit inside the hidden part");
  // The unlit layer is the full grid (19 columns x 7 rows); the lit layer is the figure's dots.
  assert.equal(dots(svgOf(html, "led-unlit")), 19 * ROWS);
  const lit = layout("1:12").chars.reduce((n, c) => n + c.dots.length, 0);
  assert.equal(dots(svgOf(html, "led-lit")), lit);
  assert.match(html, /viewBox="0 0 19 7"/);
  // Width follows the grid: 19 columns on a 0.8em-tall panel of 7 rows.
  assert.match(html, new RegExp(`width:${((19 / 7) * 0.8).toFixed(4)}em`));
});

test("LedFigure: each state has its colour class, and only the colon blinks", () => {
  for (const state of ["out", "late", "in"] as const) {
    const html = render({ text: "IN", label: "In", state });
    assert.match(html, new RegExp(`class="led-figure ${LED_TONE[state]}"`));
    assert.match(html, new RegExp(`data-led-state="${state}"`));
  }
  assert.equal(LED_TONE.out, "led-out");
  assert.equal(LED_TONE.late, "led-late");
  assert.equal(LED_TONE.in, "led-in");
  assert.match(render({ text: "IN", label: "In" }), /led-out/); // out is the default
  const clock = render({ text: "1:12", label: "x" });
  assert.equal(clock.match(/led-colon/g)?.length, 1);
  // The blinking group holds the colon's two lit dots and nothing else.
  assert.equal(dots(clock.match(/<g class="led-colon">(.*?)<\/g>/)?.[1] ?? ""), 2);
  assert.doesNotMatch(render({ text: "12", label: "x" }), /led-colon/);
});

test("LedFigure: no unit, no unit element; extra classes are kept", () => {
  const html = render({ text: "4", label: "4", className: "text-5xl" });
  assert.doesNotMatch(html, /led-unit/);
  assert.match(html, /class="led-figure led-out text-5xl"/);
});
