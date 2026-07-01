// Descarga SSB tabla 11422 (Månedslønn etter region og yrke) y produce
// data/regiones.json: mediana mensual por FAMILIA de oficios (STYRK 1 dígito)
// y fylke vigente (2024+). SSB no publica región por oficio de 4 dígitos,
// solo por grupo ocupacional; el frontend lo etiqueta como "familia de oficios".
// Jornada completa (Heltidsansatte), ambos sexos, año 2025.
//
//   node scripts/fetch_ssb_region.mjs
//
// Ejecución anual (febrero), junto a fetch_ssb.mjs.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));

const ANIO = "2025";
const BASE = "https://data.ssb.no/api/pxwebapi/v2/tables/11422/data";

// Fylker vigentes desde 2024 + total nacional (código 0)
const REGIONES = [
  { codigo: "0", nombre: "Toda Noruega" },
  { codigo: "03", nombre: "Oslo" },
  { codigo: "32", nombre: "Akershus" },
  { codigo: "31", nombre: "Østfold" },
  { codigo: "33", nombre: "Buskerud" },
  { codigo: "39", nombre: "Vestfold" },
  { codigo: "40", nombre: "Telemark" },
  { codigo: "34", nombre: "Innlandet" },
  { codigo: "42", nombre: "Agder" },
  { codigo: "11", nombre: "Rogaland (Stavanger)" },
  { codigo: "46", nombre: "Vestland (Bergen)" },
  { codigo: "15", nombre: "Møre og Romsdal" },
  { codigo: "50", nombre: "Trøndelag (Trondheim)" },
  { codigo: "18", nombre: "Nordland" },
  { codigo: "55", nombre: "Troms" },
  { codigo: "56", nombre: "Finnmark" },
];
const GRUPOS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"]; // 11422 no publica el grupo 0 (FFAA)

const params = new URLSearchParams({ lang: "no", outputFormat: "json-stat2" });
params.append("valueCodes[Region]", REGIONES.map((r) => r.codigo).join(","));
params.append("valueCodes[MaaleMetode]", "01"); // mediana
params.append("valueCodes[Yrke]", GRUPOS.join(","));
params.append("valueCodes[Kjonn]", "0");
params.append("valueCodes[ArbeidsTid]", "5"); // Heltidsansatte
params.append("valueCodes[ContentsCode]", "Manedslonn");
params.append("valueCodes[Tid]", ANIO);

const url = `${BASE}?${params.toString()}`;

function indexer(jsonstat) {
  const { id, size, value } = jsonstat;
  return (sel) => {
    let flat = 0;
    let stride = 1;
    for (let i = id.length - 1; i >= 0; i--) {
      const dim = id[i];
      const idx = jsonstat.dimension[dim].category.index[sel[dim]];
      if (idx === undefined) return null;
      flat += idx * stride;
      stride *= size[i];
    }
    const v = value[flat];
    return v == null ? null : v;
  };
}

const res = await fetch(url);
if (!res.ok) throw new Error(`SSB ${res.status}: ${await res.text()}`);
const js = await res.json();
const at = indexer(js);

const grupos = {};
for (const g of GRUPOS) {
  const porRegion = {};
  for (const r of REGIONES) {
    const v = at({ Region: r.codigo, MaaleMetode: "01", Yrke: g, Kjonn: "0", ArbeidsTid: "5", ContentsCode: "Manedslonn", Tid: ANIO });
    if (v != null && v > 0) porRegion[r.codigo] = v;
  }
  grupos[g] = porRegion;
}

const out = {
  meta: {
    fuente: "SSB tabla 11422 (mediana mensual, jornada completa, por grupo ocupacional STYRK-08 de 1 dígito y fylke)",
    anio_datos: Number(ANIO),
    nota: "SSB no publica región por oficio exacto (4 dígitos), solo por grupo ocupacional. El frontend lo presenta como 'familia de oficios'.",
  },
  regiones: REGIONES,
  grupos,
};

writeFileSync(join(__dir, "..", "data", "regiones.json"), JSON.stringify(out, null, 1), "utf8");

const nCeldas = Object.values(grupos).reduce((a, g) => a + Object.keys(g).length, 0);
console.log(`OK data/regiones.json: ${GRUPOS.length} grupos x ${REGIONES.length} regiones, ${nCeldas} celdas con dato.`);
