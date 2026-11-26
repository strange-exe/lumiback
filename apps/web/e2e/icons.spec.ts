import { createHash } from "node:crypto";

import { expect, test, type APIResponse } from "./fixtures";

/**
 * Browsers fetch icons out of band, so no console error or axe rule catches a missing or broken
 * one: fetch every declared icon and check its bytes (DESIGN.md favicon rule).
 */
test.use({ storageState: { cookies: [], origins: [] } });

/**
 * The email logo (backend/app/email_templates.py). It must stay byte-identical until email
 * delivery to the university inbox is retested with a new image, so no install icon may reuse it.
 */
const EMAIL_LOGO = "/icons/icon-192.png";
const EMAIL_LOGO_SHA256 = "f96f1fa7d1ceea3f6b9ec24ba9a32b5af4a5762a76b3f3cd5a35937e3027372b";
/** Gate glass tokens the lantern mark is drawn in: paper tile, ink lantern, lit window. */
const PAPER = "#f3f0e8";
const INK = "#141c22";
const LIT = "#5fe0cf";
/** Light and dark browser tabs and pages the favicon has to hold on. */
const LIGHT_GROUNDS = ["#ffffff", PAPER];
const DARK_GROUNDS = ["#000000", "#202124"];

type Png = { width: number; height: number; opaque: boolean };

/** Width, height and alpha from a PNG's signature and IHDR chunk; fails on anything else. */
async function readPng(response: APIResponse, label: string): Promise<Png> {
  expect(response.status(), label).toBe(200);
  expect(response.headers()["content-type"], label).toContain("image/png");
  const bytes = await response.body();
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(bytes.subarray(0, 8).equals(signature), `${label}: not a PNG`).toBe(true);
  expect(bytes.subarray(12, 16).toString("latin1"), `${label}: no IHDR`).toBe("IHDR");
  const colourType = bytes[25];
  // 0 grey, 2 RGB: no alpha channel. A palette (3) may carry transparency in tRNS, so it isn't opaque.
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    opaque: colourType === 0 || colourType === 2,
  };
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("the favicon is the lantern and holds on light and dark tabs at 16 px", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const href = await page.locator('head link[rel="icon"]').first().getAttribute("href");
  expect(href, "no <link rel=icon>").toBeTruthy();
  const response = await request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/svg+xml");
  const svg = (await response.body()).toString("latin1");
  expect(svg.startsWith("<svg"), "not an SVG").toBe(true);
  expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(svg), "non-ASCII bytes in the favicon").toBe(true);
  expect(svg).toContain('viewBox="0 0 32 32"');
  for (const token of [PAPER, INK, LIT]) expect(svg, `favicon lacks ${token}`).toContain(token);

  // Draw it at 16 px, as a tab does, and read the pixels. One mark serves both schemes (Safari
  // ignores prefers-color-scheme in favicons), so its outer edge must hold on light grounds and
  // its tile on dark ones.
  const pixels = await page.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, 16, 16);
    const hex = (x: number, y: number) => {
      const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
      return {
        hex: "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join(""),
        alpha: a,
      };
    };
    return { edge: hex(0, 8), tile: hex(2, 8), centre: hex(8, 9) };
  }, href!);
  expect(pixels.edge.alpha, "the tile's edge pixel is see-through").toBe(255);
  expect(pixels.tile.alpha).toBe(255);
  for (const ground of LIGHT_GROUNDS) {
    expect(
      contrast(pixels.edge.hex, ground),
      `edge ${pixels.edge.hex} on ${ground}`,
    ).toBeGreaterThanOrEqual(3);
  }
  for (const ground of DARK_GROUNDS) {
    expect(
      contrast(pixels.tile.hex, ground),
      `tile ${pixels.tile.hex} on ${ground}`,
    ).toBeGreaterThanOrEqual(3);
  }
  // The lit window sits in the middle of the mark.
  expect(
    contrast(pixels.centre.hex, LIT),
    `centre ${pixels.centre.hex} is not the lit window`,
  ).toBeLessThan(1.3);
});

test("the apple-touch icon is an opaque 180 px square", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('head link[rel="apple-touch-icon"]').first().getAttribute("href");
  expect(href, "no apple-touch-icon").toBeTruthy();
  const png = await readPng(await request.get(href!), href!);
  // iOS paints transparent pixels black, so the tile must be opaque.
  expect(png).toEqual({ width: 180, height: 180, opaque: true });
});

test("installable: the manifest's icons are served at their declared sizes", async ({
  request,
}) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  const body = (await manifest.json()) as {
    name: string;
    display: string;
    icons: { src: string; sizes: string; type: string; purpose: string }[];
  };
  expect(body).toMatchObject({ name: "Lumiback", display: "standalone" });
  expect(body.icons.map((i) => i.purpose).sort()).toEqual(["any", "any", "maskable"]);
  expect(body.icons.map((i) => i.sizes).sort()).toEqual(["192x192", "512x512", "512x512"]);
  for (const icon of body.icons) {
    expect(icon.src, "the email logo is frozen; install icons use their own files").not.toBe(
      EMAIL_LOGO,
    );
    expect(icon.type).toBe("image/png");
    const png = await readPng(await request.get(icon.src), icon.src);
    const [width, height] = icon.sizes.split("x").map(Number);
    expect({ width: png.width, height: png.height }, icon.src).toEqual({ width, height });
    // A maskable icon is cropped to a shape by the platform: it must fill the square.
    if (icon.purpose === "maskable") expect(png.opaque, `${icon.src} has transparency`).toBe(true);
  }
});

test("the email logo is unchanged", async ({ request }) => {
  const response = await request.get(EMAIL_LOGO);
  await readPng(response, EMAIL_LOGO);
  const sha256 = createHash("sha256")
    .update(await response.body())
    .digest("hex");
  expect(sha256).toBe(EMAIL_LOGO_SHA256);
});
