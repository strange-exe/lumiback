"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useShare } from "@/features/share/ShareProvider";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * While a share runs, every signed-in page says so, with who is watching and a way to stop.
 * (Safeguard: sharing is never invisible to the person sharing.)
 */
export function LiveBar(): ReactNode {
  const { session, problem } = useShare();
  const path = usePathname();
  if (!session || path === "/share") return null;

  const watching = session.viewers.filter((v) => v.status === "granted").length;
  const waiting = session.viewers.filter((v) => v.status === "pending").length;
  const detail = [
    plural(watching, "viewer"),
    waiting > 0 ? `${plural(waiting, "request")} waiting` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      href="/share"
      className="mb-2 flex min-h-12 items-center gap-3 rounded-control bg-pine px-4 py-2 text-on-pine hover:brightness-110"
    >
      <span
        aria-hidden="true"
        className={`size-2.5 shrink-0 rounded-full ${problem ? "bg-on-pine/50" : "bg-lantern"}`}
      />
      <span className="flex-1 text-sm">
        <strong>{problem ? "Sharing paused" : "Sharing your location"}</strong>
        <span className="opacity-80"> · {detail}</span>
      </span>
      <span className="text-sm font-bold underline underline-offset-4">Manage</span>
    </Link>
  );
}
