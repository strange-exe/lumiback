import { mapPage } from "@/ui/LiveMap";
import { palettes } from "@/ui/theme";

jest.mock("@/lib/config", () => ({ WEB_URL: "https://web.test" }));
jest.mock("react-native-webview", () => ({ WebView: () => null }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

describe("the live map's colours", () => {
  it("draws the live dot in the out colour and links in the link colour, in every theme", () => {
    for (const [name, c] of Object.entries(palettes)) {
      const html = mapPage(c, name.endsWith("/dark"));
      // The dot, its halo and its accuracy circle: someone out, never the accent (ink in Gate glass).
      expect(html).toContain(`.dot{border-radius:50%;background:${c.outText};`);
      expect(html).toContain(`0 0 0 6px ${c.outText}4d`);
      expect(html).toContain(`spot('dot', '${c.outText}')`);
      expect(html).toContain(`.leaflet-control-attribution a{color:${c.link}}`);
      expect(html).not.toContain(c.accent);
    }
  });
});
