import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import type { ReactNode } from "react";

import { shareApi } from "@/features/share/api";
import { LiveBar } from "@/features/share/components/LiveBar";
import { ShareProvider } from "@/features/share/ShareProvider";
import { accessToken } from "@/lib/session";

import "./globals.css";

// One family for everything: Geist is a variable font, so every weight is a single file.
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Lumiback", template: "%s · Lumiback" },
  description:
    "Log where you're going and when you'll be back. Share your live location only with people you approve.",
  applicationName: "Lumiback",
  // Installed on iOS: open full-screen with the page colour behind the status bar.
  appleWebApp: { capable: true, title: "Lumiback", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafb" },
    { media: "(prefers-color-scheme: dark)", color: "#08090c" },
  ],
};

/**
 * The share engine sits at the root so a running share keeps reporting on every page, including
 * public ones like /privacy or /watch reached from inside the app. Signed out: no API call.
 */
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  const token = await accessToken();
  const liveShare = token ? await shareApi.activeTabShare(token).catch(() => null) : null;
  return (
    <html lang="en-IN" className={geist.variable}>
      <body className="min-h-dvh">
        <ShareProvider initial={liveShare}>
          <LiveBar />
          {children}
        </ShareProvider>
      </body>
    </html>
  );
}
