"use client";

import { CaretRight } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useShare } from "@/features/share/ShareProvider";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * While a share runs, a strip across the top of every page says so (like a phone's call-in-
 * progress bar), with who is watching and a way back to stop it. Sharing is never invisible to
 * the person sharing. Hidden on /share itself, which shows all of this in full.
 */
export function LiveBar(): ReactNode {
  const { session, problem } = useShare();
  const path = usePathname();
  if (!session || path === "/share") return null;

  const watching = session.viewers.filter((v) => v.status === "granted").length;
  const waiting = session.viewers.filter((v) => v.status === "pending").length;

  return (
    <Link
      href="/share"
      className="block bg-pine text-on-pine transition hover:brightness-110 active:brightness-95"
    >
      <span className="mx-auto flex min-h-11 max-w-xl items-center gap-3 px-5 py-2 text-sm">
        <span
          aria-hidden="true"
          className={`size-2 shrink-0 rounded-full ${problem ? "bg-on-pine/50" : "bg-lantern"}`}
        />
        <span className="min-w-0 flex-1 truncate">
          <strong>{problem ? "Sharing paused" : "Sharing your location"}</strong>
          <span className="opacity-85">
            {" "}
            · {plural(watching, "viewer")}
            {waiting > 0 && `, ${plural(waiting, "request")} waiting`}
          </span>
        </span>
        <span className="flex items-center gap-1 font-bold">
          Manage
          <CaretRight size={14} weight="bold" aria-hidden="true" />
        </span>
      </span>
    </Link>
  );
}
