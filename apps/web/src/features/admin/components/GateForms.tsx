"use client";

import { Check, Copy, Crosshair } from "@phosphor-icons/react";
import { useActionState, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { Field, FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import {
  createGate,
  newKioskLink,
  setGateActive,
  updateGate,
  type GateFormState,
} from "@/features/admin/actions";
import type { Gate } from "@/lib/types";

const EMPTY: GateFormState = { error: null };

const noSubscribe = (): (() => void) => () => {};

/**
 * The one-time kiosk link. The token travels in the URL fragment, which browsers never send to
 * a server, so it stays out of every access log; the kiosk page moves it into the tablet's storage.
 */
export function KioskLink({ gate, token }: { gate: string; token: string }): ReactNode {
  const origin = useSyncExternalStore(
    noSubscribe,
    () => window.location.origin,
    () => "",
  );
  const link = `${origin}/kiosk#k=${token}`;
  const [copied, setCopied] = useState(false);
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-sheet border border-accent/40 bg-accent-soft p-5"
    >
      <div className="flex flex-col gap-1">
        <p className="font-bold text-ink">Kiosk link for {gate}</p>
        <p className="text-sm text-muted">
          Open it once on the tablet at this gate; it remembers it. This link is shown only now.
          Anyone with it can show this gate&apos;s code, so don&apos;t share it in a group.
        </p>
      </div>
      <code className="block overflow-x-auto rounded-control bg-surface px-3 py-2.5 text-sm text-ink">
        {link}
      </code>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(link);
            setCopied(true);
          }}
          className="inline-flex min-h-11 items-center gap-2 rounded-control bg-ink px-4 text-sm font-bold text-page hover:opacity-90"
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? "Copied" : "Copy link"}
        </button>
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center rounded-control px-4 text-sm font-bold text-accent ring-1 ring-line hover:bg-surface"
        >
          Open the kiosk here
        </a>
      </div>
    </div>
  );
}

export function CreateGateForm(): ReactNode {
  const [state, action] = useActionState(createGate, EMPTY);
  const lat = useRef<HTMLInputElement>(null);
  const lng = useRef<HTMLInputElement>(null);
  const [fix, setFix] = useState<string | null>(null);

  function fillFromDevice(): void {
    if (!("geolocation" in navigator)) {
      setFix("This browser can't share its location. Enter the numbers instead.");
      return;
    }
    setFix("Finding this device…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (lat.current) lat.current.value = position.coords.latitude.toFixed(6);
        if (lng.current) lng.current.value = position.coords.longitude.toFixed(6);
        setFix(`Got it, accurate to about ${Math.round(position.coords.accuracy)} m.`);
      },
      () => setFix("Location was blocked or unavailable. Enter the numbers instead."),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {state.kiosk && <KioskLink gate={state.kiosk.gate} token={state.kiosk.token} />}
      <form
        action={action}
        aria-labelledby="add-gate-heading"
        className="flex flex-col gap-4 rounded-sheet border border-line bg-surface p-5 sm:p-6"
      >
        <div className="flex flex-col gap-1">
          <h2 id="add-gate-heading" className="font-display text-xl text-ink">
            Add a gate
          </h2>
          <p className="text-sm text-muted">
            Easiest standing at the gate: use this device&apos;s location, then set how far from it
            a scan still counts.
          </p>
        </div>
        <Field
          label="Name"
          name="name"
          placeholder="Main Gate"
          maxLength={60}
          required
          defaultValue={state.fields?.name}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            ref={lat}
            label="Latitude"
            name="lat"
            inputMode="decimal"
            placeholder="30.268700"
            defaultValue={state.fields?.lat}
          />
          <Field
            ref={lng}
            label="Longitude"
            name="lng"
            inputMode="decimal"
            placeholder="77.994700"
            defaultValue={state.fields?.lng}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={fillFromDevice}
            className="inline-flex min-h-11 items-center gap-2 rounded-control px-4 text-sm font-bold text-accent ring-1 ring-line hover:bg-accent-soft"
          >
            <Crosshair aria-hidden="true" className="size-4" />
            Use this device&apos;s location
          </button>
          <p aria-live="polite" className="text-sm text-muted">
            {fix}
          </p>
        </div>
        <Field
          label="Scan radius (metres)"
          name="radius_m"
          type="number"
          min={10}
          max={500}
          defaultValue={state.fields?.radius_m ?? "75"}
          hint="Scans count within this distance, plus some allowance for GPS error (up to 50 m)."
        />
        <FormError message={state.error} />
        <SubmitButton pendingLabel="Adding…" className="self-start">
          Add gate
        </SubmitButton>
      </form>
    </div>
  );
}

/** Switch on/off, a new kiosk link, and edit, for one gate. */
export function GateActions({ gate }: { gate: Gate }): ReactNode {
  const [toggle, toggleAction] = useActionState(setGateActive, EMPTY);
  const [kiosk, kioskAction] = useActionState(newKioskLink, EMPTY);
  const [edit, editAction] = useActionState(updateGate, EMPTY);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <form action={toggleAction}>
          <input type="hidden" name="gate_id" value={gate.id} />
          <input type="hidden" name="active" value={gate.active ? "false" : "true"} />
          <SubmitButton
            variant="secondary"
            pendingLabel={gate.active ? "Switching off…" : "Switching on…"}
            className="min-h-11 text-sm"
          >
            {gate.active ? "Switch off" : "Switch on"}
          </SubmitButton>
        </form>
        <form
          action={kioskAction}
          onSubmit={(event) => {
            const ok = window.confirm(
              `Make a new kiosk link for ${gate.name}? The tablet using the old link stops working until you open the new one on it.`,
            );
            if (!ok) event.preventDefault();
          }}
        >
          <input type="hidden" name="gate_id" value={gate.id} />
          <SubmitButton variant="secondary" pendingLabel="Making…" className="min-h-11 text-sm">
            New kiosk link
          </SubmitButton>
        </form>
      </div>
      <FormError message={toggle.error ?? kiosk.error} />
      {kiosk.kiosk && <KioskLink gate={kiosk.kiosk.gate} token={kiosk.kiosk.token} />}
      <details className="group">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-sm font-bold text-accent">
          Edit name or radius
        </summary>
        <form action={editAction} className="mt-2 flex flex-wrap items-end gap-3">
          <input type="hidden" name="gate_id" value={gate.id} />
          <Field
            label="Name"
            name="name"
            defaultValue={gate.name}
            maxLength={60}
            id={`name-${gate.id}`}
          />
          <Field
            label="Radius (m)"
            name="radius_m"
            type="number"
            min={10}
            max={500}
            defaultValue={String(gate.radius_m)}
            id={`radius-${gate.id}`}
            className="w-28"
          />
          <SubmitButton pendingLabel="Saving…" className="min-h-12">
            Save
          </SubmitButton>
          <p aria-live="polite" className="basis-full text-sm">
            {edit.error ? (
              <span className="font-bold text-danger">{edit.error}</span>
            ) : (
              <span className="text-good">{edit.notice}</span>
            )}
          </p>
        </form>
      </details>
    </div>
  );
}
