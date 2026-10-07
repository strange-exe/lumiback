import type { Metadata } from "next";
import type { ReactNode } from "react";

import { adminApi } from "@/features/admin/api";
import { SettingsForm } from "@/features/admin/components/SettingsForm";
import { requireAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage(): Promise<ReactNode> {
  const { token } = await requireAdmin();
  const current = await adminApi.settings(token);
  return (
    <section aria-labelledby="settings-heading" className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 id="settings-heading" className="font-display text-title text-ink">
          Settings
        </h1>
        <p className="text-muted">These apply to every hostel and gate.</p>
      </div>
      <SettingsForm current={current} />
    </section>
  );
}
