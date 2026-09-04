// Exporta a JSON el material del curso Norskprøven B1 (NEXO NORSK, línea Idioma).
// Uso:  node scripts/norsk_curso_export.mjs [--ruta=norskproven-b1|norsk-desde-cero-a2] [--dry] [--solo=M01]
//
// Salida (GITIGNORED, el repo es público y el curso es contenido de pago):
//   scripts/_norsk_curso/curso.json       <- todas las piezas con su cuerpo en HTML
//   scripts/_norsk_curso/curso-demo.json  <- la demo pública (M01 entero + índice + intro)
//   scripts/_norsk_curso/manifiesto.json  <- recuento por tipo, palabras y fecha
//
// Con --solo=M01 la salida va a scripts/_norsk_curso/curso-solo.json y no se toca
// nada más, para que una consulta de una pieza no deje el curso a medias.
//
// La demo se copia además a data/norsk-curso-demo.json, que es lo ÚNICO de este
// pipeline que entra en el repo. El resto lo sube a Supabase norsk_curso_build.mjs.
//
// Sin dependencias: no hay node_modules en este repo, así que el lector de
// front-matter YAML y el conversor de Markdown a HTML van escritos aquí abajo y
// cubren lo que el material usa de verdad, ni más ni menos.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const EXPORTADOR_ARCHIVO = fileURLToPath(import.meta.url);
const ROOT = path.dirname(path.dirname(EXPORTADOR_ARCHIVO));

// Carpeta canónica del material en el Drive. El curso se escribe y se revisa ahí:
// este script solo lee, nunca escribe en el Drive.
//
// Dos rutas comparten el pipeline: la Ruta Norskprøven B1 (por defecto) y el
// recorrido «Noruego desde cero hasta A2». Se elige con --ruta=<slug>. Cada ruta
// tiene su carpeta en el Drive, su salida gitignored y su demo pública.
const DRIVE_RUTAS = "/Users/josep/Library/CloudStorage/GoogleDrive-josep.muttt@gmail.com/Mi unidad/Business/Nexo Noruega/norsk/idioma/rutas";
const RUTAS = {
  "norskproven-b1": {
    producto: "NEXO NORSK · Ruta Norskprøven B1",
    material: path.join(DRIVE_RUTAS, "norskproven-b1"),
    salida: path.join(ROOT, "scripts", "_norsk_curso"),
    demo: path.join(ROOT, "data", "norsk-curso-demo.json"),
    // Orden de lectura, que es también el orden del curso: primero el diagnóstico de
    // entrada (módulo 0), después los dieciséis mecanismos y al final el material por
    // destreza. Las carpetas que aún no tienen contenido avisan y no rompen nada.
    fuentes: [
      { dir: "00_diagnostico", tipo: "diagnostico" },
      { dir: "01_mecanismos", tipo: "mecanismo" },
      { dir: "02_lytt/guiones", tipo: "lytt" },
      { dir: "03_les", tipo: "les" },
      { dir: "04_skriv", tipo: "skriv" },
      { dir: "05_muntlig", tipo: "muntlig" },
      { dir: "06_simulacros", tipo: "simulacro" },
    ],
  },
  "norsk-desde-cero-a2": {
    producto: "NEXO NORSK · Noruego desde cero hasta A2",
    material: path.join(DRIVE_RUTAS, "norsk-desde-cero-a2"),
    salida: path.join(ROOT, "scripts", "_norsk_curso", "norsk-desde-cero-a2"),
    demo: path.join(ROOT, "data", "norsk-desde-cero-demo.json"),
    fuentes: [{ dir: "01_unidades", tipo: "leccion" }],
    // Cada lección lleva su banco de ejercicios explícito y sus audios declarados.
    ejercicios: "02_ejercicios",
    audio: path.join("03_audio", "manifiesto.json"),
    // La demo pública abre estas piezas enteras; el resto solo enseña su nombre.
    demoAbiertas: ["PREA1-U02-L01", "PREA1-U02-L02"],
  },
};
const RUTA = (process.argv.find((a) => a.startsWith("--ruta=")) || "").slice(7).trim() || "norskproven-b1";
if (!Object.prototype.hasOwnProperty.call(RUTAS, RUTA)) {
  console.error(`Ruta desconocida: ${RUTA}. Rutas válidas: ${Object.keys(RUTAS).join(", ")}`);
  process.exit(1);
}
const CFG = RUTAS[RUTA];
const MATERIAL = CFG.material;
const SALIDA = CFG.salida;
const DEMO_PUBLICA = CFG.demo;
const FUENTES = CFG.fuentes;

const DRY = process.argv.includes("--dry");
const SOLO = (process.argv.find((a) => a.startsWith("--solo=")) || "").slice(7).trim().toUpperCase() || null;

// El código de la pieza es la llave primaria en Supabase y viaja en la query del
// endpoint, así que se acota aquí y se vuelve a acotar allí.
const CODIGO_VALIDO = /^[A-Z0-9_-]{3,40}$/;

// Secciones editoriales internas. No son material del alumno y por tanto no
// entran ni en el curso de pago ni en la demo pública. La fuente Markdown las
// conserva como trazabilidad; el exportador las separa de la superficie final.
const SECCIONES_INTERNAS = new Set([
  "notas-para-la-revision-nativa",
  "puertas-abiertas-de-esta-leccion",
  "puertas-abiertas-de-este-documento",
  "registro-de-dudas-para-contraste-humano-opcional",
  "registro-historico-de-dudas-de-lengua",
  "registro-de-revision-de-lengua",
  "registro-de-produccion",
  "estado-y-controles-separados-de-esta-leccion",
  "estado-reconciliado-de-esta-leccion",
  "estado-reconciliado-y-mejoras-opcionales",
  "estado-y-trabajo-abierto",
  "controles-y-pendientes-separados",
  "lo-que-este-banco-todavia-no-tiene",
  "hoja-interna-de-observacion-siete-puertas-y-alcance",
  "control-de-calidad-de-este-bloque",
  "comprobaciones-pasadas-sobre-este-archivo",
  "comprobaciones-internas-de-este-lote",
  "siguiente-paso",
  "registro-interno",
]);

