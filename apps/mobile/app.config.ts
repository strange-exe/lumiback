/// <reference types="node" />
// Build-time config: runs in Node (not in the app), so only this file gets Node's types.
import { existsSync } from "node:fs";

import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * app.json holds the config; this only adds the Firebase file that Android push needs, when there
 * is one. ./google-services.json is preferred and uploaded with EAS builds (see /.easignore): the
 * file path is part of the runtime fingerprint, so the same path on this machine and on EAS keeps
 * over-the-air updates compatible. The GOOGLE_SERVICES_JSON file variable is only a fallback for
 * builds from a checkout without the file. Without either, the app uses local notifications only.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const googleServicesFile = existsSync("./google-services.json")
    ? "./google-services.json"
    : process.env.GOOGLE_SERVICES_JSON;
  return {
    ...(config as ExpoConfig),
    android: { ...config.android, ...(googleServicesFile ? { googleServicesFile } : {}) },
  };
};
