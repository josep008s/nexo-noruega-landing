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
  console.error(`No existe ${BANCO}. Exporta el banco canónico del Drive (ver norsk/NORSK_SETUP.md).`);
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

const salida = {
  meta: {
    producto: "NEXO NORSK",
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
