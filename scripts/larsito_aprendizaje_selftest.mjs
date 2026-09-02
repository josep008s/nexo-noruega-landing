#!/usr/bin/env node
// Autotest sin red de api/larsito-aprendizaje.js: la memoria de Larsito solo guarda
// códigos y un foco de feedback acotado, nunca audio ni transcripciones, y solo
// con compra activa. Se inyectan dependencias falsas: no toca Supabase ni la red.
import { handler, validarInforme, validarCola } from "../api/larsito-aprendizaje.js";

function res() {
  const r = { statusCode: 200, headers: {}, body: null };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const envOk = { LARSITO_ON: "true", NORSK_JWT_SECRET: "x", SUPABASE_URL: "https://demo.supabase.co", SUPABASE_SERVICE_KEY: "k" };
const informeOk = {
  accion: "informe", session_id: "sesion-0001-abcd", modo: "FREE_CONVERSATION", escenario: "EX-A-01",
  mecanismo: "M09", pieza: "M09", puerta: "O3", conserva: "Has sostenido el hilo aunque te faltaba una palabra.",
  ahora: "Cuando cuentas lo que dijo otra persona, cambia du por jeg.", contraste: "Hun sa: du får svar / Hun sa at jeg får svar.",
  repite: "Cuenta lo que te dijo la médica, pero ahora con una cita nueva.", resultado: "SEGUNDO_INTENTO_PENDIENTE",
};
function deps(extra) {
  const llamadas = { upserts: [], selects: [] };
  const d = Object.assign({
    env: envOk,
    readSessionCookie: () => ({ sub: "11111111-1111-4111-8111-111111111111" }),
    compraActiva: async () => ({ id: "compra" }),
    sbSelect: async (q) => { llamadas.selects.push(q); return []; },
    sbUpsert: async (tabla, filas, conflicto, prefer) => { llamadas.upserts.push({ tabla, filas, conflicto, prefer }); return filas; },
    readJsonBodyLimited: async (req) => req.body,
  }, extra || {});
  return { d, llamadas };
}
const casos = [];
async function caso(nombre, fn) { try { await fn(); casos.push([nombre, true]); } catch (e) { casos.push([nombre, false, e.message]); } }
function espera(cond, msg) { if (!cond) throw new Error(msg); }

await caso("flag cerrado -> cerrado sin tocar nada", async () => {
  const { d, llamadas } = deps({ env: { ...envOk, LARSITO_ON: "false" } });
  const r = res(); await handler({ method: "GET", query: { accion: "perfil" } }, r, d);
  espera(r.body && r.body.error === "cerrado" && llamadas.selects.length === 0, "debía estar cerrado");
});
await caso("sin claves -> 503", async () => {
  const { d } = deps({ env: { LARSITO_ON: "true" } });
  const r = res(); await handler({ method: "GET", query: { accion: "perfil" } }, r, d);
  espera(r.statusCode === 503, "esperaba 503");
});
await caso("PUT -> 405", async () => {
  const { d } = deps(); const r = res(); await handler({ method: "PUT", query: {} }, r, d);
  espera(r.statusCode === 405 && r.headers.allow === "GET, POST", "esperaba 405");
});
await caso("sin cookie -> 401 y sin consultas", async () => {
  const { d, llamadas } = deps({ readSessionCookie: () => null });
  const r = res(); await handler({ method: "GET", query: { accion: "perfil" } }, r, d);
  espera(r.statusCode === 401 && llamadas.selects.length === 0, "esperaba 401 sin consultas");
});
await caso("compra caducada -> 401", async () => {
  const { d } = deps({ compraActiva: async () => null });
  const r = res(); await handler({ method: "POST", body: informeOk }, r, d);
  espera(r.statusCode === 401, "esperaba 401");
});
await caso("perfil -> últimos informes y recuperaciones pendientes", async () => {
  const { d, llamadas } = deps({ sbSelect: async (q) => { llamadas.selects.push(q); return q.includes("informes") ? [{ mecanismo: "M09", ahora: "x" }] : [{ recovery_id: "REC:M09:3" }]; } });
  const r = res(); await handler({ method: "GET", query: { accion: "perfil" } }, r, d);
  espera(r.statusCode === 200 && r.body.ok && r.body.informes.length === 1 && r.body.recuperaciones.length === 1, "perfil incompleto");
  espera(llamadas.selects[0].includes("limit=5") && llamadas.selects[1].includes("estado=eq.PENDING"), "consultas sin acotar");
  espera(r.headers["cache-control"] === "private, no-store", "respuesta cacheable");
});
await caso("informe válido -> upsert acotado por sesión", async () => {
  const { d, llamadas } = deps(); const r = res(); await handler({ method: "POST", body: informeOk }, r, d);
  espera(r.statusCode === 200 && r.body.ok === true && r.body.guardado === true, "no se guardó");
  const u = llamadas.upserts[0];
  espera(u.tabla === "norsk_larsito_informes" && u.conflicto === "compra_id,session_id" && /ignore-duplicates/.test(u.prefer), "upsert mal formado");
  espera(u.filas[0].compra_id === "11111111-1111-4111-8111-111111111111" && u.filas[0].mecanismo === "M09", "fila incompleta");
});
await caso("informe con transcripción -> 400 y nada guardado", async () => {
  const { d, llamadas } = deps(); const r = res();
  await handler({ method: "POST", body: { ...informeOk, transcripcion: "Hei, jeg heter..." } }, r, d);
  espera(r.statusCode === 400 && llamadas.upserts.length === 0, "debía rechazar la transcripción");
});
await caso("informe con audio -> 400", async () => {
  espera(validarInforme({ ...informeOk, audio: "data:audio/webm;base64,AAAA" }) === null, "debía rechazar el audio");
});
await caso("informe con texto de 301 caracteres -> 400", async () => {
  const { d, llamadas } = deps(); const r = res();
  await handler({ method: "POST", body: { ...informeOk, ahora: "a".repeat(301) } }, r, d);
  espera(r.statusCode === 400 && llamadas.upserts.length === 0, "debía rechazar el texto largo");
});
await caso("informe con modo inventado -> 400", async () => {
  espera(validarInforme({ ...informeOk, modo: "HUMAN_REVIEW" }) === null, "debía rechazar el modo");
});
await caso("tope diario -> 429", async () => {
  const { d, llamadas } = deps({ sbSelect: async () => new Array(40).fill({ id: "x" }) });
  const r = res(); await handler({ method: "POST", body: informeOk }, r, d);
  espera(r.statusCode === 429 && llamadas.upserts.length === 0, "esperaba 429");
});
await caso("cola válida -> upsert por recovery_id", async () => {
  const { d, llamadas } = deps(); const r = res();
  const cola = [1, 3, 7, 14].map((c) => ({ recovery_id: `REC:M09:${c}`, focus_id: "M09", source_id: "esc-01", contacto: c, operacion_id: "BUILD_WITH_SUPPORT", programada_en: "2026-09-02T10:00:00.000Z", estado: "PENDING", completada_en: null }));
  await handler({ method: "POST", body: { accion: "recuperaciones", cola } }, r, d);
  espera(r.statusCode === 200 && r.body.sincronizadas === 4, "no sincronizó");
  espera(llamadas.upserts[0].conflicto === "compra_id,recovery_id" && /merge-duplicates/.test(llamadas.upserts[0].prefer), "upsert mal formado");
});
await caso("cola de 41 -> 400", async () => {
  const cola = new Array(41).fill(0).map((_, i) => ({ recovery_id: `REC:F${i}:1`, focus_id: `F${i}`, source_id: "s", contacto: 1, operacion_id: "BUILD_WITH_SUPPORT", programada_en: "2026-09-02T10:00:00.000Z", estado: "PENDING" }));
  espera(validarCola(cola) === null, "debía rechazar 41 elementos");
});
await caso("cola con contacto 5 -> 400", async () => {
  espera(validarCola([{ recovery_id: "REC:M09:5", focus_id: "M09", source_id: "s", contacto: 5, operacion_id: "BUILD_WITH_SUPPORT", programada_en: "2026-09-02T10:00:00.000Z", estado: "PENDING" }]) === null, "debía rechazar el contacto 5");
});
await caso("supabase caído -> 503", async () => {
  const { d } = deps({ sbSelect: async () => { throw new Error("caído"); } });
  const r = res(); await handler({ method: "GET", query: { accion: "perfil" } }, r, d);
  espera(r.statusCode === 503, "esperaba 503");
});

const fallos = casos.filter((c) => !c[1]);
for (const c of casos) console.log((c[1] ? "  ok  " : "  FALLA") + " " + c[0] + (c[2] ? " · " + c[2] : ""));
console.log(fallos.length ? `\n${fallos.length} caso(s) fallan` : `\nPASS larsito_aprendizaje_selftest: ${casos.length} casos sin red`);
process.exit(fallos.length ? 1 : 0);
