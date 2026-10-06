import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AuthShell } from "@/components/ui/AuthShell";
import { JoinForm } from "@/features/watch/components/JoinForm";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Follow someone home" };

export default async function JoinPage(): Promise<ReactNode> {
  const user = await currentUser();

  return (
    <AuthShell>
      <div>
        <h1 className="font-display text-title text-ink">Follow someone home</h1>
        <p className="mt-2 text-stone">
          Enter the code a Lumiback student sent you. They&apos;ll approve you before you see their
          location, and it stops when they stop sharing.
        </p>
      </div>
      <JoinForm signedInAs={user ? user.name : null} />
    </AuthShell>
  );
}