// Defensa de contenido, independiente de los títulos. Estos marcadores describen
// QA, trazabilidad o trabajo editorial y no deben aparecer en el artefacto que ve
// el alumno. Se acotan a fórmulas de producción: no se prohíben expresiones
// pedagógicas legítimas como "otra persona", el piloto de un aparato o el
// consentimiento dentro de un ejemplo de vocabulario.
const CONTENIDO_EDITORIAL_INTERNO = /contraste humano|revisi[oó]n nativa|registro (?:hist[oó]rico )?de dudas|puerta editorial|firma (?:humana|nativa)|revisi[oó]n sist[eé]mica|revisi[oó]n de bokm[aå]l|qa (?:sist[eé]mic[oa]|t[eé]cnic[oa]|de audio)|material interno|material publicable|no es copy|estado (?:de producci[oó]n|y trabajo abierto)|puertas abiertas de este documento|hoja interna|\bcohorte\b|\breclutamiento\b|circuito (?:con personas|de alumnos)|(?:no hay|no se incluye)[^.!?]{0,120}\bconsentimiento\b|\bla lupa\b|pass_con_avisos|orden (?:expresa )?de publicaci[oó]n|publicaci[oó]n (?:sigue|se registra|conserva|es una puerta)|puertas? (?:t[eé]cnicas? y )?de publicaci[oó]n|autorizar (?:la )?publicaci[oó]n|autorizar su uso p[uú]blico/i;
const CABECERA_PRODUCCION_HTML = /<pre><code>\s*(?:MECANISMO|DOCUMENTO|PIEZA):/i;
const RUTA_INTERNA_CURSO = /(?:\/Users\/|(?:\.\.\/)+|(?:norsk\/)?idioma\/rutas\/|(?:_fuentes|produccion|scripts|supabase|api|data|rutas)\/)[^\s<>"']+\.(?:md|xlsx|json|sql|mjs|js|py)\b/i;
const RUIDO_PRODUCCION_ALUMNO = /MP3 m[aá]ster|fuente editable|experiencia maestra|Gobierno vigente|para producci[oó]n interna|Nota de grabaci[oó]n|petici[oó]n original|QA editorial interna|\bversionado\b|puerta abierta en la cabecera/i;

const FINGERPRINT_VERSION = "sha256-ruta-contenido-v1";

function ordenarFuentes(entradas) {
  return entradas.slice().sort((a, b) => (a.ruta < b.ruta ? -1 : a.ruta > b.ruta ? 1 : 0));
}

function fingerprintFuentes(entradas) {
  const hash = createHash("sha256");
  hash.update(`${FINGERPRINT_VERSION}\0`, "utf8");
  ordenarFuentes(entradas).forEach(({ ruta, sha256 }) => {
    hash.update(ruta, "utf8");
    hash.update("\0", "utf8");
    hash.update(sha256, "ascii");
    hash.update("\n", "utf8");
  });
  return hash.digest("hex");
}

// ---------- YAML: el subconjunto que usa el front-matter del curso ----------
// Cubre escalares, listas en bloque y en línea, mapas anidados y bloques plegados
// con > o con |. No pretende ser un YAML completo: lo que no entiende, lo ignora.

function sangriaDe(linea) {
  return linea.length - linea.replace(/^\s+/, "").length;
}

function valorEscalar(texto) {
  const s = String(texto).trim();
  if (!s) return null;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  if (s.startsWith("[") && s.endsWith("]")) {
    const dentro = s.slice(1, -1).trim();
    if (!dentro) return [];
    return dentro.split(",").map((x) => valorEscalar(x)).filter((x) => x !== null);
  }
  return s;
}

function leerMapa(lineas, inicio, sangria) {
  const mapa = {};
  let i = inicio;
  while (i < lineas.length) {
    const linea = lineas[i];
    if (!linea.trim()) { i++; continue; }
    const s = sangriaDe(linea);
    if (s < sangria) break;
    if (/^-(\s|$)/.test(linea.trim())) break;
    const m = linea.trim().match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!m) { i++; continue; }
    const [, clave, resto] = m;
    if (/^[>|][-+]?$/.test(resto)) {
      const [texto, j] = leerBloquePlegado(lineas, i + 1, s + 1);
      mapa[clave] = texto;
      i = j;
      continue;
    }
    if (resto !== "") { mapa[clave] = valorEscalar(resto); i++; continue; }
    const [hijo, j] = leerHijo(lineas, i + 1, s);
    mapa[clave] = hijo;
    i = j;
  }
  return [mapa, i];
}

function leerHijo(lineas, inicio, sangriaClave) {
  let i = inicio;
  while (i < lineas.length && !lineas[i].trim()) i++;
  if (i >= lineas.length) return [null, i];
  const s = sangriaDe(lineas[i]);
  if (/^-(\s|$)/.test(lineas[i].trim()) && s >= sangriaClave) return leerLista(lineas, i, s);
  if (s > sangriaClave) return leerMapa(lineas, i, s);
  return [null, i];
}

function leerLista(lineas, inicio, sangria) {
  const lista = [];
  let i = inicio;
  while (i < lineas.length) {
    const linea = lineas[i];
    if (!linea.trim()) { i++; continue; }
    if (sangriaDe(linea) < sangria || !/^-(\s|$)/.test(linea.trim())) break;
    lista.push(valorEscalar(linea.trim().replace(/^-\s*/, "")));
    i++;
  }
  return [lista, i];
}

function leerBloquePlegado(lineas, inicio, sangriaMinima) {
  const trozos = [];
  let i = inicio;
  while (i < lineas.length) {
    const linea = lineas[i];
    if (!linea.trim()) { trozos.push(""); i++; continue; }
    if (sangriaDe(linea) < sangriaMinima) break;
    trozos.push(linea.trim());
    i++;
  }
  while (trozos.length && trozos[trozos.length - 1] === "") trozos.pop();
  return [trozos.join(" ").trim(), i];
}

// Separa el front-matter del cuerpo. Devuelve {meta, cuerpo} o null si el archivo
// no abre con la línea de tres guiones.
function partirFrontMatter(texto) {
  const t = texto.replace(/\r\n/g, "\n").replace(/^﻿/, "");
  if (!t.startsWith("---\n")) return null;
  const lineas = t.split("\n");
  let cierre = -1;
  for (let i = 1; i < lineas.length; i++) {
    if (lineas[i].trim() === "---") { cierre = i; break; }
  }
  if (cierre === -1) return null;
  const [meta] = leerMapa(lineas.slice(1, cierre), 0, 0);
  return { meta, cuerpo: lineas.slice(cierre + 1).join("\n").trim() };
}

// ---------- Markdown a HTML ----------

