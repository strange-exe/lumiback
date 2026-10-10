import { supportMailto } from "./support";

// Hoisted above the import by Jest.
jest.mock("@/lib/config", () => ({ SUPPORT_EMAIL: "support@lumiback.test" }));

test("a support email names the version and build, and nothing else", () => {
  const url = supportMailto({
    version: "1.3.1",
    runtimeVersion: "c22cefa5baa82b88409c594c5d53df19ed6c2fe1",
    updateId: "01a120c3-faae-72de-8551-b3102cad53da",
  });
  expect(url.startsWith("mailto:support@lumiback.test?subject=Lumiback%20help&body=")).toBe(true);
  const body = decodeURIComponent(url.split("&body=")[1]!);
  expect(body.trim()).toBe("---\nLumiback 1.3.1 / c22cefa5 / 01a120c3");
});

test("development builds send just the version", () => {
  const body = decodeURIComponent(supportMailto({ version: "1.3.1" }).split("&body=")[1]!);
  expect(body.trim()).toBe("---\nLumiback 1.3.1");
});
