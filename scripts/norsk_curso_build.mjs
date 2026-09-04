// Valida el curso Norskprøven B1 exportado del Drive y lo sube a Supabase.
// Uso:  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/norsk_curso_build.mjs [--ruta=norskproven-b1|norsk-desde-cero-a2] [--dry]
//
// Entrada (GITIGNORED, el repo es público y el curso es contenido de pago):
//   scripts/_norsk_curso/curso.json  <- lo genera scripts/norsk_curso_export.mjs
//
// La demo pública no se sube: vive en data/norsk-curso-demo.json y la sirve el
// estático. Aquí solo viaja lo que hay detrás del muro.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Dos rutas comparten tabla y endpoint (columna ruta, migración 0008). La B1 sigue
// en la carpeta de siempre; el recorrido desde cero en una subcarpeta.
const RUTAS_VALIDAS = ["norskproven-b1", "norsk-desde-cero-a2"];
const RUTA = (process.argv.find((a) => a.startsWith("--ruta=")) || "").slice(7).trim() || "norskproven-b1";
if (!RUTAS_VALIDAS.includes(RUTA)) { console.error(`Ruta desconocida: ${RUTA}. Válidas: ${RUTAS_VALIDAS.join(", ")}`); process.exit(1); }
const CARPETA = RUTA === "norskproven-b1" ? path.join(ROOT, "scripts", "_norsk_curso") : path.join(ROOT, "scripts", "_norsk_curso", RUTA);
const CURSO = path.join(CARPETA, "curso.json");
const MANIFIESTO = path.join(CARPETA, "manifiesto.json");
const DRY = process.argv.includes("--dry");
const FINGERPRINT_VERSION = "sha256-ruta-contenido-v1";

const CODIGO_VALIDO = /^[A-Z0-9_-]{3,40}$/;
const TIPOS = ["diagnostico", "mecanismo", "anexo", "lytt", "les", "skriv", "muntlig", "simulacro", "leccion", "puente", "salto"];
const PROHIBIDAS = /increíble|brutal|paraíso|trucos|hola chicos/i;
const NO_PENINSULAR = /\b(celular|manejar|acá|computadora|plata|carro)\b/i;
const SECCION_INTERNA = /^(?:notas-para-la-revision-nativa|puertas-abiertas-de-esta-leccion|puertas-abiertas-de-este-documento|registro-de-dudas-para-contraste-humano-opcional|registro-historico-de-dudas-de-lengua|registro-de-revision-de-lengua|registro-de-produccion|estado-y-controles-separados-de-esta-leccion|estado-reconciliado-de-esta-leccion|estado-reconciliado-y-mejoras-opcionales|estado-y-trabajo-abierto|controles-y-pendientes-separados|lo-que-este-banco-todavia-no-tiene|hoja-interna-de-observacion-siete-puertas-y-alcance|control-de-calidad-de-este-bloque|comprobaciones-pasadas-sobre-este-archivo|comprobaciones-internas-de-este-lote|siguiente-paso)$/;
const CONTENIDO_EDITORIAL_INTERNO = /contraste humano|revisi[oó]n nativa|registro (?:hist[oó]rico )?de dudas|puerta editorial|firma (?:humana|nativa)|revisi[oó]n sist[eé]mica|revisi[oó]n de bokm[aå]l|qa (?:sist[eé]mic[oa]|t[eé]cnic[oa]|de audio)|material interno|material publicable|no es copy|estado (?:de producci[oó]n|y trabajo abierto)|puertas abiertas de este documento|hoja interna|\bcohorte\b|\breclutamiento\b|circuito (?:con personas|de alumnos)|(?:no hay|no se incluye)[^.!?]{0,120}\bconsentimiento\b|\bla lupa\b|pass_con_avisos|orden (?:expresa )?de publicaci[oó]n|publicaci[oó]n (?:sigue|se registra|conserva|es una puerta)|puertas? (?:t[eé]cnicas? y )?de publicaci[oó]n|autorizar (?:la )?publicaci[oó]n|autorizar su uso p[uú]blico/i;

