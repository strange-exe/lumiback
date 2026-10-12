// Release APKs per processor type (ABI), next to the universal one.
//
// A universal APK carries native code for all four Android ABIs, and a phone uses one of them:
// about 124 MB, most of it unused. With splits, one release build also writes
// app-arm64-v8a-release.apk (practically every phone today) and app-armeabi-v7a-release.apk
// (older 32-bit phones); the app picks the one for the phone it runs on
// (src/updates/native-build.ts). Every APK keeps the same versionCode: they're sideloaded, not
// uploaded to Play, so any of them installs over any older build.
//
// `include` lists every ABI, not just the two we publish: it also limits the ABIs the app's own
// native code (libappmodules.so) is compiled for, and leaving x86/x86_64 out shipped a universal
// APK whose x86_64 code crashed at launch (emulators, Chromebooks). The x86 APKs are made but not
// published (eas.json picks the files to upload).
//
// Only `assemble…Release` turns splits on: debug builds and app bundles stay as they were.
// https://developer.android.com/build/configure-apk-splits
const { withAppBuildGradle } = require("expo/config-plugins");

const MARKER = "// lumiback: abi splits";

const SPLITS = `
    ${MARKER}
    splits {
        abi {
            enable gradle.startParameter.taskNames.any { it.toLowerCase().contains("assemble") && it.toLowerCase().contains("release") }
            reset()
            include "arm64-v8a", "armeabi-v7a", "x86", "x86_64"
            universalApk true
        }
    }
`;

module.exports = function withAbiSplits(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== "groovy") {
      throw new Error("with-abi-splits: expected a Groovy android/app/build.gradle");
    }
    const gradle = mod.modResults.contents;
    if (gradle.includes(MARKER)) return mod;
    const anchor = /^android \{\r?\n/m;
    if (!anchor.test(gradle)) {
      throw new Error("with-abi-splits: no `android {` block in android/app/build.gradle");
    }
    mod.modResults.contents = gradle.replace(anchor, (line) => line + SPLITS);
    return mod;
  });
};
