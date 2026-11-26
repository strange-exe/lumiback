import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { shareApi } from "@/features/share/api";
import { LiveBar } from "@/features/share/components/LiveBar";
import { ShareProvider } from "@/features/share/ShareProvider";
import { fontVariables } from "@/lib/fonts";
import { accessToken } from "@/lib/session";
import { themeColor } from "@/lib/theme";
import { currentTheme } from "@/lib/theme-server";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Lumiback", template: "%s · Lumiback" },
  description:
    "Tap out at the gate or log your trip; your hostel's rules set when you're due back. Share your live location only with people you approve.",
  applicationName: "Lumiback",
  // Installed on iOS: open full-screen with the page colour behind the status bar.
  appleWebApp: { capable: true, title: "Lumiback", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

/** The browser bar takes the chosen theme's page colour (light and dark). */
export async function generateViewport(): Promise<Viewport> {
  return { themeColor: themeColor(await currentTheme(), "page") };
}

/**
 * The share engine sits at the root so a running share keeps reporting on every page, including
 * public ones like /privacy or /watch reached from inside the app. Signed out: no API call.
 * Loading a running share only shows it; this tab sends location only once the student chooses
 * to here (see ShareProvider and send-here.ts).
 *
 * The colour theme comes from this browser's cookie, set on the server: the first paint is
 * already in that theme, with no script (the CSP allows none inline) and no flash. Every route
 * renders per request anyway (the session cookie above), so reading one more cookie changes
 * nothing about caching.
 */
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  const [token, theme] = await Promise.all([accessToken(), currentTheme()]);
  const liveShare = token ? await shareApi.activeTabShare(token).catch(() => null) : null;
  return (
    <html lang="en-IN" data-theme={theme} className={fontVariables}>
      <body className="min-h-dvh">
        <ShareProvider initial={liveShare}>
          <LiveBar />
          {children}
        </ShareProvider>
      </body>
    </html>
  );
}
