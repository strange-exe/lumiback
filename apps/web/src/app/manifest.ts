import type { MetadataRoute } from "next";

import { DEFAULT_THEME, themeColor } from "@/lib/theme";

/** The default theme's light page colour: the splash and bar before the app's own page loads. */
const PAGE = themeColor(DEFAULT_THEME, "page")[0].color;

/** Makes Lumiback installable ("Add to Home Screen"): its own icon, opens full-screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Lumiback",
    short_name: "Lumiback",
    description:
      "Tap out at the gate or log your trip, and share your live location only with people you approve.",
    start_url: "/home", // signed-out visitors are sent on to sign in
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: PAGE,
    theme_color: PAGE,
    categories: ["lifestyle", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
