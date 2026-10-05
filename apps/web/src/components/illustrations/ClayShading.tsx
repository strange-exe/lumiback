import type { ReactNode } from "react";

/**
 * Shared "matte clay" lighting for every illustration: one soft key light from the top-left
 * and a gentle core shadow bottom-right. Shapes keep their own fill (a CSS variable, so dark
 * mode re-lights them) and receive these overlays on top.
 */
export function ClayDefs({ id }: { id: string }): ReactNode {
  return (
    <defs>
      <linearGradient id={`${id}-light`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity="0.38" />
        <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
      <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0.55" stopColor="#000" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity="0.22" />
      </linearGradient>
      <radialGradient id={`${id}-ground`}>
        <stop offset="0" stopColor="var(--clay-shadow)" stopOpacity="0.9" />
        <stop offset="1" stopColor="var(--clay-shadow)" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

/** Draws `children` (one closed shape) three times: base fill, light, and shade. */
export function Clay({
  id,
  fill,
  children,
}: {
  id: string;
  fill: string;
  children: (paint: string) => ReactNode;
}): ReactNode {
  return (
    <g>
      {children(fill)}
      {children(`url(#${id}-light)`)}
      {children(`url(#${id}-shade)`)}
    </g>
  );
}
