import { Phone } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";

import { formatPhone } from "@/features/admin/format";

/** A person to call, with a tap-to-call link (dials straight from a phone). */
export function Contact({
  label,
  name,
  phone,
}: {
  label: string;
  name?: string | null;
  phone: string | null | undefined;
}): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="flex flex-col gap-0.5">
        {name ? <span className="truncate text-ink">{name}</span> : null}
        {phone ? (
          <a
            href={`tel:${phone}`}
            className="inline-flex min-h-11 items-center gap-1.5 self-start font-bold text-accent tabular-nums underline-offset-4 hover:underline"
          >
            <Phone aria-hidden="true" className="size-4" />
            {formatPhone(phone)}
          </a>
        ) : (
          <span className="text-muted">Not given</span>
        )}
      </dd>
    </div>
  );
}
