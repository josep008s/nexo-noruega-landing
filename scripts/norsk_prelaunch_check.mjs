// Guard de pre-lanzamiento de NEXO PASS.
// Falla (exit 1) si algo NO está listo para vender. Convierte los "pendientes"
// en una barrera: nadie mergea/lanza con placeholders, enlaces rotos o copy roto.
//
//   node scripts/norsk_prelaunch_check.mjs          (revisa el repo)
//   node scripts/norsk_prelaunch_check.mjs --env    (además exige env vars de prod)
//
// Bloqueos DUROS (exit 1): placeholders legales, enlaces rotos, em dash en copy
// publicable, demo inválida, sitemap con URLs muertas.
// Avisos (no fallan salvo --env): cuentas/env de Rocky, buzón de correo.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rel = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(rel(p), "utf8");
const exists = (p) => fs.existsSync(rel(p));

const duros = [];   // bloquean el lanzamiento
const avisos = [];  // cosas de Rocky (cuentas, entidad, buzón)
const oks = [];

function duro(msg) { duros.push(msg); }
function aviso(msg) { avisos.push(msg); }
function ok(msg) { oks.push(msg); }

// Modo: pre-venta (venta:false) o venta abierta (venta:true). Fuente: pass/MODO.json.
let VENTA = false;
try { VENTA = JSON.parse(read("pass/MODO.json")).venta === true; } catch (e) { /* sin MODO.json = pre-venta */ }
ok(`modo: ${VENTA ? "VENTA ABIERTA" : "pre-venta (lista de espera, sin checkout)"}`);

// Páginas publicables (indexables o de venta). Excluye app/gracias/acceso.
const PUBLICABLES = [
  "norsk/index.html", "norsk/sprint-oral/index.html",
  "pass/index.html", "pass/leccion-0/index.html", "pass/preguntas-de-ejemplo/index.html",
  "pass/que-examen-necesitas/index.html", "pass/como-inscribirse/index.html",
  "pass/requisitos-ciudadania-noruega/index.html",
  "pass/condiciones/index.html", "pass/privacidad/index.html",
];
const LEGALES = ["pass/condiciones/index.html", "pass/privacidad/index.html"];
const PROHIBIDAS = /increíble|brutal|paraíso|hola chicos/i;

// 1) Placeholders legales (duro con venta abierta; aviso en pre-venta, donde las
// condiciones declaran que entran en vigor con la primera venta)
for (const f of LEGALES) {
  if (!exists(f)) { duro(`Falta la página legal ${f}`); continue; }
  const h = read(f);
  if (/\[RAZ[OÓ]N SOCIAL/i.test(h)) {
    if (VENTA) duro(`${f}: placeholder [RAZÓN SOCIAL] sin rellenar y la venta está ABIERTA`);
    else aviso(`${f}: placeholder del titular pendiente (obligatorio antes de abrir la venta)`);
  } else ok(`${f}: titular rellenado`);
}

// 1b) Coherencia del modo en el código
{
  const landing = read("pass/index.html");
  const app = read("pass/app/app.js");
  const hayBotones = landing.includes('class="cta comprar"');
  const appFlag = /var VENTA_ABIERTA = (true|false);/.exec(app);
  const appVenta = appFlag ? appFlag[1] === "true" : null;
  if (appVenta === null) duro("pass/app/app.js: falta el flag VENTA_ABIERTA");
  else if (appVenta !== VENTA) duro(`incoherencia de modo: MODO.json venta=${VENTA} pero app.js VENTA_ABIERTA=${appVenta}`);
  else ok(`app.js VENTA_ABIERTA=${appVenta} coherente con MODO.json`);
  if (!VENTA && hayBotones) duro("pre-venta: la landing aún tiene botones de compra activos (.cta comprar)");
  if (VENTA && !hayBotones) duro("venta abierta: la landing no tiene botones de compra");
  if (!VENTA && !hayBotones) ok("landing sin checkout en pre-venta (lista de espera)");
}

// 2) Enlaces internos resuelven en TODAS las páginas
{
  const pages = [];
  const walk = (d) => fs.readdirSync(rel(d), { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name === "index.html") pages.push(p);
  });
  walk("pass");
  walk("norsk");
  pages.push("index.html");
  let rotos = 0;
  for (const pg of pages) {
    const h = read(pg);
    for (const href of h.match(/(?:href|src)="([^"]+)"/g) || []) {
      const u = href.slice(href.indexOf('"') + 1, -1).split("#")[0].split("?")[0];
      if (!u || /^(https?:|mailto:|data:|tel:)/.test(u)) continue;
      if (!u.startsWith("/")) { duro(`${pg}: enlace relativo frágil "${u}"`); rotos++; continue; }
      const p = u.replace(/^\//, "");
      const cand = [p, p + "/index.html", p.endsWith("/") ? p + "index.html" : null].filter(Boolean);
      if (!(p === "" || cand.some(exists))) { duro(`${pg}: enlace interno roto "${u}"`); rotos++; }
    }
  }
  if (!rotos) ok(`enlaces internos: 0 rotos en ${pages.length} páginas`);
}

