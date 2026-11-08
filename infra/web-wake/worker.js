// Cloudflare Worker in front of the website (route lumiback.abhinesh.codes/*, see wrangler.toml).
//
// On the free plan the website sleeps when nobody uses it and takes a minute or more to wake.
// Until now a visitor then saw Render's own loading page, or Cloudflare's "error 524" when the
// wake took longer than Cloudflare waits. This Worker passes every request straight through,
// except a page request (GET, wants HTML) the site doesn't answer within WAIT_MS, or answers
// with a server error: that one gets Lumiback's own "Waking up" page, which checks every few
// seconds and reloads once the site is up. The original request keeps running in the
// background, so the site keeps waking. Nothing is cached or stored; the only thing read from a
// visitor is the page's own two-minute "lb_woke" flag cookie (see WOKE_COOKIE).

/** How long a page request may take before the visitor gets the starting page instead. */
export const WAIT_MS = 8_000;

/**
 * Once the page sees the site answer, it sets this short-lived cookie and reloads. The Worker
 * then waits up to WOKE_WAIT_MS for the real page instead of WAIT_MS: an awake site whose page
 * is slow (the API it calls is still waking) would otherwise get this page again, in a loop.
 */
export const WOKE_COOKIE = "lb_woke=1";
export const WOKE_WAIT_MS = 90_000;

/** A static file the site serves without calling the API: answers as soon as the site is up. */
export const UP_CHECK_PATH = "/app/android.json";

/** How often the starting page checks whether the site is up (ms); slower after SLOW_AFTER_S. */
export const CHECK_EVERY_MS = 5_000;
export const CHECK_SLOW_MS = 30_000;

/** What the page says as the wait goes on (seconds waited, message). Honest when it's stuck. */
export const LINES = [
  [0, "Back in a minute or two. This page opens by itself when ready."],
  [90, "Taking longer than usual. Still trying."],
  [300, "The site isn't starting right now. Please try again in a few minutes."],
];
const SLOW_AFTER_S = 300;

/** A page load in a browser (not an image, a script or a form post). */
export function wantsPage(request) {
  return request.method === "GET" && (request.headers.get("Accept") ?? "").includes("text/html");
}

/** The site is down or still waking: a 5xx, including Cloudflare's 52x origin errors. */
export function isWaking(response) {
  return response.status >= 500;
}

function nonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

// The lantern from the app icon, drawn on the LED dot matrix the website uses for its
// countdown: "#" body, "w" the lit window, "." an unlit dot.
const LANTERN = [
  ".....###.....",
  "....#...#....",
  "..#########..",
  "...#######...",
  "..#########..",
  "..##wwwww##..",
  "..##wwwww##..",
  "..##wwwww##..",
  "..##wwwww##..",
  "..##wwwww##..",
  "..##wwwww##..",
  "..#########..",
  "...#######...",
];
const DOT_GAP = 12;
const LAST_ROW = LANTERN.length - 1;

/** Rendered on the server so it shows without JavaScript; rows light from the bottom up. */
function lanternDots() {
  let dots = "";
  LANTERN.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      const kind = cell === "w" ? `w r${y}` : cell === "#" ? `b r${y}` : "o";
      const c = (n) => n * DOT_GAP + DOT_GAP / 2;
      dots += `<circle class="${kind}" cx="${c(x)}" cy="${c(y)}" r="4"/>`;
    });
  });
  return dots;
}

/** Each row's start in the bottom-up sweep (ms). */
const rowDelays = LANTERN.map((_, y) => `.r${y}{--d:${200 + (LAST_ROW - y) * 60}ms}`).join("");

/**
 * The starting page: self-contained (no outside requests), with its own strict CSP. font-src
 * 'self' only lets the site's own font preloads through: Cloudflare's Early Hints can replay the
 * site's Link headers before this page arrives, and blocking them just fills the console.
 */
