import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, Fraunces } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  axes: ["SOFT"], // the soft corners are the character; optical sizing cost ~2x the bytes
  variable: "--font-fraunces",
  display: "swap",
});

const atkinson = Atkinson_Hyperlegible({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-atkinson",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Outing", template: "%s · Outing" },
  description:
    "Log your trips out of the hostel and let the people you choose know you're back safe. For Graphic Era University students.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4efe6" },
    { media: "(prefers-color-scheme: dark)", color: "#121a18" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en-IN" className={`${fraunces.variable} ${atkinson.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
