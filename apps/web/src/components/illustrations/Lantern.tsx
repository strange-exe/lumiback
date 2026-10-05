import type { CSSProperties, ReactNode } from "react";

import { Clay, ClayDefs } from "@/components/illustrations/ClayShading";

interface LanternProps {
  /** Lit while the student is out (someone is waiting); dark once they're back. */
  lit: boolean;
  className?: string;
  style?: CSSProperties;
}

/** The anchor object of the app: a small clay lantern. Decorative; meaning is always in text. */
export function Lantern({ lit, className, style }: LanternProps): ReactNode {
  const id = "lantern";
  return (
    <svg
      viewBox="0 0 64 84"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <ClayDefs id={id} />
      <radialGradient id="lantern-glow">
        <stop offset="0" stopColor="var(--lantern-glow)" />
        <stop offset="0.7" stopColor="var(--lantern)" />
        <stop offset="1" stopColor="var(--lantern)" stopOpacity="0.85" />
      </radialGradient>

      <ellipse cx="32" cy="78" rx="24" ry="5" fill={`url(#${id}-ground)`} />

      <path
        d="M24 10a8 8 0 0 1 16 0"
        fill="none"
        stroke="var(--pine)"
        strokeWidth="3.5"
        strokeLinecap="round"
      />

      <Clay id={id} fill="var(--pine)">
        {(paint) => <path d="M18 14h28l-3 8H21z" fill={paint} />}
      </Clay>

      <Clay id={id} fill={lit ? "var(--lantern)" : "var(--line)"}>
        {(paint) => <rect x="16" y="22" width="32" height="42" rx="10" fill={paint} />}
      </Clay>

      <g className={lit ? "lantern-lit" : undefined}>
        <rect
          x="23"
          y="29"
          width="18"
          height="28"
          rx="7"
          fill={lit ? "url(#lantern-glow)" : "var(--stone)"}
          opacity={lit ? 1 : 0.35}
        />
        {lit && <ellipse cx="32" cy="46" rx="3" ry="5" fill="#fff" opacity="0.75" />}
      </g>

      <Clay id={id} fill="var(--pine)">
        {(paint) => <rect x="19" y="63" width="26" height="7" rx="3.5" fill={paint} />}
      </Clay>
    </svg>
  );
}
