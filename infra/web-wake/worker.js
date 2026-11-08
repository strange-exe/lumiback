// Cloudflare Worker in front of the website (route lumiback.abhinesh.codes/*, see wrangler.toml).
//
// On the free plan the website sleeps when nobody uses it and takes a minute or more to wake.
// Until now a visitor then saw Render's own loading page, or Cloudflare's "error 524" when the
// wake took longer than Cloudflare waits. This Worker passes every request straight through,
// except a page request (GET, wants HTML) the site doesn't answer within WAIT_MS, or answers
// with a server error: that one gets Lumiback's own starting page, which checks every few
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
  [0, "It sleeps after a quiet spell and takes a minute or two to start. This page opens by itself."],
  [90, "Taking longer than usual. Still trying."],
  [300, "The site isn't starting right now. Please try again in a few minutes."],
];
const SLOW_AFTER_S = 300;

/**
 * The hand-off once the site answers, as in the app's starting screen: each line is true when
 * it shows, held for its time (ms), then the page reloads into the site.
 */
export const HANDOFF = [
  ["Server started", 650],
  ["Opening Lumiback", 450],
];

/** The wordmark, one letter per span so each can rise on its own. */
export const WORD = "Lumiback";

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

/** Rendered on the server so the name shows without JavaScript. */
const letters = [...WORD].map((ch, i) => `<span class="l${i}">${ch}</span>`).join("");
/** Each letter's start in the rise (ms): one after another, behind the line drawing in. */
const letterDelays = [...WORD].map((_, i) => `.l${i}{animation-delay:${200 + i * 45}ms}`).join("");

/**
 * The starting page: self-contained (no outside requests), with its own strict CSP. font-src
 * 'self' only lets the site's own font preloads through: Cloudflare's Early Hints can replay the
 * site's Link headers before this page arrives, and blocking them just fills the console.
 *
 * An opening title on the app's dark LED board: a line draws, "Lumiback" rises letter by letter
 * above it, and an orange segment sweeps the line while the site wakes. Entrances ease out,
 * exits ease in, loops ease in and out; with reduced motion nothing moves and the words still
 * change.
 */
