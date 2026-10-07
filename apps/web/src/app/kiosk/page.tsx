import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { KioskScreen } from "@/features/kiosk/KioskScreen";
import { BACKEND_URL } from "@/lib/config";

export const metadata: Metadata = {
  title: "Gate kiosk",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#0b0c10" };

/** The tablet at a gate. Its own device token (from the admin's kiosk link) lives on the tablet. */
export default function KioskPage(): ReactNode {
  return <KioskScreen apiUrl={BACKEND_URL} />;
}
