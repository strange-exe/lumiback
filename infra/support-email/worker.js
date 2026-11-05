// Cloudflare Email Worker for support@lumiback.abhinesh.codes.
//
// Every email is forwarded to FORWARD_TO (a verified Email Routing destination, set as a
// variable on the Worker), and the sender gets one automatic "we've got it" reply, threaded
// under their message. The reply goes through Resend when the RESEND_API_KEY secret is set
// (recommended), otherwise through Cloudflare's reply(). Automated mail (bounces, mailing lists,
// other auto-replies) is forwarded but never answered, so two auto-responders can't loop; so is
// mail without Cloudflare's dmarc=pass, so a forged sender gets no reply (no backscatter); and
// auto-replies are rate-limited per sender and in total per minute (see "limiting auto-replies").
// Its Cron Trigger also keeps the Render services awake and emails FORWARD_TO when one of them
// is down or the API's sweep is stale (see "alerting the owner" below).
// Docs: https://developers.cloudflare.com/email-routing/email-workers/reply-email-workers/
// No npm packages, so it can be pasted into the dashboard editor as one file.

import { EmailMessage } from "cloudflare:email";

const FROM_NAME = "Lumiback Support";
const SITE = "https://lumiback.abhinesh.codes";
// The Worker's own address; Resend already sends the auto-replies from it.
const SUPPORT_ADDRESS = "support@lumiback.abhinesh.codes";

// Inbox-tested email layout (backend/app/email_templates.py), same colours and type.
const INK = "#0b0c10";
const MUTED = "#5b606b";
const LINE = "#e7e8ec";
const PAGE = "#f4f5f7";
const GOOD = "#187349";
const SANS = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const P = `margin:0;font-family:${SANS};font-size:15px;line-height:22px;color:${INK};`;
const SMALL = `margin:0;font-family:${SANS};font-size:13px;line-height:19px;color:${MUTED};`;

const NO_REPLY_SENDER = /^(mailer-daemon|postmaster|no-?reply|bounces?)([+.@-]|$)/i;

/** Why this mail must not get an auto-reply (RFC 3834 and the usual list/bulk markers), or
 * null when it may. The reason is logged, so the Worker's Logs tab explains every skip. */
export function automatedReason(from, headers) {
  if (!from) return "no sender (a bounce)";
  if (NO_REPLY_SENDER.test(from)) return `sender ${from}`;
  const auto = (headers.get("Auto-Submitted") || "no").trim().toLowerCase();
  if (auto !== "no") return `Auto-Submitted: ${auto}`;
  const precedence = (headers.get("Precedence") || "").trim();
  if (/^(bulk|list|junk|auto_reply)$/i.test(precedence)) return `Precedence: ${precedence}`;
  for (const name of ["List-Id", "List-Unsubscribe", "X-Autoreply", "X-Autorespond"]) {
    if (headers.get(name)) return `${name} header`;
  }
  // Exchange's request not to auto-reply. Only its auto-reply values count: Outlook can stamp
  // ordinary mail with delivery/read-receipt values (DR, RN, NRN), which don't concern us.
  const suppress = (headers.get("X-Auto-Response-Suppress") || "").toLowerCase();
  if (/\b(all|autoreply|oof)\b/.test(suppress)) return `X-Auto-Response-Suppress: ${suppress}`;
  return null;
}

export const isAutomated = (from, headers) => automatedReason(from, headers) !== null;

// ---------- only answering senders Cloudflare authenticated ----------
//
// An auto-reply goes to message.from, which anyone can forge. Cloudflare's reply() refuses
// mail without a valid DMARC result; the Resend path checks the same thing itself, so a forged
// sender can't turn the Worker into a source of backscatter. Email Routing checks DMARC before
// the Worker runs and adds its result as the FIRST Authentication-Results header, with the
// authserv-id mx.cloudflare.net; any other copy may have come from the sender and is ignored.
// Docs: https://developers.cloudflare.com/email-routing/email-workers/runtime-api/
//       https://developers.cloudflare.com/email-routing/email-workers/reply-email-workers/

