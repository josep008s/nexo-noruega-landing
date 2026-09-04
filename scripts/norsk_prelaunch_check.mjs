// Guard automatico de pre-lanzamiento de NEXO PASS.
// Falla (exit 1) ante regresiones comprobables. Un exit 0 solo confirma estas
// comprobaciones locales: nunca autoriza vender, publicar ni desplegar.
//
//   node scripts/norsk_prelaunch_check.mjs          (revisa el repo)
//   node scripts/norsk_prelaunch_check.mjs --env    (además exige env vars de prod)
//
// Bloqueos DUROS (exit 1): placeholders legales, enlaces rotos, em dash en copy
// publicable, demo inválida, sitemap con URLs muertas.
// Avisos (no fallan salvo --env): gates finales de entidad, cobros y buzón.

import fs from "node:fs";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rel = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(rel(p), "utf8");
const exists = (p) => fs.existsSync(rel(p));

const duros = [];   // bloquean el lanzamiento
const avisos = [];  // gates comerciales finales (entidad, cobros, buzón)
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
  "norsk/index.html", "norsk/entrenamiento-oral/index.html",
  "norsk/desde-cero/index.html", "norsk/ruta-completa/index.html",
  "pass/index.html", "pass/leccion-0/index.html", "pass/preguntas-de-ejemplo/index.html",
  "pass/que-examen-necesitas/index.html", "pass/como-inscribirse/index.html",
  "pass/requisitos-ciudadania-noruega/index.html",
  "pass/condiciones/index.html", "pass/privacidad/index.html",
];
const LEGALES = ["pass/condiciones/index.html", "pass/privacidad/index.html"];
const PROHIBIDAS = /increíble|brutal|paraíso|hola chicos/i;
const IDS_SECCIONES_EDITORIALES = new Set([
  "notas-para-la-revision-nativa",
  "puertas-abiertas-de-esta-leccion",
  "puertas-abiertas-de-este-documento",
  "registro-de-dudas-para-contraste-humano-opcional",
  "registro-historico-de-dudas-de-lengua",
  "registro-de-revision-de-lengua",
  "registro-de-produccion",
  "estado-y-controles-separados-de-esta-leccion",
  "estado-reconciliado-de-esta-leccion",
  "estado-reconciliado-y-mejoras-opcionales",
  "estado-y-trabajo-abierto",
  "controles-y-pendientes-separados",
  "lo-que-este-banco-todavia-no-tiene",
  "hoja-interna-de-observacion-siete-puertas-y-alcance",
  "control-de-calidad-de-este-bloque",
  "comprobaciones-pasadas-sobre-este-archivo",
  "comprobaciones-internas-de-este-lote",
  "siguiente-paso",
]);
const CONTENIDO_EDITORIAL_INTERNO = /contraste humano|revisi[oó]n nativa|registro (?:hist[oó]rico )?de dudas|puerta editorial|firma (?:humana|nativa)|revisi[oó]n sist[eé]mica|revisi[oó]n de bokm[aå]l|qa (?:sist[eé]mic[oa]|t[eé]cnic[oa]|de audio)|material interno|material publicable|no es copy|estado (?:de producci[oó]n|y trabajo abierto)|puertas abiertas de este documento|hoja interna|\bcohorte\b|\breclutamiento\b|circuito (?:con personas|de alumnos)|(?:no hay|no se incluye)[^.!?]{0,120}\bconsentimiento\b|\bla lupa\b|pass_con_avisos|orden (?:expresa )?de publicaci[oó]n|publicaci[oó]n (?:sigue|se registra|conserva|es una puerta)|puertas? (?:t[eé]cnicas? y )?de publicaci[oó]n|autorizar (?:la )?publicaci[oó]n|autorizar su uso p[uú]blico/i;
const CABECERA_PRODUCCION_HTML = /<pre><code>\s*(?:MECANISMO|DOCUMENTO|PIEZA):/i;
const RUTA_INTERNA_CURSO = /(?:\/Users\/|(?:\.\.\/)+|(?:norsk\/)?idioma\/rutas\/|(?:_fuentes|produccion|scripts|supabase|api|data|rutas)\/)[^\s<>"']+\.(?:md|xlsx|json|sql|mjs|js|py)\b/i;
const RUIDO_PRODUCCION_ALUMNO = /MP3 m[aá]ster|fuente editable|experiencia maestra|Gobierno vigente|para producci[oó]n interna|Nota de grabaci[oó]n|petici[oó]n original|QA editorial interna|\bversionado\b|puerta abierta en la cabecera/i;

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
  walk("sueldo");
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
    "norsk/index.html", "norsk/entrenamiento-oral/index.html",
    "pass/index.html", "pass/app/index.html", "pass/leccion-0/index.html",
    "pass/preguntas-de-ejemplo/index.html", "pass/que-examen-necesitas/index.html",
    "pass/como-inscribirse/index.html", "pass/requisitos-ciudadania-noruega/index.html",
    "norsk/larsito/index.html", "norsk/curso/index.html",
    "pass/condiciones/index.html", "pass/privacidad/index.html",
    "pass/acceso/index.html", "pass/gracias/index.html",
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

// 5b bis) Fuentes autoalojadas: el navegador no debe pedir nada a Google.
{
  const pages = [];
  const walk = (d) => fs.readdirSync(rel(d), { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name === "index.html") pages.push(p);
  });
  walk("pass"); walk("norsk"); walk("sueldo"); pages.push("index.html");
  let malas = 0;
  for (const f of pages) {
    const h = read(f);
    if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(h)) { duro(`${f}: carga fuentes de Google (van autoalojadas en /fonts/)`); malas++; }
    if (!h.includes('href="/fonts/fonts.css"')) { duro(`${f}: no enlaza /fonts/fonts.css`); malas++; }
  }
  for (const w of ["fonts/fonts.css", "fonts/LICENSES.txt", "fonts/caesar-dressing-normal-400-latin.woff2", "fonts/source-serif-4-italic-400-latin.woff2", "fonts/source-serif-4-normal-400-latin.woff2", "fonts/space-grotesk-normal-500-latin.woff2"]) {
    if (!exists(w)) { duro(`Falta ${w} (fuentes autoalojadas)`); malas++; }
  }
  if (!malas) ok(`fuentes: autoalojadas en /fonts/ en ${pages.length} páginas, sin terceros`);
}

// 5c) La home es intocable: su tema oscuro es decisión de marca.
{
  const home = read("index.html");
  if (!/body\s*\{[^}]*background:\s*var\(--noche\)/.test(home)) {
    duro("index.html: la home ha perdido su fondo oscuro (no se rediseña)");
  } else ok("home: tema oscuro intacto");
}

// 5d) Las dos entradas de producto comparten shell visual. El contenido cambia,
// pero hero, resaltado y navegación activa no pueden volver a divergir.
{
  const ENTRADAS = ["norsk/index.html", "pass/index.html"];
  const CONTRATO = [
    'h1{font-size:clamp(2.1rem,5.4vw,3.4rem);max-width:17ch;margin-bottom:20px}',
    '.sub{font-size:1.16rem;color:var(--tinta-suave);max-width:56ch;margin-bottom:28px}',
    'background:var(--aurora);border:none;text-decoration:none;text-align:center;padding:16px 32px',
    '.hero{padding-top:56px;padding-bottom:52px}',
    '.hero{padding-top:38px;padding-bottom:44px}',
    'border-bottom:3px solid transparent',
    'border-bottom-color:var(--aurora)',
  ];
  let derivas = 0;

  for (const f of ENTRADAS) {
    const h = read(f);
    const header = (/<header>[\s\S]*?<\/header>/.exec(h) || [""])[0];
    const ausentes = CONTRATO.filter((fragmento) => !h.includes(fragmento));
    if (ausentes.length) {
      duro(`${f}: la entrada de producto se desvía del hero o la navegación compartidos (ver ESTILO.md)`);
      derivas++;
    }
    if (!/<h1[^>]*>[\s\S]*?<mark class="marcado">[^<]+<\/mark>[\s\S]*?<\/h1>/.test(h)) {
      duro(`${f}: el hero no señala una única promesa con mark.marcado`);
      derivas++;
    }
    const activa = f.startsWith("norsk/")
      ? '<a href="/norsk/" aria-current="page">Norsk</a>'
      : '<a href="/pass/" aria-current="page">Ciudadanía</a>';
    if (!header.includes(activa)) {
      duro(`${f}: aria-current no identifica la sección activa correcta`);
      derivas++;
    }
    if (!header.includes('<a href="https://www.nexonoruega.com">Nexo Noruega</a>')) {
      duro(`${f}: la navegación compartida no termina en Nexo Noruega`);
      derivas++;
    }
  }
  if (!derivas) ok("entradas Norsk/Ciudadanía: hero, marcado y navegación activos unificados");
}