export function startingPage() {
  const n = nonce();
  const html = `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#0d0e10">
<title>Lumiback</title>
<style nonce="${n}">
/* The app's LED board tokens (apps/mobile/src/ui/theme.ts), dark in both modes. */
:root { --board: #0d0e10; --on-board: #f2f2f3; --muted: #9a9aa3; --line: #24252a; --edge: #3a3b41;
  --led: #ff6a2b; color-scheme: dark;
  --out: cubic-bezier(0.22, 1, 0.36, 1); --expo: cubic-bezier(0.16, 1, 0.3, 1);
  --in: cubic-bezier(0.55, 0, 1, 0.45); --io: cubic-bezier(0.65, 0, 0.35, 1);
  --spring: cubic-bezier(0.3, 1.35, 0.6, 1); }
@media (prefers-color-scheme: dark) { :root { --board: #121316; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100dvh; display: grid; grid-template-rows: auto 1fr;
  background: var(--board); color: var(--on-board);
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
header { padding: 20px 24px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
header svg { width: 28px; height: 28px; }
#clock { margin: 0; font-size: 0.8125rem; color: var(--muted); font-variant-numeric: tabular-nums; }
main { display: grid; align-content: end; padding: 24px 24px max(56px, 8vh); }
.lockup { width: 100%; max-width: 44rem; }
.word { margin: 0; display: flex; overflow: hidden; padding-bottom: 0.06em;
  font-size: clamp(3.5rem, 13vw, 7.5rem); line-height: 1.06; font-weight: 600; letter-spacing: -0.035em; }
.word span { display: inline-block; }
.track { position: relative; margin-top: 20px; height: 3px; border-radius: 2px; overflow: hidden;
  background: var(--line); transform-origin: left; }
.track i, .track b { position: absolute; top: 0; bottom: 0; left: 0; border-radius: 2px; background: var(--led); }
.track i { width: 38%; }
.track b { width: 100%; transform: translateX(-100%); }
.ready .track b { transform: none; }
.say { margin-top: 20px; }
h1 { margin: 0; font-size: 1.25rem; line-height: 1.3; font-weight: 600; }
#status { margin: 8px 0 0; color: var(--muted); max-width: 34rem; }
.retry { margin-top: 24px; min-height: 44px; padding: 0 22px; display: inline-flex; align-items: center;
  border: 1px solid var(--edge); border-radius: 10px; color: var(--on-board);
  font-weight: 600; text-decoration: none;
  transition: transform 0.18s var(--spring), border-color 0.2s var(--out); }
.retry:hover { border-color: var(--muted); }
.retry:active { transform: scale(0.97); transition-duration: 0.08s; }
.retry:focus-visible { outline: 2px solid var(--led); outline-offset: 3px; }
.ready .fade { opacity: 0; visibility: hidden; }
@media (prefers-reduced-motion: no-preference) {
  ${letterDelays}
  /* The name rises from behind the line's top edge, one letter after another. */
  .word span { animation: letter 0.76s var(--expo) both; }
  .track { animation: draw 0.7s var(--out) 0.1s both; }
  /* The segment sweeps while the site wakes; once it's up the line fills and the sweep stops. */
  .track i { transform: translateX(-100%); animation: sweep 1.8s var(--io) 1.1s infinite; }
  .ready .track i { animation: none; opacity: 0; }
  .ready .track b { animation: fill 0.42s var(--out) both; }
  .say, .retry { animation: rise 0.56s var(--out) 0.75s both; }
  .ready .retry { animation: none; } /* a held animation would keep it from fading */
  .roll { transition: opacity 0.3s var(--out), transform 0.3s var(--out); }
  .roll.out { opacity: 0; transform: translateY(-8px); transition: opacity 0.16s var(--in), transform 0.16s var(--in); }
  .roll.from { opacity: 0; transform: translateY(10px); transition: none; }
  .ready .fade { transition: opacity 0.2s var(--in), visibility 0s linear 0.2s; }
}
@keyframes letter { from { transform: translateY(105%); } to { transform: none; } }
@keyframes draw { from { transform: scaleX(0); } to { transform: none; } }
@keyframes sweep { from { transform: translateX(-100%); } to { transform: translateX(265%); } }
@keyframes fill { from { transform: translateX(-100%); } to { transform: none; } }
@keyframes rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
</style>
</head>
<body>
<header>
  <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <rect width="32" height="32" rx="8" fill="#24252a"/>
    <g transform="translate(16 16) scale(0.064) translate(-512 -503)">
      <path d="M445.5 407a66.5 66.5 0 0 1 133 0" fill="none" stroke="#fff" stroke-width="33" stroke-linecap="round"/>
      <path d="M404 432h216l-24 50H428z" fill="#fff"/>
      <rect x="412" y="482" width="200" height="200" rx="70" fill="#fff"/>
      <rect x="456" y="522" width="112" height="118" rx="26" fill="#ff6a2b"/>
    </g>
  </svg>
  <p id="clock" class="fade"></p>
</header>
<main>
  <div class="lockup">
    <p class="word" aria-hidden="true">${letters}</p>
    <div class="track" aria-hidden="true"><i></i><b></b></div>
    <div class="say" role="status">
      <h1 id="title" class="roll">Waking the server</h1>
      <p id="status" class="roll fade">${LINES[0][1]}</p>
    </div>
    <a class="retry fade" href="">Try now</a>
  </div>
</main>
<script nonce="${n}">
(function () {
  var LINES = ${JSON.stringify(LINES)};
  var HANDOFF = ${JSON.stringify(HANDOFF)};
  var title = document.getElementById("title");
  var status = document.getElementById("status");
  var clock = document.getElementById("clock");
  var still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var start = Date.now();
  var done = false;
  // A new line rolls in: the old one lifts away, the new one rises from below.
  function roll(el, text) {
    if (el.textContent === text) return;
    if (still) { el.textContent = text; return; }
    el.classList.add("out");
    setTimeout(function () {
      el.textContent = text;
      el.classList.remove("out");
      el.classList.add("from");
      void el.offsetWidth;
      el.classList.remove("from");
    }, 160);
  }
  function waited() { return Math.floor((Date.now() - start) / 1000); }
  function tick() {
    var s = waited();
    clock.textContent = "Waiting " + Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    for (var i = LINES.length - 1; i >= 0; i--) {
      if (s >= LINES[i][0]) { roll(status, LINES[i][1]); break; }
    }
  }
  var ticker = setInterval(tick, 1000);
  tick();
  function open() {
    done = true;
    clearInterval(ticker);
    document.cookie = "${WOKE_COOKIE}; max-age=120; path=/; samesite=lax; secure";
    document.body.classList.add("ready");
    var at = 0;
    HANDOFF.forEach(function (step) {
      setTimeout(function () { roll(title, step[0]); }, at);
      at += step[1];
    });
    // The last line stays up while the browser loads the site.
    setTimeout(function () { location.reload(); }, at);
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
