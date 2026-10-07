// Kept apart from the scene so the page can pick a palette without loading three.js.

/** Palette for one theme. Light is a calm evening; dark is dusk with the lantern doing more work. */
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
  platform: "#fbf8f2",
  ground: "#efe8dc",
  path: "#e3dccf",
  pillar: "#f6f1e8",
  arch: "#234e46",
  block: "#dbe7e2",
  roof: "#2f5e55",
  tree: "#6e9c7f",
  trunk: "#b9a88f",
  lantern: "#e59a3a",
  glow: "#f7d9a8",
  pin: "#e59a3a",
  sky: 1.45,
  sun: 2.4,
  lamp: 2.5,
};

export const DARK: ScenePalette = {
  platform: "#22302c",
  ground: "#1a2421",
  path: "#33433e",
  pillar: "#2c3b36",
  arch: "#8fc1b5",
  block: "#1f3530",
  roof: "#3d6b61",
  tree: "#2f5a44",
  trunk: "#4a4136",
  lantern: "#f0a94b",
  glow: "#ffd99c",
  pin: "#f0a94b",
  sky: 0.6,
  sun: 1.0,
  lamp: 9,
};
