import { Linking } from "react-native";

import { openLocationSettings, settingsLabel } from "@/location/settings";

const sendIntent = jest.spyOn(Linking, "sendIntent");
const openSettings = jest.spyOn(Linking, "openSettings");

beforeEach(() => {
  sendIntent.mockReset().mockResolvedValue(undefined);
  openSettings.mockReset().mockResolvedValue(undefined);
});

describe("the settings that fix a failed start", () => {
  it("opens the phone's location switch when location is off", async () => {
    await openLocationSettings("servicesOff");
    expect(sendIntent).toHaveBeenCalledWith("android.settings.LOCATION_SOURCE_SETTINGS");
    expect(openSettings).not.toHaveBeenCalled();
  });

  it("falls back to the app settings when that page can't open", async () => {
    sendIntent.mockRejectedValue(new Error("no activity"));
    await openLocationSettings("servicesOff");
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it("opens Lumiback's app settings for a refused permission", async () => {
    await openLocationSettings("denied");
    expect(sendIntent).not.toHaveBeenCalled();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it("says what the button does", () => {
    expect(settingsLabel("servicesOff")).toBe("Turn on location");
    expect(settingsLabel("denied")).toBe("Open settings");
  });
});
