// Helpers compartidos de NEXO NORSK (los archivos api/_* no se exponen como endpoint).
// Sin dependencias: node:crypto + fetch global (Node 18+).
//
// Variables de entorno (ver norsk/NORSK_SETUP.md):
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY,
//   NORSK_JWT_SECRET, RESEND_API_KEY, NORSK_SITE_URL

import crypto from "node:crypto";

// Única fuente de verdad de los planes. El cliente nunca envía importes.
export const PLANES = {
  p10: { amount: 24900, dias: 10, nombre: "Intensivo" },
  p30: { amount: 34900, dias: 30, nombre: "Con Calma" },
  p90: { amount: 44900, dias: 90, nombre: "Sin Prisa" },
};

export const COOKIE = "nexo_norsk";

export function siteUrl() {
  return process.env.NORSK_SITE_URL || "https://www.nexonoruega.com";
}

// ---------- JWT HS256 mínimo ----------

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlJSON(obj) {
  return b64url(JSON.stringify(obj));
}

export function jwtSign(payload, secret) {
  const head = b64urlJSON({ alg: "HS256", typ: "JWT" });
  const body = b64urlJSON(payload);
  const sig = crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest();
  return `${head}.${body}.${b64url(sig)}`;
}

export function jwtVerify(token, secret) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const expected = crypto.createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest();
  let given;
  try { given = Buffer.from(parts[2].replace(/-/g, "+").replace(/_/g, "/"), "base64"); } catch (e) { return null; }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); } catch (e) { return null; }
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
  return payload;
}

// ---------- Cookie de sesión ----------

export function setSessionCookie(res, compraId, expiresAtMs) {
  const secret = process.env.NORSK_JWT_SECRET;
  const exp = Math.floor(expiresAtMs / 1000);
  const token = jwtSign({ sub: compraId, exp, uso: "sesion" }, secret);
  const maxAge = Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));
  res.setHeader("Set-Cookie",
    `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`);
}

export function readSessionCookie(req) {
  const raw = req.headers.cookie || "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const payload = jwtVerify(m[1], process.env.NORSK_JWT_SECRET);
  if (!payload || payload.uso !== "sesion" || !payload.sub) return null;
  return payload;
}

// ---------- Supabase REST ----------

function sbHeaders(extra) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return Object.assign({
    "Content-Type": "application/json",
    apikey: key,
    Authorization: `Bearer ${key}`,
  }, extra || {});
}

export async function sbSelect(pathAndQuery) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${pathAndQuery}`, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`supabase select ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function sbInsert(table, rows, prefer) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: sbHeaders({ Prefer: prefer || "return=representation" }),
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(`supabase insert ${r.status}: ${await r.text()}`);
  const text = await r.text();
  return text ? JSON.parse(text) : [];
}

export async function sbUpsert(table, rows, onConflict, prefer) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: sbHeaders({ Prefer: prefer || "resolution=ignore-duplicates,return=representation" }),
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(`supabase upsert ${r.status}: ${await r.text()}`);
  const text = await r.text();
  return text ? JSON.parse(text) : [];
}

export async function sbRpc(fn, args) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: sbHeaders(),
    body: JSON.stringify(args || {}),
  });
  if (!r.ok) throw new Error(`supabase rpc ${fn} ${r.status}: ${await r.text()}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

// Compra activa (o null). Comprueba estado y caducidad en servidor, no solo la cookie.
export async function compraActiva(compraId) {
  const rows = await sbSelect(
    `norsk_compras?id=eq.${encodeURIComponent(compraId)}&status=eq.activa&select=id,email,plan,expires_at`);
  if (!rows.length) return null;
  const c = rows[0];
  if (new Date(c.expires_at).getTime() < Date.now()) return null;
  return c;
}

// Rate limit persistente vía RPC (ver SQL en NORSK_SETUP.md). Devuelve el contador del día.
export async function tickUso(compraId) {
  return sbRpc("norsk_incr_uso", { p_compra: compraId });
}

// ---------- Stripe REST (form-encoded, sin SDK) ----------

export function stripeForm(params, prefix, out) {
  out = out || new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === "object") stripeForm(item, `${key}[${i}]`, out);
        else out.append(`${key}[${i}]`, String(item));
      });
    } else if (typeof v === "object") {
      stripeForm(v, key, out);
    } else {
      out.append(key, String(v));
    }
  });
  return out;
}

export async function stripe(path, params, method) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: method || (params ? "POST" : "GET"),
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params ? stripeForm(params).toString() : undefined,
  });
  const data = await r.json();
  if (!r.ok) {
    const msg = data && data.error ? data.error.message : `stripe ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return data;
}

// Verificación de firma del webhook (cabecera stripe-signature) sobre el body RAW.
export function stripeVerifySignature(rawBody, sigHeader, secret, toleranceSec) {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=")));
  const t = parseInt(parts.t, 10);
  if (!t || Math.abs(Date.now() / 1000 - t) > (toleranceSec || 300)) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const given = parts.v1 || "";
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- Resend ----------

export async function sendMagicLink(email, compraId, expiresAtMs) {
  const secret = process.env.NORSK_JWT_SECRET;
  const exp = Math.floor(expiresAtMs / 1000);
  const token = jwtSign({ sub: compraId, email, exp, uso: "activar" }, secret);
  const enlace = `${siteUrl()}/api/norsk-activar/?token=${encodeURIComponent(token)}`;
  const caduca = new Date(expiresAtMs).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });

  const html = [
    `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#0E1B26;line-height:1.6">`,
    `<p style="font-family:system-ui,sans-serif;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#2C5A72">NEXO NORSK</p>`,
    `<h1 style="font-family:system-ui,sans-serif;font-size:22px;letter-spacing:-.01em">Tu acceso está listo.</h1>`,
    `<p>Este es tu enlace de entrada. Funciona en cualquier dispositivo y todas las veces que lo necesites hasta el <b>${caduca}</b>.</p>`,
    `<p style="margin:28px 0"><a href="${enlace}" style="background:#3FCB94;color:#0E1B26;font-family:system-ui,sans-serif;font-weight:700;text-decoration:none;padding:14px 26px;border-radius:6px;display:inline-block">Entrar al curso</a></p>`,
    `<p style="font-size:14px;color:#2C5A72">Si el botón no funciona, copia este enlace en el navegador:<br>${enlace}</p>`,
    `<p style="font-size:14px;color:#2C5A72;margin-top:24px">Guarda este correo. Es tu llave.</p>`,
    `</div>`,
  ].join("");

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "NEXO NORSK <norsk@nexonoruega.com>",
      to: [email],
      subject: "Tu acceso a NEXO NORSK",
      html,
    }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${await r.text()}`);
  return true;
}

// ---------- util ----------

export function readBody(req) {
  if (req.body) {
    if (typeof req.body === "string") {
      try { return Promise.resolve(JSON.parse(req.body)); } catch (e) { return Promise.resolve({}); }
    }
    return Promise.resolve(req.body);
  }
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch (e) { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

export function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
