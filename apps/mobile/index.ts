// The app's entry point. Background tasks are defined here, before Expo Router, because a
// background launch (a data-only push or a location update with the app closed) runs only this
// file: no screen mounts, so the root layout and anything it imports never load. A task defined
// there was missing in a closed app ("No task registered", found on the emulator 2026-11-10).
// https://docs.expo.dev/versions/v57.0.0/sdk/task-manager/ ("must be called in the global scope")
import "./src/location/task";
import "./src/notify/update-task";
// Last, so the tasks exist before the app renders (https://docs.expo.dev/router/installation/).
import "expo-router/entry";