const CLOUDFLARE_AUTHSERV_ID = "mx.cloudflare.net";

/**
 * The first Authentication-Results header split into its ";"-separated parts, or null when
 * it can't be read. Headers.get joins repeated headers with ", " in their order, so the first
 * header ends at the first comma outside a quoted string or comment. Quoted strings (which
 * may echo a sender's envelope local part, with ";" and "," in it) are kept whole, and
 * (nested) comments are dropped, so no sender text is read as structure (RFC 8601, RFC 5322
 * quoted-string and comment). An unclosed quote or comment makes it unreadable: no reply.
 */
function firstResultParts(joined) {
  const parts = [];
  let part = "";
  let depth = 0; // comment nesting
  let quoted = false;
  for (let i = 0; i < joined.length; i++) {
    const c = joined[i];
    if ((quoted || depth > 0) && c === "\\") {
      if (quoted) part += c + (joined[i + 1] ?? "");
      i++; // a quoted-pair: the next character is literal
    } else if (quoted) {
      part += c;
      if (c === '"') quoted = false;
    } else if (depth > 0) {
      if (c === "(") depth++;
      else if (c === ")") depth--;
      if (depth === 0) part += " ";
    } else if (c === '"') {
      quoted = true;
      part += c;
    } else if (c === "(") {
      depth = 1;
    } else if (c === ";" || c === ",") {
      parts.push(part.trim());
      part = "";
      if (c === ",") return parts; // the end of the first header
    } else {
      part += c;
    }
  }
  if (quoted || depth > 0) return null;
  parts.push(part.trim());
  return parts;
}

/**
 * Cloudflare's own DMARC result: { reason } when it isn't a pass (or can't be trusted), else
 * { reason: null, domain } with the header From domain it authenticated (lower case), or
 * domain null when the result names none.
 */
function cloudflareDmarc(headers) {
  const joined = headers.get("Authentication-Results");
  if (!joined) return { reason: "no Authentication-Results header" };
  const parts = firstResultParts(joined);
  if (!parts) return { reason: "unreadable Authentication-Results (an unclosed quote or comment)" };
  const [id, ...results] = parts;
  // The authserv-id may be followed by a version number ("mx.cloudflare.net 1").
  if (id.split(/\s+/)[0].toLowerCase() !== CLOUDFLARE_AUTHSERV_ID) {
    return { reason: `the first Authentication-Results is not ${CLOUDFLARE_AUTHSERV_ID}'s` };
  }
  const dmarc = results.filter((r) => /^dmarc\s*=/i.test(r));
  if (dmarc.length === 0) return { reason: "no dmarc result" };
  if (dmarc.length > 1) return { reason: "more than one dmarc result" };
  const verdict = /^dmarc\s*=\s*([a-z]*)/i.exec(dmarc[0])[1].toLowerCase();
  if (verdict !== "pass") return { reason: `dmarc=${verdict}` };
  // Quoted values are blanked first, so text echoed inside one can't pose as the property.
  const props = dmarc[0].replace(QUOTED_STRING, '""');
  const froms = [...props.matchAll(/(?:^|\s)header\.from\s*=\s*([A-Za-z0-9.-]+)(?=\s|$)/gi)];
  if (froms.length > 1) return { reason: "more than one header.from in the dmarc result" };
  return { reason: null, domain: froms.length ? froms[0][1].toLowerCase().replace(/\.$/, "") : null };
}

// An RFC 5322 quoted string, with its quoted-pairs.
const QUOTED_STRING = /"(?:[^"\\]|\\.)*"/g;

/** Why Cloudflare's own result doesn't show dmarc=pass, or null when it does (RFC 8601). */
export function dmarcReason(headers) {
  return cloudflareDmarc(headers).reason;
}

// A plain envelope address: an unquoted local part and a dotted domain, nothing else. Quotes,
// commas, spaces, angle brackets or a second "@" could make Resend's "to" mean another
// mailbox (or several) than the one checked here.
const PLAIN_ADDRESS = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)$/;

