// devices.ts reads ApiError from api.ts, which needs a configured API address and the session.
jest.mock("@/lib/config", () => ({ API_URL: "https://api.test" }));
jest.mock("@/lib/session", () => ({}));

import { ApiError } from "@/lib/api";
import {
  canSignOut,
  canSignOutOthers,
  deviceError,
  deviceKind,
  deviceLabel,
  deviceName,
  hasCurrent,
  onlyThisDevice,
  signedOutMessage,
} from "@/lib/devices";
import { formatStamp } from "@/lib/time";
import type { Device } from "@/lib/types";

const row = (id: string, current = false, device: string | null = "Chrome on Windows"): Device => ({
  id,
  device,
  signed_in_at: "2026-11-07T15:44:00Z",
  last_active_at: "2026-11-07T16:00:00Z",
  current,
});

describe("deviceLabel", () => {
  it("names Android by its release, never the API level", () => {
    expect(deviceLabel({ OS: "android", Version: 34, release: "14" })).toBe(
      "Lumiback app on Android 14",
    );
  });

  it("leaves the version out when Android gives no release", () => {
    expect(deviceLabel({ OS: "android", Version: 34 })).toBe("Lumiback app on Android");
    expect(deviceLabel({ OS: "android", Version: 34, release: "  " })).toBe(
      "Lumiback app on Android",
    );
  });

  it("names iOS by Platform.Version", () => {
    expect(deviceLabel({ OS: "ios", Version: "17.5" })).toBe("Lumiback app on iOS 17.5");
  });

  it("falls back to the app's name elsewhere", () => {
    expect(deviceLabel({ OS: "web", Version: "" })).toBe("Lumiback app");
  });

  it("drops characters the backend refuses and stays within 60", () => {
    const odd = `14${String.fromCodePoint(0x202e)}${String.fromCodePoint(0x0a)}x`;
    expect(deviceLabel({ OS: "android", Version: 34, release: odd })).toBe(
      "Lumiback app on Android 14x",
    );
    const long = deviceLabel({ OS: "android", Version: 34, release: "9".repeat(100) });
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.startsWith("Lumiback app on Android 999")).toBe(true);
    for (const ch of long) expect(ch.codePointAt(0)).toBeLessThan(0x7f);
  });
});

describe("formatStamp (IST)", () => {
  it("shows the contract's example", () => {
    expect(formatStamp("2026-11-07T15:44:00Z")).toBe("Sat 7 Nov, 9:14 PM");
  });

  it("moves past midnight in IST, not UTC", () => {
    // 19:00 UTC on Friday is 00:30 on Saturday in India.
    expect(formatStamp("2026-11-06T19:00:00Z")).toBe("Sat 7 Nov, 12:30 AM");
  });

  it("writes noon as 12 PM and pads minutes", () => {
    expect(formatStamp("2026-01-01T06:35:00Z")).toBe("Thu 1 Jan, 12:05 PM");
  });

  it("reads an offset timestamp the same as UTC", () => {
    expect(formatStamp("2026-11-07T21:14:00+05:30")).toBe("Sat 7 Nov, 9:14 PM");
  });
});

describe("rows and actions", () => {
  it("offers Sign out on every row except this device", () => {
    const list = [row("a", true), row("b"), row("c")];
    expect(list.filter(canSignOut).map((d) => d.id)).toEqual(["b", "c"]);
  });

  it("offers Sign out on every row when this phone isn't marked", () => {
    const list = [row("a"), row("b")];
    expect(list.every(canSignOut)).toBe(true);
    expect(hasCurrent(list)).toBe(false);
  });

  it("offers sign-out-others only with this device and at least one other", () => {
    expect(canSignOutOthers([row("a", true), row("b")])).toBe(true);
    expect(canSignOutOthers([row("a", true)])).toBe(false);
    // No current row: the server would answer 409.
    expect(canSignOutOthers([row("a"), row("b")])).toBe(false);
    expect(canSignOutOthers([])).toBe(false);
  });

  it("knows when only this phone is signed in", () => {
    expect(onlyThisDevice([row("a", true)])).toBe(true);
    expect(onlyThisDevice([row("a", true), row("b")])).toBe(false);
  });

  it("names unknown devices and picks an icon", () => {
    expect(deviceName(row("a", false, null))).toBe("Unknown device");
    expect(deviceKind(row("a", false, null))).toBe("unknown");
    expect(deviceKind(row("a", false, "Lumiback app on Android 14"))).toBe("phone");
    expect(deviceKind(row("a", false, "Safari on iPhone"))).toBe("phone");
    expect(deviceKind(row("a"))).toBe("computer");
  });

  it("counts what was signed out", () => {
    expect(signedOutMessage(0)).toBe("No other devices were signed in.");
    expect(signedOutMessage(1)).toBe("Signed out of 1 device.");
    expect(signedOutMessage(3)).toBe("Signed out of 3 devices.");
  });
});

describe("deviceError", () => {
  const fallback = "Couldn't sign that device out. Try again.";

  it("says a 404 device was already signed out", () => {
    expect(deviceError(new ApiError(404, "No such device"), fallback)).toBe(
      "That device was already signed out.",
    );
  });

  it("shows the backend's 409 detail", () => {
    const detail = "Sign out and back in on this device first, then try again.";
    expect(deviceError(new ApiError(409, detail), fallback)).toBe(detail);
  });

  it("shows the backend's 429 message", () => {
    const detail = "Too many attempts. Try again in 12 minutes.";
    expect(deviceError(new ApiError(429, detail), fallback)).toBe(detail);
  });

  it("uses the fallback for anything that isn't an API error", () => {
    expect(deviceError(new Error("boom"), fallback)).toBe(fallback);
    expect(deviceError(new ApiError(500, ""), fallback)).toBe(fallback);
  });
});
