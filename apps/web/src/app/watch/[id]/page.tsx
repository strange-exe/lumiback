import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { LiveView } from "@/features/watch/components/LiveView";
import { isUuid } from "@/lib/route";

export const metadata: Metadata = {
  title: "Following along",
  // The default referrer policy already sends other sites (map tiles) only our origin, never
  // this page's path with the share id. OSM's tile servers expect that Referer, so keep it.
  robots: { index: false, follow: false },
};

/** Open to signed-in students and code-joined guests alike; the stream decides who sees what. */
export default async function WatchPage({ params }: PageProps<"/watch/[id]">): Promise<ReactNode> {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-8 px-5 py-6">
      <Link href="/" className="self-start font-display text-xl text-accent">
        Lumiback
      </Link>
      <LiveView sessionId={id} />
    </main>
  );
}