// 3) Em dash + palabras prohibidas en copy publicable
for (const f of PUBLICABLES) {
  if (!exists(f)) continue;
  const h = read(f);
  // solo el cuerpo visible aprox: fuera <style>/<script>/<head>
  const body = h.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<head[\s\S]*?<\/head>/g, "");
  if (body.includes("—")) duro(`${f}: em dash (—) en el texto visible`);
  if (PROHIBIDAS.test(body)) aviso(`${f}: posible palabra prohibida (revisar si es negación/voz de marca)`);
}
if (!duros.some((d) => d.includes("em dash"))) ok("copy publicable: 0 em dash");

// 4) Demo pública válida
if (!exists("data/norsk-demo.json")) duro("Falta data/norsk-demo.json");
else {
  try {
    const d = JSON.parse(read("data/norsk-demo.json"));
    if (!Array.isArray(d.preguntas) || d.preguntas.length < 10) duro("demo: menos de 10 preguntas");
    else if (!d.leccion0 || !d.leccion0.cuerpo_html) duro("demo: falta la Lección 0");
    else {
      const mal = d.preguntas.filter((p) => !Array.isArray(p.opciones_es) || p.opciones_es.length !== 3 || ![0, 1, 2].includes(p.correcta));
      if (mal.length) duro(`demo: ${mal.length} preguntas con estructura inválida`);
      else ok(`demo pública: ${d.preguntas.length} preguntas + Lección 0`);
    }
  } catch (e) { duro("demo: JSON inválido"); }
}

// 5) Sitemap: todas las URLs existen
if (exists("sitemap.xml")) {
  const locs = (read("sitemap.xml").match(/<loc>https:\/\/www\.nexonoruega\.com([^<]*)<\/loc>/g) || [])
    .map((m) => m.replace(/<\/?loc>/g, "").replace("https://www.nexonoruega.com", ""));
  let faltan = 0;
  for (const u of locs) {
    const p = u.replace(/^\//, "").replace(/\/$/, "");
    if (!(p === "" || exists(p) || exists(p + "/index.html"))) { duro(`sitemap: URL sin página ${u}`); faltan++; }
  }
  if (!faltan) ok(`sitemap: ${locs.length} URLs, todas existen`);
}

// 6) Contacto: hay que crear el buzón (no verificable aquí)
{
  const usaCorreo = LEGALES.some((f) => exists(f) && read(f).includes("pass@nexonoruega.com"));
  if (usaCorreo) aviso("Crear y monitorizar el buzón pass@nexonoruega.com (canal de desistimiento/garantía/RGPD)");
}

// 7) Env de producción (solo con --env)
if (process.argv.includes("--env")) {
  const req = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "NORSK_JWT_SECRET", "RESEND_API_KEY"];
  const faltan = req.filter((k) => !process.env[k]);
  if (faltan.length) duro(`Faltan env vars: ${faltan.join(", ")}`);
  else ok("env vars de producción presentes");
  aviso("Verificar en el Dashboard de Stripe la URL de condiciones (consent_collection) y el webhook con barra final");
} else {
  aviso("Stripe/Supabase/Resend + entidad legal: pendientes de Rocky (ver pass/PASS_SETUP.md). Ejecuta con --env cuando estén.");
}

// ---------- Informe ----------
console.log("\n== NEXO PASS · check de pre-lanzamiento ==\n");
oks.forEach((m) => console.log("  ✅ " + m));
avisos.forEach((m) => console.log("  ⏳ " + m));
duros.forEach((m) => console.log("  ❌ " + m));
console.log("");
if (duros.length) {
  console.log(`NO LANZAR: ${duros.length} bloqueo(s) duro(s). ${avisos.length} pendiente(s) de Rocky.`);
  process.exit(1);
}
console.log(`Repo LISTO. Quedan ${avisos.length} acción(es) de Rocky (cuentas/entidad/buzón). Sin bloqueos de código.`);
process.exit(0);
