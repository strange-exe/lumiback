/// <reference types="node" />
// Build-time config: runs in Node (not in the app), so only this file gets Node's types.
import { existsSync } from "node:fs";

import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * app.json holds the config; this only adds the Firebase file that Android push needs, when there
 * is one. EAS cloud builds get it from the GOOGLE_SERVICES_JSON file variable (it's gitignored);
 * local builds use ./google-services.json. Without either, the app builds and runs, and uses
 * local notifications only.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const googleServicesFile =
    process.env.GOOGLE_SERVICES_JSON ??
    (existsSync("./google-services.json") ? "./google-services.json" : undefined);
  return {
    ...(config as ExpoConfig),
    android: { ...config.android, ...(googleServicesFile ? { googleServicesFile } : {}) },
  };
};
