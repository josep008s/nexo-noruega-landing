// Helpers compartidos de NEXO PASS, fuera de api/ para no consumir una funcion
// serverless propia en Vercel.
// Sin dependencias: node:crypto + fetch global (Node 18+).
//
// Variables de entorno (ver pass/PASS_SETUP.md):
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY,
//   NORSK_JWT_SECRET, RESEND_API_KEY, NORSK_SITE_URL

import crypto from "node:crypto";

// Única fuente de verdad de los planes. El cliente nunca envía importes.
export const PLANES = {
  p3: { amount: 9900, dias: 3, nombre: "Intensivo" },
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

// Devuelve las filas afectadas (return=representation): sirve para un compare-and-swap
// (PATCH con filtro condicional → si vuelve fila, esta invocación "ganó").
export async function sbPatch(table, filterQuery, patch) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?${filterQuery}`, {
    method: "PATCH",
    headers: sbHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`supabase patch ${table} ${r.status}: ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : [];
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

// Rate limit persistente vía RPC (ver SQL en pass/PASS_SETUP.md). Devuelve el contador del día
// para ese tipo. Tipos separados: "api" (práctica/simulacros) y "reenvio" (magic links),
// para que reenviar un enlace nunca queme la cuota de estudio ni al revés.
export async function tickUso(compraId, tipo) {
  return sbRpc("norsk_incr_uso", { p_compra: compraId, p_tipo: tipo || "api" });
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
// Durante la rotación del secreto, Stripe firma con ambos y manda VARIAS entradas v1:
// se acepta si cualquiera coincide (mismo criterio que el SDK oficial).
export function stripeVerifySignature(rawBody, sigHeader, secret, toleranceSec) {
  if (!sigHeader) return false;
  let t = 0;
  const v1s = [];
  sigHeader.split(",").forEach((p) => {
    const i = p.indexOf("=");
    if (i === -1) return;
    const k = p.slice(0, i).trim();
    const v = p.slice(i + 1).trim();
    if (k === "t") t = parseInt(v, 10);
    else if (k === "v1") v1s.push(v);
  });
  if (!t || Math.abs(Date.now() / 1000 - t) > (toleranceSec || 300)) return false;
  const expected = Buffer.from(
    crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"), "utf8");
  return v1s.some((given) => {
    const b = Buffer.from(given, "utf8");
    return b.length === expected.length && crypto.timingSafeEqual(expected, b);
  });
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
    `<p style="font-family:system-ui,sans-serif;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#2C5A72">NEXO PASS</p>`,
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
      from: "NEXO PASS <pass@nexonoruega.com>",
      to: [email],
      subject: "Tu acceso a NEXO PASS",
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

// JSON acotado para endpoints sensibles. Vercel puede entregar req.body ya
// parseado o como stream; en ambos casos se aplica el mismo limite en bytes.
export async function readJsonBodyLimited(req, maxBytes) {
  const limite = Number.isInteger(maxBytes) && maxBytes > 0 ? maxBytes : 2048;
  const declarado = Number(req.headers && req.headers["content-length"]);
  if (Number.isFinite(declarado) && declarado > limite) {
    const e = new Error("cuerpo demasiado grande");
    e.status = 413;
    e.code = "cuerpo";
    throw e;
  }

  if (req.body !== undefined && req.body !== null) {
    let raw;
    if (Buffer.isBuffer(req.body)) raw = req.body.toString("utf8");
    else if (typeof req.body === "string") raw = req.body;
    else {
      try { raw = JSON.stringify(req.body); }
      catch (err) {
        const e = new Error("json invalido");
        e.status = 400;
        e.code = "json";
        throw e;
      }
    }
    if (Buffer.byteLength(raw, "utf8") > limite) {
      const e = new Error("cuerpo demasiado grande");
      e.status = 413;
      e.code = "cuerpo";
      throw e;
    }
    try { return raw ? JSON.parse(raw) : {}; }
    catch (err) {
      const e = new Error("json invalido");
      e.status = 400;
      e.code = "json";
      throw e;
    }
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let excedido = false;
    req.on("data", (chunk) => {
      if (excedido) return;
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += b.length;
      if (bytes > limite) {
        excedido = true;
        return;
      }
      chunks.push(b);
    });
    req.on("end", () => {
      if (excedido) {
        const e = new Error("cuerpo demasiado grande");
        e.status = 413;
        e.code = "cuerpo";
        reject(e);
        return;
      }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch (err) {
        const e = new Error("json invalido");
        e.status = 400;
        e.code = "json";
        reject(e);
      }
    });
    req.on("error", reject);
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
