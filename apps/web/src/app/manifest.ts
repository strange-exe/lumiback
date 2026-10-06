import type { MetadataRoute } from "next";

/** Makes Lumiback installable ("Add to Home Screen"): its own icon, opens full-screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Lumiback",
    short_name: "Lumiback",
    description:
      "Log where you're going and when you'll be back. Share your live location only with people you approve.",
    start_url: "/home", // signed-out visitors are sent on to sign in
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f4efe6",
    theme_color: "#f4efe6",
    categories: ["lifestyle", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
