// Regenera api/_larsito_frases.js: la lista blanca de frases de la demo de Larsito
// que /api/larsito-tts/ sirve sin cookie. Lee data/larsito-demo.json, junta todas
// las frases noruegas que la demo puede reproducir (larsito_no y respuestas modelo
// de cada turno, y el transcript_no de cada ejercicio de escucha), las normaliza
// igual que el endpoint (trim + espacios colapsados) y escribe el SHA-256 de cada
// una. Ejecutar cada vez que cambie el JSON de la demo:
//
//   node scripts/larsito_frases_hash.mjs

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const demo = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "larsito-demo.json"), "utf8"));

// MISMA normalización que api/larsito-tts.js. Si cambia allí, cambia aquí.
const normalizar = (t) => String(t || "").trim().replace(/\s+/g, " ");

const frases = [];
for (const esc of demo.escenarios || []) {
  for (const turno of esc.turnos || []) {
    if (turno.larsito_no) frases.push(turno.larsito_no);
    for (const m of turno.respuestas_modelo_no || []) frases.push(m);
  }
}
for (const ej of demo.listening || []) {
  if (ej.transcript_no) frases.push(ej.transcript_no);
}

if (!frases.length) {
  console.error("larsito_frases_hash: no se ha encontrado ninguna frase en data/larsito-demo.json");
  process.exit(1);
}

const hashes = [...new Set(frases.map((f) =>
  crypto.createHash("sha256").update(normalizar(f), "utf8").digest("hex")))];

const salida = [
  "// GENERADO por scripts/larsito_frases_hash.mjs a partir de data/larsito-demo.json.",
  "// No editar a mano: si cambia la demo, regenerar con `node scripts/larsito_frases_hash.mjs`.",
  "// Son hashes SHA-256 de frases ya públicas (la demo se sirve sin login), así que",
  "// pueden vivir en el repo sin problema. /api/larsito-tts/ sirve estas frases sin",
  "// cookie; cualquier otro texto exige compra activa.",
  "",
  "export const FRASES_DEMO = new Set([",
  ...hashes.map((h) => `  "${h}",`),
  "]);",
  "",
].join("\n");

fs.writeFileSync(path.join(ROOT, "api", "_larsito_frases.js"), salida);
console.log(`${frases.length} frases de la demo, ${hashes.length} hashes únicos -> api/_larsito_frases.js`);
