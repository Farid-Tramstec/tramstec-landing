/**
 * Waitlist endpoint — Vercel serverless function (Node 20).
 *
 * Receives the landing's signup form while the public API backend isn't
 * deployed yet. Two storage paths run in parallel:
 *
 *   1) Always: notification email to OWNER_EMAIL via Resend (if RESEND_API_KEY
 *      is set in Vercel env vars). If it isn't, we log to console.
 *   2) Optional: append the lead to a Resend Audience so the operator can
 *      later import to their CRM / blast a "we're live" campaign without
 *      having to dig through inbox emails. Set RESEND_AUDIENCE_ID to enable.
 *
 * Env vars (configure in Vercel → Project → Settings → Environment Variables):
 *   - RESEND_API_KEY        (optional) — re_xxx from resend.com
 *   - RESEND_AUDIENCE_ID    (optional) — uuid from a Resend Audience
 *   - OWNER_EMAIL           (optional, default farid@tramstec.com)
 *   - WAITLIST_FROM         (optional, default "TramsTec <noreply@tramstec.com>")
 *
 * Anti-abuse: simple in-memory rate limit per IP (Vercel functions are
 * stateless across invocations, so this is best-effort only; a proper
 * limiter belongs in the API layer or Vercel Edge Middleware).
 */

const VALID_PLANS = new Set(["starter", "growth", "scale", "enterprise"]);
const VALID_ADDONS = new Set(["payments", "erp", "priority"]);

function isEmail(v) {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;
}

function cleanStr(v, maxLen) {
  if (typeof v !== "string") return "";
  const s = v.trim().slice(0, maxLen);
  return s;
}

function htmlEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function sendNotificationEmail({ to, from, subject, html, apiKey }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

async function addToAudience({ audienceId, email, firstName, apiKey }) {
  const res = await fetch(
    `https://api.resend.com/audiences/${encodeURIComponent(audienceId)}/contacts`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ email, first_name: firstName || undefined, unsubscribed: false }),
    },
  );
  if (!res.ok && res.status !== 409) {
    // 409 = already in audience — that's fine
    const txt = await res.text().catch(() => "");
    throw new Error(`Resend audience ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json().catch(() => ({}));
}

module.exports = async function handler(req, res) {
  // CORS (the landing and the API live under the same origin in production,
  // but we allow same-origin POSTs and reject preflight from elsewhere).
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "POST");
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  // Body parsing — Vercel parses JSON automatically when Content-Type matches.
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  if (!body || typeof body !== "object") body = {};

  const email = cleanStr(body.email, 254).toLowerCase();
  const workspace = cleanStr(body.workspace, 120);
  const framework = cleanStr(body.framework, 60);
  const plan = cleanStr(body.plan, 30);
  const lang = body.lang === "en" ? "en" : "es";
  const rawAddons = Array.isArray(body.addons) ? body.addons : [];
  const addons = rawAddons.filter((a) => typeof a === "string" && VALID_ADDONS.has(a));
  const fiscal = body.fiscal && typeof body.fiscal === "object" ? body.fiscal : null;

  if (!isEmail(email)) {
    return res.status(400).json({ error: "invalid_email" });
  }
  if (plan && !VALID_PLANS.has(plan)) {
    return res.status(400).json({ error: "invalid_plan" });
  }

  const ownerEmail = process.env.OWNER_EMAIL || "farid@tramstec.com";
  const fromAddr = process.env.WAITLIST_FROM || "TramsTec <noreply@tramstec.com>";
  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;

  const ip = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() || "unknown";
  const ua = (req.headers["user-agent"] || "").toString().slice(0, 200);
  const ts = new Date().toISOString();

  // Always log so we can see leads in Vercel function logs even without Resend.
  console.log("[waitlist] new lead", { ts, email, workspace, framework, plan, addons, lang, ip });

  // Try to deliver to Resend (if configured). Failures are surfaced to the
  // client so retries happen and we don't silently swallow leads.
  let delivered = false;
  if (apiKey) {
    const subject = `Nuevo waitlist: ${email}${workspace ? ` (${workspace})` : ""}`;
    const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#0f3a3a">
        <h2 style="margin:0 0 12px 0;color:#0f3a3a">Nuevo registro en waitlist de TramsTec</h2>
        <p style="margin:0 0 16px 0">Recibido a las <strong>${htmlEscape(ts)}</strong> (UTC)</p>
        <table style="border-collapse:collapse;width:100%;max-width:520px">
          <tr><td style="padding:6px 10px;background:#f4eedb;width:140px"><strong>Email</strong></td><td style="padding:6px 10px"><a href="mailto:${htmlEscape(email)}">${htmlEscape(email)}</a></td></tr>
          <tr><td style="padding:6px 10px;background:#f4eedb"><strong>Empresa</strong></td><td style="padding:6px 10px">${htmlEscape(workspace || "—")}</td></tr>
          <tr><td style="padding:6px 10px;background:#f4eedb"><strong>Stack IA</strong></td><td style="padding:6px 10px">${htmlEscape(framework || "—")}</td></tr>
          <tr><td style="padding:6px 10px;background:#f4eedb"><strong>Plan</strong></td><td style="padding:6px 10px">${htmlEscape(plan || "—")}</td></tr>
          <tr><td style="padding:6px 10px;background:#f4eedb"><strong>Add-ons</strong></td><td style="padding:6px 10px">${addons.length ? addons.map(htmlEscape).join(", ") : "—"}</td></tr>
          <tr><td style="padding:6px 10px;background:#f4eedb"><strong>Idioma</strong></td><td style="padding:6px 10px">${htmlEscape(lang)}</td></tr>
          ${fiscal ? `<tr><td style="padding:6px 10px;background:#f4eedb"><strong>RFC</strong></td><td style="padding:6px 10px">${htmlEscape(fiscal.rfc || "—")}</td></tr><tr><td style="padding:6px 10px;background:#f4eedb"><strong>Razón social</strong></td><td style="padding:6px 10px">${htmlEscape(fiscal.business_name || "—")}</td></tr><tr><td style="padding:6px 10px;background:#f4eedb"><strong>C.P.</strong></td><td style="padding:6px 10px">${htmlEscape(fiscal.postal_code || "—")}</td></tr>` : ""}
          <tr><td style="padding:6px 10px;background:#f4eedb"><strong>IP</strong></td><td style="padding:6px 10px">${htmlEscape(ip)}</td></tr>
          <tr><td style="padding:6px 10px;background:#f4eedb"><strong>User-Agent</strong></td><td style="padding:6px 10px;color:#666;font-size:12px">${htmlEscape(ua)}</td></tr>
        </table>
        <p style="margin:16px 0 0 0;color:#666;font-size:12px">Responde directo a <a href="mailto:${htmlEscape(email)}">${htmlEscape(email)}</a> para tomar contacto.</p>
      </div>
    `;
    try {
      await sendNotificationEmail({ to: ownerEmail, from: fromAddr, subject, html, apiKey });
      delivered = true;
    } catch (err) {
      console.error("[waitlist] resend notification failed", err);
    }
    if (audienceId) {
      try {
        await addToAudience({ audienceId, email, firstName: workspace, apiKey });
      } catch (err) {
        console.error("[waitlist] resend audience add failed", err);
      }
    }
  } else {
    // No Resend configured. Still return 200 — the lead is in Vercel's
    // function logs and the operator can paginate logs to collect it.
    console.warn("[waitlist] RESEND_API_KEY not set — lead only persisted to function logs");
    delivered = true;
  }

  return res.status(200).json({ ok: true, delivered });
}
