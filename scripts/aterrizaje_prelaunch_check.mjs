// Guard de pre-lanzamiento de la capa de ATERRIZAJE (/empezar, /mapa, /kit, /legal).
// Mismo espíritu que norsk_prelaunch_check.mjs: convierte los "pendientes" en barrera.
// Falla (exit 1) si algo NO está listo. Los pendientes de empresa son avisos en
// pre-venta y bloqueos duros cuando la venta del Kit está abierta.
//
//   node scripts/aterrizaje_prelaunch_check.mjs          (revisa el repo)
//   node scripts/aterrizaje_prelaunch_check.mjs --env    (además exige env vars de prod)
//
// Bloqueos DUROS (exit 1): em dash en copy publicable, palabras prohibidas,
// enlaces internos rotos (salvo pendientes conocidos), incoherencia de modo venta,
// placeholders legales con la venta abierta.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rel = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(rel(p), "utf8");
const exists = (p) => fs.existsSync(rel(p));

const duros = [];
const avisos = [];
const oks = [];
const duro = (m) => duros.push(m);
const aviso = (m) => avisos.push(m);
const ok = (m) => oks.push(m);

// Modo de venta del Kit. Fuente: kit/MODO.json.
let VENTA = false;
try { VENTA = JSON.parse(read("kit/MODO.json")).venta === true; } catch (e) { /* sin MODO.json = pre-venta */ }
ok(`modo kit: ${VENTA ? "VENTA ABIERTA" : "pre-venta (lista de espera, sin checkout)"}`);

const PUBLICABLES = [
  "empezar/index.html",
  "mapa/index.html",
  "mapa/guia/index.html",
  "kit/index.html",
  "legal/privacidad/index.html",
];
const PROHIBIDAS = /increíble|brutal|paraíso|hola chicos/i;

// Enlaces internos que apuntan a islas de OTRA rama pendiente de merge.
// Existen en producción solo cuando esa rama entre. Aviso, no bloqueo.
const PENDIENTES_MERGE = ["norsk/"];

// 1) Todas las páginas existen
for (const f of PUBLICABLES) {
  if (!exists(f)) duro(`Falta la página ${f}`);
}
if (!duros.length) ok("las 5 páginas de la capa de aterrizaje existen");

// 2) Em dash y palabras prohibidas en copy publicable
for (const f of PUBLICABLES) {
  if (!exists(f)) continue;
  const h = read(f);
  const lineas = h.split("\n");
  lineas.forEach((l, i) => {
    if (l.includes("—")) duro(`${f}:${i + 1}: em dash en copy publicable`);
    const m = PROHIBIDAS.exec(l);
    if (m) duro(`${f}:${i + 1}: palabra prohibida "${m[0]}"`);
  });
}
if (!duros.some((d) => d.includes("em dash") || d.includes("prohibida"))) {
  ok("sin em dash ni palabras prohibidas en el copy");
}

// 3) Placeholders legales (aviso en pre-venta, duro con venta abierta)
{
  const f = "legal/privacidad/index.html";
  if (exists(f)) {
    const h = read(f);
    const hayRazon = /\[RAZ[OÓ]N SOCIAL/i.test(h);
    const hayCorreo = /\[CORREO DE CONTACTO\]/i.test(h);
    if (hayRazon || hayCorreo) {
      const msg = `${f}: placeholder pendiente (${[hayRazon && "[RAZÓN SOCIAL]", hayCorreo && "[CORREO DE CONTACTO]"].filter(Boolean).join(" y ")})`;
      if (VENTA) duro(`${msg} y la venta del Kit está ABIERTA`);
      else aviso(`${msg}; obligatorio antes de abrir la venta o activar Supabase`);
    } else ok(`${f}: titular y contacto rellenados`);
  }
}

// 4) Coherencia del modo de venta en kit/index.html
{
  const h = exists("kit/index.html") ? read("kit/index.html") : "";
  const flag = /var VENTA_ABIERTA = (true|false);/.exec(h);
  const urlM = /var CHECKOUT_URL = "([^"]*)";/.exec(h);
  const flagVal = flag ? flag[1] === "true" : null;
  const urlVal = urlM ? urlM[1] : null;
  if (flagVal === null) duro("kit/index.html: falta el flag VENTA_ABIERTA");
  else if (flagVal !== VENTA) duro(`incoherencia de modo: kit/MODO.json venta=${VENTA} pero kit/index.html VENTA_ABIERTA=${flagVal}`);
  else ok(`kit/index.html VENTA_ABIERTA=${flagVal} coherente con MODO.json`);
  if (urlVal === null) duro("kit/index.html: falta CHECKOUT_URL");
  else if (VENTA && !urlVal) duro("venta abierta pero CHECKOUT_URL está vacío");
  else if (!VENTA && urlVal) aviso(`pre-venta con CHECKOUT_URL ya puesto (${urlVal}): revisa si toca abrir`);
  else ok("CHECKOUT_URL coherente con el modo");
}

// 5) Enlaces internos resuelven (en las páginas nuevas)
{
  let rotos = 0;
  for (const f of PUBLICABLES) {
    if (!exists(f)) continue;
    const h = read(f);
    const hrefs = [...h.matchAll(/href="(\/[^"#]*)"/g)].map((m) => m[1]);
    for (const href of hrefs) {
      const limpio = href.replace(/\/$/, "");
      const destino = limpio === "" ? "index.html" : `${limpio.slice(1)}/index.html`;
      const archivo = limpio === "" ? "index.html" : limpio.slice(1);
      const esArchivo = /\.\w+$/.test(archivo);
      const okDestino = esArchivo ? exists(archivo) : exists(destino);
      if (!okDestino) {
        const pendiente = PENDIENTES_MERGE.some((p) => href.startsWith("/" + p) || href === "/" + p.replace(/\/$/, "") + "/");
        if (pendiente) aviso(`${f}: enlaza a ${href}, que entra con otra rama (feat/norsk). Publicar /empezar y /mapa/guia DESPUÉS de ese merge, o quitar el enlace.`);
        else { duro(`${f}: enlace interno roto ${href}`); rotos++; }
      }
    }
  }
  if (!rotos) ok("enlaces internos correctos (los de /norsk/ quedan avisados hasta su merge)");
}

// 6) api/lead.js tiene el campo segmento
{
  const h = exists("api/lead.js") ? read("api/lead.js") : "";
  if (!h.includes("segmento")) duro("api/lead.js: falta el campo segmento (lo usa /mapa)");
  else ok("api/lead.js con campo segmento");
}

// 7) Env vars (solo con --env)
if (process.argv.includes("--env")) {
  for (const v of ["SUPABASE_URL", "SUPABASE_SERVICE_KEY"]) {
    if (!process.env[v]) aviso(`env var ${v} sin definir: los leads no se guardan (solo log)`);
    else ok(`env ${v} definida`);
  }
}

// Resumen
console.log("\n== Guard de aterrizaje ==");
for (const m of oks) console.log("  OK  ", m);
for (const m of avisos) console.log("  AVISO", m);
for (const m of duros) console.log("  DURO", m);
console.log(`\n${oks.length} ok · ${avisos.length} avisos · ${duros.length} bloqueos`);
if (duros.length) { console.log("NO listo. Arregla los bloqueos duros."); process.exit(1); }
console.log(VENTA ? "Listo para VENDER." : "Listo para publicar en modo pre-venta.");
