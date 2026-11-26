import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { KioskScreen } from "@/features/kiosk/KioskScreen";
import { BACKEND_URL } from "@/lib/config";
import { themeColor } from "@/lib/theme";
import { currentTheme } from "@/lib/theme-server";

export const metadata: Metadata = {
  title: "Gate kiosk",
  robots: { index: false, follow: false },
};

/** The whole kiosk screen is the board: the browser bar matches it. */
export async function generateViewport(): Promise<Viewport> {
  return { themeColor: themeColor(await currentTheme(), "board") };
}

/** The tablet at a gate. Its own device token (from the admin's kiosk link) lives on the tablet. */
export default function KioskPage(): ReactNode {
  return <KioskScreen apiUrl={BACKEND_URL} />;
}
