import assert from "node:assert/strict";
import { test } from "node:test";

import { holeFor, holeRadius, PAD, placeCardTop, placeCardX } from "./place.ts";

const base = { viewportHeight: 800, cardHeight: 200, gap: 12, edge: 16 };

test("the card goes under the highlight when it fits", () => {
  assert.equal(placeCardTop({ ...base, hole: { x: 0, y: 100, width: 300, height: 200 } }), 312);
});

test("the card goes above a highlight near the bottom (the footer's Account)", () => {
  assert.equal(placeCardTop({ ...base, hole: { x: 0, y: 700, width: 300, height: 64 } }), 488);
});

test("the card stays on screen for a highlight too tall for either side", () => {
  const top = placeCardTop({ ...base, hole: { x: 0, y: 100, width: 300, height: 600 } });
  assert.ok(top >= 16);
  assert.ok(top + 200 <= 784);
});

test("the card is centred without a highlight, and stays inside a short viewport", () => {
  assert.equal(placeCardTop({ ...base, hole: null }), 300);
  assert.equal(placeCardTop({ ...base, viewportHeight: 150, hole: null }), 16);
});

test("the card lines up with the highlight's left edge but never leaves the viewport", () => {
  assert.deepEqual(
    placeCardX({ hole: { x: 40, y: 0, width: 80, height: 40 }, viewportWidth: 1440 }),
    {
      left: 40,
      width: 384,
    },
  );
  // A control at the right edge: the card slides left to fit.
  assert.deepEqual(
    placeCardX({ hole: { x: 1400, y: 0, width: 30, height: 40 }, viewportWidth: 1440 }),
    { left: 1440 - 16 - 384, width: 384 },
  );
  // A phone: full width less the edges.
  assert.deepEqual(
    placeCardX({ hole: { x: 200, y: 0, width: 60, height: 40 }, viewportWidth: 320 }),
    {
      left: 16,
      width: 288,
    },
  );
  // No highlight: centred.
  assert.deepEqual(placeCardX({ hole: null, viewportWidth: 1000 }), { left: 308, width: 384 });
});

test("the hole wraps the control with room to spare, clipped to the viewport", () => {
  const viewport = { width: 390, height: 844 };
  assert.deepEqual(holeFor({ x: 100, y: 200, width: 80, height: 44 }, viewport), {
    x: 100 - PAD,
    y: 200 - PAD,
    width: 80 + PAD * 2,
    height: 44 + PAD * 2,
  });
  assert.deepEqual(holeFor({ x: -20, y: 800, width: 100, height: 100 }, viewport), {
    x: 0,
    y: 800 - PAD,
    width: 100 - 20 + PAD,
    height: 844 - (800 - PAD),
  });
  assert.equal(holeFor({ x: 0, y: 900, width: 100, height: 40 }, viewport), null);
});

test("the hole is rounded like a control, never more than half its height", () => {
  assert.equal(holeRadius({ x: 0, y: 0, width: 100, height: 20 }), 10);
  assert.equal(holeRadius({ x: 0, y: 0, width: 300, height: 200 }), 20);
});
