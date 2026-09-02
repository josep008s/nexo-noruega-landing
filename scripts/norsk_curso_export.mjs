// Exporta a JSON el material del curso Norskprøven B1 (NEXO NORSK, línea Idioma).
// Uso:  node scripts/norsk_curso_export.mjs [--dry] [--solo=M01]
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

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Carpeta canónica del material en el Drive. El curso se escribe y se revisa ahí:
// este script solo lee, nunca escribe en el Drive.
const MATERIAL = "/Users/josep/Library/CloudStorage/GoogleDrive-josep.muttt@gmail.com/Mi unidad/Business/Nexo Noruega/norsk/idioma/rutas/norskproven-b1";

const SALIDA = path.join(ROOT, "scripts", "_norsk_curso");
const DEMO_PUBLICA = path.join(ROOT, "data", "norsk-curso-demo.json");

const DRY = process.argv.includes("--dry");
const SOLO = (process.argv.find((a) => a.startsWith("--solo=")) || "").slice(7).trim().toUpperCase() || null;

// Orden de lectura, que es también el orden del curso: primero el diagnóstico de
// entrada (módulo 0), después los dieciséis mecanismos y al final el material por
// destreza. Las carpetas que aún no tienen contenido avisan y no rompen nada.
const FUENTES = [
  { dir: "00_diagnostico", tipo: "diagnostico" },
  { dir: "01_mecanismos", tipo: "mecanismo" },
  { dir: "02_lytt/guiones", tipo: "lytt" },
  { dir: "03_les", tipo: "les" },
  { dir: "04_skriv", tipo: "skriv" },
  { dir: "05_muntlig", tipo: "muntlig" },
  { dir: "06_simulacros", tipo: "simulacro" },
];

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
]);

// Defensa de contenido, independiente de los títulos. Estos marcadores describen
// QA, trazabilidad o trabajo editorial y no deben aparecer en el artefacto que ve
// el alumno. Se acotan a fórmulas de producción: no se prohíben expresiones
// pedagógicas legítimas como "otra persona", el piloto de un aparato o el
// consentimiento dentro de un ejemplo de vocabulario.
const CONTENIDO_EDITORIAL_INTERNO = /contraste humano|revisi[oó]n nativa|registro (?:hist[oó]rico )?de dudas|puerta editorial|firma (?:humana|nativa)|revisi[oó]n sist[eé]mica|revisi[oó]n de bokm[aå]l|qa (?:sist[eé]mic[oa]|t[eé]cnic[oa]|de audio)|material interno|material publicable|no es copy|estado (?:de producci[oó]n|y trabajo abierto)|puertas abiertas de este documento|hoja interna|\bcohorte\b|\breclutamiento\b|circuito (?:con personas|de alumnos)|(?:no hay|no se incluye)[^.!?]{0,120}\bconsentimiento\b|\bla lupa\b|pass_con_avisos|orden (?:expresa )?de publicaci[oó]n|publicaci[oó]n (?:sigue|se registra|conserva|es una puerta)|puertas? (?:t[eé]cnicas? y )?de publicaci[oó]n|autorizar (?:la )?publicaci[oó]n|autorizar su uso p[uú]blico/i;

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