function fallo(errores, id, msg) {
  errores.push(`${id}: ${msg}`);
}

function sha256(datos) {
  return createHash("sha256").update(datos).digest("hex");
}

function fingerprintFuentes(entradas) {
  const ordenadas = entradas.slice().sort((a, b) => (a.ruta < b.ruta ? -1 : a.ruta > b.ruta ? 1 : 0));
  const hash = createHash("sha256");
  hash.update(`${FINGERPRINT_VERSION}\0`, "utf8");
  ordenadas.forEach(({ ruta, sha256: huella }) => {
    hash.update(ruta, "utf8");
    hash.update("\0", "utf8");
    hash.update(huella, "ascii");
    hash.update("\n", "utf8");
  });
  return hash.digest("hex");
}

function validarManifiesto(cursoTexto, piezas, errores) {
  if (!fs.existsSync(MANIFIESTO)) {
    fallo(errores, "manifiesto", "falta manifiesto.json; vuelve a exportar desde las fuentes");
    return null;
  }

  let manifiesto;
  try {
    manifiesto = JSON.parse(fs.readFileSync(MANIFIESTO, "utf8"));
  } catch (e) {
    fallo(errores, "manifiesto", "JSON inválido");
    return null;
  }

  if (manifiesto.fingerprint_version !== FINGERPRINT_VERSION) {
    fallo(errores, "manifiesto", "versión de fingerprint ausente o desconocida");
  }
  if (manifiesto.curso_sha256 !== sha256(Buffer.from(cursoTexto, "utf8"))) {
    fallo(errores, "manifiesto", "curso.json no coincide con su SHA-256; vuelve a exportar");
  }
  if (!Array.isArray(manifiesto.fuentes) || !manifiesto.fuentes.length) {
    fallo(errores, "manifiesto", "lista de fuentes vacía");
    return manifiesto;
  }
  if (manifiesto.fuentes.length !== piezas.length) {
    fallo(errores, "manifiesto", `registra ${manifiesto.fuentes.length} fuentes para ${piezas.length} piezas`);
  }

  const rutas = new Set();
  const base = typeof manifiesto.material === "string" ? path.resolve(manifiesto.material) : "";
  manifiesto.fuentes.forEach((entrada, i) => {
    const id = `manifiesto.fuentes[${i}]`;
    const ruta = entrada && entrada.ruta;
    const huella = entrada && entrada.sha256;
    if (!ruta || typeof ruta !== "string" || path.isAbsolute(ruta) || ruta.includes("\\") || !ruta.endsWith(".md")) {
      fallo(errores, id, "ruta relativa inválida");
      return;
    }
    if (rutas.has(ruta)) fallo(errores, id, `ruta duplicada: ${ruta}`);
    rutas.add(ruta);
    if (!/^[a-f0-9]{64}$/.test(huella || "")) {
      fallo(errores, id, "SHA-256 inválido");
      return;
    }
    if (!base) {
      fallo(errores, id, "directorio material inválido");
      return;
    }
    const absoluta = path.resolve(base, ruta);
    if (!absoluta.startsWith(`${base}${path.sep}`)) {
      fallo(errores, id, "ruta sale del directorio material");
      return;
    }
    if (!fs.existsSync(absoluta)) {
      fallo(errores, id, `fuente ausente: ${ruta}`);
      return;
    }
    if (sha256(fs.readFileSync(absoluta)) !== huella) {
      fallo(errores, id, `fuente modificada desde el export: ${ruta}`);
    }
  });

  if (manifiesto.fuentes_sha256 !== fingerprintFuentes(manifiesto.fuentes)) {
    fallo(errores, "manifiesto", "fingerprint agregado de fuentes no coincide");
  }
  return manifiesto;
}

