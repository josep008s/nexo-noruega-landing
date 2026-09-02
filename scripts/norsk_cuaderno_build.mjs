#!/usr/bin/env node
// Sube el Cuaderno de la Ruta Norskprøven B1 (seis PDF) al bucket privado norsk-cuaderno
// y deja escrito el manifiesto con la huella de cada tomo.
//
// Uso:  node scripts/norsk_cuaderno_build.mjs --dry   (valida los PDF y escribe data/norsk-cuaderno.json; no sube)
//       node scripts/norsk_cuaderno_build.mjs         (además crea el bucket si falta y sube los seis tomos)
//
// Los PDF se copian antes del Drive a scripts/_norsk_cuaderno/ (gitignored: son contenido de pago y el repo es público).
// Necesita SUPABASE_URL y SUPABASE_SERVICE_KEY en el entorno para subir.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGEN = path.join(ROOT, "scripts", "_norsk_cuaderno");
const PUBLICO = path.join(ROOT, "data", "norsk-cuaderno.json");
const BUCKET = "norsk-cuaderno";
const DRY = process.argv.includes("--dry");

const TOMOS = [
  { n: 1, archivo: "NEXO-NORSK_Cuaderno-B1_Tomo-1_Los-16-mecanismos-primera-parte.pdf", titulo: "Los 16 mecanismos, primera parte", que: "Punto de partida y mecanismos M01 a M08" },
  { n: 2, archivo: "NEXO-NORSK_Cuaderno-B1_Tomo-2_Los-16-mecanismos-segunda-parte.pdf", titulo: "Los 16 mecanismos, segunda parte", que: "Mecanismos M09 a M16" },
  { n: 3, archivo: "NEXO-NORSK_Cuaderno-B1_Tomo-3_Hablar.pdf", titulo: "Hablar", que: "Entrenamiento oral: 21 actuaciones y banco de consignas" },
  { n: 4, archivo: "NEXO-NORSK_Cuaderno-B1_Tomo-4_Escuchar-y-leer.pdf", titulo: "Escuchar y leer", que: "Escucha y lectura, con las claves aparte" },
  { n: 5, archivo: "NEXO-NORSK_Cuaderno-B1_Tomo-5_Escribir.pdf", titulo: "Escribir", que: "Expresión escrita y banco de expresiones" },
  { n: 6, archivo: "NEXO-NORSK_Cuaderno-B1_Tomo-6_Simulacros.pdf", titulo: "Simulacros", que: "Por ordenador y oral, con soluciones" },
];

function paginasPdf(ruta, buf) {
  // Con poppler instalado, pdfinfo es exacto; si no, se cuenta por el árbol de páginas
  // (los PDF de WeasyPrint comprimen los objetos, así que el recuento puede no estar a la vista).
  try { const out = execFileSync("pdfinfo", [ruta], { encoding: "utf8" }); const m = out.match(/Pages:\s+(\d+)/); if (m) return Number(m[1]); } catch (e) { /* sin poppler */ }
  const m = buf.toString("latin1").match(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/);
  return m ? Number(m[1]) : null;
}

const manifiesto = { bucket: BUCKET, fecha: new Date().toISOString().slice(0, 10), tomos: [] };
const publico = { version: 1, actualizado: manifiesto.fecha, tomos: [] };
let fallos = 0;
for (const t of TOMOS) {
  const ruta = path.join(ORIGEN, t.archivo);
  if (!fs.existsSync(ruta)) { console.error(`FALTA ${t.archivo} en scripts/_norsk_cuaderno/`); fallos++; continue; }
  const buf = fs.readFileSync(ruta);
  if (buf.subarray(0, 5).toString() !== "%PDF-") { console.error(`${t.archivo} no es un PDF`); fallos++; continue; }
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const paginas = paginasPdf(ruta, buf);
  if (paginas !== null && paginas < 20) { console.error(`${t.archivo}: recuento de páginas raro (${paginas})`); fallos++; }
  manifiesto.tomos.push({ n: t.n, archivo: t.archivo, bytes: buf.length, paginas, sha256 });
  publico.tomos.push({ n: t.n, titulo: t.titulo, que: t.que, paginas, mb: Math.round(buf.length / 1048576 * 10) / 10 });
  console.log(`Tomo ${t.n}: ${paginas} páginas · ${(buf.length / 1048576).toFixed(1)} MB · ${sha256.slice(0, 12)}`);
}
if (fallos) { console.error(`\n${fallos} problema(s). No se escribe nada.`); process.exit(1); }

fs.writeFileSync(path.join(ORIGEN, "manifiesto.json"), JSON.stringify(manifiesto, null, 2));
fs.writeFileSync(PUBLICO, JSON.stringify(publico, null, 2) + "\n");
console.log(`\nManifiesto en scripts/_norsk_cuaderno/manifiesto.json · metadatos públicos en data/norsk-cuaderno.json (sin nombres de archivo).`);
if (DRY) { console.log("--dry: validación OK, no se sube nada."); process.exit(0); }

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) { console.error("Faltan SUPABASE_URL y SUPABASE_SERVICE_KEY. Usa --dry para validar sin subir."); process.exit(1); }
const cab = { apikey: key, Authorization: `Bearer ${key}` };

// Bucket privado (si ya existe, Supabase responde 409 y seguimos).
const rb = await fetch(`${url}/storage/v1/bucket`, { method: "POST", headers: { ...cab, "Content-Type": "application/json" },
  body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: 20 * 1048576, allowed_mime_types: ["application/pdf"] }) });
if (!rb.ok && rb.status !== 409) throw new Error(`bucket ${rb.status}: ${await rb.text()}`);
console.log(rb.status === 409 ? `Bucket ${BUCKET} ya existía.` : `Bucket ${BUCKET} creado (privado).`);

for (const t of manifiesto.tomos) {
  const r = await fetch(`${url}/storage/v1/object/${BUCKET}/${encodeURIComponent(t.archivo)}`, {
    method: "POST", headers: { ...cab, "Content-Type": "application/pdf", "x-upsert": "true" },
    body: fs.readFileSync(path.join(ORIGEN, t.archivo)),
  });
  if (!r.ok) throw new Error(`subida ${t.archivo} ${r.status}: ${await r.text()}`);
  console.log(`Subido tomo ${t.n}.`);
}
console.log("\nCuaderno subido. La descarga la sirve api/norsk-cuaderno.js con URL firmada de 15 minutos.");