export function startingPage() {
  const n = nonce();
  const size = LANTERN[0].length * DOT_GAP;
  const html = `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Lumiback</title>
<style nonce="${n}">
/* The website's own tokens (apps/web/src/app/globals.css). */
:root { --page: #f1f1f2; --surface: #ffffff; --ink: #111113; --muted: #56565d; --line: #dcdce0;
  --accent: #e8501a; color-scheme: light dark;
  --out: cubic-bezier(0.22, 1, 0.36, 1); --in: cubic-bezier(0.55, 0, 1, 0.45);
  --io: cubic-bezier(0.45, 0, 0.55, 1); --spring: cubic-bezier(0.3, 1.35, 0.6, 1); }
@media (prefers-color-scheme: dark) {
  :root { --page: #08090a; --surface: #141518; --ink: #f2f2f3; --muted: #9a9aa3; --line: #26272c;
    --accent: #ff6a2b; }
}
* { box-sizing: border-box; }
body { margin: 0; min-height: 100dvh; display: grid; grid-template-rows: auto 1fr;
  background: var(--page); color: var(--ink);
  background-image: radial-gradient(var(--line) 1px, transparent 1.5px); background-size: 18px 18px;
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
header { padding: 20px 24px; }
.brand { display: inline-flex; align-items: center; gap: 10px; font-weight: 600; font-size: 1.0625rem; }
.brand svg { width: 28px; height: 28px; }
main { display: grid; place-items: center; padding: 24px 16px 72px; }
.card { width: 100%; max-width: 26rem; padding: 40px 24px 32px; text-align: center; display: grid;
  justify-items: center; background: var(--page); border-radius: 24px; }
.lantern { width: 132px; height: 132px; margin-bottom: 28px; }
.lantern .b { fill: var(--ink); }
.lantern .w { fill: var(--accent); }
.lantern .o { fill: var(--line); opacity: 0.45; }
h1 { margin: 0 0 12px; font-size: 1.9375rem; line-height: 1.15; font-weight: 600; }
#status { margin: 0; color: var(--muted); max-width: 22rem; min-height: 3em;
  transition: opacity 0.25s var(--out); }
#status.out { opacity: 0; transition: opacity 0.15s var(--in); }
.retry { margin-top: 24px; min-height: 44px; padding: 0 22px; display: inline-flex; align-items: center;
  border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--ink);
  font-weight: 600; text-decoration: none;
  transition: transform 0.18s var(--spring), border-color 0.2s var(--out); }
.retry:hover { border-color: var(--muted); }
.retry:active { transform: scale(0.97); transition-duration: 0.08s; }
.retry:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
#clock { margin: 16px 0 0; font-size: 0.875rem; color: var(--muted); font-variant-numeric: tabular-nums; }
.bar { display: none; position: fixed; inset: 0 0 auto; height: 3px; overflow: hidden; }
.bar span { display: block; width: 40%; height: 100%; background: var(--accent); border-radius: 0 3px 3px 0; }
@media (prefers-reduced-motion: no-preference) {
  ${rowDelays}
  /* The lantern lights row by row from the bottom, holds, dims, and starts again. */
  .lantern .b, .lantern .w { animation: cycle 4s var(--io) var(--d) infinite both; }
  /* The indeterminate bar along the top (fills to the end once the site is up). */
  .bar { display: block; }
  .bar span { animation: slide 1.6s var(--io) infinite; }
  .ready .bar span { width: 100%; transform-origin: left; animation: fill 0.4s var(--out) forwards; }
  .rise { animation: rise 0.7s var(--out) both; }
  .d1 { animation-delay: 0.35s; } .d2 { animation-delay: 0.45s; }
  .d3 { animation-delay: 0.55s; } .d4 { animation-delay: 0.65s; }
  /* A one-colour sheen across the heading while it waits (ink to muted, never a hue gradient). */
  @supports ((background-clip: text) or (-webkit-background-clip: text)) {
    h1.shine { color: transparent; -webkit-background-clip: text; background-clip: text;
      background-image: linear-gradient(100deg, var(--ink) 40%, var(--muted) 50%, var(--ink) 60%);
      background-size: 250% 100%;
      animation: rise 0.7s var(--out) 0.35s both, shine 2.6s var(--io) 1s infinite; }
  }
  .ready .card { animation: leave 0.3s var(--in) 0.12s forwards; }
}
@keyframes cycle { 0% { opacity: 0.12; } 12% { opacity: 1; } 62% { opacity: 1; } 80% { opacity: 0.12; } 100% { opacity: 0.12; } }
@keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
@keyframes fill { from { transform: scaleX(0.4); } to { transform: scaleX(1); } }
@keyframes shine { from { background-position: 100% 0; } to { background-position: 0 0; } }
@keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes leave { to { opacity: 0; transform: scale(0.98); } }
</style>
</head>
<body>
<div class="bar" aria-hidden="true"><span></span></div>
<header>
  <span class="brand">
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="#0d0e10"/>
      <g transform="translate(16 16) scale(0.064) translate(-512 -503)">
        <path d="M445.5 407a66.5 66.5 0 0 1 133 0" fill="none" stroke="#fff" stroke-width="33" stroke-linecap="round"/>
        <path d="M404 432h216l-24 50H428z" fill="#fff"/>
        <rect x="412" y="482" width="200" height="200" rx="70" fill="#fff"/>
        <rect x="456" y="522" width="112" height="118" rx="26" fill="#ff6a2b"/>
      </g>
    </svg>
    Lumiback
  </span>
</header>
<main>
  <div class="card">
    <svg class="lantern" viewBox="0 0 ${size} ${size}" aria-hidden="true" focusable="false">${lanternDots()}</svg>
    <h1 class="shine rise d1">Waking up</h1>
    <p id="status" class="rise d2" role="status">${LINES[0][1]}</p>
    <a class="retry rise d3" href="">Try now</a>
    <p id="clock" class="rise d4"></p>
  </div>
</main>
<script nonce="${n}">
(function () {
  var LINES = ${JSON.stringify(LINES)};
  var status = document.getElementById("status");
  var clock = document.getElementById("clock");
  var start = Date.now();
  var done = false;
  function say(text) {
    if (status.textContent === text) return;
    status.classList.add("out");
    setTimeout(function () { status.textContent = text; status.classList.remove("out"); }, 150);
  }
  function waited() { return Math.floor((Date.now() - start) / 1000); }
  function tick() {
    var s = waited();
    clock.textContent = "Waiting " + Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    for (var i = LINES.length - 1; i >= 0; i--) {
      if (s >= LINES[i][0]) { say(LINES[i][1]); break; }
    }
  }
  var ticker = setInterval(tick, 1000);
  tick();
  function open() {
    done = true;
    clearInterval(ticker);
    say("Ready. Opening Lumiback.");
    document.cookie = "${WOKE_COOKIE}; max-age=120; path=/; samesite=lax; secure";
    document.body.classList.add("ready");
    setTimeout(function () { location.reload(); }, 450);
  }
  function check() {
    if (done) return;
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, ${WAIT_MS});
    fetch("${UP_CHECK_PATH}", { method: "HEAD", cache: "no-store", signal: controller.signal })
      .then(function (r) { if (r.ok) open(); })
      .catch(function () {})
      .finally(function () {
        clearTimeout(timer);
        if (!done) setTimeout(check, waited() >= ${SLOW_AFTER_S} ? ${CHECK_SLOW_MS} : ${CHECK_EVERY_MS});
      });
  }
  setTimeout(check, ${CHECK_EVERY_MS});
})();
</script>
</body>
</html>`;
  return new Response(html, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": "10",
      "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${n}'; script-src 'nonce-${n}'; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(() => resolve("slow"), ms));

export default {
  async fetch(request, env, ctx, wait = WAIT_MS) {
    if (!wantsPage(request)) return fetch(request);
    const woke = (request.headers.get("Cookie") ?? "").split(/;\s*/).includes(WOKE_COOKIE);
    if (woke) wait = Math.max(wait, WOKE_WAIT_MS);
    const origin = fetch(request);
    // Keep the request alive after answering, so the site carries on waking.
    ctx.waitUntil(origin.then(() => undefined, () => undefined));
    const first = await Promise.race([origin.then((r) => r, () => null), sleep(wait)]);
    if (first instanceof Response && !isWaking(first)) return first;
    return startingPage();
  },
};