/**
 * The single address in a From header ("Name" <a@b> or a bare a@b), or null when it holds
 * anything else (several mailboxes, an address in the display name, a non-plain address).
 */
function headerFromAddress(value) {
  const text = (value || "").trim();
  const open = text.lastIndexOf("<");
  if (open === -1) return PLAIN_ADDRESS.test(text) ? text : null;
  const close = text.indexOf(">", open);
  if (close === -1 || text.slice(close + 1).trim() !== "") return null;
  const display = text.slice(0, open).replace(QUOTED_STRING, "");
  if (/[@,<>"]/.test(display)) return null;
  const address = text.slice(open + 1, close).trim();
  return PLAIN_ADDRESS.test(address) ? address : null;
}

/**
 * Why the auto-reply must not go to `from` (the envelope sender), or null. DMARC
 * authenticates the header From domain (DKIM signs the From header, never the envelope), and
 * the reply goes to the envelope sender. So the envelope sender must be exactly the signed
 * From address, in the authenticated domain or a subdomain of it (relaxed alignment).
 * Otherwise a sender who passes DMARC (or replays someone's signed message) could aim
 * replies at another mailbox.
 */
export function senderReason(from, headers) {
  const dmarc = cloudflareDmarc(headers);
  if (dmarc.reason) return `DMARC: ${dmarc.reason}`;
  if (!dmarc.domain) return "DMARC: the pass names no header.from domain";
  const plain = PLAIN_ADDRESS.exec(from || "");
  if (!plain) return "sender: not a plain address";
  const domain = plain[1].toLowerCase();
  if (domain !== dmarc.domain && !domain.endsWith(`.${dmarc.domain}`)) {
    return `sender: ${domain} is not the DMARC-authenticated ${dmarc.domain}`;
  }
  const signed = headerFromAddress(headers.get("From"));
  if (!signed || signed.toLowerCase() !== from.toLowerCase()) {
    return "sender: the envelope sender is not the From address";
  }
  return null;
}

// ---------- the sender's Message-ID ----------
//
// It is copied into In-Reply-To/References and keys Resend's idempotency, so only a short,
// well-formed one is used: "<left@right>" in printable ASCII without spaces, angle brackets or
// a second "@", at most 250 characters. Anything else means no threading and a random key.

const MESSAGE_ID_MAX = 250;
const MESSAGE_ID = /^<[\x21-\x3b\x3d\x3f\x41-\x7e]+@[\x21-\x3b\x3d\x3f\x41-\x7e]+>$/;

/** The sender's Message-ID when it is safe to reflect, otherwise null. */
export function safeMessageId(value) {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id.length <= MESSAGE_ID_MAX && MESSAGE_ID.test(id) ? id : null;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** UTF-8 text as base64, in 76-character lines (RFC 2045). */
function base64Lines(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

/** Non-ASCII header text, e.g. a subject with an emoji (RFC 2047). */
function headerText(text) {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${base64Lines(text).replace(/\r\n/g, "")}?=`;
}

// The reply's subject is fixed, never the sender's: DKIM doesn't sign an extra Subject added
// on top of a signed one, so a replayed message could otherwise put a third party's words in
// Lumiback's mail to the signer. In-Reply-To and References still thread the reply.
const REPLY_SUBJECT = "We've got your message";

const TEXT = [
  "Hi,",
  "",
  "Message received",
  "Thanks for writing to Lumiback. Your message has reached the team, and someone will reply to this address, usually within a day.",
  "",
  "If it's urgent, for example you're out and running late, call your hostel office or warden directly. Lumiback's alerts don't replace them.",
  "",
  `Your outing status and history are always on ${SITE}/home and in the app.`,
  "",
  "This is an automatic reply; there's no need to answer it.",
  "Lumiback, for Graphic Era hostel students.",
].join("\n");

function html() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Message received</title>
</head>
<body style="margin:0;padding:0;background:${PAGE};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE};">
<tr><td align="center" style="padding:28px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
<tr><td style="padding:0 4px 14px;font-family:${SANS};font-size:20px;font-weight:bold;color:${INK};">Lumiback</td></tr>
<tr><td style="background:#ffffff;border:1px solid ${LINE};border-radius:12px;padding:28px 26px;">
<p style="${P}">Hi,</p>
<p style="margin:18px 0 0;font-family:${SANS};font-size:12px;line-height:16px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${GOOD};">Message received</p>
<h1 style="margin:6px 0 4px;font-family:${SANS};font-size:22px;line-height:28px;font-weight:bold;color:${INK};">Thanks for writing to Lumiback</h1>
<p style="${P}margin-top:10px;">Your message has reached the team, and someone will reply to this address, usually within a day.</p>
<p style="${P}margin-top:10px;">If it's urgent, for example you're out and running late, call your hostel office or warden directly. Lumiback's alerts don't replace them.</p>
<p style="${SMALL}margin-top:18px;">Your outing status and history are always on ${escapeHtml(SITE.replace("https://", ""))}/home and in the app.</p>
</td></tr>
<tr><td style="padding:16px 4px 0;font-family:${SANS};font-size:12px;line-height:18px;color:${MUTED};">This is an automatic reply; there's no need to answer it.<br>Lumiback, for Graphic Era hostel students.</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** The raw MIME reply: text and HTML alternatives, threaded under the original message. */
export function buildReply({ from, to, messageId, now = new Date(), id = crypto.randomUUID() }) {
  const domain = from.split("@")[1];
  const boundary = `lumiback-${id}`;
  const threadId = safeMessageId(messageId);
  const headers = [
    `From: ${FROM_NAME} <${from}>`,
    `To: ${to}`,
    `Subject: ${headerText(REPLY_SUBJECT)}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${id}@${domain}>`,
    ...(threadId ? [`In-Reply-To: ${threadId}`, `References: ${threadId}`] : []),
    // RFC 3834: marks this as an auto-reply so other responders stay quiet.
    "Auto-Submitted: auto-replied",
    "X-Auto-Response-Suppress: All",
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const part = (type, body) =>
    [
      `--${boundary}`,
      `Content-Type: ${type}; charset=UTF-8`,
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(body),
    ].join("\r\n");
  return [
    headers.join("\r\n"),
    "",
    part("text/plain", TEXT),
    part("text/html", html()),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

// ---------- keeping the API awake during outing hours ----------
//
// Render's free plan spins the API down after 15 minutes without traffic, and the late-alert
// sweep runs inside the API: a student 30 minutes late would get no alert until someone woke
// it. A Cron Trigger (every 10 minutes) pings each service inside its own window. The API's
// /health runs `SELECT 1`, so the daily pings also keep the free Supabase project from pausing.
// Free hours (750 a month, shared by both services; a service that runs out of hours gets
// all of them suspended), over a 31-day month, with ~15 minutes of idle tail per wake-up:
//   API 09:30-22:00 = 12.5 h x 31 = 388 h + ~8 h   = ~396 h
//   web 17:00-22:00 =  5 h   x 31 = 155 h + ~8 h   = ~163 h
//   total ~559 h, leaving ~190 h for visits outside the windows.
// Keep both windows together under ~650 h; widening the web window to 10:00-22:00 would
// leave about 0 h of headroom.

const IST_OFFSET_MIN = 5 * 60 + 30;

/** "HH:MM" as minutes after midnight, or null when it isn't a valid time. */
const minutesOf = (hhmm) => {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec((hhmm || "").trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/**
 * Is `now` inside the HH:MM window on the campus (IST) clock? An unset or invalid bound falls
 * back to the default rather than switching keep-awake off; a window that ends before it starts
 * (e.g. 17:00-01:00) runs overnight. Keep `until` at least 40 minutes after the latest "Back by"
 * so the late alert (30 min) and the escalation (40 min) still find the API awake.
 */
export function inAwakeWindow(now, from, until, fallback = ["09:30", "22:00"]) {
  const start = minutesOf(from) ?? minutesOf(fallback[0]);
  const end = minutesOf(until) ?? minutesOf(fallback[1]);
  const ist = (now.getUTCHours() * 60 + now.getUTCMinutes() + IST_OFFSET_MIN) % (24 * 60);
  return start <= end ? ist >= start && ist < end : ist >= start || ist < end;
}

/**
 * What each Render service is pinged at and when. Point both URLs at the services' own
 * onrender.com addresses, not the Cloudflare domain: a cached answer at the edge never reaches
 * Render, so it wouldn't keep anything awake. The website is pinged for its small static
 * `/app/android.json`.
 */
export const AWAKE_TARGETS = [
  { name: "api", url: "KEEP_AWAKE_URL", from: "KEEP_AWAKE_FROM", until: "KEEP_AWAKE_UNTIL", fallback: ["09:30", "22:00"] },
  { name: "web", url: "KEEP_AWAKE_WEB_URL", from: "KEEP_AWAKE_WEB_FROM", until: "KEEP_AWAKE_WEB_UNTIL", fallback: ["17:00", "22:00"] },
];

const TEN_MINUTES = 10 * 60 * 1000;

/**
 * How long each outbound fetch may take before it is aborted (AbortSignal.timeout). A timeout
 * rejects like a network error ("TimeoutError: ..."), so it is handled the same way. Pings get
 * room for a Render cold start (~30 s or more); that first ping never alerts anyway, and Render
 * still wakes when the Worker stops waiting. Resend normally answers in well under a second.
 */
export const FETCH_TIMEOUT_MS = { ping: 30_000, resend: 10_000 };

/** The API's /health "sweep" field ("ok", "stale" or "off"), or null when the body isn't JSON. */
async function sweepOf(res) {
  try {
    const body = await res.json();
    return typeof body?.sweep === "string" ? body.sweep : null;
  } catch {
    return null;
  }
}

/**
 * Pings one service. `line` is for the log; `problem` is set when the owner should hear about
 * it. A service only counts as down once it was already inside its window 10 minutes earlier:
 * the first ping of a window wakes it from sleep, and a cold start may time out.
 */
async function ping(target, now, env, fetcher) {
  const url = env[target.url];
  if (!url) return { line: `${target.name}: off (no ${target.url})`, problem: null };
  const inWindow = (at) => inAwakeWindow(at, env[target.from], env[target.until], target.fallback);
  if (!inWindow(now)) return { line: `${target.name}: outside the window`, problem: null };
  const settled = inWindow(new Date(now.getTime() - TEN_MINUTES));
  const report = (line, problem) => ({ line, problem: settled ? problem : null });
  try {
    const res = await fetcher(url, {
      headers: { "User-Agent": "lumiback-keep-awake" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS.ping),
    });
    if (!res.ok) {
      return report(`${target.name}: pinged ${res.status}`, `${target.name} answered ${res.status} (${url})`);
    }
    if (target.name === "api" && (await sweepOf(res)) === "stale") {
      return report(
        `${target.name}: pinged ${res.status}, sweep stale`,
        "api is up, but its sweep has not finished for a while, so late alerts and escalations are not going out",
      );
    }
    return { line: `${target.name}: pinged ${res.status}`, problem: null };
  } catch (err) {
    // A cold start can time out; the next run retries.
    return report(
      `${target.name}: ping failed: ${describe(err)}`,
      `${target.name} did not answer: ${describe(err)} (${url})`,
    );
  }
}

/** Pings every configured service inside its window. */
export async function checkServices(now, env, fetcher = fetch) {
  return Promise.all(AWAKE_TARGETS.map((t) => ping(t, now, env, fetcher)));
}

/** Pings every configured service inside its window; one log line says what happened to each. */
export async function keepAwake(now, env, fetcher = fetch) {
  return (await checkServices(now, env, fetcher)).map((r) => r.line).join("; ");
}

// ---------- alerting the owner ----------
//
// When a ping finds a problem (the API or the website down, or the API's sweep stale), the
// Worker emails FORWARD_TO through Resend. The Worker keeps no state between cron runs, so it
// can't tell a new incident from an old one; instead it only emails on the runs at minute 0
// and 30 (the cron fires every 10 minutes). An incident that lasts sends at most 2 emails an
// hour, and one that clears within 10-20 minutes may send none. The other runs log
// "alert held". Problems only count inside a service's keep-awake window: outside it, the
// services are meant to sleep.

/** Does this cron run send alerts? Minute 0 and 30 (IST is UTC+5:30, so the same minutes). */
export const isAlertMinute = (now) => now.getUTCMinutes() % 30 === 0;

const istTime = (now) => {
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60 * 1000);
  return `${ist.toISOString().slice(0, 16).replace("T", " ")} IST`;
};

/** The alert email: one line per problem, and where to look next. Plain text on purpose. */
export function alertEmail(problems, now) {
  const subject =
    problems.length === 1 ? `Lumiback alert: ${problems[0].split(" ")[0]} needs a look` : "Lumiback alert: services need a look";
  const text = [
    `The keep-awake check at ${istTime(now)} found:`,
    "",
    ...problems.map((p) => `- ${p}`),
    "",
    "Check the service's logs on Render (and Supabase if the database is down).",
    "This check runs every 10 minutes and emails at :00 and :30 while the problem lasts.",
    "Lumiback monitor (Cloudflare Worker lumiback-support-email).",
  ].join("\n");
  return { subject, text };
}

/** Sends the alert through Resend to FORWARD_TO. Throws with Resend's reason when refused. */
export async function sendAlert(problems, now, env, fetcher = fetch) {
  const { subject, text } = alertEmail(problems, now);
  const res = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      // A retried cron run for the same minute must not send a second email.
      "Idempotency-Key": `health-alert-${now.toISOString().slice(0, 16)}`,
    },
    body: JSON.stringify({
      from: `Lumiback Monitor <${SUPPORT_ADDRESS}>`,
      to: [env.FORWARD_TO],
      subject,
      text,
      headers: { "Auto-Submitted": "auto-generated" },
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS.resend),
  });
  if (!res.ok) throw new Error(`Resend answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** One cron run: ping, then alert when needed. Returns the run's log line. */
export async function monitor(now, env, fetcher = fetch) {
  const results = await checkServices(now, env, fetcher);
  const line = results.map((r) => r.line).join("; ");
  const problems = results.map((r) => r.problem).filter(Boolean);
  if (problems.length === 0) return line;
  if (!isAlertMinute(now)) return `${line}; alert held until :00 or :30`;
  if (!env.RESEND_API_KEY || !env.FORWARD_TO) {
    return `${line}; alert NOT sent: needs the RESEND_API_KEY and FORWARD_TO secrets`;
  }
  try {
    await sendAlert(problems, now, env, fetcher);
    return `${line}; alert sent`;
  } catch (err) {
    return `${line}; alert NOT sent: ${describe(err)}`;
  }
}

// ---------- limiting auto-replies ----------
//
// Every auto-reply is a Resend send, and the owner's health alerts share that key and quota, so
// a flood of inbound mail must not be able to spend it. Two Workers Rate Limiting bindings
// (wrangler.toml [[ratelimits]]) cap replies per sender and in total. Their counts are per
// Cloudflare location, per 60-second window and eventually consistent, so this bounds the RATE
// of replies, not a daily total. Over a limit, without the bindings, or when a check fails, the
// sender gets no auto-reply; the email itself is still forwarded.
// NOTE: the DAILY total of auto-replies is still uncapped (no Durable Object or KV counter);
// whether to add one is the owner's decision. See the same note in wrangler.toml.
// Docs: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/

/** Why this sender must not get an auto-reply right now, or null when it may. */
export async function rateLimitReason(from, env) {
  const sender = env.AUTO_REPLY_SENDER_LIMIT;
  const global = env.AUTO_REPLY_GLOBAL_LIMIT;
  if (!sender) return "rate limit: AUTO_REPLY_SENDER_LIMIT binding missing";
  if (!global) return "rate limit: AUTO_REPLY_GLOBAL_LIMIT binding missing";
  try {
    // The sender first, so one noisy sender doesn't also use up everyone's allowance.
    if (!(await sender.limit({ key: from.toLowerCase() })).success) return "rate limit: this sender";
    if (!(await global.limit({ key: "all" })).success) return "rate limit: all senders";
    return null;
  } catch (err) {
    return `rate limit check failed: ${describe(err)}`;
  }
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(monitor(new Date(event.scheduledTime), env).then((r) => console.log(r)));
  },

  // The Worker only handles email; its workers.dev address answers web visits with a plain
  // 404 instead of a "Worker threw exception" page (and an error in the logs).
  fetch() {
    return new Response("Not found. This address only receives email.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },

  async email(message, env, _ctx, fetcher = fetch) {
    // Reply first, then forward (Cloudflare's order). A failed reply is caught, so the forward
    // always runs and a person always gets the message. One log line per email says what
    // happened, so the Worker's Logs tab answers "why no auto-reply?".
    let outcome;
    // Unauthenticated mail is turned away before the rate limit, so a forged sender can't
    // spend the allowance either.
    const skip =
      automatedReason(message.from, message.headers) ??
      senderReason(message.from, message.headers) ??
      (await rateLimitReason(message.from, env));
    if (skip) {
      outcome = `no auto-reply (${skip})`;
    } else {
      const reply = {
        // The fixed support address, never the envelope recipient: a catch-all route or another
        // address pointed at this Worker must not choose who the reply claims to be from.
        from: SUPPORT_ADDRESS,
        to: message.from,
        messageId: message.headers.get("Message-ID"),
      };
      try {
        if (env.RESEND_API_KEY) {
          await sendWithResend(reply, env.RESEND_API_KEY, fetcher);
          outcome = `auto-reply sent through Resend to ${message.from}`;
        } else {
          const raw = buildReply(reply);
          await message.reply(new EmailMessage(SUPPORT_ADDRESS, message.from, raw));
          outcome = `auto-reply sent through Cloudflare to ${message.from}`;
        }
      } catch (err) {
        outcome = `auto-reply NOT sent: ${describe(err)}`;
      }
    }
    try {
      await message.forward(env.FORWARD_TO);
      console.log(`forwarded to inbox; ${outcome}`);
    } catch (err) {
      console.error(`FORWARD FAILED (${describe(err)}); ${outcome}`);
      throw err; // let Email Routing record the failure
    }
  },
};

function describe(err) {
  if (!err) return "unknown error";
  return [err.name, err.message].filter(Boolean).join(": ") || String(err);
}

/**
 * The auto-reply through Resend, which already sends Lumiback's email for this domain (SPF,
 * DKIM and an inbox-tested reputation at Microsoft 365). Cloudflare's own reply() refused to
 * send on 2026-10-09 without saying why. Set RESEND_API_KEY as a secret on the Worker (a
 * sending-only key) to use this; without it, the Worker falls back to Cloudflare's reply().
 */
export async function sendWithResend({ from, to, messageId }, apiKey, fetcher = fetch) {
  const threadId = safeMessageId(messageId);
  const headers = {
    "Auto-Submitted": "auto-replied",
    "X-Auto-Response-Suppress": "All",
    ...(threadId ? { "In-Reply-To": threadId, References: threadId } : {}),
  };
  // A digest keeps the key a fixed 83 characters (Resend allows 256) and lets a retried email
  // dedupe; without a usable Message-ID, every send gets its own random key. The recipient is
  // part of it, so one sender's Message-ID can never suppress a reply to someone else.
  const key = threadId ? await sha256Hex(`${to} ${threadId}`) : crypto.randomUUID();
  const res = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `support-auto-reply-${key}`,
    },
    body: JSON.stringify({
      from: `${FROM_NAME} <${from}>`,
      to: [to],
      subject: REPLY_SUBJECT,
      text: TEXT,
      html: html(),
      headers,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS.resend),
  });
  if (!res.ok) {
    // Resend's error names the problem (bad key, unverified domain); it holds no secrets.
    throw new Error(`Resend answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}
