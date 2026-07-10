// Valida el banco canónico de NEXO NORSK y lo sube a Supabase.
// Uso:  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/norsk_build_banco.mjs [--dry]
//
// Entrada (GITIGNORED, el repo es público y el banco es contenido de pago):
//   scripts/_norsk_banco/banco.json      <- export del canónico BANCO_PREGUNTAS_NORSK_v1.xlsx (Drive)
//   scripts/_norsk_banco/lecciones.json  <- export de norsk/curso/ (Drive)
//
// El export desde el Drive se hace con el runbook de norsk/NORSK_SETUP.md.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BANCO = path.join(ROOT, "scripts", "_norsk_banco", "banco.json");
const LECCIONES = path.join(ROOT, "scripts", "_norsk_banco", "lecciones.json");
const DRY = process.argv.includes("--dry");

const PROHIBIDAS = /increíble|brutal|paraíso|trucos|hola chicos/i;
const NO_PENINSULAR = /\b(celular|manejar|acá|computadora|plata|carro)\b/i;

function fallo(errores, id, msg) {
  errores.push(`${id}: ${msg}`);
}

function validarPregunta(p, errores, avisos, vistos) {
  const id = p.codigo || "(sin codigo)";
  if (!p.codigo || !/^[A-Z0-9-]{4,32}$/.test(p.codigo)) fallo(errores, id, "codigo inválido");
  if (vistos.has(p.codigo)) fallo(errores, id, "codigo duplicado");
  vistos.add(p.codigo);
  if (![1, 2, 3].includes(p.modulo)) fallo(errores, id, "modulo fuera de 1-3");
  if (!(p.leccion >= 0 && p.leccion <= 12)) fallo(errores, id, "leccion fuera de 0-12");
  if (!p.tema) fallo(errores, id, "tema vacío");
  if (!p.pregunta_no || !p.pregunta_es) fallo(errores, id, "falta pregunta en un idioma");
  for (const campo of ["opciones_no", "opciones_es"]) {
    if (!Array.isArray(p[campo]) || p[campo].length !== 3 || p[campo].some((o) => !o || typeof o !== "string")) {
      fallo(errores, id, `${campo}: deben ser exactamente 3 opciones no vacías`);
    }
  }
  if (![0, 1, 2].includes(p.correcta)) fallo(errores, id, "correcta debe ser 0, 1 o 2");
  if (!p.explicacion_es || p.explicacion_es.length < 40) fallo(errores, id, "explicacion_es vacía o demasiado corta");
  if (!p.fuente || !/https?:\/\//.test(p.fuente)) fallo(errores, id, "fuente sin URL oficial");
  if (![1, 2, 3].includes(p.nivel)) fallo(errores, id, "nivel fuera de 1-3");

  const espanol = [p.pregunta_es, p.explicacion_es, ...(p.opciones_es || [])].join(" ");
  if (espanol.includes("—")) fallo(errores, id, "em dash (—) en el español");
  if (PROHIBIDAS.test(espanol)) fallo(errores, id, "palabra prohibida de marca en el español");
  if (NO_PENINSULAR.test(espanol)) fallo(errores, id, "marcador no peninsular en el español");

  // A2: aviso (no bloqueo) si el noruego se alarga; la calidad fina la da La Lupa + muestreo humano.
  const frases = (p.pregunta_no || "").split(/[.!?]/).filter((f) => f.trim());
  if (frases.some((f) => f.trim().split(/\s+/).length > 15)) {
    avisos.push(`${id}: frase noruega de más de 15 palabras (revisar A2)`);
  }
  if ((p.pregunta_no || "").length > 160) avisos.push(`${id}: pregunta_no de más de 160 caracteres`);
}

function validarLeccion(l, errores, vistos) {
  const id = l.slug || "(sin slug)";
  if (!l.slug || !/^[a-z0-9-]{2,60}$/.test(l.slug)) fallo(errores, id, "slug inválido");
  if (vistos.has(l.slug)) fallo(errores, id, "slug duplicado");
  vistos.add(l.slug);
  if (!(l.orden >= 0 && l.orden <= 12)) fallo(errores, id, "orden fuera de 0-12");
  if (![1, 2, 3].includes(l.modulo) && l.orden !== 0) fallo(errores, id, "modulo fuera de 1-3");
  if (!l.titulo || !l.resumen || !l.cuerpo_html) fallo(errores, id, "faltan titulo/resumen/cuerpo_html");

  // vocab: estructura {no, es[, frase_a2]} y marca en la parte en español
  if (l.vocab !== undefined && !Array.isArray(l.vocab)) fallo(errores, id, "vocab no es un array");
  const vocab = Array.isArray(l.vocab) ? l.vocab : [];
  vocab.forEach((v, i) => {
    if (!v || typeof v.no !== "string" || !v.no.trim() || typeof v.es !== "string" || !v.es.trim()) {
      fallo(errores, id, `vocab[${i}]: falta 'no' o 'es'`);
    }
    if (v && v.frase_a2 !== undefined && typeof v.frase_a2 !== "string") {
      fallo(errores, id, `vocab[${i}]: frase_a2 no es texto`);
    }
  });
  const vocabEs = vocab.map((v) => `${(v && v.es) || ""} ${(v && v.frase_a2) || ""}`).join(" ");

  const texto = [l.titulo, l.resumen, l.cuerpo_html, vocabEs].join(" ");
  if (texto.includes("—")) fallo(errores, id, "em dash (—) en la lección");
  if (PROHIBIDAS.test(texto)) fallo(errores, id, "palabra prohibida de marca");
  if (NO_PENINSULAR.test(texto)) fallo(errores, id, "marcador no peninsular");
}

async function subir(tabla, filas, onConflict) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY");
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

if (!fs.existsSync(BANCO)) {
  console.error(`No existe ${BANCO}. Exporta el banco canónico del Drive (ver norsk/NORSK_SETUP.md).`);
  process.exit(1);
}

const banco = JSON.parse(fs.readFileSync(BANCO, "utf8"));
const preguntas = banco.preguntas || banco;
const lecciones = fs.existsSync(LECCIONES) ? JSON.parse(fs.readFileSync(LECCIONES, "utf8")).lecciones || [] : [];

const errores = [];
const avisos = [];
const codigosVistos = new Set();
const slugsVistos = new Set();

const verificadas = preguntas.filter((p) => (p.estado || "verificada") === "verificada");
verificadas.forEach((p) => validarPregunta(p, errores, avisos, codigosVistos));
lecciones.forEach((l) => validarLeccion(l, errores, slugsVistos));

const porModulo = { 1: 0, 2: 0, 3: 0 };
verificadas.forEach((p) => { porModulo[p.modulo] = (porModulo[p.modulo] || 0) + 1; });

console.log(`Banco: ${preguntas.length} preguntas en el canónico, ${verificadas.length} verificadas (M1 ${porModulo[1]} · M2 ${porModulo[2]} · M3 ${porModulo[3]})`);
console.log(`Lecciones: ${lecciones.length}`);
if (avisos.length) console.log(`\nAVISOS (${avisos.length}):\n- ${avisos.join("\n- ")}`);
if (errores.length) {
  console.error(`\nERRORES (${errores.length}):\n- ${errores.join("\n- ")}`);
  process.exit(1);
}

if (DRY) { console.log("\n--dry: validación OK, no se sube nada."); process.exit(0); }

const filas = verificadas.map((p) => ({
  codigo: p.codigo, modulo: p.modulo, leccion: p.leccion, tema: p.tema,
  pregunta_no: p.pregunta_no, pregunta_es: p.pregunta_es,
  opciones_no: p.opciones_no, opciones_es: p.opciones_es,
  correcta: p.correcta, explicacion_es: p.explicacion_es,
  fuente: p.fuente, nivel: p.nivel, activa: true,
  updated_at: new Date().toISOString(),
}));

await subir("norsk_preguntas", filas, "codigo");
console.log(`Subidas ${filas.length} preguntas a norsk_preguntas.`);

// Desactivar lo retirado: cualquier pregunta activa en Supabase que ya no esté
// "verificada" en el canónico deja de servirse (norsk_muestra filtra por activa).
{
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const canonicos = new Set(filas.map((f) => f.codigo));
  const r = await fetch(`${url}/rest/v1/norsk_preguntas?select=codigo&activa=is.true&limit=10000`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!r.ok) throw new Error(`Supabase listar codigos ${r.status}: ${await r.text()}`);
  const enDb = await r.json();
  const huerfanas = enDb.map((x) => x.codigo).filter((c) => !canonicos.has(c));
  for (const codigo of huerfanas) {
    const p = await fetch(`${url}/rest/v1/norsk_preguntas?codigo=eq.${encodeURIComponent(codigo)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}`, Prefer: "return=minimal" },
      body: JSON.stringify({ activa: false, updated_at: new Date().toISOString() }),
    });
    if (!p.ok) throw new Error(`Supabase desactivar ${codigo} ${p.status}: ${await p.text()}`);
  }
  console.log(huerfanas.length
    ? `Desactivadas ${huerfanas.length} preguntas retiradas: ${huerfanas.join(", ")}`
    : "Sin preguntas retiradas que desactivar.");
}

if (lecciones.length) {
  await subir("norsk_lecciones", lecciones.map((l) => ({
    slug: l.slug, orden: l.orden, modulo: l.modulo || 1, titulo: l.titulo,
    resumen: l.resumen, cuerpo_html: l.cuerpo_html, vocab: l.vocab || [],
    publica: !!l.publica, updated_at: new Date().toISOString(),
  })), "slug");
  console.log(`Subidas ${lecciones.length} lecciones a norsk_lecciones.`);
}
