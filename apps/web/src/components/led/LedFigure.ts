import { createElement as h, type ReactElement } from "react";

import { layout, ROWS } from "./glyphs.ts";
import { LED_TONE, type LedState } from "./led.ts";

export interface LedFigureProps {
  /** What the panel shows: "1:12", "+18", "IN", "12". */
  text: string;
  /** The same in words; it is the figure's accessible name ("1 hour 12 minutes left"). */
  label: string;
  state?: LedState;
  /** A small unit after the figure ("h", "min", "s"); in body type, on the panel's baseline. */
  unit?: string;
  /** Size and spacing (font-size sets the figure's size: the panel is 0.8em tall). */
  className?: string;
}

const R = 0.36; // dot radius in a 1x1 cell: round dots with a clear gap, like a real panel

function dot(key: string, cx: number, cy: number): ReactElement {
  return h("circle", { key, cx: cx + 0.5, cy: cy + 0.5, r: R });
}

/**
 * A dot-matrix figure for the LED board: a uniform 5x7 grid of round dots per character, every
 * dot present and unlit by default; the figure's dots light in the state's colour with a glow,
 * and the colon blinks. Screen readers get `label` only: the panel is hidden from them.
 *
 * Written with createElement rather than JSX so `node --test` can render it in unit tests (it
 * only strips types; it can't load .tsx). No hooks: works in server and client components.
 */
export function LedFigure({
  text,
  label,
  state = "out",
  unit,
  className = "",
}: LedFigureProps): ReactElement {
  const { columns, chars } = layout(text);
  const viewBox = `0 0 ${columns} ${ROWS}`;
  const svg = (cls: string, children: ReactElement[]): ReactElement =>
    h(
      "svg",
      { className: cls, viewBox, preserveAspectRatio: "xMinYMid meet", focusable: "false" },
      children,
    );

  const unlit: ReactElement[] = [];
  for (let x = 0; x < columns; x += 1)
    for (let y = 0; y < ROWS; y += 1) unlit.push(dot(`${x}.${y}`, x, y));

  // Keyed by position, so digits change in place (no re-light) as the time ticks.
  const lit = chars.map((ch, index) =>
    h(
      "g",
      { key: index, className: ch.colon ? "led-colon" : undefined },
      ch.dots.map(([x, y]) => dot(`${x}.${y}`, x, y)),
    ),
  );

  return h(
    "span",
    {
      role: "img",
      "aria-label": label,
      "data-led-state": state,
      className: `led-figure ${LED_TONE[state]} ${className}`.trim(),
    },
    h(
      "span",
      {
        className: "led-panel",
        "aria-hidden": "true",
        style: { width: `${((columns / ROWS) * 0.8).toFixed(4)}em` },
      },
      svg("led-unlit", unlit),
      svg("led-lit", lit),
    ),
    unit ? h("span", { className: "led-unit", "aria-hidden": "true" }, unit) : null,
  );
}