function validarPieza(p, errores, avisos, vistos) {
  const id = p.codigo || "(sin codigo)";
  if (!p.codigo || !CODIGO_VALIDO.test(p.codigo)) fallo(errores, id, "codigo inválido");
  if (vistos.has(p.codigo)) fallo(errores, id, "codigo duplicado");
  vistos.add(p.codigo);
  if (!TIPOS.includes(p.tipo)) fallo(errores, id, `tipo desconocido: ${p.tipo}`);
  if (!p.titulo || typeof p.titulo !== "string") fallo(errores, id, "titulo vacío");
  if (!(p.orden >= 0)) fallo(errores, id, "orden no es un número");
  if (!Array.isArray(p.secciones) || !p.secciones.length) fallo(errores, id, "sin secciones");

  const secciones = Array.isArray(p.secciones) ? p.secciones : [];
  const idsVistos = new Set();
  secciones.forEach((s, i) => {
    if (!s || !s.id || !/^[a-z0-9-]{1,80}$/.test(s.id)) fallo(errores, id, `seccion[${i}]: id inválido`);
    if (!s || !s.titulo) fallo(errores, id, `seccion[${i}]: sin titulo`);
    if (!s || !s.html || s.html.length < 20) fallo(errores, id, `seccion[${i}]: html vacío`);
    if (s && idsVistos.has(s.id)) fallo(errores, id, `seccion[${i}]: id ${s.id} repetido`);
    if (s && SECCION_INTERNA.test(s.id || "")) fallo(errores, id, `seccion[${i}]: nota editorial interna en artefacto de alumno`);
    if (s && CONTENIDO_EDITORIAL_INTERNO.test(`${s.titulo || ""} ${s.html || ""}`)) {
      fallo(errores, id, `seccion[${i}]: contenido editorial interno en artefacto de alumno`);
    }
    if (s && s.id) idsVistos.add(s.id);
  });

  const texto = [p.titulo, ...secciones.map((s) => `${(s && s.titulo) || ""} ${(s && s.html) || ""}`)].join(" ");
  if (texto.includes("—")) fallo(errores, id, "em dash (—) en la pieza");
  if (PROHIBIDAS.test(texto)) fallo(errores, id, "palabra prohibida de marca");
  if (NO_PENINSULAR.test(texto)) fallo(errores, id, "marcador no peninsular");

  const meta = p.meta || {};
  if (String(meta.lupa || "").toUpperCase() === "FAIL") fallo(errores, id, "lupa en FAIL, no se sube");
  if (!meta.lupa) avisos.push(`${id}: sin marca de La Lupa`);
  // La B1 lleva la QA sistémica/técnica aceptada; el recorrido desde cero solo
  // sube una pieza cuando ha pasado sus seis pasadas. Ningún otro estado se sube.
  const QA_ACEPTADA = ["SISTEMICA_TECNICA_ACEPTADA", "SISTEMICA_6_PASADAS"];
  if (!QA_ACEPTADA.includes(meta.qa_lengua)
      || meta.qa_lengua_alcance !== "NO_FIRMA_HUMANA_NATIVA") {
    fallo(errores, id, `QA de lengua sin cerrar (${meta.qa_lengua || "sin estado"}): no se sube`);
  }
  if (p.tipo === "leccion" && (!Array.isArray(meta.ejercicios) || !meta.ejercicios.length)) fallo(errores, id, "lección sin ejercicios");
  if (Object.prototype.hasOwnProperty.call(meta, "revision_nativa")) {
    fallo(errores, id, "metadato legacy revision_nativa no permitido en artefacto de alumno");
  }
  if (!(p.palabras > 0)) avisos.push(`${id}: sin recuento de palabras`);
}

function comprobarEntorno() {
  const faltan = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY"].filter((v) => !process.env[v]);
  if (faltan.length) {
    console.error(`Faltan variables de entorno: ${faltan.join(", ")}. Se leen del entorno, no de ningún archivo del repo.`);
    process.exit(1);
  }
}

