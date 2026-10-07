import { useColorScheme } from "react-native";

/** "Dusk Courtyard", the same tokens as the web app (apps/web/src/app/globals.css). */
const light = {
  page: "#f4efe6",
  surface: "#fbf8f2",
  ink: "#1b2422",
  stone: "#5c605a",
  line: "#e3dccf",
  pine: "#234e46",
  onPine: "#f4efe6",
  pineSoft: "#dbe7e2",
  lantern: "#e59a3a",
  lanternSoft: "#f8e6cc",
  ember: "#ad432c",
  emberSoft: "#f5ded6",
  sage: "#3f7253",
  sageSoft: "#dce9e0",
};

const dark: typeof light = {
  page: "#121a18",
  surface: "#1a2421",
  ink: "#ede7dc",
  stone: "#a9aea6",
  line: "#2d3935",
  pine: "#8fc1b5",
  onPine: "#0f1f1b",
  pineSoft: "#1f3530",
  lantern: "#f0a94b",
  lanternSoft: "#3a2c19",
  ember: "#ee927a",
  emberSoft: "#3a211b",
  sage: "#93c4a3",
  sageSoft: "#1d3326",
};

export type Colors = typeof light;

export const fonts = {
  regular: "Geist_400Regular",
  medium: "Geist_500Medium",
  semibold: "Geist_600SemiBold",
  bold: "Geist_700Bold",
} as const;

export const radius = { control: 14, sheet: 24 } as const;
export const space = (n: number): number => n * 4;

export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}
