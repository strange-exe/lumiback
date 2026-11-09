import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";

// The announcement banners the website serves (public/app/banners): the API's allowlist
// (backend/app/api/admin.py BANNERS) names exactly these files, and Android shows them in the
// expanded notification. 2:1, 1024x512, small enough for a phone on a slow connection.

const DIR = new URL("../../../public/app/banners/", import.meta.url);
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

test("every banner is a 1024x512 PNG under 200 KB", () => {
  const files = readdirSync(DIR);
  assert.ok(files.length >= 1);
  for (const name of files) {
    assert.match(name, /^[a-z][a-z0-9-]*\.png$/, name);
    const bytes = readFileSync(new URL(name, DIR));
    assert.deepEqual([...bytes.subarray(0, 8)], PNG, `${name} is a PNG`);
    // IHDR: width and height, big-endian, right after the chunk's length and type.
    assert.equal(bytes.readUInt32BE(16), 1024, `${name} width`);
    assert.equal(bytes.readUInt32BE(20), 512, `${name} height`);
    assert.ok(statSync(new URL(name, DIR)).size < 200 * 1024, `${name} under 200 KB`);
  }
});

test("the API's banner allowlist is the files here", () => {
  const api = readFileSync(new URL("../../../../../backend/app/api/admin.py", import.meta.url), {
    encoding: "utf8",
  });
  const listed = /^BANNERS = \(([^)]*)\)/m.exec(api)?.[1];
  assert.ok(listed, "BANNERS in backend/app/api/admin.py");
  const names = [...listed.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
  const files = readdirSync(DIR)
    .map((f) => f.replace(/\.png$/, ""))
    .sort();
  assert.deepEqual(names, files);
});
