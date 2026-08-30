// Valida el curso Norskprøven B1 exportado del Drive y lo sube a Supabase.
// Uso:  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/norsk_curso_build.mjs [--dry]
//
// Entrada (GITIGNORED, el repo es público y el curso es contenido de pago):
//   scripts/_norsk_curso/curso.json  <- lo genera scripts/norsk_curso_export.mjs
//
// La demo pública no se sube: vive en data/norsk-curso-demo.json y la sirve el
// estático. Aquí solo viaja lo que hay detrás del muro.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CURSO = path.join(ROOT, "scripts", "_norsk_curso", "curso.json");
const DRY = process.argv.includes("--dry");

const CODIGO_VALIDO = /^[A-Z0-9_-]{3,40}$/;
const TIPOS = ["diagnostico", "mecanismo", "lytt", "les", "skriv", "muntlig", "simulacro"];
const PROHIBIDAS = /increíble|brutal|paraíso|trucos|hola chicos/i;
const NO_PENINSULAR = /\b(celular|manejar|acá|computadora|plata|carro)\b/i;

function fallo(errores, id, msg) {
  errores.push(`${id}: ${msg}`);
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
    if (s && s.id) idsVistos.add(s.id);
  });

  const texto = [p.titulo, ...secciones.map((s) => `${(s && s.titulo) || ""} ${(s && s.html) || ""}`)].join(" ");
  if (texto.includes("—")) fallo(errores, id, "em dash (—) en la pieza");
  if (PROHIBIDAS.test(texto)) fallo(errores, id, "palabra prohibida de marca");
  if (NO_PENINSULAR.test(texto)) fallo(errores, id, "marcador no peninsular");

  const meta = p.meta || {};
  if (String(meta.lupa || "").toUpperCase() === "FAIL") fallo(errores, id, "lupa en FAIL, no se sube");
  if (!meta.lupa) avisos.push(`${id}: sin marca de La Lupa`);
  if (String(meta.revision_nativa || "").toUpperCase() === "PENDIENTE") {
    avisos.push(`${id}: revisión nativa pendiente`);
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
  console.error(`No existe ${CURSO}. Exporta antes el material del Drive: node scripts/norsk_curso_export.mjs`);
  process.exit(1);
}

const bruto = JSON.parse(fs.readFileSync(CURSO, "utf8"));
const piezas = Array.isArray(bruto) ? bruto : bruto.piezas || [];

const errores = [];
const avisos = [];
const vistos = new Set();
piezas.forEach((p) => validarPieza(p, errores, avisos, vistos));

const porTipo = {};
piezas.forEach((p) => { porTipo[p.tipo] = (porTipo[p.tipo] || 0) + 1; });
const palabras = piezas.reduce((n, p) => n + (p.palabras || 0), 0);
const secciones = piezas.reduce((n, p) => n + ((p.secciones || []).length), 0);

console.log(`Curso: ${piezas.length} piezas (${Object.entries(porTipo).map(([t, n]) => `${t} ${n}`).join(" · ") || "ninguna"})`);
console.log(`Secciones: ${secciones} · Palabras: ${palabras.toLocaleString("es-ES")}`);
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
  console.log(`\n--dry: validación OK. Subiría ${filas.length} piezas a norsk_curso:`);
  filas.forEach((f) => console.log(`  ${f.codigo} · ${f.tipo} · orden ${f.orden} · ${f.secciones.length} secciones · ${f.palabras || 0} palabras`));
  console.log("No se ha tocado Supabase.");
  process.exit(0);
}

comprobarEntorno();

await subir("norsk_curso", filas, "codigo");
console.log(`\nSubidas ${filas.length} piezas a norsk_curso.`);

// Desactivar lo retirado: cualquier pieza activa en Supabase que ya no esté en el
// export del Drive deja de servirse. El endpoint filtra siempre por activa.
{
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const canonicos = new Set(filas.map((f) => f.codigo));
  const r = await fetch(`${url}/rest/v1/norsk_curso?select=codigo&activa=is.true&limit=10000`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!r.ok) throw new Error(`Supabase listar codigos ${r.status}: ${await r.text()}`);
  const enDb = await r.json();
  const huerfanas = enDb.map((x) => x.codigo).filter((c) => !canonicos.has(c));
  for (const codigo of huerfanas) {
    const p = await fetch(`${url}/rest/v1/norsk_curso?codigo=eq.${encodeURIComponent(codigo)}`, {
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
