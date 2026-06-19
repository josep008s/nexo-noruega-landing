// Descarga SSB tabla 11418 (Yrkesfordelt månedslønn) y produce el dataset crudo
// de oficios de 4 dígitos STYRK-08 con p25 / mediana / media / p75 mensual.
// Salario de empleados a jornada completa (Heltidsansatte), todos los sectores,
// ambos sexos, año 2025. Ejecucion anual (febrero) cuando SSB publica.
//
//   node scripts/fetch_ssb.mjs
//
// Genera:
//   scripts/_ssb_raw.json   -> [{styrk, grupo, nombre_no, p25, mediana, media, p75}]
//   scripts/_names_no.json   -> [{styrk, grupo, nombre_no}]  (para traducir)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));

const ANIO = "2025";
const BASE = "https://data.ssb.no/api/pxwebapi/v2/tables/11418/data";

const params = new URLSearchParams({
  lang: "no",
  outputFormat: "json-stat2",
});
// MaaleMetode: 051 = p25, 01 = mediana, 02 = media, 061 = p75
params.append("valueCodes[MaaleMetode]", "051,01,02,061");
params.append("valueCodes[Yrke]", "*");
params.append("valueCodes[Sektor]", "ALLE");
params.append("valueCodes[Kjonn]", "0");
params.append("valueCodes[AvtaltVanlig]", "5"); // Heltidsansatte (jornada completa)
params.append("valueCodes[ContentsCode]", "Manedslonn");
params.append("valueCodes[Tid]", ANIO);

const url = `${BASE}?${params.toString()}`;

function indexer(jsonstat) {
  const { id, size, value } = jsonstat;
  return (sel) => {
    let flat = 0;
    let stride = 1;
    for (let k = id.length - 1; k >= 0; k--) {
      const dim = id[k];
      const idx = sel[dim] ?? 0;
      flat += idx * stride;
      stride *= size[k];
    }
    return value[flat];
  };
}

const MEAS = { p25: "051", mediana: "01", media: "02", p75: "061" };

async function main() {
  console.log("Descargando SSB 11418…");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SSB HTTP ${res.status}`);
  const j = await res.json();

  const yk = j.dimension.Yrke.category;
  const mk = j.dimension.MaaleMetode.category;
  const at = indexer(j);

  const yrkeCodes = Object.keys(yk.index);
  const measSel = {};
  for (const [k, code] of Object.entries(MEAS)) measSel[k] = mk.index[code];

  const out = [];
  let suppressed = 0;
  for (const styrk of yrkeCodes) {
    if (!/^\d{4}$/.test(styrk)) continue; // solo 4 dígitos (oficio terminal)
    const yi = yk.index[styrk];
    const row = {
      styrk,
      grupo: styrk[0],
      nombre_no: yk.label[styrk],
      p25: at({ Yrke: yi, MaaleMetode: measSel.p25 }),
      mediana: at({ Yrke: yi, MaaleMetode: measSel.mediana }),
      media: at({ Yrke: yi, MaaleMetode: measSel.media }),
      p75: at({ Yrke: yi, MaaleMetode: measSel.p75 }),
    };
    if (row.mediana == null) {
      suppressed++;
      continue; // sin dato publicado para ese oficio
    }
    out.push(row);
  }

  out.sort((a, b) => a.styrk.localeCompare(b.styrk));

  writeFileSync(join(__dir, "_ssb_raw.json"), JSON.stringify(out, null, 2));
  writeFileSync(
    join(__dir, "_names_no.json"),
    JSON.stringify(
      out.map(({ styrk, grupo, nombre_no }) => ({ styrk, grupo, nombre_no })),
      null,
      2
    )
  );

  console.log(`Oficios 4-dígitos con dato: ${out.length}  (sin dato: ${suppressed})`);
  console.log(`Año: ${ANIO}  ·  actualizado: ${j.updated ?? "?"}`);
  console.log("Escrito: scripts/_ssb_raw.json y scripts/_names_no.json");
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
