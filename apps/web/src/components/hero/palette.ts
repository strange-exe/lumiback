// Kept apart from the scene so the page can pick a palette without loading three.js.

/** Palette for one theme, matching the app's clay illustrations: monochrome objects, with cobalt
 * only on the pin (the student). Dark is a navy night with the lantern doing more work. */
export interface ScenePalette {
  platform: string;
  ground: string;
  path: string;
  pillar: string;
  arch: string;
  block: string;
  roof: string;
  tree: string;
  trunk: string;
  lantern: string;
  glow: string;
  pin: string;
  sky: number; // hemisphere light intensity
  sun: number; // key light intensity
  lamp: number; // lantern point light intensity
}

export const LIGHT: ScenePalette = {
  platform: "#f4f5f8",
  ground: "#e9ebf0",
  path: "#dde0e7",
  pillar: "#ffffff",
  arch: "#0b0c10",
  block: "#eef0f5",
  roof: "#14161c",
  tree: "#c3c9d6",
  trunk: "#8a909c",
  lantern: "#ffffff",
  glow: "#dfe5ff",
  pin: "#1f3fd1",
  sky: 1.45,
  sun: 2.4,
  lamp: 2.2,
};

export const DARK: ScenePalette = {
  platform: "#232a44",
  ground: "#12162a",
  path: "#2a3150",
  pillar: "#1b2036",
  arch: "#e8eaf2",
  block: "#20263d",
  roof: "#e8eaf2",
  tree: "#3a4466",
  trunk: "#2a3048",
  lantern: "#ffffff",
  glow: "#c9d3ff",
  pin: "#5b78ff",
  sky: 0.85,
  sun: 1.0,
  lamp: 8,
};
