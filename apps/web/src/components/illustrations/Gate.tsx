import type { ReactNode } from "react";

import { Clay, ClayDefs } from "@/components/illustrations/ClayShading";

/** A campus gate at dusk, in clay: doors open, a path leading out, a lantern on the arch. */
export function Gate({ className }: { className?: string }): ReactNode {
  const id = "gate";
  return (
    <svg viewBox="0 0 240 172" className={className} aria-hidden="true" focusable="false">
      <ClayDefs id={id} />

      {/* Crescent moon: dusk */}
      <circle cx="204" cy="26" r="11" fill="var(--lantern-glow)" />
      <circle cx="209" cy="22" r="10" fill="var(--page)" />

      <ellipse cx="120" cy="158" rx="112" ry="10" fill={`url(#${id}-ground)`} />

      {/* Low walls either side */}
      <Clay id={id} fill="var(--surface)">
        {(paint) => <rect x="4" y="112" width="30" height="42" rx="6" fill={paint} />}
      </Clay>
      <Clay id={id} fill="var(--surface)">
        {(paint) => <rect x="206" y="112" width="30" height="42" rx="6" fill={paint} />}
      </Clay>

      {/* The path out, narrowing into the distance */}
      <path d="M100 158 L113 108 H127 L140 158 Z" fill="var(--line)" />

      {/* Pillars with pine caps */}
      {[30, 186].map((x) => (
        <g key={x}>
          <Clay id={id} fill="var(--surface)">
            {(paint) => <rect x={x} y="46" width="24" height="110" rx="7" fill={paint} />}
          </Clay>
          <Clay id={id} fill="var(--pine)">
            {(paint) => <rect x={x - 4} y="38" width="32" height="12" rx="6" fill={paint} />}
          </Clay>
        </g>
      ))}

      {/* Arch spanning the pillars */}
      <path
        d="M50 50 Q120 0 190 50"
        fill="none"
        stroke="var(--pine)"
        strokeWidth="8"
        strokeLinecap="round"
      />

      {/* Door leaves, swung open towards us */}
      <Clay id={id} fill="var(--pine-soft)">
        {(paint) => <path d="M54 64 L84 74 V146 L54 154 Z" fill={paint} />}
      </Clay>
      <Clay id={id} fill="var(--pine-soft)">
        {(paint) => <path d="M186 64 L156 74 V146 L186 154 Z" fill={paint} />}
      </Clay>
      <g stroke="var(--pine)" strokeWidth="2" strokeLinecap="round" opacity="0.55">
        <line x1="64" y1="70" x2="64" y2="150" />
        <line x1="74" y1="73" x2="74" y2="148" />
        <line x1="176" y1="70" x2="176" y2="150" />
        <line x1="166" y1="73" x2="166" y2="148" />
      </g>

      {/* Lantern hanging from the arch */}
      <line x1="120" y1="25" x2="120" y2="40" stroke="var(--pine)" strokeWidth="2.5" />
      <Clay id={id} fill="var(--lantern)">
        {(paint) => <rect x="111" y="40" width="18" height="22" rx="6" fill={paint} />}
      </Clay>
      <rect x="115" y="44" width="10" height="14" rx="4" fill="var(--lantern-glow)" />
    </svg>
  );
}