// 5e) Vercel Hobby: cada .js directo de api/ salvo los modulos _*.js cuenta
// como funcion. Los cinco
// endpoints comerciales comparten un router, pero conservan sus URLs publicas.
{
  const MAX_FUNCIONES = 12;
  const funciones = fs.readdirSync(rel("api"), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".js") && !e.name.startsWith("_"))
    .map((e) => e.name)
    .sort();

  if (funciones.length > MAX_FUNCIONES) {
    duro(`Vercel Hobby: ${funciones.length} funciones en api/; el maximo es ${MAX_FUNCIONES}`);
  } else ok(`Vercel Hobby: ${funciones.length}/${MAX_FUNCIONES} funciones serverless`);

  const ROUTER = "api/norsk-comercial.js";
  const SELFTEST_COMERCIAL = "scripts/norsk_comercial_router_selftest.mjs";
  const rutas = ["activar", "checkout", "gracias", "reenviar", "webhook"];
  const antiguos = rutas.map((ruta) => `api/norsk-${ruta}.js`);
  const delegados = rutas.map((ruta) => `api/_norsk_${ruta}.js`);
  const compartidos = ["api/_norsk_lib.js", "api/_larsito_reservas.js", "api/_larsito_frases.js"];

  if (!exists(ROUTER)) duro(`Falta ${ROUTER}`);
  else {
    const js = read(ROUTER);
    const faltan = rutas.filter((ruta) => !js.includes(`_norsk_${ruta}.js`));
    if (faltan.length || !js.includes("bodyParser: false")
        || !js.includes("RUTAS_PUBLICAS") || js.includes("req.query.route")) {
      duro(`${ROUTER}: delegados, body RAW o selector por ruta publica incompletos`);
    }
  }
  if (antiguos.some(exists)) duro("Vercel Hobby: quedan handlers comerciales directos dentro de api/");
  for (const f of [...delegados, ...compartidos]) {
    if (!exists(f)) duro(`Vercel Hobby: falta el modulo interno ${f}`);
  }
  if (exists("server/commercial")
      && fs.readdirSync(rel("server/commercial"), { withFileTypes: true }).some((e) => e.isFile())) {
    duro("Vercel: server/commercial existe y podria publicar handlers como archivos estaticos");
  }

  for (const f of ["api/_norsk_checkout.js", "api/_norsk_reenviar.js"]) {
    if (exists(f)) {
      const js = read(f);
      if (!js.includes("readJsonBodyLimited(req, MAX_BODY_BYTES)")
          || !/MAX_BODY_BYTES\s*=\s*2\s*\*\s*1024/.test(js)
          || !js.includes("e && e.status === 413 ? 413 : 400")) {
        duro(`${f}: JSON sin limite de 2 KiB o errores 400/413 sin controlar`);
      }
    }
  }

  try {
    const cfg = JSON.parse(read("vercel.json"));
    const rewrites = Array.isArray(cfg.rewrites) ? cfg.rewrites : [];
    const incompletas = rutas.filter((ruta) => !rewrites.some((r) =>
      r.source === `/api/norsk-${ruta}/`
      && r.destination === "/api/norsk-comercial"));
    if (incompletas.length) duro(`vercel.json: faltan rewrites comerciales para ${incompletas.join(", ")}`);
    else ok("rutas comerciales: cinco URLs publicas conservadas por rewrites internos");
  } catch (e) { duro("vercel.json: JSON invalido"); }

  if (!exists(SELFTEST_COMERCIAL)) duro(`Falta ${SELFTEST_COMERCIAL}`);
  else {
    const test = spawnSync(process.execPath, [rel(SELFTEST_COMERCIAL)], {
      encoding: "utf8",
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    if (test.status !== 0 || !/PASS norsk_comercial_router_selftest: 12 casos sin red/.test(test.stdout || "")) {
      duro(`${SELFTEST_COMERCIAL}: el router no conserva despacho, metodos o respuestas`);
    } else ok("router comercial: doce casos sin red, con colision y limites 400/413");
  }
}

// 5f) Larsito: privacidad local de la demo y contrato cerrado del producto.
// Estas comprobaciones son deliberadamente explicitas: una refactorizacion que
// quite una barrera debe actualizar este guard y pasar revision, no quedar verde.
{
  const APP = "norsk/larsito/app.js";
  const APP_HTML = "norsk/larsito/index.html";
  const LEARNING_CORE = "norsk/larsito/learning-core.js";
  const DEMO_LARSITO = "data/larsito-demo.json";
  const TTS = "api/larsito-tts.js";
  const SESION = "api/larsito-sesion.js";
  const LISTENING = "api/larsito-listening.js";
  const RESERVAS = "api/_larsito_reservas.js";
  const COMPENSAR = "api/larsito-compensar.js";
  const LARSITO_VENDOR = "norsk/larsito/vendor/elevenlabs-client-1.23.0.iife.js";
  const MIGRACION = "supabase/migrations/20260902075618_larsito_reservas_0004.sql";
  const PRIVACIDAD = "pass/privacidad/index.html";
  const SELFTEST = "scripts/larsito_reservas_selftest.mjs";
  const API_PACKAGE = "api/package.json";
  const ESTIMULO = "api/larsito-estimulo.js";
  const MIGRACION_APRENDIZAJE = "supabase/migrations/20260902094330_norsk_aprendizaje_0006.sql";

  if (!exists(APP)) duro(`Falta ${APP}`);
  else {
    const js = read(APP);
    const m = /var LARSITO_ABIERTO = (true|false);/.exec(js);
    if (!m) duro(`${APP}: falta el flag LARSITO_ABIERTO`);
    else if (m[1] !== "false") duro(`${APP}: LARSITO_ABIERTO no puede abrirse en pre-lanzamiento`);
    else ok("Larsito: flag comercial cerrado");

    if (!js.includes('if (v.localService !== true) continue;')
        || !js.includes('/^(nb|no)(-|$)/i')) {
      duro(`${APP}: la voz debe exigir idioma nb/no y localService=true`);
    } else if (/localService\s*===\s*false/.test(js)) {
      duro(`${APP}: vuelve a favorecer una voz de red`);
    } else ok("Larsito demo: speechSynthesis solo nb/no localService=true");

    const sttLocal = js.includes('if (!("processLocally" in r)) return null;')
      && js.includes("r.processLocally = true;")
      && js.includes("if (r.processLocally !== true) return null;")
      && /if \(rec\) \{\s*mic = el\("button", "mic"\)/s.test(js);
    if (!sttLocal) duro(`${APP}: el micro debe ocultarse salvo processLocally=true confirmado`);
    else ok("Larsito demo: micro solo con SpeechRecognition local confirmado; texto como fallback");

    const ttsRemotoDemo = [
      "/api/larsito-tts", "ttsServidor", "comprobarTtsServidor",
      "pedirAudio", "FRASES_DEMO",
    ].filter((x) => js.includes(x));
    if (ttsRemotoDemo.length) duro(`${APP}: la demo conserva TTS remoto (${ttsRemotoDemo.join(", ")})`);
    else ok("Larsito demo: cero TTS remoto");

    // Audio fijo de la demo: new Audio() solo con la grabacion propia (url del JSON,
    // servida desde /norsk/larsito/audio/demo/) o con la grabacion local efimera (blob).
    const audiosNuevos = (js.match(/new Audio\(([^)]*)\)/g) || []).map((x) => x.replace(/^new Audio\(|\)$/g, "").trim());
    const audiosRaros = audiosNuevos.filter((x) => x !== "url" && x !== "urlMio");
    if (audiosRaros.length) duro(`${APP}: new Audio() con origen no previsto (${audiosRaros.join(", ")})`);
    if (!/function reproducirFijo\(url, texto, lento, alDone\)/.test(js) || /https?:\/\//.test((js.match(/function reproducirFijo[\s\S]*?\n  \}/) || [""])[0])) {
      duro(`${APP}: la reproduccion fija debe usar solo rutas propias`);
    }
    try {
      const demo = JSON.parse(read(DEMO_LARSITO));
      const rutas = [];
      for (const e of demo.escenarios || []) for (const t of e.turnos || []) { if (t.audio_no) rutas.push(t.audio_no); if (t.audio_modelo) rutas.push(t.audio_modelo); }
      for (const l of demo.listening || []) if (l.audio) rutas.push(l.audio);
      const fuera = rutas.filter((r) => !/^\/norsk\/larsito\/audio\/demo\/[A-Za-z0-9._-]+\.mp3$/.test(r));
      const ausentes = rutas.filter((r) => !exists(r.slice(1)));
      if (fuera.length) duro(`demo de Larsito: ${fuera.length} audio(s) fuera de /norsk/larsito/audio/demo/`);
      else if (ausentes.length) duro(`demo de Larsito: ${ausentes.length} audio(s) declarados que no existen`);
      else if (demo.audio_estatico === true && !rutas.length) duro("demo de Larsito: audio_estatico sin rutas");
      else ok(`Larsito demo: ${rutas.length} grabaciones fijas propias, sin proveedor en vivo`);
    } catch (e) { duro("demo de Larsito: JSON ilegible al comprobar el audio fijo"); }
    const grabacionLocal = js.includes("MediaRecorder") ? (js.includes("URL.revokeObjectURL(urlMio)") && !/FormData|upload|subir\(/.test(js)) : true;
    if (!grabacionLocal) duro(`${APP}: la grabacion local de 'repite tu' debe quedarse en memoria y liberarse`);
    else if (js.includes("MediaRecorder")) ok("Larsito demo: 'repite tu' graba solo en memoria local y libera el blob");

    const progreso = js.includes("function exportarProgreso()")
      && js.includes("function borrarProgreso()")
      && js.includes("localStorage.removeItem(CLAVE)")
      && js.includes("JSON.stringify(estado)")
      && !/localStorage\.setItem\([^\n]*(campo|transcript|dicho)/i.test(js);
    if (!progreso) duro(`${APP}: falta exportar/borrar progreso minimo o se persiste contenido del alumno`);
    else ok("Larsito demo: progreso minimo exportable y borrable; sin respuestas persistidas");

    const copyProhibido = /delata el nivel|gana la fluidez|corrige lo que necesites|correcci[oó]n en el momento|sensoren sitter her og lytter|evaluador est[aá] aqu[ií] escuchando/i;
    if (copyProhibido.test(js)) duro(`${APP}: copy causal, evaluativo o de sensor falso`);
    if (!js.includes("onvoiceschanged")
        || !js.includes("function restaurarEscuchaLocal()")
        || !js.includes('data-voz-bloqueada')) {
      duro(`${APP}: una voz local que aparece tarde no reactiva los botones de escucha`);
    } else ok("Larsito demo: los botones se reactivan si aparece una voz local noruega");

    const consumer = js.includes("ElevenLabsClient.Conversation.startSession")
      && js.includes("signed_url")
      && js.includes("/api/larsito-sesion/")
      && js.includes("endSession")
      && js.includes("function cargarSdkAgente()")
      && js.includes("/norsk/larsito/vendor/elevenlabs-client-1.23.0.iife.js")
      && js.includes("function cerrarConversacionActual()")
      && js.includes("var agenteVersion = 0")
      && js.includes("version !== agenteVersion")
      && js.includes("if (agenteCargando) return;");
    if (!consumer) duro(`${APP}: falta el consumidor frontend de ElevenLabs`);
    else ok("Larsito completo: SDK local, signed URL y fin de sesión conectados");

    const recuperacion = js.includes("aprendizaje.programar(")
      && js.includes("aprendizaje.primeraVencida(")
      && js.includes("aprendizaje.completarVencida(")
      && js.includes('programarRecuperacion("DEMO:" + esc.id, esc.id)')
      && js.includes("clientTools:")
      && js.includes("programar_recuperacion:")
      && js.includes("SCHEDULED_1_3_7_14");
    if (!recuperacion) duro(`${APP}: falta crear y presentar la cola local 1-3-7-14`);
    else ok("Larsito: cola local 1-3-7-14 creada y pendiente vencido mas antiguo primero");

    const estimuloEx = js.includes('fetch("/api/larsito-estimulo/"')
      && js.includes('selectorModo.value !== "EXAM_SIMULATION"')
      && js.includes("attempt_id: intento.attempt_id")
      && js.includes("request_id: intento.requests[tarea]")
      && js.includes("body.stimulus_id")
      && js.includes("dynamicVariables: dinamicas")
      && js.includes("stimulus_id: [a, b, c].join(\",\")")
      && !/EX-[ABC]-\d{2}/.test(js);
    if (!estimuloEx) duro(`${APP}: EXAM_SIMULATION no consume estimulos emitidos por servidor o acepta codigos del cliente`);
    else ok("Larsito EXAM_SIMULATION: A/B/C server-issued, request estable y dynamicVariables conectadas");

    const listeningPaginado = js.includes('"Siguiente tanda"')
      && js.includes("d.has_more")
      && js.includes("d.next_cursor")
      && js.includes('"&cursor=" + encodeURIComponent(cursor)')
      && js.includes("vistos.has(ej.codigo)");
    if (!listeningPaginado) duro(`${APP}: el listening completo no pagina o puede repetir tandas`);
    else ok("Larsito completo: listening paginado sin repetir tandas");
  }

  if (!exists(LEARNING_CORE)) duro(`Falta ${LEARNING_CORE}`);
  else {
    const js = read(LEARNING_CORE);
    const contratoCola = js.includes("var CONTACTOS = Object.freeze")
      && /contacto:\s*1,\s*dias:\s*0/.test(js)
      && /contacto:\s*3,\s*dias:\s*2/.test(js)
      && /contacto:\s*7,\s*dias:\s*6/.test(js)
      && /contacto:\s*14,\s*dias:\s*13/.test(js)
      && js.includes('estado === "PENDING"')
      && js.includes("Date.parse(a.programada_en) - Date.parse(b.programada_en)")
      && !/\b(?:transcript|audio|respuesta|texto_libre)\s*:/i.test(js);
    if (!contratoCola) duro(`${LEARNING_CORE}: cola incompleta, no ordenada o con contenido del alumno`);
    else ok("recuperacion local: cuatro contactos exactos, idempotentes y sin contenido del alumno");
  }

  if (!exists(APP_HTML)
      || read(APP_HTML).indexOf("/norsk/larsito/learning-core.js") < 0
      || read(APP_HTML).indexOf("/norsk/larsito/learning-core.js") > read(APP_HTML).indexOf("/norsk/larsito/app.js")) {
    duro(`${APP_HTML}: learning-core debe cargarse antes de app.js`);
  }

  if (!exists(LARSITO_VENDOR)) duro(`Falta ${LARSITO_VENDOR}`);
  else {
    const hash = createHash("sha256").update(fs.readFileSync(rel(LARSITO_VENDOR))).digest("hex");
    const hashEsperado = "dbeb4666c9a59efcba61e96c50503a17e1f64b02216d1fca73bb8861e97d3efc";
    if (hash !== hashEsperado) duro(`${LARSITO_VENDOR}: el bundle saneado no coincide con @elevenlabs/client@1.23.0`);
    else if (/sourceMappingURL=/.test(read(LARSITO_VENDOR))) duro(`${LARSITO_VENDOR}: conserva una referencia huérfana al sourcemap`);
    else if (!exists("norsk/larsito/vendor/LICENSE.elevenlabs-client")) duro("Falta la licencia MIT del cliente de ElevenLabs");
    else ok("Larsito completo: bundle @elevenlabs/client@1.23.0 saneado y licencia verificados");
  }

  if (!exists(DEMO_LARSITO)) duro(`Falta ${DEMO_LARSITO}`);
  else {
    try {
      const raw = read(DEMO_LARSITO);
      const d = JSON.parse(raw);
      const escenarios = Array.isArray(d.escenarios) ? d.escenarios : [];
      const listening = Array.isArray(d.listening) ? d.listening : [];
      if (escenarios.length !== 6) duro(`demo de Larsito: se esperaban 6 escenarios y hay ${escenarios.length}`);
      if (listening.length !== 6) duro(`demo de Larsito: se esperaban 6 ejercicios de escucha y hay ${listening.length}`);
      const sinTurnos = escenarios.filter((e) => !Array.isArray(e.turnos) || !e.turnos.length);
      const sinFicha = escenarios.filter((e) => typeof e.datos_ficticios_es !== "string" || !e.datos_ficticios_es.trim());
      const listeningMal = listening.filter((e) => !Array.isArray(e.preguntas) || e.preguntas.some((q) => !Array.isArray(q.opciones_no) || q.opciones_no.length !== 3 || ![0, 1, 2].includes(q.correcta)));
      if (sinTurnos.length) duro(`demo de Larsito: ${sinTurnos.length} escenarios sin turnos`);
      if (sinFicha.length) duro(`demo de Larsito: ${sinFicha.length} escenarios sin ficha ficticia explicita`);
      if (listeningMal.length) duro(`demo de Larsito: ${listeningMal.length} ejercicios de escucha invalidos`);

      const avisoCorrecto = typeof d.aviso === "string"
        && /personajes ficticios/i.test(d.aviso)
        && /no escribas datos personales, familiares ni de salud reales/i.test(d.aviso)
        && /QA sist[eé]mica y t[eé]cnica aceptada/i.test(d.aviso)
        && /no se presenta como firma de un revisor nativo humano/i.test(d.aviso)
        && /no eval[uú]a pronunciaci[oó]n ni nivel/i.test(d.aviso);
      if (!avisoCorrecto) duro("demo de Larsito: aviso de ficcion, privacidad o revision linguistica incompleto");

      const pideDatosReales = /navnet ditt og f[oø]dselsdatoen din|di tu nombre y tu fecha de nacimiento|describe el s[ií]ntoma|experiencia tuya/i;
      if (pideDatosReales.test(raw)) duro("demo de Larsito: vuelve a pedir PII, sintomas o experiencia real");
      const examenes = escenarios.filter((e) => e.modo === "eksamen");
      if (!examenes.length || examenes.some((e) => !/no hay sensor ni persona escuchando/i.test(e.contexto_es || ""))) {
        duro("demo de Larsito: el sensor simulado no esta aclarado en todos los simulacros");
      }
      if (/delata el nivel|gana la fluidez|sensoren sitter her og lytter|evaluador est[aá] aqu[ií] escuchando/i.test(raw)) {
        duro("demo de Larsito: copy evaluativo, causal o sensor falso");
      }
      if (raw.includes("\u2014")) duro("demo de Larsito: em dash en el contenido");

      if (!sinTurnos.length && !sinFicha.length && !listeningMal.length
          && escenarios.length === 6 && listening.length === 6) {
        ok("demo de Larsito: 6 conversaciones ficticias + 6 ejercicios de escucha");
      }
    } catch (e) { duro("demo de Larsito: JSON invalido"); }
  }

  if (!exists(TTS)) duro(`Falta ${TTS}`);
  else {
    const js = read(TTS);
    const requisitos = [
      [js.includes("LARSITO_TTS"), "flag cerrado"],
      [js.includes("LARSITO_PRIVACY_READY"), "gate tecnico de privacidad"],
      [js.includes('req.method !== "POST"'), "solo POST"],
      [js.includes("readSessionCookie(req)"), "cookie firmada"],
      [js.includes("compraActiva(sesion.sub)"), "compra activa"],
      [js.includes("readJsonBodyLimited(req, MAX_BODY_BYTES)") && /MAX_BODY_BYTES\s*=\s*2\s*\*\s*1024/.test(js), "cuerpo maximo 2 KiB"],
      [/MAX_CARACTERES\s*=\s*300/.test(js) && js.includes("texto.length > MAX_CARACTERES"), "texto maximo 300"],
      [js.includes("body.velocidad === 0.8") && js.includes("body.velocidad === 1"), "velocidades 0.8 y 1"],
      [js.includes('Cache-Control", "private, no-store"'), "respuesta privada sin cache"],
      [js.includes("new AbortController()") && js.includes("TIMEOUT_MS"), "timeout"],
      [/MAX_AUDIO_BYTES\s*=\s*4\s*\*\s*1024\s*\*\s*1024/.test(js) && js.includes("getReader()"), "audio maximo 4 MiB"],
      [js.includes('sbRpc("norsk_reservar_larsito"') && js.includes("p_tope_fallos") && js.includes("p_vida_segundos"), "reserva atomica con limite de fallos"],
      [js.includes('sbRpc("norsk_consumir_reserva_larsito"') && js.includes("const consumida = await consumir"), "consumo antes de entregar"],
      [js.includes('sbRpc("norsk_registrar_fallo_larsito"'), "registro de fallo"],
      [js.includes("!reserva.jti") && js.includes("jti: reserva.jti"), "jti de un solo uso"],
      [js.includes("if (!compensada) fallo.compensacion = tokenCompensacion;"), "token solo tras fallo no compensado"],
    ];
    const faltan = requisitos.filter(([cumple]) => !cumple).map(([, nombre]) => nombre);
    if (faltan.length) duro(`${TTS}: faltan ${faltan.join(", ")}`);
    if (/req\.query|FRASES_DEMO|_larsito_frases|Cache-Control[^\n]*public|console\.[a-z]+\([^\n]*texto|X-Larsito-Compensacion/i.test(js)) {
      duro(`${TTS}: texto en URL/log, acceso demo anonimo, cache publica o token en respuesta exitosa`);
    }
    if (!faltan.length) ok("TTS de producto: POST autenticado, privado, acotado y con reserva de un solo uso");
  }

  if (!exists(SESION)) duro(`Falta ${SESION}`);
  else {
    const js = read(SESION);
    if (!js.includes('sbRpc("norsk_reservar_larsito"')
        || !js.includes("readSessionCookie(req)")
        || !js.includes("compraActiva(sesion.sub)")
        || !js.includes("LARSITO_CONSUMER_READY")
        || !js.includes("const CONSUMIDOR_INTEGRADO = true;")
        || !js.includes("LARSITO_AGENT_PRIVACY_READY")
        || !js.includes("ELEVENLABS_API_KEY")
        || !js.includes("get-signed-url")
        || !js.includes("consumirFirmaLarsito")
        || !js.includes("registrarFalloFirmaLarsito")
        || !js.includes("signed_url")
        || !js.includes("p_tope_fallos")
        || !js.includes("reserva_id: reserva.reserva_id")
        || !js.includes("jti: reserva.jti")) {
      duro(`${SESION}: falta muro o reserva atomica`);
    }
    if (/tickUso|norsk_incr_global|fail-open|contarConReintento|larsito_compensar/.test(js)) {
      duro(`${SESION}: conserva contadores separados, ruta fail-open o token canjeable por el cliente`);
    } else ok("sesion Larsito: cuota de compra y global reservadas juntas; fallo cerrado");
  }

  if (!exists(LISTENING)) duro(`Falta ${LISTENING}`);
  else {
    const js = read(LISTENING);
    const requisitos = [
      js.includes("LARSITO_LISTENING"),
      js.includes('req.method !== "GET"'),
      js.includes("readSessionCookie(req)"),
      js.includes("compraActiva(sesion.sub)"),
      js.includes('sbRpc("norsk_reservar_larsito"'),
      js.includes('sbRpc("norsk_consumir_reserva_larsito"'),
      js.includes('sbRpc("norsk_registrar_fallo_larsito"'),
      js.includes("p_tope_fallos"),
      js.includes("!reserva.jti"),
      js.includes("if (!ejercicios.length)"),
      js.includes('Cache-Control", "private, no-store"'),
      js.includes("MAX_POR_CONSULTA = MAX_POR_LLAMADA + 1"),
      js.includes('codigo=gt.${encodeURIComponent(cursor)}'),
      js.includes("has_more: hasMore"),
      js.includes("next_cursor: nextCursor"),
    ];
    if (requisitos.some((cumple) => !cumple)
        || /tickUso|fail-open|contarConReintento/.test(js)) {
      duro(`${LISTENING}: audio preparado fuera de la reserva atomica o con degradacion abierta`);
    } else ok("listening Larsito: privado, paginado y con reserva consumida antes de entregar URLs");
  }

  if (!exists(RESERVAS)) duro(`Falta ${RESERVAS}`);
  else {
    const js = read(RESERVAS);
    if (!js.includes("jwtVerify(firma, secreto)")
        || !js.includes("payload.reserva_id")
        || !js.includes("payload.jti")
        || !js.includes('sbRpc("norsk_consumir_reserva_larsito"')
        || !js.includes('sbRpc("norsk_registrar_fallo_larsito"')) {
      duro(`${RESERVAS}: el consumidor interno no verifica o no resuelve la reserva de un solo uso`);
    } else ok("consumidor Larsito: firma verificada, consumo y fallo ligados a reserva, compra, tipo y jti");
  }

  if (!exists(COMPENSAR)) duro(`Falta ${COMPENSAR}`);
  else {
    const js = read(COMPENSAR);
    if (!js.includes('req.method !== "POST"')
        || !js.includes("readSessionCookie(req)")
        || !js.includes("jwtVerify(token, secreto)")
        || !js.includes('payload.tipo !== "larsito_tts"')
        || !js.includes("payload.sub !== sesion.sub")
        || !js.includes("payload.jti")
        || !js.includes("p_compra: payload.sub")
        || !js.includes("p_jti: payload.jti")
        || !js.includes('sbRpc("norsk_registrar_fallo_larsito"')) {
      duro(`${COMPENSAR}: compensacion no autenticada o no idempotente`);
    } else ok("compensacion Larsito: token ligado a cookie y RPC idempotente");
  }

  if (!exists(MIGRACION)) duro(`Falta ${MIGRACION}`);
  else {
    const sql = read(MIGRACION);
    const sqlRequisitos = [
      /create table if not exists public\.norsk_reservas_larsito/i,
      /create table if not exists public\.norsk_riesgo_larsito/i,
      /create or replace function public\.norsk_reservar_larsito/i,
      /create or replace function public\.norsk_consumir_reserva_larsito/i,
      /create or replace function public\.norsk_registrar_fallo_larsito/i,
      /for share/i,
      /for update/i,
      /v_riesgo >= p_tope_fallos/i,
      /c\.status = 'activa'[\s\S]*c\.expires_at > now\(\)/i,
      /v_compra \+ p_coste > p_tope_compra/i,
      /v_global \+ p_coste > p_tope_global/i,
      /security definer/gi,
      /set search_path = public, pg_temp/gi,
      /revoke all on function public\.norsk_reservar_larsito/i,
      /revoke all on function public\.norsk_consumir_reserva_larsito/i,
      /revoke all on function public\.norsk_registrar_fallo_larsito/i,
      /revoke all on function public\.norsk_incr_uso\(uuid, text, integer\)/i,
      /revoke all on function public\.norsk_muestra\(integer, integer, integer\)/i,
    ];
    if (sqlRequisitos.some((re) => !re.test(sql)) || sql.includes("norsk_compensar_larsito")) {
      duro(`${MIGRACION}: contrato SQL atomico o permisos incompletos`);
    } else ok("migracion Larsito: reserva, consumo y fallo atomicos cerrados a service_role");
  }

  if (!exists(ESTIMULO)) duro(`Falta ${ESTIMULO}`);
  else {
    const js = read(ESTIMULO);
    const requisitos = [
      js.includes('req.method !== "POST"'),
      js.includes("readJsonBodyLimited(req, MAX_BODY_BYTES)"),
      js.includes("readSessionCookie(req)"),
      js.includes("compraActiva(sesion.sub)"),
      js.includes('sbRpc("norsk_mostrar_estimulo_ex"'),
      js.includes("p_attempt_id: attemptId"),
      js.includes("p_request_id: requestId"),
      js.includes("p_candidatos: ESTIMULOS[tarea]"),
      js.includes('Cache-Control", "private, no-store"'),
      !/body\.stimulus_id|body\.candidatos/.test(js),
    ];
    if (requisitos.some((cumple) => !cumple)) {
      duro(`${ESTIMULO}: asignacion EX acepta codigo cliente o no falla cerrada`);
    } else ok("estimulos EX: endpoint autenticado, idempotente y banco solo de servidor");
  }

  if (!exists(MIGRACION_APRENDIZAJE)) duro(`Falta ${MIGRACION_APRENDIZAJE}`);
  else {
    const sql = read(MIGRACION_APRENDIZAJE);
    const requisitos = [
      /create table if not exists public\.norsk_exposiciones_ex/i,
      /unique \(compra_id, ruta, request_id\)/i,
      /unique \(compra_id, ruta, stimulus_id\)/i,
      /unique \(compra_id, ruta, attempt_id, tarea\)/i,
      /p_tarea is null/i,
      /c\.status = 'activa'[\s\S]*c\.expires_at > now\(\)/i,
      /v_existente\.tarea <> p_tarea or v_existente\.attempt_id <> p_attempt_id/i,
      /pg_advisory_xact_lock/i,
      /p_tarea = 'C'[\s\S]*EX-C-02[\s\S]*EX-B-02/i,
      /alter table public\.norsk_exposiciones_ex enable row level security/i,
      /revoke all on table public\.norsk_exposiciones_ex from public, anon, authenticated/i,
      /revoke all on function public\.norsk_mostrar_estimulo_ex/i,
      /grant execute on function public\.norsk_mostrar_estimulo_ex[\s\S]*to service_role/i,
    ];
    if (requisitos.some((re) => !re.test(sql))) {
      duro(`${MIGRACION_APRENDIZAJE}: unicidad, compra activa, idempotencia o permisos incompletos`);
    } else ok("migracion aprendizaje: EX consumido al mostrar, sin reuso y solo service_role");
  }

  if (!exists(PRIVACIDAD)) duro(`Falta ${PRIVACIDAD}`);
  else {
    const html = read(PRIVACIDAD);
    const privacidadTts = /texto que eliges escuchar/i.test(html)
      && /OpenAI/i.test(html)
      && /nunca el audio del alumno/i.test(html)
      && /demo de Larsito no se llama a OpenAI/i.test(html)
      && /seguirá cerrada hasta publicar aquí la conservación aplicable del proveedor/i.test(html);
    const privacidadAgente = /audio y transcripciones de la conversación/i.test(html)
      && /ElevenLabs/i.test(html)
      && /agente completo/i.test(html)
      && /conservación configurada/i.test(html);
    if (!privacidadTts || !privacidadAgente || /nada más se mueve de tu dispositivo/i.test(html)) {
      duro(`${PRIVACIDAD}: la sintesis remota o su diferencia con la demo local no estan explicadas`);
    } else ok("privacidad Larsito: demo local, TTS y agente ElevenLabs diferenciados");
  }

  if (!exists(API_PACKAGE)) duro(`Falta ${API_PACKAGE}`);
  else {
    try {
      const pkg = JSON.parse(read(API_PACKAGE));
      if (pkg.type !== "module") duro(`${API_PACKAGE}: api/*.js debe declararse ESM para que el selftest sea portable`);
      else ok("API Larsito: módulos ESM declarados de forma portable");
    } catch (e) { duro(`${API_PACKAGE}: JSON invalido`); }
  }

  if (!exists(SELFTEST)) duro(`Falta ${SELFTEST}`);
  else {
    const test = spawnSync(process.execPath, [rel(SELFTEST)], {
      encoding: "utf8",
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    if (test.status !== 0
        || !/PASS larsito_reservas_selftest: 13 flujos sin red/.test(test.stdout || "")) {
      duro(`${SELFTEST}: falla el contrato dinamico de reserva, consumo, fallo o replay`);
    } else ok("selftest Larsito: 13 flujos sin red, incluida cola 1-3-7-14 y estimulos EX concurrentes");
  }
}

// 5j) Practica interactiva del curso: ejercicios generados solo con el noruego ya revisado de cada pieza.
{
  const MOTOR = "norsk/curso/practica.js";
  const SELFTEST = "scripts/norsk_practica_selftest.mjs";
  if (!exists(MOTOR)) duro("Falta norsk/curso/practica.js (practica interactiva)");
  else {
    const js = read(MOTOR);
    if (!/root\.NexoPractica = Object\.freeze/.test(js)) duro("practica.js: no expone NexoPractica");
    if (!read("norsk/curso/index.html").includes("/norsk/curso/practica.js")) duro("norsk/curso/index.html: no carga practica.js");
    if (!read("norsk/curso/app.js").includes("NexoPractica.montar")) duro("norsk/curso/app.js: no monta la practica interactiva");
    if (/fetch\(|XMLHttpRequest|localStorage\.setItem\([^)]*respuesta/i.test(js)) duro("practica.js: la practica no debe llamar a la red ni guardar respuestas");
    if (!exists(SELFTEST)) duro(`Falta ${SELFTEST}`);
    else {
      const test = spawnSync(process.execPath, [SELFTEST], { encoding: "utf8" });
      if (test.status !== 0 || !/PASS norsk_practica_selftest/.test(test.stdout || "")) duro(`${SELFTEST}: el generador no produce una tanda completa con el contenido de la pieza`);
      else ok("practica interactiva: generador sin red, sin inventar noruego, selftest en verde");
    }
  }
}

// 5i) Memoria de Larsito: informes y cola de recuperacion solo con compra, sin audio ni transcripciones.
{
  const API = "api/larsito-aprendizaje.js";
  const MIGRACION = "supabase/migrations/20260902230000_larsito_aprendizaje_0007.sql";
  const SELFTEST = "scripts/larsito_aprendizaje_selftest.mjs";
  if (!exists(API)) duro("Falta api/larsito-aprendizaje.js (memoria de Larsito)");
  else {
    const h = read(API);
    if (!h.includes("readSessionCookie") || !h.includes("compraActiva")) duro("larsito-aprendizaje: no comprueba sesion y compra");
    if (!/LARSITO_ON !== "true"/.test(h)) duro("larsito-aprendizaje: falta el interruptor LARSITO_ON");
    if (!/const MAX_TEXTO = 300;/.test(h)) duro("larsito-aprendizaje: el foco de feedback debe caber en 300 caracteres");
    if (!/CLAVES_PROHIBIDAS = \/\^\(audio\|grabacion/.test(h)) duro("larsito-aprendizaje: debe rechazar audio y transcripciones");
    if (!/readJsonBodyLimited\(req, MAX_BODY_BYTES\)/.test(h)) duro("larsito-aprendizaje: cuerpo sin acotar");
    if (!exists(MIGRACION)) duro(`Falta ${MIGRACION}`);
    else {
      const sql = read(MIGRACION);
      for (const t of ["norsk_larsito_informes", "norsk_larsito_recuperaciones"]) {
        if (!new RegExp(`enable row level security`).test(sql) || !new RegExp(`revoke all on table public\\.${t} from public, anon, authenticated`).test(sql)) duro(`migracion 0007: ${t} sin RLS o sin revoke`);
      }
      if (!/char_length\(ahora\) between 1 and 300/.test(sql)) duro("migracion 0007: el foco Ahora no esta acotado a 300");
    }
    if (!exists(SELFTEST)) duro(`Falta ${SELFTEST}`);
    else {
      const test = spawnSync(process.execPath, [SELFTEST], { encoding: "utf8" });
      if (test.status !== 0 || !/PASS larsito_aprendizaje_selftest: \d+ casos sin red/.test(test.stdout || "")) duro(`${SELFTEST}: falla el contrato de la memoria de Larsito`);
      else ok("memoria de Larsito: informes y recuperaciones solo con compra, sin audio ni transcripciones, selftest sin red");
    }
  }
}

// 5h) Cuaderno en PDF: descarga solo con compra, PDF de pago fuera del repo, muestra publica pequena.
{
  const API = "api/norsk-cuaderno.js";
  if (!exists(API)) duro("Falta api/norsk-cuaderno.js (descarga del cuaderno)");
  else {
    const h = read(API);
    if (!h.includes("readSessionCookie") || !h.includes("compraActiva")) duro("norsk-cuaderno: no comprueba sesion y compra antes de firmar");
    if (!/expiresIn/.test(h) || !/norsk-cuaderno/.test(h)) duro("norsk-cuaderno: no firma contra el bucket privado norsk-cuaderno");
    if (!/statusCode = 302/.test(h)) duro("norsk-cuaderno: no redirige a la URL firmada");
    if (/SUPABASE_SERVICE_KEY\s*=\s*["']/.test(h)) duro("norsk-cuaderno: clave escrita en el codigo");
  }
  const META = "data/norsk-cuaderno.json";
  if (!exists(META)) duro("Falta data/norsk-cuaderno.json (metadatos publicos del cuaderno)");
  else {
    try {
      const d = JSON.parse(read(META));
      if (!Array.isArray(d.tomos) || d.tomos.length !== 6) duro("norsk-cuaderno.json: deben ser 6 tomos");
      if (JSON.stringify(d).includes(".pdf")) duro("norsk-cuaderno.json: expone nombres de archivo del bucket");
    } catch (e) { duro("norsk-cuaderno.json no es JSON valido"); }
  }
  if (!read(".gitignore").includes("scripts/_norsk_cuaderno/")) duro("scripts/_norsk_cuaderno/ no esta en .gitignore (PDF de pago en repo publico)");
  const MUESTRA = "norsk/curso/muestra/NEXO-NORSK_Cuaderno-B1_Muestra.pdf";
  if (!exists(MUESTRA)) duro("Falta la muestra gratuita del cuaderno en norsk/curso/muestra/");
  else if (fs.statSync(rel(MUESTRA)).size > 3 * 1024 * 1024) duro("La muestra del cuaderno pesa mas de 3 MB: revisar que solo lleve la guia y M01");
  const app = read("norsk/curso/app.js");
  if (!app.includes("/api/norsk-cuaderno/") || !app.includes("norsk-cuaderno.json")) duro("curso/app.js: no muestra el bloque del cuaderno");
  const test = spawnSync(process.execPath, [rel("scripts/norsk_cuaderno_selftest.mjs")], { encoding: "utf8", env: { ...process.env, NODE_NO_WARNINGS: "1" } });
  if (test.status !== 0 || !/casos sin red OK/.test(test.stdout || "")) duro("selftest del cuaderno falla: " + String(test.stdout || test.stderr || "").slice(-200));
  else ok("cuaderno en PDF: descarga solo con compra, PDF fuera del repo, muestra publica y selftest sin red");
}

// 5g) El curso: la demo publica no puede llevar contenido de pago.
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
      const cuerposEsperados = ["M01", "DIAGNOSTICO_B1"];
      const cuerposReales = conCuerpo.slice().sort();
      if (JSON.stringify(cuerposReales) !== JSON.stringify(cuerposEsperados.slice().sort())) {
        duro(`demo del curso: cuerpos ${cuerposReales.join(", ") || "ninguno"}; solo se permiten M01 y DIAGNOSTICO_B1`);
      }
      if (Array.isArray(d.piezas) && d.piezas.length) duro("demo del curso: d.piezas debe estar vacio");
      if (!d.mecanismo || d.mecanismo.codigo !== "M01") duro("demo del curso: la muestra completa debe ser M01");
      if (!d.diagnostico || d.diagnostico.codigo !== "DIAGNOSTICO_B1"
          || d.diagnostico.parcial !== true || d.diagnostico.secciones.length !== 2) {
        duro("demo del curso: el diagnostico debe ser parcial y llevar exactamente dos secciones");
      }
      const indiceEsperado = Array.from({ length: 15 }, (_, i) => `M${String(i + 2).padStart(2, "0")}`);
      const indiceReal = (d.indice || []).map((p) => p.codigo);
      if (JSON.stringify(indiceReal) !== JSON.stringify(indiceEsperado)) {
        duro("demo del curso: el indice debe contener exactamente M02-M16, en orden y sin cuerpo");
      } else if (!filtradas.length && JSON.stringify(cuerposReales) === JSON.stringify(cuerposEsperados.slice().sort())) {
        ok("demo del curso: M01 + introduccion parcial del diagnostico + indice M02-M16");
      }

      if (!d.mecanismo || !d.mecanismo.meta
          || d.mecanismo.meta.qa_lengua !== "SISTEMICA_TECNICA_ACEPTADA"
          || d.mecanismo.meta.qa_lengua_alcance !== "NO_FIRMA_HUMANA_NATIVA"
          || Object.prototype.hasOwnProperty.call(d.mecanismo.meta, "revision_nativa")) {
        duro("demo del curso: metadato de QA lingüística no canónico");
      }

      const seccionesAlumno = [
        ...((d.mecanismo && d.mecanismo.secciones) || []),
        ...((d.diagnostico && d.diagnostico.secciones) || []),
      ];
      if (seccionesAlumno.some((s) => IDS_SECCIONES_EDITORIALES.has(s.id))) duro("demo del curso: incluye una seccion editorial interna");
      const textoAlumno = seccionesAlumno.map((s) => `${s.titulo || ""} ${s.html || ""}`).join(" ");
      if (CONTENIDO_EDITORIAL_INTERNO.test(textoAlumno)) {
        duro("demo del curso: expone notas, dudas o puertas editoriales internas");
      }
      if (CABECERA_PRODUCCION_HTML.test(textoAlumno)) duro("demo del curso: expone una cabecera de produccion");
      if (RUTA_INTERNA_CURSO.test(textoAlumno)) duro("demo del curso: expone una ruta interna");
      if (RUIDO_PRODUCCION_ALUMNO.test(textoAlumno)) duro("demo del curso: expone lenguaje de produccion");
      if (JSON.stringify(d).includes("\u2014")) duro("demo del curso: em dash en el contenido");
    } catch (e) { duro("demo del curso: JSON invalido"); }
  }

  // El material completo jamas entra al repo.
  if (exists("scripts/_norsk_curso/curso.json")) {
    const ig = read(".gitignore");
    if (!ig.includes("scripts/_norsk_curso/")) duro("scripts/_norsk_curso/ existe y NO esta en .gitignore (contenido de pago en repo publico)");
    else ok("curso completo fuera del repo (gitignored)");
    if (!exists("scripts/_norsk_curso/manifiesto.json")) duro("curso completo: falta el manifiesto del export");
    else {
      try {
        const manifiesto = JSON.parse(read("scripts/_norsk_curso/manifiesto.json"));
        const exportadorActual = createHash("sha256").update(read("scripts/norsk_curso_export.mjs"), "utf8").digest("hex");
        if (!manifiesto.exportador_sha256 || manifiesto.exportador_sha256 !== exportadorActual) {
          duro("curso completo: artefactos no regenerados despues de cambiar el exportador");
        } else ok("curso completo: artefactos generados con el exportador vigente");
      } catch (e) { duro("curso completo: manifiesto de export invalido"); }
    }
    const buildCurso = spawnSync(process.execPath, [rel("scripts/norsk_curso_build.mjs"), "--dry"], {
      encoding: "utf8",
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    if (buildCurso.status !== 0) {
      duro("curso completo: el build dry falla o detecta fuentes modificadas desde el export");
    } else if (!/Fuentes SHA-256: [a-f0-9]{64} · Curso SHA-256: [a-f0-9]{64}/.test(buildCurso.stdout || "")) {
      duro("curso completo: el build no valida fingerprints SHA-256 de fuentes y artefacto");
    } else ok("curso completo: fingerprints de fuentes y artefacto verificados");
    try {
      const privado = JSON.parse(read("scripts/_norsk_curso/curso.json"));
      const seccionesPrivadas = privado.flatMap((p) => (p.secciones || []).map((s) => ({ codigo: p.codigo, ...s })));
      const idsFiltrados = seccionesPrivadas.filter((s) => IDS_SECCIONES_EDITORIALES.has(s.id));
      if (idsFiltrados.length) {
        duro(`curso completo: ${idsFiltrados.length} seccion(es) editorial(es) internas en la superficie de alumno`);
      }
      const textoEditorial = seccionesPrivadas.filter((s) => CONTENIDO_EDITORIAL_INTERNO.test(`${s.titulo || ""} ${s.html || ""}`));
      if (textoEditorial.length) {
        duro(`curso completo: ${textoEditorial.length} seccion(es) exponen QA, trazabilidad o trabajo editorial interno`);
      } else if (!idsFiltrados.length) ok("curso completo: trazabilidad editorial separada de la superficie de alumno");
      const cabecerasProduccion = seccionesPrivadas.filter((s) => CABECERA_PRODUCCION_HTML.test(s.html || ""));
      if (cabecerasProduccion.length) {
        duro(`curso completo: ${cabecerasProduccion.length} cabecera(s) de produccion en la superficie de alumno`);
      }
      const rutasInternas = seccionesPrivadas.filter((s) => RUTA_INTERNA_CURSO.test(`${s.titulo || ""} ${s.html || ""}`));
      if (rutasInternas.length) duro(`curso completo: ${rutasInternas.length} ruta(s) internas en la superficie de alumno`);
      const ruidoProduccion = seccionesPrivadas.filter((s) => RUIDO_PRODUCCION_ALUMNO.test(`${s.titulo || ""} ${s.html || ""}`));
      if (ruidoProduccion.length) duro(`curso completo: ${ruidoProduccion.length} seccion(es) con lenguaje de produccion`);
      const kit = privado.find((p) => p.codigo === "KIT_ORAL_21_JORNADAS");
      const jornadas = kit && Array.isArray(kit.secciones)
        ? kit.secciones.filter((s) => /^jornada-\d+\b/.test(s.id || ""))
        : [];
      if (jornadas.length !== 21) duro(`curso completo: el kit oral expone ${jornadas.length} de 21 actuaciones navegables`);
      else if (!/estado\.actuaciones/.test(read("norsk/curso/app.js"))
          || !/estado\.ultimaSeccion/.test(read("norsk/curso/app.js"))) {
        duro("curso completo: las 21 actuaciones no conservan progreso y reanudacion local");
      } else ok("ruta oral: 21 actuaciones navegables, reanudables y con progreso local minimo");
    } catch (e) { duro("curso completo: JSON privado invalido"); }
  }
}

// 6) Contacto: hay que crear el buzón (no verificable aquí)
{
  const usaCorreo = LEGALES.some((f) => exists(f) && read(f).includes("pass@nexonoruega.com"));
  if (usaCorreo) aviso("Crear y monitorizar el buzón pass@nexonoruega.com (canal de desistimiento/garantía/RGPD)");
}

// 7) Env de producción (solo con --env)
{
  const flagsAbiertos = [
    ["LARSITO_ON", process.env.LARSITO_ON === "true"],
    ["LARSITO_CONSUMER_READY", process.env.LARSITO_CONSUMER_READY === "true"],
    ["LARSITO_LISTENING", process.env.LARSITO_LISTENING === "on"],
    ["LARSITO_TTS", process.env.LARSITO_TTS === "on"],
    ["LARSITO_PRIVACY_READY", process.env.LARSITO_PRIVACY_READY === "true"],
    ["LARSITO_AGENT_PRIVACY_READY", process.env.LARSITO_AGENT_PRIVACY_READY === "true"],
  ].filter(([, abierto]) => abierto).map(([nombre]) => nombre);
  if (flagsAbiertos.length) {
    duro(`pre-lanzamiento: flags de Larsito abiertos en el entorno (${flagsAbiertos.join(", ")})`);
  } else ok("runtime Larsito: todos los flags de pre-lanzamiento permanecen cerrados");
}

// 5k) Contenido de pago fuera de Git. El curso completo (api/_curso_privado*.js) se
// generó para la revisión privada y entró por error en el índice el 02.09.2026
// (PR #48); se retiró el 04.09.2026. Desde entonces: nunca en el índice, siempre
// en .gitignore, y ningún archivo grande sospechoso dentro de api/.
{
  const patronPrivado = /^_curso_privado.*\.js$/;
  let indice = null;
  let gitError = "";
  try {
    indice = execSync("git ls-files -- api", { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n").filter(Boolean);
  } catch (e) { indice = null; gitError = String(e && e.message || e).split("\n")[0].slice(0, 160); }
  if (indice) {
    const filtrados = indice.filter((f) => patronPrivado.test(path.basename(f)));
    if (filtrados.length) duro(`contenido de pago en el índice de Git: ${filtrados.join(", ")}`);
    else ok("Git: ningún curso privado en el índice de api/");
  } else aviso(`Git no disponible: no se ha podido comprobar el índice de api/ (${gitError})`);
  const ignore = exists(".gitignore") ? read(".gitignore") : "";
  if (!/^api\/_curso_privado\*\.js$/m.test(ignore)) duro(".gitignore: falta la regla api/_curso_privado*.js");
  else ok(".gitignore: el curso privado queda fuera del repo");
  const grandes = fs.readdirSync(rel("api"), { withFileTypes: true })
    .filter((e) => e.isFile() && !patronPrivado.test(e.name) && fs.statSync(rel(path.join("api", e.name))).size > 200 * 1024)
    .map((e) => e.name);
  if (grandes.length) duro(`api/: archivos de más de 200 KB que no deberían estar en un repo público: ${grandes.join(", ")}`);
  else ok("api/: ningún archivo de más de 200 KB fuera del curso privado ignorado");
}

// 5l) Recorrido «Noruego desde cero hasta A2»: la demo pública es válida, no
// expone nada editorial ni de pago, y el autotest de su banco de ejercicios pasa.
{
  const DEMO_CERO = "data/norsk-desde-cero-demo.json";
  if (!exists(DEMO_CERO)) duro(`Falta ${DEMO_CERO}`);
  else {
    try {
      const d = JSON.parse(read(DEMO_CERO));
      const raw = read(DEMO_CERO);
      if (!d.meta || d.meta.ruta !== "norsk-desde-cero-a2") duro("demo desde cero: ruta incorrecta");
      if (!Array.isArray(d.piezas) || !d.piezas.length) duro("demo desde cero: sin piezas abiertas");
      if (raw.includes("\u2014")) duro("demo desde cero: em dash");
      if (/revisi[oó]n nativa|firma nativa|PENDIENTE_6_PASADAS/.test(raw)) duro("demo desde cero: expone estado editorial interno");
      if (PROHIBIDAS.test(raw)) duro("demo desde cero: palabra prohibida de marca");
      (d.indice || []).forEach((m) => { if (m.secciones || m.html) duro(`demo desde cero: ${m.codigo} lleva cuerpo en el índice`); });
      if (!duros.some((x) => x.startsWith("demo desde cero"))) ok(`demo desde cero: ${d.piezas.length} lección(es) abierta(s) + índice de ${(d.indice || []).length}`);
    } catch (e) { duro("demo desde cero: JSON inválido"); }
  }
  // Larsito desde cero: escenarios guiados, sin audio remoto ni estado editorial.
  const DEMO_LARSITO_CERO = "data/larsito-desde-cero-demo.json";
  if (!exists(DEMO_LARSITO_CERO)) duro(`Falta ${DEMO_LARSITO_CERO}`);
  else {
    try {
      const raw = read(DEMO_LARSITO_CERO);
      const d = JSON.parse(raw);
      const esc = Array.isArray(d.escenarios) ? d.escenarios : [];
      if (d.ruta !== "norsk-desde-cero-a2") duro("Larsito desde cero: ruta incorrecta");
      if (!esc.length) duro("Larsito desde cero: sin escenarios");
      if (d.audio_estatico !== false) duro("Larsito desde cero: audio_estatico debe ser false (sin grabaciones ni proveedor)");
      if (raw.includes("\u2014")) duro("Larsito desde cero: em dash");
      if (/PENDIENTE|revisi[oó]n nativa|firma nativa/i.test(raw)) duro("Larsito desde cero: expone estado editorial interno");
      if (PROHIBIDAS.test(raw)) duro("Larsito desde cero: palabra prohibida de marca");
      const turnosMal = esc.flatMap((e) => (e.turnos || []).filter((t) => !t.larsito_no || !t.larsito_es || !t.pista_es || !(t.respuestas_modelo_no || []).length));
      if (turnosMal.length) duro(`Larsito desde cero: ${turnosMal.length} turno(s) incompletos`);
      const conAudio = esc.flatMap((e) => (e.turnos || []).filter((t) => t.audio_no || t.audio_modelo));
      if (conAudio.length) duro("Larsito desde cero: audio declarado en turnos sin manifiesto");
      if (!duros.some((x) => x.startsWith("Larsito desde cero"))) ok(`Larsito desde cero: ${esc.length} escenario(s) guiado(s), ${esc.reduce((n, e) => n + (e.turnos || []).length, 0)} turnos, sin audio remoto`);
    } catch (e) { duro("Larsito desde cero: JSON inválido"); }
  }
  const SELFTEST_CERO = "scripts/norsk_desde_cero_selftest.mjs";
  if (!exists(SELFTEST_CERO)) duro(`Falta ${SELFTEST_CERO}`);
  else {
    const r = spawnSync(process.execPath, [rel(SELFTEST_CERO)], { encoding: "utf8" });
    if (r.status !== 0) duro(`${SELFTEST_CERO} falla: ${(r.stdout || r.stderr || "").split("\n").filter(Boolean).slice(-3).join(" | ")}`);
    else ok("recorrido desde cero: banco explícito, tipos y ratio de práctica extra verificados sin navegador");
  }
}

if (process.argv.includes("--env")) {
  const req = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "NORSK_JWT_SECRET", "RESEND_API_KEY"];
  const faltan = req.filter((k) => !process.env[k]);
  if (faltan.length) duro(`Faltan env vars: ${faltan.join(", ")}`);
  else ok("env vars de producción presentes");
  aviso("Verificar en el Dashboard de Stripe la URL de condiciones (consent_collection) y el webhook con barra final");
} else {
  aviso("Stripe/Resend + entidad legal: gates comerciales finales (ver pass/PASS_SETUP.md). Ejecuta con --env cuando estén.");
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
console.log(`Checks automáticos PASS. Quedan ${avisos.length} gate(s) comerciales/finales. Este resultado no abre la venta por sí solo.`);
process.exit(0);
