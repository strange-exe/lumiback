import type { Outing } from "@/lib/types";

/** "Shopping!" -> "Shopping.": one trailing . ! or ? is dropped before the full stop is added. */
export function sentence(text: string): string {
  return `${text.trim().replace(/[.!?]$/, "")}.`;
}

/**
 * How a trip was recorded. Only a trip scanned at the gate both ways is fully verified; a gate
 * tap-out with a self-reported return says just that.
 */
export function viaLabel(outing: Pick<Outing, "out_via" | "in_via">): {
  label: string;
  verified: boolean;
} {
  if (outing.out_via !== "gate") return { label: "Self-reported", verified: false };
  if (outing.in_via === "gate") return { label: "Verified at gate", verified: true };
  return { label: "Out verified at gate", verified: true };
}
