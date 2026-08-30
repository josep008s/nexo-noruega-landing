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

// 5b) Coherencia del tema claro (ver ESTILO.md)
// El CSS vive inline en cada página, así que la única defensa contra la deriva
// es comprobar que todas declaran los mismos tokens y que nadie usa como texto
// un color que no llega al contraste AA sobre fondo claro.
{
  const TEMA_CLARO = [
    "norsk/index.html", "norsk/sprint-oral/index.html",
    "pass/index.html", "pass/app/index.html", "pass/leccion-0/index.html",
    "pass/preguntas-de-ejemplo/index.html", "pass/que-examen-necesitas/index.html",
    "pass/como-inscribirse/index.html", "pass/requisitos-ciudadania-noruega/index.html",
    "norsk/larsito/index.html", "norsk/curso/index.html",
  ];
  const TOKENS = ["#0E1B26", "#F3F5F4", "#3FCB94", "#2C5A72", "#8DA1AB"];
  const FUENTES = ["Space Grotesk", "Source Serif 4"];
  let derivas = 0;

  for (const f of TEMA_CLARO) {
    if (!exists(f)) { duro(`tema claro: falta ${f}`); derivas++; continue; }
    const h = read(f);
    const root = (/:root\s*\{[\s\S]*?\}/.exec(h) || [""])[0];

    const faltan = TOKENS.filter((t) => !root.includes(t));
    if (faltan.length) { duro(`${f}: el :root no declara ${faltan.join(", ")} (ver ESTILO.md)`); derivas++; }

    const sinFuente = FUENTES.filter((x) => !h.includes(x));
    if (sinFuente.length) { duro(`${f}: no carga ${sinFuente.join(" ni ")}`); derivas++; }

    if (/#0b6f63/i.test(h)) { duro(`${f}: usa #0b6f63, el verde retirado del sistema (ver ESTILO.md)`); derivas++; }

    // Fondo de página claro: nadie del tema claro puede pintar el body de noche.
    if (/body\s*\{[^}]*background:\s*var\(--noche\)/.test(h)) { duro(`${f}: el body sigue en tema oscuro`); derivas++; }

    // aurora y niebla como color de texto sobre claro no llegan a AA.
    for (const [tok, ratio] of [["--aurora", "1,7:1"], ["--niebla", "2,5:1"]]) {
      const re = new RegExp(`\\.claro[^{]*\\{[^}]*color:\\s*var\\(${tok}\\)`, "i");
      if (re.test(h)) { duro(`${f}: color:var(${tok}) sobre fondo claro (${ratio}, no llega a AA)`); derivas++; }
    }
  }
  if (!derivas) ok(`tema claro: ${TEMA_CLARO.length} páginas con los mismos tokens y sin colores ilegibles`);

  if (!exists("ESTILO.md")) duro("Falta ESTILO.md, que documenta el sistema visual");
}

// 5c) La home es intocable: su tema oscuro es decisión de marca.
{
  const home = read("index.html");
  if (!/body\s*\{[^}]*background:\s*var\(--noche\)/.test(home)) {
    duro("index.html: la home ha perdido su fondo oscuro (no se rediseña)");
  } else ok("home: tema oscuro intacto");
}

// 5d) Larsito: el flag del cliente y la demo tienen que ser coherentes.
// El agente de voz se despliega apagado hasta que existan claves; con el flag
// encendido y sin backend, la página prometería algo que no puede cumplir.
if (exists("norsk/larsito/app.js")) {
  const js = read("norsk/larsito/app.js");
  const m = /var LARSITO_ABIERTO = (true|false);/.exec(js);
  if (!m) duro("norsk/larsito/app.js: falta el flag LARSITO_ABIERTO");
  else {
    const abierto = m[1] === "true";
    ok(`Larsito: LARSITO_ABIERTO=${abierto}`);
    if (abierto) aviso("Larsito abierto: comprueba LARSITO_ON, LARSITO_AGENT_ID y la clave de voz en Vercel");
  }
  if (!exists("data/larsito-demo.json")) duro("Falta data/larsito-demo.json (la demo de Larsito)");
  else {
    try {
      const d = JSON.parse(read("data/larsito-demo.json"));
      const escenarios = Array.isArray(d.escenarios) ? d.escenarios.length : 0;
      const listening = Array.isArray(d.listening) ? d.listening.length : 0;
      if (!escenarios) duro("demo de Larsito: sin escenarios de conversación");
      else if (!listening) duro("demo de Larsito: sin ejercicios de escucha");
      else {
        const malas = (d.listening || []).filter((e) => !Array.isArray(e.preguntas) || e.preguntas.some((q) => !Array.isArray(q.opciones_no) || q.opciones_no.length !== 3 || ![0, 1, 2].includes(q.correcta)));
        const sinTurnos = (d.escenarios || []).filter((e) => !Array.isArray(e.turnos) || !e.turnos.length);
        if (malas.length) duro(`demo de Larsito: ${malas.length} ejercicios de escucha con estructura inválida`);
        else if (sinTurnos.length) duro(`demo de Larsito: ${sinTurnos.length} escenarios sin turnos`);
        else ok(`demo de Larsito: ${escenarios} conversaciones + ${listening} ejercicios de escucha`);
      }
      if (JSON.stringify(d).includes("\u2014")) duro("demo de Larsito: em dash en el contenido");
    } catch (e) { duro("demo de Larsito: JSON inválido"); }
  }

  // TTS de servidor: si existe el endpoint, tiene que llevar el flag de apagado
  // (LARSITO_TTS, comprobado antes de tocar OpenAI) y la lista blanca de frases
  // de la demo, que es el control de coste para quien usa la página sin login.
  if (exists("api/larsito-tts.js")) {
    if (!exists("api/_larsito_frases.js")) {
      duro("api/larsito-tts.js existe pero falta api/_larsito_frases.js (regenerar con node scripts/larsito_frases_hash.mjs)");
    } else if (!read("api/larsito-tts.js").includes("LARSITO_TTS")) {
      duro("api/larsito-tts.js: falta la comprobación del flag LARSITO_TTS antes de llamar a OpenAI");
    } else {
      ok("TTS de Larsito: apagado por defecto y con lista blanca");
    }
  }
}

// 5e) El curso: la demo publica no puede llevar contenido de pago.
// El exportador saca el material del Drive y deja aqui solo la muestra.
// Este check es la ultima red antes de publicar en un repo publico.
if (exists("norsk/curso/app.js")) {
  if (!exists("data/norsk-curso-demo.json")) duro("Falta data/norsk-curso-demo.json (la demo del curso)");
  else {
    try {
      const d = JSON.parse(read("data/norsk-curso-demo.json"));
      const conCuerpo = [];
      if (d.mecanismo && Array.isArray(d.mecanismo.secciones) && d.mecanismo.secciones.length) conCuerpo.push(d.mecanismo.codigo);
      if (d.diagnostico && Array.isArray(d.diagnostico.secciones) && d.diagnostico.secciones.length) conCuerpo.push(d.diagnostico.codigo);
      (d.piezas || []).forEach((p) => { if (Array.isArray(p.secciones) && p.secciones.length) conCuerpo.push(p.codigo); });

      const filtradas = (d.indice || []).filter((p) => Array.isArray(p.secciones) && p.secciones.length);
      if (filtradas.length) duro(`demo del curso: ${filtradas.length} piezas del indice traen cuerpo y no deberian`);
      else if (conCuerpo.length > 3) duro(`demo del curso: ${conCuerpo.length} piezas completas, demasiadas para una muestra`);
      else if (!conCuerpo.length) duro("demo del curso: no hay ninguna pieza de muestra");
      else ok(`demo del curso: muestra de ${conCuerpo.join(", ")} + indice de ${(d.indice || []).length}`);

      if (JSON.stringify(d).includes("Notas para la revisi")) duro("demo del curso: incluye notas internas de revision");
      if (JSON.stringify(d).includes("\u2014")) duro("demo del curso: em dash en el contenido");
    } catch (e) { duro("demo del curso: JSON invalido"); }
  }

  // El material completo jamas entra al repo.
  if (exists("scripts/_norsk_curso/curso.json")) {
    const ig = read(".gitignore");
    if (!ig.includes("scripts/_norsk_curso/")) duro("scripts/_norsk_curso/ existe y NO esta en .gitignore (contenido de pago en repo publico)");
    else ok("curso completo fuera del repo (gitignored)");
  }
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
