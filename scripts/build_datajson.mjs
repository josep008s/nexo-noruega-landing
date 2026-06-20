// Ensambla data/data.json a partir de:
//   scripts/_ssb_raw.json        (salarios SSB 11418, 4 dígitos)
//   scripts/_tr_batch{1..9}.json (traducciones + alias español)
//   scripts/_fiscal_params.json  (constantes fiscales 2026 verificadas)
//
//   node scripts/build_datajson.mjs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const repo = join(__dir, "..");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));

const CATEGORIAS = {
  "0": "Fuerzas armadas",
  "1": "Dirección y gerencia",
  "2": "Profesiones científicas e intelectuales",
  "3": "Técnicos y profesionales de nivel medio",
  "4": "Apoyo administrativo",
  "5": "Servicios y ventas",
  "6": "Agricultura, silvicultura y pesca",
  "7": "Oficios y artesanía",
  "8": "Operadores de máquinas y montaje",
  "9": "Ocupaciones elementales",
};

// Oficios "cajón de sastre" del SSB que no representan una profesión consultable
const DROP = new Set(["0000"]);

function normAlias(a) {
  return a
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function main() {
  const raw = read(join(__dir, "_ssb_raw.json"));

  const tr = new Map();
  for (let n = 1; n <= 9; n++) {
    const p = join(__dir, `_tr_batch${n}.json`);
    if (!existsSync(p)) continue;
    for (const o of read(p)) if (!tr.has(o.styrk)) tr.set(o.styrk, o);
  }

  const fiscalPath = join(__dir, "_fiscal_params.json");
  if (!existsSync(fiscalPath)) {
    console.error("FALTA scripts/_fiscal_params.json (parámetros fiscales 2026 verificados).");
    process.exit(1);
  }
  const fiscal = read(fiscalPath);

  const oficios = [];
  const sinTrad = [];
  for (const r of raw) {
    if (DROP.has(r.styrk)) continue;
    const t = tr.get(r.styrk);
    if (!t) {
      sinTrad.push(r.styrk);
      continue;
    }
    const alias = [...new Set([normAlias(t.nombre_es), ...t.alias_es.map(normAlias)])].filter(Boolean);
    oficios.push({
      styrk: r.styrk,
      grupo: r.grupo,
      nombre_no: r.nombre_no,
      nombre_es: t.nombre_es,
      alias_es: alias,
      salario: {
        p25_mes: r.p25,
        mediana_mes: r.mediana,
        media_mes: r.media,
        p75_mes: r.p75,
      },
    });
  }

  // Correcciones ortográficas de nombre_es (tildes que faltaban en la traducción)
  const nfPath = join(__dir, "_nombre_es_fixes.json");
  if (existsSync(nfPath)) {
    const fixes = new Map(read(nfPath).map((f) => [f.styrk, f.nombre_es]));
    let nf = 0;
    for (const o of oficios) if (fixes.has(o.styrk)) { o.nombre_es = fixes.get(o.styrk); nf++; }
    console.log(`Correcciones de tildes en nombre_es: ${nf}`);
  }

  // Overlay de alias curados (match exacto = prioridad para coloquialismos)
  const ovPath = join(__dir, "_alias_overrides.json");
  if (existsSync(ovPath)) {
    const ov = read(ovPath);
    const byStyrk = new Map(oficios.map((o) => [o.styrk, o]));
    const huerfanas = [];
    for (const [styrk, extra] of Object.entries(ov)) {
      if (styrk.startsWith("_")) continue;
      const o = byStyrk.get(styrk);
      if (!o) {
        if (Array.isArray(extra) && extra.length) huerfanas.push(styrk);
        continue;
      }
      const set = new Set(o.alias_es);
      for (const a of extra) {
        const na = normAlias(a);
        if (na) set.add(na);
      }
      o.alias_es = [...set];
    }
    if (huerfanas.length) console.log("Overrides sin oficio (revisar):", huerfanas.join(", "));
  }

  oficios.sort((a, b) => a.nombre_es.localeCompare(b.nombre_es, "es"));

  const data = {
    meta: {
      fuente_sueldos: "SSB tabla 11418 (jornada completa, todos los sectores)",
      anio_datos: 2025,
      actualizado_ssb: "2026-02-05",
      fuente_fiscal: "Skatteetaten 2026",
      moneda: "NOK",
      nok_por_eur: fiscal.nok_por_eur,
      nota_rango: "p25 y p75 son cuartiles reales por oficio publicados por SSB (no estimaciones).",
      total_oficios: oficios.length,
    },
    fiscal_2026: fiscal.fiscal_2026,
    servicios_2026: fiscal.servicios_2026,
    categorias: Object.entries(CATEGORIAS).map(([codigo, nombre_es]) => ({ codigo, nombre_es })),
    oficios,
  };

  writeFileSync(join(repo, "data", "data.json"), JSON.stringify(data));
  console.log(`data/data.json escrito: ${oficios.length} oficios.`);
  if (sinTrad.length) console.log("Sin traducción (revisar):", sinTrad.join(", "));
}

main();
