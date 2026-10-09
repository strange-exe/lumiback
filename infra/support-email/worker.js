// Cloudflare Email Worker for support@lumiback.abhinesh.codes.
//
// Every email is forwarded to FORWARD_TO (a verified Email Routing destination, set as a
// variable on the Worker), and the sender gets one automatic "we've got it" reply, threaded
// under their message. The reply goes through Resend when the RESEND_API_KEY secret is set
// (recommended), otherwise through Cloudflare's reply(). Automated mail (bounces, mailing lists,
// other auto-replies) is forwarded but never answered, so two auto-responders can't loop.
// Docs: https://developers.cloudflare.com/email-routing/email-workers/reply-email-workers/
// No npm packages, so it can be pasted into the dashboard editor as one file.

import { EmailMessage } from "cloudflare:email";

const FROM_NAME = "Lumiback Support";
const SITE = "https://lumiback.abhinesh.codes";

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

function replySubject(subject) {
  const clean = (subject || "").replace(/[\r\n]+/g, " ").trim();
  if (!clean) return "We've got your message";
  return /^re:/i.test(clean) ? clean : `Re: ${clean}`;
}

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
export function buildReply({ from, to, subject, messageId, now = new Date(), id = crypto.randomUUID() }) {
  const domain = from.split("@")[1];
  const boundary = `lumiback-${id}`;
  const headers = [
    `From: ${FROM_NAME} <${from}>`,
    `To: ${to}`,
    `Subject: ${headerText(replySubject(subject))}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${id}@${domain}>`,
    ...(messageId ? [`In-Reply-To: ${messageId}`, `References: ${messageId}`] : []),
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

export default {
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
    const skip = automatedReason(message.from, message.headers);
    if (skip) {
      outcome = `no auto-reply (${skip})`;
    } else {
      const reply = {
        from: message.to,
        to: message.from,
        subject: message.headers.get("Subject"),
        messageId: message.headers.get("Message-ID"),
      };
      try {
        if (env.RESEND_API_KEY) {
          await sendWithResend(reply, env.RESEND_API_KEY, fetcher);
          outcome = `auto-reply sent through Resend to ${message.from}`;
        } else {
          const raw = buildReply(reply);
          await message.reply(new EmailMessage(message.to, message.from, raw));
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
export async function sendWithResend({ from, to, subject, messageId }, apiKey, fetcher = fetch) {
  const id = crypto.randomUUID();
  const headers = {
    "Auto-Submitted": "auto-replied",
    "X-Auto-Response-Suppress": "All",
    ...(messageId ? { "In-Reply-To": messageId, References: messageId } : {}),
  };
  const res = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `support-auto-reply-${messageId || id}`,
    },
    body: JSON.stringify({
      from: `${FROM_NAME} <${from}>`,
      to: [to],
      subject: replySubject(subject),
      text: TEXT,
      html: html(),
      headers,
    }),
  });
  if (!res.ok) {
    // Resend's error names the problem (bad key, unverified domain); it holds no secrets.
    throw new Error(`Resend answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}
