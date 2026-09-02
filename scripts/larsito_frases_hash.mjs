// Herramienta historica del TTS remoto retirado de la demo. Regenera el inventario
// de hashes que se conserva en server/archive/larsito-frases.mjs solo como trazabilidad. Ni la
// demo actual ni /api/larsito-tts.js importan esa lista: el endpoint del producto
// completo exige siempre cookie y compra. No forma parte del build ni del guard.
//
//   node scripts/larsito_frases_hash.mjs

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const demo = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "larsito-demo.json"), "utf8"));

// Normalizacion del inventario historico.
const normalizar = (t) => String(t || "").trim().replace(/\s+/g, " ");

const frases = [];
for (const esc of demo.escenarios || []) {
  for (const turno of esc.turnos || []) {
    if (turno.larsito_no) frases.push(turno.larsito_no);
    for (const m of turno.respuestas_modelo_no || []) frases.push(m);
    // Los bloques sugeridos tambien se pueden escuchar desde su chip.
    for (const b of turno.bloques_no || []) frases.push(b);
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
  "// ARTEFACTO HISTORICO del TTS remoto que usaba la demo.",
  "// La demo actual no importa esta lista ni llama a /api/larsito-tts/. El endpoint",
  "// del producto completo exige siempre cookie y compra; el guard de pre-lanzamiento",
  "// falla si FRASES_DEMO vuelve a entrar en esa ruta. Se conserva solo como trazabilidad.",
  "",
  "export const FRASES_DEMO = new Set([",
  ...hashes.map((h) => `  "${h}",`),
  "]);",
  "",
].join("\n");

fs.writeFileSync(path.join(ROOT, "server", "archive", "larsito-frases.mjs"), salida);
console.log(`${frases.length} frases de la demo, ${hashes.length} hashes únicos -> server/archive/larsito-frases.mjs`);
