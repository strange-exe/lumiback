import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { Bone, Loading } from "@/components/ui/Skeleton";
import { DeviceList, DevicesError } from "@/features/account/DeviceList";
import { deviceRows } from "@/features/account/devices";
import { ApiError, callBackend } from "@/lib/backend";
import type { Device } from "@/lib/types";

const HEADING = "devices-heading";

/** The section's heading and help, the same in every state. */
function Frame({ children }: { children: ReactNode }): ReactNode {
  return (
    <section aria-labelledby={HEADING} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={HEADING} tabIndex={-1} className="font-display text-xl text-ink">
          Signed-in devices
        </h2>
        <p className="text-sm text-muted">
          Lost your phone? Sign it out here, then{" "}
          <Link
            href="/account/password"
            className="font-bold text-accent underline-offset-4 hover:underline"
          >
            change your password
          </Link>
          . A new password signs out every other device too.
        </p>
      </div>
      {children}
    </section>
  );
}

/** Shown while the list loads (the account page streams it in). */
export function SignedInDevicesLoading(): ReactNode {
  return (
    <Frame>
      <Loading>
        <div className="flex flex-col divide-y divide-line rounded-sheet border border-line bg-surface">
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-2 px-5 py-4">
              <Bone className="h-5 w-44 rounded-control" />
              <Bone className="h-4 w-60 max-w-full rounded-control" />
              <Bone className="h-4 w-52 max-w-full rounded-control" />
            </div>
          ))}
        </div>
      </Loading>
    </Frame>
  );
}

/**
 * Where this account is signed in, for a lost phone. A failed load stays inside this section
 * (the rest of the account page still works) and offers a retry; a lost session signs in again.
 */
export async function SignedInDevices({ token }: { token: string }): Promise<ReactNode> {
  let devices: Device[];
  try {
    devices = await callBackend<Device[]>("/auth/devices", { token });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect("/sign-in");
    return (
      <Frame>
        <DevicesError />
      </Frame>
    );
  }
  return (
    <Frame>
      <DeviceList rows={deviceRows(devices)} headingId={HEADING} />
    </Frame>
  );
}
