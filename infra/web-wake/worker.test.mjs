// node --test infra/web-wake/worker.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import worker, {
  HANDOFF,
  LINES,
  WORD,
  UP_CHECK_PATH,
  WOKE_COOKIE,
  isWaking,
  startingPage,
  wantsPage,
} from "./worker.js";

const page = (url = "https://lumiback.abhinesh.codes/home") =>
  new Request(url, { headers: { Accept: "text/html,application/xhtml+xml" } });
const ctx = () => {
  const waited = [];
  return { waited, waitUntil: (p) => waited.push(p) };
};

/** Runs the Worker with `fetch` answering as `answer` does. */
async function run(request, answer, wait = 50) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = (req) => {
    seen.push(req);
    return answer(req);
  };
  try {
    const c = ctx();
    const response = await worker.fetch(request, {}, c, wait);
    return { response, seen, waited: c.waited };
  } finally {
    globalThis.fetch = real;
  }
}

test("only browser page loads are watched", () => {
  assert.equal(wantsPage(page()), true);
  assert.equal(wantsPage(new Request("https://x.test/a.js", { headers: { Accept: "*/*" } })), false);
  assert.equal(
    wantsPage(new Request("https://x.test/", { method: "POST", headers: { Accept: "text/html" } })),
    false,
  );
  assert.equal(isWaking(new Response("", { status: 524 })), true);
  assert.equal(isWaking(new Response("", { status: 404 })), false);
});

test("a site that answers is passed through untouched", async () => {
  const ok = new Response("<h1>Today</h1>", { status: 200 });
  const { response, seen } = await run(page(), async () => ok);
  assert.equal(response, ok);
  assert.equal(seen.length, 1);
});

test("assets and form posts are never replaced, even when slow or failing", async () => {
  const failing = new Response("", { status: 502 });
  const asset = new Request("https://lumiback.abhinesh.codes/_next/a.js");
  const { response } = await run(asset, async () => failing);
  assert.equal(response, failing);
});

test("a waking site gets the starting page, and the request keeps running", async () => {
  let release;
  const slow = new Promise((resolve) => (release = resolve));
  const { response, waited } = await run(page(), () => slow, 20);
  assert.equal(response.status, 503);
  assert.match(await response.text(), /<h1[^>]*>Waking the server<\/h1>/);
  assert.equal(waited.length, 1, "the origin request is kept alive");
  release(new Response("late", { status: 200 }));
  await waited[0];
});

test("a server error or a network failure also gets the starting page", async () => {
  for (const answer of [
    async () => new Response("error code: 524", { status: 524 }),
    async () => {
      throw new TypeError("network");
    },
  ]) {
    const { response } = await run(page(), answer);
    assert.equal(response.status, 503);
  }
});

test("the starting page is self-contained, never cached, and locked down", async () => {
  const response = startingPage();
  const html = await response.text();
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Retry-After"), "10");
  const csp = response.headers.get("Content-Security-Policy");
  assert.match(csp, /default-src 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  const n = csp.match(/script-src 'nonce-([^']+)'/)[1];
  assert.ok(html.includes(`<script nonce="${n}">`), "the inline script carries the nonce");
  assert.notEqual(startingPage().headers.get("Content-Security-Policy"), csp, "a fresh nonce");
  assert.doesNotMatch(html, /https?:\/\//, "no outside requests");
  assert.match(html, /<html lang="en-IN">/);
  assert.match(html, /role="status"/);
  assert.match(html, /prefers-reduced-motion: no-preference/);
  assert.doesNotMatch(html, /\sstyle=/, "inline style attributes would be blocked by the CSP");
  assert.equal((html.match(/<svg [^>]*aria-hidden="true"/g) ?? []).length, 1, "the mark");
});

test("the name is in the HTML itself, one letter per span, rising one after another", async () => {
  const html = await startingPage().text();
  const word = html.match(/<p class="word" aria-hidden="true">(.*?)<\/p>/)[1];
  assert.equal(word.replace(/<[^>]+>/g, ""), WORD, "shows without JavaScript");
  assert.equal((word.match(/<span class="l\d">/g) ?? []).length, WORD.length);
  assert.match(html, /\.l0\{animation-delay:200ms\}/, "the first letter starts first");
  assert.match(html, /\.l7\{animation-delay:515ms\}/, "45 ms apart");
});

test("once the site is up it says so, then opens: every line true, the whole hand-off short", () => {
  assert.deepEqual(
    HANDOFF.map(([line]) => line),
    ["Server started", "Opening Lumiback"],
  );
  const total = HANDOFF.reduce((t, [, ms]) => t + ms, 0);
  assert.ok(total > 0 && total < 1_500, `the reload waits ${total} ms`);
});

test("once the page saw the site up, a slow page is waited for instead of looping back", async () => {
  const woken = new Request("https://lumiback.abhinesh.codes/home", {
    headers: { Accept: "text/html", Cookie: `theme=dark; ${WOKE_COOKIE}` },
  });
  const late = new Response("<h1>Today</h1>", { status: 200 });
  const slow = () => new Promise((resolve) => setTimeout(() => resolve(late), 60));
  const { response } = await run(woken, slow, 20);
  assert.equal(response, late, "passed through although it took longer than the usual wait");
  const { response: fresh } = await run(page(), slow, 20);
  assert.equal(fresh.status, 503, "without the flag the usual wait applies");
});

test("the page checks a static file (not the slow page) and sets the flag before reloading", async () => {
  const html = await startingPage().text();
  assert.ok(html.includes(`fetch("${UP_CHECK_PATH}"`));
  assert.ok(html.includes(`document.cookie = "${WOKE_COOKIE}; max-age=120`));
  assert.match(html, /location\.reload\(\)/);
});

test("the wait messages get more honest as the wait goes on", () => {
  const starts = LINES.map(([s]) => s);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  assert.equal(starts[0], 0);
  assert.match(LINES.at(-1)[1], /isn't starting/);
});
