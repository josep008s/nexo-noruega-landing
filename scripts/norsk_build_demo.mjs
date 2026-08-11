// Genera data/norsk-demo.json (el ÚNICO artefacto público del banco):
// las preguntas marcadas demo:true + la lección pública (L0).
// Uso:  node scripts/norsk_build_demo.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BANCO = path.join(ROOT, "scripts", "_norsk_banco", "banco.json");
const LECCIONES = path.join(ROOT, "scripts", "_norsk_banco", "lecciones.json");
const SALIDA = path.join(ROOT, "data", "norsk-demo.json");

if (!fs.existsSync(BANCO)) {
  console.error(`No existe ${BANCO}. Exporta el banco canónico del Drive (ver pass/PASS_SETUP.md).`);
  process.exit(1);
}

const banco = JSON.parse(fs.readFileSync(BANCO, "utf8"));
const preguntas = (banco.preguntas || banco).filter((p) => p.demo === true && (p.estado || "verificada") === "verificada");

const lecciones = fs.existsSync(LECCIONES) ? JSON.parse(fs.readFileSync(LECCIONES, "utf8")).lecciones || [] : [];
const publica = lecciones.find((l) => l.publica);

if (preguntas.length < 10) {
  console.error(`Solo ${preguntas.length} preguntas demo verificadas; se esperaban 12.`);
  process.exit(1);
}

// Validación del artefacto PÚBLICO: la demo es el escaparate, nada roto sale de aquí.
const PROHIBIDAS = /increíble|brutal|paraíso|trucos|hola chicos/i;
const NO_PENINSULAR = /\b(celular|manejar|acá|computadora|plata|carro)\b/i;
const errores = [];
for (const p of preguntas) {
  const id = p.codigo || "(sin codigo)";
  if (!Array.isArray(p.opciones_no) || p.opciones_no.length !== 3 ||
      !Array.isArray(p.opciones_es) || p.opciones_es.length !== 3) errores.push(`${id}: opciones != 3`);
  if (![0, 1, 2].includes(p.correcta)) errores.push(`${id}: correcta inválida`);
  if (!p.pregunta_no || !p.pregunta_es || !p.explicacion_es) errores.push(`${id}: campos vacíos`);
  const es = [p.pregunta_es, p.explicacion_es, ...(p.opciones_es || [])].join(" ");
  if (es.includes("—")) errores.push(`${id}: em dash`);
  if (PROHIBIDAS.test(es)) errores.push(`${id}: palabra prohibida`);
  if (NO_PENINSULAR.test(es)) errores.push(`${id}: no peninsular`);
}
if (publica) {
  const esL = [publica.titulo, publica.resumen, publica.cuerpo_html,
    ...(publica.vocab || []).map((v) => `${v.es || ""} ${v.frase_a2 || ""}`)].join(" ");
  if (esL.includes("—")) errores.push("leccion0: em dash");
  if (PROHIBIDAS.test(esL)) errores.push("leccion0: palabra prohibida");
  if ((publica.vocab || []).some((v) => !v.no || !v.es)) errores.push("leccion0: vocab incompleto");
}
if (errores.length) {
  console.error(`ERRORES en la demo (no se escribe nada):\n- ${errores.join("\n- ")}`);
  process.exit(1);
}

const salida = {
  meta: {
    producto: "NEXO PASS",
    actualizado: new Date().toISOString().slice(0, 10),
    fuente_temario: "Forskrift om læreplan i samfunnskunnskap for voksne innvandrere (FOR-2021-06-20-2054)",
    mecanica: {
      statsborger: { total: 36, puntuables: 32, aprobado: 24, minutos: 60, idioma: "solo noruego (bokmål/nynorsk)" },
      samfunns: { total: 38, puntuables: 34, aprobado: 26, minutos: 60, idioma: "23 idiomas, incluido español" },
    },
  },
  preguntas: preguntas.map((p) => ({
    codigo: p.codigo, modulo: p.modulo, leccion: p.leccion, tema: p.tema,
    pregunta_no: p.pregunta_no, pregunta_es: p.pregunta_es,
    opciones_no: p.opciones_no, opciones_es: p.opciones_es,
    correcta: p.correcta, explicacion_es: p.explicacion_es,
    fuente: p.fuente, nivel: p.nivel,
  })),
  leccion0: publica ? {
    slug: publica.slug, titulo: publica.titulo, resumen: publica.resumen,
    cuerpo_html: publica.cuerpo_html, vocab: publica.vocab || [],
  } : null,
};

fs.writeFileSync(SALIDA, JSON.stringify(salida, null, 1));
console.log(`Escrito ${SALIDA}: ${salida.preguntas.length} preguntas demo${publica ? " + Lección 0" : " (SIN Lección 0)"}.`);