// La fuente Markdown conserva toda la trazabilidad. Esta función solo limpia la
// copia de alumno y opera de forma determinista sobre bloques completos. Las dos
// sustituciones en línea conservan ejercicios legítimos que antes llevaban una
// coletilla editorial dentro del mismo párrafo.
function sanearHtmlParaAlumno(codigo, seccion) {
  let html = seccion.html;

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

const errores = [];
const avisos = [];
const piezas = [];
const codigosVistos = new Set();
const seccionesInternasOmitidas = [];
const fuentesLeidas = [];

for (const fuente of FUENTES) {
  const dir = path.join(MATERIAL, fuente.dir);
  if (!fs.existsSync(dir)) {
    avisos.push(`${fuente.dir}: la carpeta no existe todavía en el Drive, se salta`);
    continue;
  }
  const archivos = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
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
      .filter((s) => s.html);
    seccionesLeidas.filter((s) => SECCIONES_INTERNAS.has(s.id)).forEach((s) => {
      seccionesInternasOmitidas.push(`${codigoFinal}:${s.id}`);
    });
    secciones.forEach((s) => {
      if (CONTENIDO_EDITORIAL_INTERNO.test(`${s.titulo || ""} ${textoPlanoHtml(s.html)}`)) {
        errores.push(`${codigoFinal}:${s.id}: contenido editorial interno en artefacto de alumno`);
      }
    });
    const palabras = contarPalabrasSecciones(secciones);
    if (!secciones.length || palabras < 50) { errores.push(`${codigoFinal}: contenido vacío o demasiado corto (${palabras} palabras)`); continue; }

    if (!meta.lupa) avisos.push(`${codigoFinal}: sin campo lupa en el front-matter`);
    const tipoFinal = codigoFinal === "ANEXO-UTTRYKK" ? "anexo" : fuente.tipo;
    piezas.push({
      codigo: codigoFinal,
      tipo: tipoFinal,
      titulo: tituloDe(meta, cuerpo, codigoFinal),
      orden: piezas.length + 1,
      meta: {
        piezas_canon: meta.piezas_canon || null,
        unidades_destino: meta.unidades_destino || null,
        delprover: meta.delprover || null,
        lupa: meta.lupa || null,
        // Política única de producto: la QA existente de esta v1 se acepta como
        // sistémica/técnica. No se exporta bajo el nombre revision_nativa porque
        // no existe una firma humana o nativa.
        qa_lengua: "SISTEMICA_TECNICA_ACEPTADA",
        qa_lengua_alcance: "NO_FIRMA_HUMANA_NATIVA",
      },
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

console.log(`Material leído en: ${MATERIAL}`);
console.log(`Piezas: ${piezas.length} (${Object.entries(porTipo).map(([t, n]) => `${t} ${n}`).join(" · ") || "ninguna"})`);
console.log(`Secciones: ${seccionesTotales} · Palabras: ${palabrasTotales.toLocaleString("es-ES")}`);
console.log(`Secciones editoriales omitidas de las superficies: ${seccionesInternasOmitidas.length}`);
console.log(`Fingerprint de ${fuentesManifest.length} fuentes: ${fuentesSha256}`);

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

function construirDemo() {
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
  ];
  const textoAlumno = seccionesAlumno.map((s) => `${s.titulo || ""} ${s.html || ""}`).join(" ");
  if (texto.includes("—")) fallos.push("em dash en la demo");
  if (/increíble|brutal|paraíso|trucos|hola chicos/i.test(texto)) fallos.push("palabra prohibida de marca en la demo");
  if (/\b(celular|manejar|acá|computadora|plata|carro)\b/i.test(texto)) fallos.push("marcador no peninsular en la demo");
  if (!demo.mecanismo || !demo.mecanismo.secciones.length) fallos.push("la demo no lleva el mecanismo M01 entero");
  // Nadie más que M01 puede llevar cuerpo en la demo.
  demo.indice.forEach((m) => {
    if (m.secciones || m.html) fallos.push(`${m.codigo}: el índice de la demo lleva cuerpo`);
  });
  const internas = seccionesAlumno.filter((s) => SECCIONES_INTERNAS.has(s.id));
  if (internas.length) fallos.push(`la demo lleva ${internas.length} sección(es) editorial(es) interna(s)`);
  if (CONTENIDO_EDITORIAL_INTERNO.test(textoAlumno)) {
    fallos.push("la demo expone notas, dudas o puertas editoriales internas");
  }
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
  console.log(`  M01 (${demo.mecanismo.secciones.length} secciones, ${demo.mecanismo.palabras} palabras)` +
    ` + índice de ${demo.indice.length} mecanismos` +
    (demo.diagnostico ? ` + introducción del diagnóstico (${demo.diagnostico.secciones.length} secciones)` : " sin diagnóstico"));
}

const manifiesto = {
  generado: new Date().toISOString(),
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
};
fs.writeFileSync(path.join(SALIDA, "manifiesto.json"), JSON.stringify(manifiesto, null, 1));
console.log(`Escrito ${path.join(SALIDA, "manifiesto.json")}.`);
console.log("\nSiguiente paso: node scripts/norsk_curso_build.mjs --dry para ver qué subiría a Supabase.");