async function subir(tabla, filas, onConflict) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const r = await fetch(`${url}/rest/v1/${tabla}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(filas),
  });
  if (!r.ok) throw new Error(`Supabase ${tabla} ${r.status}: ${await r.text()}`);
}

// ---------- main ----------

if (!fs.existsSync(CURSO)) {
  console.error(`No existe ${CURSO}. Exporta antes el material del Drive: node scripts/norsk_curso_export.mjs --ruta=${RUTA}`);
  process.exit(1);
}

const cursoTexto = fs.readFileSync(CURSO, "utf8");
const bruto = JSON.parse(cursoTexto);
const piezas = Array.isArray(bruto) ? bruto : bruto.piezas || [];

const errores = [];
const avisos = [];
const vistos = new Set();
const manifiesto = validarManifiesto(cursoTexto, piezas, errores);
piezas.forEach((p) => validarPieza(p, errores, avisos, vistos));

const porTipo = {};
piezas.forEach((p) => { porTipo[p.tipo] = (porTipo[p.tipo] || 0) + 1; });
const palabras = piezas.reduce((n, p) => n + (p.palabras || 0), 0);
const secciones = piezas.reduce((n, p) => n + ((p.secciones || []).length), 0);

console.log(`Curso: ${piezas.length} piezas (${Object.entries(porTipo).map(([t, n]) => `${t} ${n}`).join(" · ") || "ninguna"})`);
console.log(`Secciones: ${secciones} · Palabras: ${palabras.toLocaleString("es-ES")}`);
if (manifiesto && manifiesto.fuentes_sha256) {
  console.log(`Fuentes SHA-256: ${manifiesto.fuentes_sha256} · Curso SHA-256: ${manifiesto.curso_sha256}`);
}
if (avisos.length) console.log(`\nAVISOS (${avisos.length}):\n- ${avisos.join("\n- ")}`);
if (errores.length) {
  console.error(`\nERRORES (${errores.length}), no se sube nada:\n- ${errores.join("\n- ")}`);
  process.exit(1);
}
if (!piezas.length) {
  console.error("\nERRORES (1), no se sube nada:\n- el curso exportado está vacío");
  process.exit(1);
}

const filas = piezas.map((p) => ({
  ruta: RUTA,
  codigo: p.codigo,
  tipo: p.tipo,
  titulo: p.titulo,
  orden: p.orden,
  meta: p.meta || {},
  secciones: p.secciones,
  palabras: p.palabras || null,
  activa: true,
  updated_at: new Date().toISOString(),
}));

if (DRY) {
  console.log(`\n--dry: validación OK. Subiría ${filas.length} piezas a norsk_curso (ruta ${RUTA}):`);
  filas.forEach((f) => console.log(`  ${f.codigo} · ${f.tipo} · orden ${f.orden} · ${f.secciones.length} secciones · ${f.palabras || 0} palabras`));
  console.log("No se ha tocado Supabase.");
  process.exit(0);
}

comprobarEntorno();

await subir("norsk_curso", filas, "ruta,codigo");
console.log(`\nSubidas ${filas.length} piezas a norsk_curso.`);

// Desactivar lo retirado: cualquier pieza activa en Supabase que ya no esté en el
// export del Drive deja de servirse. El endpoint filtra siempre por activa.
{
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const canonicos = new Set(filas.map((f) => f.codigo));
  const r = await fetch(`${url}/rest/v1/norsk_curso?select=codigo&ruta=eq.${encodeURIComponent(RUTA)}&activa=is.true&limit=10000`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!r.ok) throw new Error(`Supabase listar codigos ${r.status}: ${await r.text()}`);
  const enDb = await r.json();
  const huerfanas = enDb.map((x) => x.codigo).filter((c) => !canonicos.has(c));
  for (const codigo of huerfanas) {
    const p = await fetch(`${url}/rest/v1/norsk_curso?ruta=eq.${encodeURIComponent(RUTA)}&codigo=eq.${encodeURIComponent(codigo)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}`, Prefer: "return=minimal" },
      body: JSON.stringify({ activa: false, updated_at: new Date().toISOString() }),
    });
    if (!p.ok) throw new Error(`Supabase desactivar ${codigo} ${p.status}: ${await p.text()}`);
  }
  console.log(huerfanas.length
    ? `Desactivadas ${huerfanas.length} piezas retiradas: ${huerfanas.join(", ")}`
    : "Sin piezas retiradas que desactivar.");
}
