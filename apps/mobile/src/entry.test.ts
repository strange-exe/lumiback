import { readFileSync } from "fs";
import { join } from "path";

// A background launch (a data-only push or a location update with the app closed) evaluates only
// the entry file: no screen mounts, so the root layout never loads. Tasks defined from the layout
// were missing in a closed app on the emulator (2026-11-10). These checks keep them in the entry.
const root = join(__dirname, "..");
const read = (path: string): string => readFileSync(join(root, path), "utf8");
const imports = (source: string): string[] =>
  [...source.matchAll(/^import\s+(?:[^"']*from\s+)?["']([^"']+)["'];?$/gm)].map((m) => m[1] ?? "");

describe("app entry", () => {
  it("is index.ts", () => {
    expect(JSON.parse(read("package.json")).main).toBe("index.ts");
  });

  it("defines both background tasks before Expo Router loads the app", () => {
    const order = imports(read("index.ts"));
    const router = order.indexOf("expo-router/entry");
    expect(router).toBe(order.length - 1);
    for (const task of ["./src/location/task", "./src/notify/update-task"]) {
      const at = order.indexOf(task);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThan(router);
    }
  });

  it("leaves the tasks out of the root layout, which a background launch never loads", () => {
    const layout = imports(read("src/app/_layout.tsx"));
    expect(layout).not.toContain("@/location/task");
    expect(layout).not.toContain("@/notify/update-task");
  });
});
