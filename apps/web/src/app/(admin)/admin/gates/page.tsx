import type { Metadata } from "next";
import type { ReactNode } from "react";

import { adminApi } from "@/features/admin/api";
import { CreateGateForm, GateActions } from "@/features/admin/components/GateForms";
import { formatWhen } from "@/features/admin/format";
import { kioskLine, type KioskTone } from "@/features/admin/kiosk-health";
import { formatTime } from "@/features/outings/time";
import { requireAdmin } from "@/lib/session";
import type { Gate } from "@/lib/types";

export const metadata: Metadata = { title: "Gates" };

export default async function GatesPage(): Promise<ReactNode> {
  const { token } = await requireAdmin();
  const [gates, settings] = await Promise.all([adminApi.gates(token), adminApi.settings(token)]);
  // "06:00" (IST) as the app writes times elsewhere ("6:00 AM").
  const opensAt = settings.kiosk_quiet_until
    ? formatTime(`2000-01-01T${settings.kiosk_quiet_until}:00+05:30`)
    : null;

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
      <section aria-labelledby="gates-heading" className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 id="gates-heading" className="font-display text-title text-ink">
            Gates
          </h1>
          <p className="max-w-[65ch] text-muted">
            Each gate has a tablet showing a code that changes every 20 seconds. Students scan it
            with the app; their phone&apos;s GPS has to agree they&apos;re at the gate.
          </p>
        </div>
        {gates.length === 0 ? (
          <p className="rounded-sheet border border-dashed border-line px-5 py-10 text-center text-muted">
            No gates yet. Add your first one, then open its kiosk link on the gate&apos;s tablet.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line border-y border-line">
            {gates.map((gate) => (
              <li key={gate.id} className="flex flex-col gap-3 py-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 className="font-display text-xl text-ink">{gate.name}</h2>
                  <span
                    className={`inline-flex rounded-full px-2.5 py-0.5 text-sm font-bold ${
                      gate.active ? "bg-good-soft text-good" : "bg-line text-muted"
                    }`}
                  >
                    {gate.active ? "Taking scans" : "Switched off"}
                  </span>
                </div>
                <p className="text-sm text-muted">
                  Counts scans within {gate.radius_m} m ·{" "}
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${gate.lat}&mlon=${gate.lng}#map=18/${gate.lat}/${gate.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-bold text-accent underline-offset-4 hover:underline"
                  >
                    {gate.lat.toFixed(5)}, {gate.lng.toFixed(5)}
                  </a>
                </p>
                <KioskStatus gate={gate} opensAt={opensAt} />
                <GateActions gate={gate} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <CreateGateForm />
    </div>
  );
}

const TONES: Record<KioskTone, string> = {
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  muted: "bg-line text-muted",
};

/** The gate tablet's health: the label says it; the colour only repeats it. */
function KioskStatus({ gate, opensAt }: { gate: Gate; opensAt: string | null }): ReactNode {
  const line = kioskLine(
    gate.kiosk,
    gate.kiosk_seen_at ? formatWhen(gate.kiosk_seen_at) : null,
    opensAt,
  );
  if (!line) return null;
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm" data-kiosk={gate.kiosk}>
      <span className={`rounded-full px-2.5 py-0.5 font-bold ${TONES[line.tone]}`}>
        {line.label}
      </span>
      <span className="text-muted">{line.detail}</span>
    </p>
  );
}
