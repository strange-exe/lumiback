import { useMemo, type ReactNode } from "react";

import { qrPath } from "@/features/kiosk/qr-path";

export function QrCode({
  text,
  label,
  className,
}: {
  text: string;
  label: string;
  className?: string;
}): ReactNode {
  const { path, size } = useMemo(() => qrPath(text), [text]);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#0b0c10" />
    </svg>
  );
}
