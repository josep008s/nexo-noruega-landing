#!/usr/bin/env node
// Autotest sin red de api/norsk-cuaderno.js: puerta antes que almacén.
// Comprueba método, configuración, tomo, sesión, compra y la redirección firmada.
import { handler } from "../api/norsk-cuaderno.js";

function res() {
  const r = { statusCode: 200, headers: {}, body: null, ended: false };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; r.ended = true; return r; };
  r.end = () => { r.ended = true; };
  return r;
}
const env = { NORSK_JWT_SECRET: "x", SUPABASE_URL: "https://demo.supabase.co", SUPABASE_SERVICE_KEY: "k" };
async function conEnv(valores, fn) {
  const antes = {};
  for (const k of Object.keys({ ...env, ...valores })) { antes[k] = process.env[k]; if (valores[k] === undefined) delete process.env[k]; else process.env[k] = valores[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(antes)) { if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k]; } }
}
const fetchFirma = async (url, init) => {
  if (!/\/storage\/v1\/object\/sign\/norsk-cuaderno\//.test(url)) throw new Error("ruta de firma incorrecta: " + url);
  const b = JSON.parse(init.body);
  if (b.expiresIn !== 900) throw new Error("caducidad distinta de 15 min");
  return { ok: true, json: async () => ({ signedURL: "/object/sign/norsk-cuaderno/x.pdf?token=abc" }) };
};
const casos = [];
async function caso(nombre, fn) { try { await fn(); casos.push([nombre, true]); } catch (e) { casos.push([nombre, false, e.message]); } }
const sesionOk = { readSessionCookie: () => ({ sub: "compra-1" }), compraActiva: async () => ({ id: "compra-1" }), fetch: fetchFirma };

await caso("POST -> 405", async () => { const r = res(); await conEnv(env, () => handler({ method: "POST", query: { tomo: "1" } }, r, sesionOk)); if (r.statusCode !== 405) throw new Error(r.statusCode); });
await caso("sin claves -> 503", async () => { const r = res(); await conEnv({ NORSK_JWT_SECRET: "x", SUPABASE_URL: undefined, SUPABASE_SERVICE_KEY: undefined }, () => handler({ method: "GET", query: { tomo: "1" } }, r, sesionOk)); if (r.statusCode !== 503) throw new Error(r.statusCode); });
await caso("tomo 9 -> 400", async () => { const r = res(); await conEnv(env, () => handler({ method: "GET", query: { tomo: "9" } }, r, sesionOk)); if (r.statusCode !== 400) throw new Error(r.statusCode); });
await caso("tomo con ruta -> 400", async () => { const r = res(); await conEnv(env, () => handler({ method: "GET", query: { tomo: "../1" } }, r, sesionOk)); if (r.statusCode !== 400) throw new Error(r.statusCode); });
await caso("sin sesión -> 401 y no se firma", async () => { let firmado = false; const r = res(); await conEnv(env, () => handler({ method: "GET", query: { tomo: "1" } }, r, { readSessionCookie: () => null, compraActiva: async () => ({}), fetch: async () => { firmado = true; } })); if (r.statusCode !== 401 || firmado) throw new Error(r.statusCode + " firmado=" + firmado); });
await caso("compra caducada -> 401", async () => { const r = res(); await conEnv(env, () => handler({ method: "GET", query: { tomo: "2" } }, r, { ...sesionOk, compraActiva: async () => null })); if (r.statusCode !== 401 || r.body.error !== "caducado") throw new Error(r.statusCode); });
await caso("supabase caído -> 503", async () => { const r = res(); await conEnv(env, () => handler({ method: "GET", query: { tomo: "2" } }, r, { ...sesionOk, compraActiva: async () => { throw new Error("down"); } })); if (r.statusCode !== 503) throw new Error(r.statusCode); });
await caso("compra activa -> 302 a URL firmada", async () => { const r = res(); await conEnv(env, () => handler({ method: "GET", query: { tomo: "6" } }, r, sesionOk)); if (r.statusCode !== 302 || !/^https:\/\/demo\.supabase\.co\/storage\/v1\/object\/sign\/norsk-cuaderno\//.test(r.headers.location)) throw new Error(r.statusCode + " " + r.headers.location); if (r.headers["cache-control"] !== "private, no-store") throw new Error("cache"); });
await caso("firma falla -> 503", async () => { const r = res(); await conEnv(env, () => handler({ method: "GET", query: { tomo: "3" } }, r, { ...sesionOk, fetch: async () => ({ ok: false, status: 500, text: async () => "boom" }) })); if (r.statusCode !== 503) throw new Error(r.statusCode); });

const fallos = casos.filter((c) => !c[1]);
for (const c of casos) console.log((c[1] ? "  ok  " : "  FALLA") + " " + c[0] + (c[2] ? " · " + c[2] : ""));
console.log(fallos.length ? `\n${fallos.length} caso(s) fallan` : `\n${casos.length} casos sin red OK`);
process.exit(fallos.length ? 1 : 0);