function escapar(t) {
  return String(t)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function enlace(url, texto) {
  return `<a href="${url}" target="_blank" rel="noopener">${texto}</a>`;
}

// Convierte el texto de una línea: código, enlaces, negrita y cursiva. Los tramos
// que no deben volver a tocarse (código y enlaces ya montados) se apartan en fichas
// y se devuelven al final, para que un asterisco dentro de código no acabe en <em>.
function enLinea(texto) {
  const fichas = [];
  const guardar = (html) => `\u0000${fichas.push(html) - 1}\u0000`;

  let t = String(texto).replace(/`([^`]+)`/g, (_, c) => guardar(`<code>${escapar(c)}</code>`));
  t = escapar(t);
  t = t.replace(/\[([^\]\n]+)\]\((https?:[^)\s]+)\)/g, (_, txt, url) => guardar(enlace(url, txt)));
  t = t.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, (_, url) => guardar(enlace(url, url)));
  t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, antes, url) => {
    const limpio = url.replace(/[.,;:!?]+$/, "");
    return antes + guardar(enlace(limpio, limpio)) + url.slice(limpio.length);
  });
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");

  // Las fichas pueden contener otras fichas (código dentro del texto de un enlace),
  // así que se devuelven en vueltas hasta que no queda ninguna.
  for (let vuelta = 0; vuelta < 5 && t.includes("\u0000"); vuelta++) {
    t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => fichas[Number(i)]);
  }
  return t;
}

function esSeparadorDeTabla(linea) {
  const celdas = linea.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
  return celdas.length > 0 && celdas.every((c) => /^\s*:?-{2,}:?\s*$/.test(c));
}

function celdasDe(linea) {
  return linea.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

function alineacionDe(celda) {
  const c = celda.trim();
  if (c.startsWith(":") && c.endsWith(":")) return "center";
  if (c.endsWith(":")) return "right";
  return null;
}

function markdownAHtml(md) {
  const lineas = String(md).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;

  const abreBloque = (l) =>
    !l.trim() ||
    /^```/.test(l.trim()) ||
    /^#{1,6}\s/.test(l) ||
    /^(-{3,}|\*{3,}|_{3,})\s*$/.test(l.trim()) ||
    /^>\s?/.test(l) ||
    /^[-*+]\s+/.test(l) ||
    /^\d+[.)]\s+/.test(l) ||
    /^\|/.test(l.trim());

  while (i < lineas.length) {
    const linea = lineas[i];
    if (!linea.trim()) { i++; continue; }

    // Bloque de código con acentos graves.
    if (/^```/.test(linea.trim())) {
      const dentro = [];
      i++;
      while (i < lineas.length && !/^```/.test(lineas[i].trim())) { dentro.push(lineas[i]); i++; }
      i++;
      out.push(`<pre><code>${escapar(dentro.join("\n"))}</code></pre>`);
      continue;
    }

    // Encabezados. Aquí nunca se emite un <h1>: el título de la pieza y el de la
    // sección ya viajan aparte, así que lo que queda dentro del cuerpo son los
    // subtítulos de tercer nivel del material y sus hijos.
    const enc = linea.match(/^(#{1,6})\s+(.*)$/);
    if (enc) {
      const nivel = Math.min(6, Math.max(2, enc[1].length));
      out.push(`<h${nivel}>${enLinea(enc[2].trim())}</h${nivel}>`);
      i++;
      continue;
    }

    // Línea horizontal.
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(linea.trim())) { out.push("<hr>"); i++; continue; }

    // Tabla: fila de cabecera más fila separadora.
    if (/^\|/.test(linea.trim()) && i + 1 < lineas.length && esSeparadorDeTabla(lineas[i + 1])) {
      const cabecera = celdasDe(linea);
      const alineaciones = celdasDe(lineas[i + 1]).map(alineacionDe);
      i += 2;
      const filas = [];
      while (i < lineas.length && /^\|/.test(lineas[i].trim())) { filas.push(celdasDe(lineas[i])); i++; }
      const estilo = (n) => (alineaciones[n] ? ` style="text-align:${alineaciones[n]}"` : "");
      const th = cabecera.map((c, n) => `<th${estilo(n)}>${enLinea(c)}</th>`).join("");
      const tr = filas
        .map((f) => `<tr>${f.map((c, n) => `<td${estilo(n)}>${enLinea(c)}</td>`).join("")}</tr>`)
        .join("");
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`);
      continue;
    }

    // Cita: se recogen las líneas seguidas y el contenido se convierte aparte.
    if (/^>\s?/.test(linea)) {
      const dentro = [];
      while (i < lineas.length && /^>\s?/.test(lineas[i])) { dentro.push(lineas[i].replace(/^>\s?/, "")); i++; }
      out.push(`<blockquote>${markdownAHtml(dentro.join("\n"))}</blockquote>`);
      continue;
    }

    // Listas. El material no anida listas, así que aquí solo hay un nivel; una
    // línea sangrada que no abre item se pega al item anterior.
    const marcaLista = linea.match(/^([-*+])\s+(.*)$/) || linea.match(/^(\d+)[.)]\s+(.*)$/);
    if (marcaLista) {
      const ordenada = /^\d+[.)]\s/.test(linea);
      const primerNumero = ordenada ? parseInt(linea, 10) : 1;
      const items = [];
      while (i < lineas.length) {
        const l = lineas[i];
        const item = ordenada ? l.match(/^\d+[.)]\s+(.*)$/) : l.match(/^[-*+]\s+(.*)$/);
        if (item) { items.push(item[1]); i++; continue; }
        if (items.length && l.trim() && /^\s+\S/.test(l)) { items[items.length - 1] += ` ${l.trim()}`; i++; continue; }
        break;
      }
      const cuerpo = items.map((x) => `<li>${enLinea(x)}</li>`).join("");
      out.push(ordenada
        ? `<ol${primerNumero !== 1 ? ` start="${primerNumero}"` : ""}>${cuerpo}</ol>`
        : `<ul>${cuerpo}</ul>`);
      continue;
    }

    // Párrafo. Los saltos de línea sueltos se conservan como <br>, porque en este
    // material separan frases que van una debajo de otra a propósito.
    const parrafo = [];
    while (i < lineas.length && !abreBloque(lineas[i])) { parrafo.push(lineas[i].trim()); i++; }
    if (parrafo.length) out.push(`<p>${parrafo.map(enLinea).join("<br>")}</p>`);
    else i++;
  }

  return out.join("\n");
}

// ---------- Troceado en secciones ----------

function idDeSeccion(titulo) {
  return String(titulo)
    .toLowerCase()
    .replace(/^\s*\d+(\.\d+)*[.)]?\s*/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "seccion";
}

// Parte el cuerpo por los encabezados de segundo nivel. Lo que va antes del primero
// (el H1, la ficha del mecanismo, el aviso de la casa) forma la sección de entrada.
function trocearSecciones(cuerpo, separarJornadas = false) {
  const lineas = cuerpo.split("\n");
  const bloques = [];
  let actual = { titulo: null, lineas: [] };
  let enCodigo = false;
  let h1PrincipalVisto = false;
  for (const l of lineas) {
    if (/^```/.test(l.trim())) enCodigo = !enCodigo;
    const esH1 = !enCodigo && /^#\s+(?!#)/.test(l);
    const esH2 = !enCodigo && /^##\s+(?!#)/.test(l);
    const esJornada = !enCodigo && separarJornadas && /^###\s+Jornada\s+\d+\b/i.test(l);
    // El primer H1 es el título de la pieza y ya viaja en otro campo. Los H1
    // posteriores sí delimitan bloques: algunos simulacros los usan para separar
    // material del alumno de hojas editoriales internas antes de volver al curso.
    if (esH1 && !h1PrincipalVisto) {
      h1PrincipalVisto = true;
      continue;
    }
    if (esH1 || esH2 || esJornada) {
      bloques.push(actual);
      actual = { titulo: l.replace(/^#{1,3}\s+/, "").trim(), lineas: [] };
      continue;
    }
    actual.lineas.push(l);
  }
  bloques.push(actual);

  const usados = new Set();
  const secciones = [];
  for (const b of bloques) {
    // De la entrada se quita el H1: el título de la pieza ya lo dice.
    const texto = (b.titulo === null ? b.lineas.filter((l) => !/^#\s+/.test(l)) : b.lineas).join("\n").trim();
    if (!texto) continue;
    const titulo = b.titulo === null ? "Introducción" : b.titulo;
    let id = b.titulo === null ? "intro" : idDeSeccion(titulo);
    let n = 2;
    while (usados.has(id)) { id = `${idDeSeccion(titulo)}-${n}`; n++; }
    usados.add(id);
    secciones.push({ id, titulo, html: markdownAHtml(texto) });
  }
  return secciones;
}

function textoPlanoHtml(html) {
  return String(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function esFichaInternaMecanismo(bloque, codigo) {
  if (!/^M\d{2}$/.test(codigo)) return false;
  const plano = textoPlanoHtml(bloque);
  if (!new RegExp(`^MECANISMO:\\s*${codigo}\\b`, "i").test(plano)) return false;
  return [
    /\bGRIETA:/i,
    /\bPIEZAS NUEVAS:/i,
    /\bYA TRAES:/i,
    /\bDELPRØVE PRINCIPAL:/i,
    /\bUNIDAD DESTINO:/i,
    /\bEVIDENCIA:/i,
    /\bRECUPERACI[ÓO]N:/i,
  ].every((patron) => patron.test(plano));
}

function esAvisoLegalRepetido(bloque) {
  const plano = textoPlanoHtml(bloque);
  return /NEXO NORSK/i.test(plano)
    && /(?:proyecto independiente|material propio)/i.test(plano)
    && /(?:HK-dir|UDI|centro de examen)/i.test(plano)
    && /(?:no es la prueba|no promete|no reproduce|no estamos vinculados|no tenemos relaci[oó]n)/i.test(plano);
}

function esMapaInternoDeLeccion(bloque) {
  const plano = textoPlanoHtml(bloque);
  return /(?:los seis pasos (?:del canon|del m[eé]todo)|c[oó]mo se corresponde esta lecci[oó]n con los seis pasos|recorrido de la lecci[oó]n)/i.test(plano)
    && /(?:escena|grieta)/i.test(plano)
    && /(?:ficha P|transferencia)/i.test(plano);
}

function sustituirBloqueAlumno(html, etiqueta, patrones, reemplazo) {
  const re = new RegExp(`<${etiqueta}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${etiqueta}>`, "gi");
  return html.replace(re, (bloque) => {
    const plano = textoPlanoHtml(bloque);
    return patrones.every((patron) => patron.test(plano)) ? reemplazo : bloque;
  });
}

function limpiarRuidoEspecifico(codigo, seccion, html) {
  if (codigo === "DIAGNOSTICO_B1" && seccion.id === "como-hacer-este-perfil-opcional") {
    html = sustituirBloqueAlumno(html, "p", [/86 MP3 m[aá]ster/i],
      "<p><strong>Para la escucha.</strong> Escucha cada pieza dos veces a velocidad normal: pide que te la lean o usa el lector de voz en noruego del móvil. No leas el texto; si lo haces, anótalo porque entonces estás midiendo lectura.</p>");
  }

  if (codigo === "LES_LARGOS" && seccion.id === "nota-de-limites") {
    html = sustituirBloqueAlumno(html, "li", [/215 a 280 palabras/i, /_fuentes\/FICHA_FORMATO_LES/i],
      "<li><strong>La longitud de 215 a 280 palabras es una decisión de NEXO.</strong> HK-dir no publica cifras de palabras por nivel; solo indica que los textos de A1 y A2 son más cortos y sencillos que los de B1 y B2.</li>");
    html = sustituirBloqueAlumno(html, "li", [/Tres opciones por pregunta/i, /cuando montemos el simulacro/i],
      "<li><strong>Aquí hay tres opciones por pregunta.</strong> La prueba publica cuatro para este tipo de tarea, así que esta práctica no reproduce exactamente esa parte del formato.</li>");
  }

  if (codigo === "BANCO_CONSIGNAS_ORAL" && seccion.id === "nota-de-limites") {
    html = sustituirBloqueAlumno(html, "p", [/_fuentes\/FICHA_FORMATO_MUNTLIG/i, /Son cuatro/i],
      `<p><strong>Cómo es la prueba oral.</strong> Estos datos se comprobaron el 01.09.2026 con la información pública de HK-dir. Normalmente participan dos candidatos, un examinador y un sensor externo. La presentación inicial no se evalúa. Después hay tres tareas: una intervención individual de 2 a 3 minutos, una conversación en pareja de 5 a 7 y otra intervención individual de opinión justificada de 2 a 3. La valoración corresponde al sensor de HK-dir. Fuentes: ${enlace("https://prove.hkdir.no/norskprove-a1-b2/les-om-proven-norsk-A1-B2/om-muntlig-prove", "información para candidatos")} y ${enlace("https://hkdir.no/voksenopplaering/norsk-og-samfunnskunnskap/om-norskprovene/norskproven-a1-b2/prove-i-munnleg-kommunikasjon", "criterios de comunicación oral")}.</p>`);
  }

  if (codigo === "KIT_ORAL_21_JORNADAS" && seccion.id === "intro") {
    html = sustituirBloqueAlumno(html, "blockquote", [/Gobierno vigente/i, /experiencia maestra/i],
      "<blockquote><p>Son 21 actuaciones flexibles, pensadas para cuatro a seis semanas. No tienen que hacerse en días consecutivos. Veinte minutos es una referencia, no un límite.</p></blockquote>");
  }

  if (codigo === "KIT_ORAL_21_JORNADAS" && seccion.id === "limites-de-este-documento") {
    html = sustituirBloqueAlumno(html, "p", [/_fuentes\/FICHA_FORMATO_MUNTLIG/i, /revalidarse/i],
      "<p>Los datos sobre la prueba oral se comprobaron el 01.09.2026 con las fuentes oficiales de HK-dir y el reglamento vigente.</p>");
  }

  if (codigo === "SIMULACROS_LYTT_LES_SKRIV" && seccion.id === "convenciones-de-este-documento") {
    html = sustituirBloqueAlumno(html, "p", [/34 MP3 m[aá]ster/i, /fuente editable/i], "");
    html = sustituirBloqueAlumno(html, "p", [/Cuando una soluci[oó]n dice M04 o M02/i, /01_mecanismos\//i],
      "<p><strong>Mecanismos.</strong> Cuando una solución menciona M04 o M02, se refiere a uno de los dieciséis mecanismos de la ruta. Puedes abrirlo desde el índice del curso.</p>");
  }

  if (codigo === "SIMULACROS_ORAL" && seccion.id === "nota-de-limites") {
    html = sustituirBloqueAlumno(html, "p", [/_fuentes\/FICHA_FORMATO_MUNTLIG/i, /cada seis meses/i],
      `<p>Los datos de formato se comprobaron el 01.09.2026 con la ${enlace("https://prove.hkdir.no/norskprove-a1-b2/les-om-proven-norsk-A1-B2/om-muntlig-prove", "información pública para candidatos")}, los ${enlace("https://hkdir.no/voksenopplaering/norsk-og-samfunnskunnskap/om-norskprovene/norskproven-a1-b2/prove-i-munnleg-kommunikasjon", "criterios de comunicación oral")} y el ${enlace("https://cdn.sanity.io/files/dc7vqrwe/production/0d54a91003ef099600915a4503f4d3b24da2c9ee.pdf?dl=", "formulario público de valoración")} de HK-dir.</p>`);
    html = sustituirBloqueAlumno(html, "p", [/O2 lleva alcance/i, /O5/i],
      "<p><strong>Para practicar.</strong> Cada simulacro está escrito para tres personas: tú, quien hace de examinador y quien hace de segundo candidato. Larsito puede ocupar esos dos papeles cuando practiques por tu cuenta.</p>");
  }

  if (codigo === "LYTT_CORTOS_B" && seccion.id === "bloque-a2-ocho-guiones") {
    html = sustituirBloqueAlumno(html, "p", [/^Nota de grabaci[oó]n$/i], "");
    html = sustituirBloqueAlumno(html, "p", [/alternativas nombran el sexo/i, /VOZ 2/i], "");
  }

  if (codigo === "LYTT_LARGOS" && seccion.id === "que-son-estas-doce-piezas") {
    html = sustituirBloqueAlumno(html, "p", [/petici[oó]n original/i, /QA editorial interna/i, /versionado/i], "");
  }

  if (codigo === "SIMULACROS_LYTT_LES_SKRIV" && seccion.id === "reglas-comunes-de-los-dos-simulacros-escritos") {
    html = sustituirBloqueAlumno(html, "p", [/ficha de la l[aá]mina/i, /nuestro equipo produzca/i],
      "<p><strong>Sobre la tarea de describir una imagen.</strong> En esta versión la tarea usa una escena descrita en lugar de una imagen. Es más fácil, así que no la cuentes como simulacro completo hasta repetirla con una imagen delante.</p>");
  }

  if (codigo === "SIMULACROS_LYTT_LES_SKRIV" && /^simulacro-skriv-[12]-3-tareas-90-minutos$/.test(seccion.id)) {
    html = sustituirBloqueAlumno(html, "p", [/Ficha de la l[aá]mina/i, /producci[oó]n interna/i], "");
  }

  if (codigo === "LYTT_CORTOS_A" && seccion.id === "nota-de-limites") {
    html = sustituirBloqueAlumno(html, "p", [/etiquetas de trabajo del equipo/i, /Estas etiquetas solo ordenan la producci[oó]n/i],
      "<p>Las etiquetas A2, B1 y B1 alto son orientativas: ordenan la práctica, pero no califican tu nivel ni proceden de HK-dir.</p>");
    html = sustituirBloqueAlumno(html, "p", [/Voces de la grabaci[oó]n/i, /el reparto de voces no es libre/i], "");
    html = sustituirBloqueAlumno(html, "p", [/Fechas\./i, /revisi[oó]n interna/i],
      "<p><strong>Fechas.</strong> En los guiones no se combinan días de la semana con fechas cerradas, para que las escenas no dependan de un calendario concreto.</p>");
    html = sustituirBloqueAlumno(html, "p", [/Plantas y traducci[oó]n/i, /cuando el material llegue a la app/i],
      "<p><strong>Plantas.</strong> En Noruega la planta a pie de calle es <code>første etasje</code>. Por eso <code>andre etasje</code> corresponde a la primera planta en la cuenta española y <code>tredje etasje</code>, a la segunda.</p>");
    html = sustituirBloqueAlumno(html, "p", [/Escenas sanitarias/i, /kit de fichas/i],
      "<p><strong>Escenas sanitarias.</strong> Solo practican situaciones administrativas y lengua. No incluyen diagnóstico, tratamiento ni consejo clínico.</p>");
  }

  if (codigo === "LYTT_CORTOS_B" && seccion.id === "nota-de-limites") {
    html = sustituirBloqueAlumno(html, "p", [/estimaci[oó]n interna del equipo/i, /umbral de puntos/i],
      "<p>Las etiquetas A2, B1 y B1 alto son orientativas: ordenan la práctica, pero no califican tu nivel ni proceden de HK-dir.</p>");
    html = sustituirBloqueAlumno(html, "p", [/Lo que no rellenamos/i, /papel para tomar notas/i],
      "<p>Para el número exacto de tareas, el papel permitido y las condiciones del centro, consulta tu convocatoria y tu centro de examen.</p>");
    html = sustituirBloqueAlumno(html, "p", [/C[oó]mo se usan/i, /especificaci[oó]n/i], "");
    html = sustituirBloqueAlumno(html, "p", [/Qu[eé] significa aqu[ií] citar una pieza/i, /canon de 80 piezas/i], "");
    html = sustituirBloqueAlumno(html, "table", [/Pieza que el canon eval[uú]a en LYTT/i, /Mecanismo/i], "");
  }

  if (codigo === "LYTT_LARGOS" && seccion.id === "nota-de-limites") {
    html = sustituirBloqueAlumno(html, "p", [/ficha de formato del proyecto/i, /fecha de consulta/i],
      "<p>Estas notas separan el formato publicado por HK-dir de las decisiones didácticas de NEXO.</p>");
    html = sustituirBloqueAlumno(html, "p", [/dificultad de cada guion/i, /circuito descriptivo/i],
      `<p><strong>1. La dificultad es orientativa.</strong> A2 alto, B1 y B1 alto ordenan la práctica; no califican al alumno ni proceden de HK-dir. Los umbrales oficiales no se publican. Fuente: ${enlace("https://hkdir.no/voksenopplaering/norsk-og-samfunnskunnskap/om-norskprovene/norskproven-a1-b2/den-adaptive-strukturen-i-lese-og-lytteproven", "HK-dir, estructura adaptativa")}, consultada el 29.08.2026.</p>`);
    html = sustituirBloqueAlumno(html, "p", [/Tres preguntas por audio/i, /Cuando estas piezas se monten/i],
      `<p><strong>2. Aquí hay tres preguntas por audio.</strong> Sirven para estudiar el mismo guion desde el dato, la intención y la conclusión. El formato B1 publicado incluye conversaciones largas con dos preguntas simultáneas, así que esta práctica no lo reproduce exactamente. Fuente: ${enlace("https://hkdir.no/voksenopplaering/norsk-og-samfunnskunnskap/om-norskprovene/norskproven-a1-b2/om-lytteproven", "HK-dir, prueba de escucha")}, consultada el 29.08.2026.</p>`);
    html = sustituirBloqueAlumno(html, "p", [/Tres opciones por pregunta/i, /ficha de formato/i],
      "<p><strong>6. Aquí hay tres opciones por pregunta.</strong> Es una decisión didáctica para poder leer el ítem entero antes de escuchar.</p>");
    html = sustituirBloqueAlumno(html, "p", [/Piezas del canon marcadas R/i, /especificaci[oó]n curricular/i], "");
    html = sustituirBloqueAlumno(html, "p", [/Cada opci[oó]n incorrecta lleva su motivo/i, /control de calidad de la ruta/i], "");
  }

  if (codigo === "LES_BREVES" && seccion.id === "nota-de-limites") {
    html = sustituirBloqueAlumno(html, "p", [/Dos huecos que la ficha/i, /decisi[oó]n nuestra de producci[oó]n/i],
      "<p><strong>Dos límites.</strong> HK-dir no publica una cifra de palabras por nivel ni la proporción exacta de cada tipo de ítem. Los textos de 20 a 70 palabras y el reparto de esta colección son decisiones didácticas de NEXO.</p>");
    html = sustituirBloqueAlumno(html, "p", [/Un tercer aviso/i, /puerta abierta en la cabecera/i],
      `<p><strong>Número de alternativas.</strong> La prueba usa cuatro. Aquí usamos tres para una práctica más breve, así que el azar ayuda más en este material. Fuente: ${enlace("https://hkdir.no/voksenopplaering/norsk-og-samfunnskunnskap/om-norskprovene/norskproven-a1-b2/om-leseproven", "HK-dir, prueba de lectura")}, consultada el 29.08.2026.</p>`);
  }

  if (codigo === "SKRIV_B1" && seccion.id === "como-se-corrige-tu-texto") {
    html = html.replace(/<h3>1\.6 Lo que esta ficha deja sin cerrar<\/h3>/i, "<h3>1.6 Datos que cambian</h3>");
    html = sustituirBloqueAlumno(html, "p", [/Lo que esta ficha deja sin cerrar/i, /plazo de reclamaci[oó]n/i],
      "<p>No damos aquí plazos de reclamación, precios ni fechas de convocatoria porque pueden cambiar o las fuentes discrepan. Consulta HK-dir o tu centro de examen.</p>");
  }

  if (codigo === "SIMULACROS_ORAL" && seccion.id === "ficha-de-tiempos-2") {
    html = html.replace(/La ficha de formato no dice que el examinador cambie las condiciones a mitad de la tarea/gi,
      "La información pública de HK-dir no indica que el examinador cambie las condiciones a mitad de la tarea");
  }

  return html;
}

// La fuente Markdown conserva toda la trazabilidad. Esta función solo limpia la
// copia de alumno y opera de forma determinista sobre bloques completos. Las dos
// sustituciones en línea conservan ejercicios legítimos que antes llevaban una
// coletilla editorial dentro del mismo párrafo.
function sanearHtmlParaAlumno(codigo, seccion) {
  let html = seccion.html;

  html = html.replace(/<pre><code>[\s\S]*?<\/code><\/pre>/g, (bloque) => {
    if (!CABECERA_PRODUCCION_HTML.test(bloque)) return bloque;
    if (/^M\d{2}$/.test(codigo) && !esFichaInternaMecanismo(bloque, codigo)) return bloque;
    cabecerasInternasOmitidas++;
    return "";
  });

  if (seccion.id === "intro" || seccion.id === "nota-de-limites") {
    html = html.replace(/<blockquote>[\s\S]*?<\/blockquote>/g, (bloque) => (
      esAvisoLegalRepetido(bloque) ? "" : bloque
    ));
    html = html.replace(/<p>[\s\S]*?<\/p>/g, (bloque) => (
      esAvisoLegalRepetido(bloque) || (seccion.id === "intro" && /^M\d{2}$/.test(codigo) && esMapaInternoDeLeccion(bloque)) ? "" : bloque
    ));
  }

  html = limpiarRuidoEspecifico(codigo, seccion, html);

  // Última defensa: una ruta interna nunca se enseña. Las reescrituras de arriba
  // conservan el dato útil; esta sustitución cubre una referencia nueva que se
  // haya colado dentro de código sin borrar el párrafo entero.
  html = html.replace(/<code>[^<]+<\/code>/gi, (bloque) => (
    RUTA_INTERNA_CURSO.test(textoPlanoHtml(bloque)) ? "la documentación interna de la ruta" : bloque
  ));

  if ((codigo === "M02" || codigo === "M13") && seccion.id === "practica") {
    html = html.replace(
      /Guion original nuestro, con revisi[oó]n sist[eé]mica cerrada el 31\.08\.2026; no equivale a firma humana y esta ficha no tiene una pista propia asociada\./g,
      "Guion original nuestro."
    );
  }

  if (codigo === "SIMULACROS_LYTT_LES_SKRIV" && seccion.id === "convenciones-de-este-documento") {
    html = html.replace(
      / El QA de audio y bokm[aå]l aceptado es t[eé]cnico\/sist[eé]mico, no firma humana o nativa; el uso de los archivos conserva sus puertas t[eé]cnicas y de publicaci[oó]n separadas\./g,
      ""
    );
  }

  if (codigo === "SIMULACROS_ORAL" && seccion.id === "el-caso-que-mas-duele") {
    html = html.replace(/La hoja interna puede mostrar/g, "Tu registro de progreso puede mostrar");
  }

  const filtrarBloque = (bloque) => {
    const plano = textoPlanoHtml(bloque);
    if (CONTENIDO_EDITORIAL_INTERNO.test(plano)) return "";
    if (/verificaci[oó]n de lengua ya hecha en esta versi[oó]n/i.test(plano)) return "";
    if (/relaci[oó]n con el bloque a/i.test(plano)) return "";
    if (/revalidaci[oó]n de la ficha de formato[^.!?]{0,160}(?:apertura|actualizaci[oó]n)/i.test(plano)) return "";
    return bloque;
  };
  html = html.replace(/<p>[\s\S]*?<\/p>/g, filtrarBloque);
  html = html.replace(/<li>[\s\S]*?<\/li>/g, filtrarBloque);
  html = html.replace(/<(ol|ul)>\s*<\/\1>/g, "");
  html = html.replace(/\n{2,}/g, "\n").trim();

  return html;
}

function contarPalabras(cuerpo) {
  return String(cuerpo)
    .replace(/`{1,3}/g, " ")
    .replace(/[#*_|>]/g, " ")
    .split(/\s+/)
    .filter((p) => /[\wÀ-ÿ]/.test(p)).length;
}

function contarPalabrasSecciones(secciones) {
  const texto = secciones.map((s) => `${s.titulo || ""} ${String(s.html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z0-9#]+;/gi, " ")}`).join("\n");
  return contarPalabras(texto);
}

// ---------- Lectura del material ----------

function codigoDeArchivo(nombre) {
  return nombre
    .replace(/\.md$/i, "")
    .replace(/_v\d+(\.\d+)*$/i, "")
    .toUpperCase();
}

function tituloDe(meta, cuerpo, codigo) {
  if (meta && typeof meta.titulo === "string" && meta.titulo.trim()) return meta.titulo.trim();
  if (meta && typeof meta.documento === "string" && meta.documento.trim()) return meta.documento.trim();
  const h1 = cuerpo.split("\n").find((l) => /^#\s+/.test(l));
  return h1 ? h1.replace(/^#\s+/, "").trim() : codigo;
}

// Frase de la grieta para el índice de la demo. Primero la línea GRIETA de la ficha
// del mecanismo, que ya está escrita como una frase; si no está, la primera frase de
// la sección "La grieta". Sale en texto llano, sin marcas de Markdown, porque en el
// índice se lee como una frase suelta y no como un trozo de lección.
function fraseDeGrieta(cuerpo, secciones) {
  const llano = (t) => String(t).replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();
  const linea = cuerpo.split("\n").find((l) => /^GRIETA:/i.test(l.trim()));
  if (linea) return llano(linea.trim().replace(/^GRIETA:\s*/i, "")) || null;
  const grieta = secciones.find((s) => s.id.startsWith("la-grieta"));
  if (!grieta) return null;
  const texto = llano(grieta.html.replace(/<[^>]+>/g, " "));
  const corte = texto.match(/^.*?[.!?](\s|$)/);
  return (corte ? corte[0] : texto).trim() || null;
}


// ---------- Recorrido desde cero: orden, ejercicios y audios ----------

function claveLeccion(nombre) {
  const c = codigoDeArchivo(nombre);
  const zonas = { PREA1: 0, A1: 1, A2: 2 };
  let m = c.match(/^(PREA1|A1|A2)-U(\d\d)-L(\d\d)$/);
  if (m) return zonas[m[1]] * 10000 + Number(m[2]) * 100 + Number(m[3]);
  m = c.match(/^SALTO-(PREA1|A1)-/);
  if (m) return zonas[m[1]] * 10000 + 9900;
  if (/^PUENTE-/.test(c)) return 30000;
  return 40000;
}

let manifiestoAudio = null;
function audiosDe(ids) {
  if (!CFG.audio) return null;
  if (!manifiestoAudio) {
    const ruta = path.join(MATERIAL, CFG.audio);
    manifiestoAudio = {};
    if (fs.existsSync(ruta)) {
      JSON.parse(fs.readFileSync(ruta, "utf8")).audios.forEach((a) => { manifiestoAudio[a.id] = a; });
    }
  }
  const out = {};
  ids.forEach((id) => {
    const a = manifiestoAudio[id];
    if (!a) { errores.push(`audio ${id} no está en ${CFG.audio}`); return; }
    // Solo viaja lo que la app necesita: el texto para la voz local del navegador,
    // la duración y el estado. Nunca la ruta del archivo en el Drive.
    out[id] = { texto: a.texto || "", duracion_s: a.duracion_s || null, estado: a.estado, funcion: a.funcion || null, descripcion: a.descripcion || null };
  });
  return out;
}

function ejerciciosDe(codigo) {
  if (!CFG.ejercicios) return null;
  const ruta = path.join(MATERIAL, CFG.ejercicios, `${codigo}.ejercicios.json`);
  if (!fs.existsSync(ruta)) { errores.push(`${codigo}: falta ${path.basename(ruta)}`); return null; }
  let data;
  try { data = JSON.parse(fs.readFileSync(ruta, "utf8")); } catch (e) { errores.push(`${codigo}: ejercicios JSON inválido`); return null; }
  // El campo qa es trazabilidad de producción: se queda en el Drive. A la app y a
  // Supabase solo viaja lo que el alumno usa.
  const items = (Array.isArray(data.ejercicios) ? data.ejercicios : []).map((e) => { const { qa, ...resto } = e; return resto; });
  const texto = JSON.stringify(items);
  if (texto.includes("—")) errores.push(`${codigo}: em dash en los ejercicios`);
  return items;
}

function listaMeta(valor) {
  if (Array.isArray(valor)) return valor.map((x) => String(x).trim()).filter(Boolean);
  if (typeof valor === "string" && valor.trim()) return valor.split(",").map((x) => x.trim()).filter(Boolean);
  return [];
}

const errores = [];
const avisos = [];
const piezas = [];
const codigosVistos = new Set();
const seccionesInternasOmitidas = [];
const fuentesLeidas = [];
let cabecerasInternasOmitidas = 0;

for (const fuente of FUENTES) {
  const dir = path.join(MATERIAL, fuente.dir);
  if (!fs.existsSync(dir)) {
    avisos.push(`${fuente.dir}: la carpeta no existe todavía en el Drive, se salta`);
    continue;
  }
  const archivos = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  // Las lecciones del recorrido desde cero se ordenan por zona, unidad y lección,
  // no alfabéticamente (A1 iría antes que PREA1). Los saltos cierran su zona y el
  // puente va al final.
  if (fuente.tipo === "leccion") archivos.sort((a, b) => claveLeccion(a) - claveLeccion(b));
  if (!archivos.length) {
    avisos.push(`${fuente.dir}: la carpeta está vacía, se salta`);
    continue;
  }

  for (const archivo of archivos) {
    const codigo = codigoDeArchivo(archivo);
    if (SOLO && codigo !== SOLO) continue;

    const rutaFuente = path.join(dir, archivo);
    const bytesFuente = fs.readFileSync(rutaFuente);
    const bruto = bytesFuente.toString("utf8");
    fuentesLeidas.push({
      ruta: path.posix.join(fuente.dir, archivo),
      sha256: createHash("sha256").update(bytesFuente).digest("hex"),
    });
    const partido = partirFrontMatter(bruto);
    if (!partido) { errores.push(`${archivo}: sin front-matter YAML al principio`); continue; }

    const { meta, cuerpo } = partido;
    const codigoFinal = String(meta.codigo || codigo).toUpperCase();

    if (!CODIGO_VALIDO.test(codigoFinal)) { errores.push(`${archivo}: código "${codigoFinal}" con formato inválido`); continue; }
    if (codigosVistos.has(codigoFinal)) { errores.push(`${archivo}: código ${codigoFinal} duplicado`); continue; }
    codigosVistos.add(codigoFinal);

    if (String(meta.lupa || "").toUpperCase() === "FAIL") errores.push(`${codigoFinal}: lupa en FAIL, la pieza no sale`);
    if (cuerpo.includes("—")) errores.push(`${codigoFinal}: em dash (—) en el cuerpo`);

    const seccionesLeidas = trocearSecciones(cuerpo, codigoFinal === "KIT_ORAL_21_JORNADAS");
    const secciones = seccionesLeidas
      .filter((s) => !SECCIONES_INTERNAS.has(s.id))
      .map((s) => ({ ...s, html: sanearHtmlParaAlumno(codigoFinal, s) }))
      .filter((s) => textoPlanoHtml(s.html));
    seccionesLeidas.filter((s) => SECCIONES_INTERNAS.has(s.id)).forEach((s) => {
      seccionesInternasOmitidas.push(`${codigoFinal}:${s.id}`);
    });
    secciones.forEach((s) => {
      const textoSeccion = `${s.titulo || ""} ${textoPlanoHtml(s.html)}`;
      if (CABECERA_PRODUCCION_HTML.test(s.html || "")) {
        errores.push(`${codigoFinal}:${s.id}: cabecera de producción interna en artefacto de alumno`);
      }
      if (CONTENIDO_EDITORIAL_INTERNO.test(textoSeccion)) {
        errores.push(`${codigoFinal}:${s.id}: contenido editorial interno en artefacto de alumno`);
      }
      if (RUTA_INTERNA_CURSO.test(`${s.titulo || ""} ${s.html || ""}`) || RUTA_INTERNA_CURSO.test(textoSeccion)) {
        errores.push(`${codigoFinal}:${s.id}: ruta interna en artefacto de alumno`);
      }
      if (RUIDO_PRODUCCION_ALUMNO.test(textoSeccion)) {
        errores.push(`${codigoFinal}:${s.id}: lenguaje de producción en artefacto de alumno`);
      }
    });
    const palabras = contarPalabrasSecciones(secciones);
    if (!secciones.length || palabras < 50) { errores.push(`${codigoFinal}: contenido vacío o demasiado corto (${palabras} palabras)`); continue; }

    if (!meta.lupa) avisos.push(`${codigoFinal}: sin campo lupa en el front-matter`);
    const tipoFinal = codigoFinal === "ANEXO-UTTRYKK" ? "anexo" : fuente.tipo;
    let metaPieza;
    if (fuente.tipo === "leccion") {
      // Recorrido desde cero: el front-matter de la lección es la ficha del alumno
      // (zona, misión, competencias, prerrequisitos) y viaja con la pieza. El estado
      // de QA se exporta tal cual está declarado: la subida a Supabase lo exige
      // cerrado y por eso ninguna lección sin sus seis pasadas puede publicarse.
      const idsAudio = listaMeta(meta.audio);
      const ejercicios = ejerciciosDe(codigoFinal) || [];
      ejercicios.forEach((e) => { if (e.audio && idsAudio.indexOf(e.audio) < 0) idsAudio.push(e.audio); });
      metaPieza = {
        ruta: RUTA,
        zona: meta.zona || null,
        unidad: meta.unidad || null,
        mision: meta.mision || null,
        objetivo: meta.objetivo_comunicativo || null,
        conocimientos_previos: listaMeta(meta.conocimientos_previos),
        conexion_posterior: listaMeta(meta.conexion_posterior),
        conexion_m01_m16: listaMeta(meta.conexion_m01_m16),
        competencias: listaMeta(meta.competencias),
        destrezas: listaMeta(meta.destrezas),
        evidencia: meta.evidencia_salida || null,
        larsito: meta.larsito || null,
        audio: idsAudio,
        audios: audiosDe(idsAudio),
        ejercicios,
        lupa: meta.lupa || null,
        qa_lengua: meta.qa_lengua || null,
        qa_lengua_alcance: meta.qa_lengua_alcance || "NO_FIRMA_HUMANA_NATIVA",
      };
    } else {
      metaPieza = {
        piezas_canon: meta.piezas_canon || null,
        unidades_destino: meta.unidades_destino || null,
        delprover: meta.delprover || null,
        lupa: meta.lupa || null,
        // Política única de producto: la QA existente de esta v1 se acepta como
        // sistémica/técnica. No se exporta bajo el nombre revision_nativa porque
        // no existe una firma humana o nativa.
        qa_lengua: "SISTEMICA_TECNICA_ACEPTADA",
        qa_lengua_alcance: "NO_FIRMA_HUMANA_NATIVA",
      };
    }
    piezas.push({
      codigo: codigoFinal,
      tipo: tipoFinal,
      titulo: tituloDe(meta, cuerpo, codigoFinal),
      orden: piezas.length + 1,
      meta: metaPieza,
      secciones,
      palabras,
      grieta: fraseDeGrieta(cuerpo, secciones),
    });
  }
}

// ---------- Informe y validación ----------

const porTipo = {};
piezas.forEach((p) => { porTipo[p.tipo] = (porTipo[p.tipo] || 0) + 1; });
const palabrasTotales = piezas.reduce((n, p) => n + p.palabras, 0);
const seccionesTotales = piezas.reduce((n, p) => n + p.secciones.length, 0);
const fuentesManifest = ordenarFuentes(fuentesLeidas);
const fuentesSha256 = fingerprintFuentes(fuentesManifest);
const exportadorSha256 = createHash("sha256").update(fs.readFileSync(EXPORTADOR_ARCHIVO)).digest("hex");

console.log(`Material leído en: ${MATERIAL}`);
console.log(`Piezas: ${piezas.length} (${Object.entries(porTipo).map(([t, n]) => `${t} ${n}`).join(" · ") || "ninguna"})`);
console.log(`Secciones: ${seccionesTotales} · Palabras: ${palabrasTotales.toLocaleString("es-ES")}`);
console.log(`Secciones editoriales omitidas de las superficies: ${seccionesInternasOmitidas.length}`);
console.log(`Cabeceras internas de mecanismo omitidas: ${cabecerasInternasOmitidas}`);
console.log(`Fingerprint de ${fuentesManifest.length} fuentes: ${fuentesSha256}`);
console.log(`Exportador SHA-256: ${exportadorSha256}`);

if (avisos.length) console.log(`\nAVISOS (${avisos.length}):\n- ${avisos.join("\n- ")}`);
if (errores.length) {
  console.error(`\nERRORES (${errores.length}), no se escribe nada:\n- ${errores.join("\n- ")}`);
  process.exit(1);
}
if (!piezas.length) {
  console.error("\nERRORES (1), no se escribe nada:\n- no se ha leído ninguna pieza");
  process.exit(1);
}

// ---------- La demo pública ----------
// Es lo único de este pipeline que puede entrar en el repo, así que aquí solo cabe
// el mecanismo M01 entero, el índice de los otros quince sin cuerpo y la entrada
// del diagnóstico. El resto del curso no se toca.

function piezaLimpia(p) {
  const { grieta, ...resto } = p;
  return resto;
}

function construirDemoDesdeCero() {
  const abiertas = CFG.demoAbiertas.map((c) => piezas.find((p) => p.codigo === c)).filter(Boolean);
  if (abiertas.length !== CFG.demoAbiertas.length) { avisos.push("faltan piezas abiertas de la demo del recorrido desde cero"); }
  const indice = piezas
    .filter((p) => CFG.demoAbiertas.indexOf(p.codigo) < 0)
    .map((p) => ({ codigo: p.codigo, tipo: p.tipo, titulo: p.titulo, orden: p.orden, zona: p.meta.zona, unidad: p.meta.unidad, resumen: p.meta.mision || "" }));
  return {
    meta: {
      producto: CFG.producto,
      ruta: RUTA,
      actualizado: new Date().toISOString().slice(0, 10),
      aviso: "Material propio de NEXO NORSK. NEXO NORSK es un proyecto independiente y no tiene relación con HK-dir, con UDI ni con ningún centro de examen. Este recorrido no promete un nivel, un aprobado ni un trámite.",
      piezas_totales: piezas.length,
      lecciones_totales: piezas.filter((p) => p.tipo === "leccion").length,
    },
    // La demo es pública: viaja sin los estados editoriales (lupa, qa_lengua), que
    // son control de producción y ya los aplica la subida a Supabase.
    piezas: abiertas.map((p) => {
      const meta = Object.assign({}, p.meta);
      delete meta.lupa; delete meta.qa_lengua; delete meta.qa_lengua_alcance;
      return Object.assign({}, piezaLimpia(p), { meta, orden: p.orden, resumen: p.meta.mision || "" });
    }),
    indice,
  };
}

function construirDemo() {
  if (CFG.demoAbiertas) return construirDemoDesdeCero();
  const m01 = piezas.find((p) => p.codigo === "M01");
  if (!m01) { avisos.push("no hay M01: la demo se queda sin mecanismo de muestra"); return null; }

  // La lectura principal ya separó las secciones editoriales internas del curso
  // completo. Este filtro repetido es una defensa adicional para el artefacto
  // público si en el futuro cambia la construcción de piezas.
  const mecanismoDemo = Object.assign({}, m01, {
    secciones: m01.secciones.filter((s) => !SECCIONES_INTERNAS.has(s.id)),
  });

  const indice = piezas
    .filter((p) => p.tipo === "mecanismo" && p.codigo !== "M01")
    .map((p) => ({ codigo: p.codigo, titulo: p.titulo, grieta: p.grieta }));

  // Del diagnóstico solo entra la introducción: la entrada del documento y su
  // primera sección, que explican por qué la prueba no da un número. Las cuatro
  // pruebas, la rúbrica y las soluciones son de pago y se quedan fuera.
  const diag = piezas.find((p) => p.tipo === "diagnostico");
  const introDiagnostico = diag
    ? {
      codigo: diag.codigo,
      titulo: diag.titulo,
      parcial: true,
      nota: "Solo la introducción. Las cuatro pruebas, la rúbrica y las soluciones están en el curso.",
      secciones: diag.secciones.slice(0, 2),
    }
    : null;
  if (!diag) avisos.push("no hay diagnóstico: la demo se queda sin su introducción");

  return {
    meta: {
      producto: "NEXO NORSK · Ruta Norskprøven B1",
      actualizado: new Date().toISOString().slice(0, 10),
      aviso: "Material propio de NEXO NORSK, de formato similar al que HK-dir describe en su web. NEXO NORSK es un proyecto independiente y no tiene relación con HK-dir, con UDI ni con ningún centro de examen.",
      piezas_totales: piezas.length,
      mecanismos_totales: porTipo.mecanismo || 0,
    },
    mecanismo: piezaLimpia(mecanismoDemo),
    indice,
    diagnostico: introDiagnostico,
  };
}

// Comprobación del artefacto público: la demo es el escaparate y encima va al repo,
// así que se revisa antes de escribirla.
function revisarDemo(demo) {
  const fallos = [];
  const texto = JSON.stringify(demo);
  const seccionesAlumno = [
    ...((demo.mecanismo && demo.mecanismo.secciones) || []),
    ...((demo.diagnostico && demo.diagnostico.secciones) || []),
    ...((demo.piezas || []).flatMap((p) => p.secciones || [])),
  ];
  const textoAlumno = seccionesAlumno.map((s) => `${s.titulo || ""} ${s.html || ""}`).join(" ");
  if (texto.includes("—")) fallos.push("em dash en la demo");
  if (/increíble|brutal|paraíso|trucos|hola chicos/i.test(texto)) fallos.push("palabra prohibida de marca en la demo");
  if (/\b(celular|manejar|acá|computadora|plata|carro)\b/i.test(texto)) fallos.push("marcador no peninsular en la demo");
  if (CFG.demoAbiertas) {
    if (!Array.isArray(demo.piezas) || demo.piezas.length !== CFG.demoAbiertas.length) fallos.push("la demo no lleva las piezas abiertas previstas");
  } else if (!demo.mecanismo || !demo.mecanismo.secciones.length) fallos.push("la demo no lleva el mecanismo M01 entero");
  // Nadie más que M01 puede llevar cuerpo en la demo.
  demo.indice.forEach((m) => {
    if (m.secciones || m.html) fallos.push(`${m.codigo}: el índice de la demo lleva cuerpo`);
  });
  const internas = seccionesAlumno.filter((s) => SECCIONES_INTERNAS.has(s.id));
  if (internas.length) fallos.push(`la demo lleva ${internas.length} sección(es) editorial(es) interna(s)`);
  if (CONTENIDO_EDITORIAL_INTERNO.test(textoAlumno)) {
    fallos.push("la demo expone notas, dudas o puertas editoriales internas");
  }
  if (CABECERA_PRODUCCION_HTML.test(textoAlumno)) fallos.push("la demo expone una cabecera de producción");
  if (RUTA_INTERNA_CURSO.test(textoAlumno)) fallos.push("la demo expone una ruta interna");
  if (RUIDO_PRODUCCION_ALUMNO.test(textoPlanoHtml(textoAlumno))) fallos.push("la demo expone lenguaje de producción");
  return fallos;
}

if (DRY) {
  console.log("\n--dry: validación OK, no se escribe nada.");
  process.exit(0);
}

fs.mkdirSync(SALIDA, { recursive: true });

const curso = piezas.map(piezaLimpia);

// Con --solo la salida va a un archivo aparte y no se toca nada más. Es una lupa
// para mirar una pieza, no una exportación: si machacara curso.json, la siguiente
// subida daría por retiradas las otras veinticuatro y las desactivaría en Supabase.
if (SOLO) {
  const soloSalida = path.join(SALIDA, "curso-solo.json");
  fs.writeFileSync(soloSalida, JSON.stringify(curso, null, 1));
  console.log(`\nEscrito ${soloSalida}: ${curso.length} pieza.`);
  console.log("No se han tocado curso.json, la demo ni el manifiesto: --solo es solo para mirar.");
  process.exit(0);
}

const cursoJson = JSON.stringify(curso, null, 1);
const cursoSha256 = createHash("sha256").update(cursoJson, "utf8").digest("hex");
fs.writeFileSync(path.join(SALIDA, "curso.json"), cursoJson);
console.log(`\nEscrito ${path.join(SALIDA, "curso.json")}: ${curso.length} piezas.`);

const demo = construirDemo();
if (!demo) {
  console.error("No se ha podido construir la demo.");
  process.exit(1);
}
const fallos = revisarDemo(demo);
if (fallos.length) {
  console.error(`\nERRORES en la demo (no se escribe):\n- ${fallos.join("\n- ")}`);
  process.exit(1);
}
{
  const json = JSON.stringify(demo, null, 1);
  fs.writeFileSync(path.join(SALIDA, "curso-demo.json"), json);
  fs.writeFileSync(DEMO_PUBLICA, json);
  console.log(`Escrito ${path.join(SALIDA, "curso-demo.json")} y su copia pública ${DEMO_PUBLICA}:`);
  if (demo.mecanismo) {
    console.log(`  M01 (${demo.mecanismo.secciones.length} secciones, ${demo.mecanismo.palabras} palabras)` +
      ` + índice de ${demo.indice.length} mecanismos` +
      (demo.diagnostico ? ` + introducción del diagnóstico (${demo.diagnostico.secciones.length} secciones)` : " sin diagnóstico"));
  } else {
    console.log(`  ${demo.piezas.map((p) => `${p.codigo} (${p.secciones.length} secciones, ${p.palabras} palabras)`).join(" + ")} + índice de ${demo.indice.length} piezas`);
  }
}

const manifiesto = {
  generado: new Date().toISOString(),
  ruta: RUTA,
  material: MATERIAL,
  piezas: piezas.length,
  por_tipo: porTipo,
  secciones: seccionesTotales,
  palabras: palabrasTotales,
  codigos: piezas.map((p) => p.codigo),
  fingerprint_version: FINGERPRINT_VERSION,
  fuentes_sha256: fuentesSha256,
  fuentes: fuentesManifest,
  curso_sha256: cursoSha256,
  exportador_sha256: exportadorSha256,
};
fs.writeFileSync(path.join(SALIDA, "manifiesto.json"), JSON.stringify(manifiesto, null, 1));
console.log(`Escrito ${path.join(SALIDA, "manifiesto.json")}.`);
console.log(`\nSiguiente paso: node scripts/norsk_curso_build.mjs --ruta=${RUTA} --dry para ver qué subiría a Supabase.`);
