#!/usr/bin/env node
// Autotest sin navegador de norsk/curso/practica.js: el banco de ejercicios de cada
// mecanismo tiene que ser grande, estar hecho solo con el noruego ya revisado de la
// pieza (más el anexo de expresiones cuando existe) y no romperse con las variantes
// de formato de cada archivo. Con el curso completo en disco (api/_curso_privado.js,
// fuera del repo) recorre los 16 mecanismos; si no, la pieza abierta de la demo.
// Con --meta escribe data/norsk-practica-meta.json (totales por pieza para la web).
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import vm from "node:vm";

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", hellip: "…" };
function decode(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return Object.prototype.hasOwnProperty.call(ENT, e) ? ENT[e] : m;
  });
}
const fakeDocument = {
  createElement() {
    return { _html: "", set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; }, get value() { return decode(this._html); }, get textContent() { return decode(this._html.replace(/<[^>]+>/g, "")); } };
  },
};
const sandbox = { window: undefined, document: fakeDocument, navigator: {}, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL("../norsk/curso/practica.js", import.meta.url), "utf8"), sandbox);
const P = sandbox.NexoPractica;

let piezas, anexo = null, completo = false;
const privado = new URL("../api/_curso_privado.js", import.meta.url);
if (existsSync(privado)) {
  const raw = readFileSync(privado, "utf8");
  const todas = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)).piezas;
  piezas = todas.filter((p) => p.tipo === "mecanismo");
  anexo = todas.find((p) => p.codigo === "ANEXO-UTTRYKK") || null;
  completo = true;
} else {
  const demo = JSON.parse(readFileSync(new URL("../data/norsk-curso-demo.json", import.meta.url), "utf8"));
  piezas = [demo.mecanismo];
}

const fallos = [];
const tipos = {};
const porPieza = {};
let total = 0;
for (const pieza of piezas.sort((a, b) => a.codigo.localeCompare(b.codigo))) {
  let b;
  const anexoHtml = P.seccionAnexo(anexo, pieza.codigo);
  try { b = P.banco(pieza, anexoHtml); } catch (e) { fallos.push(`${pieza.codigo}: excepción ${e.message}`); continue; }
  for (const it of b.items) {
    tipos[it.tipo] = (tipos[it.tipo] || 0) + 1;
    if ((it.tipo === "ordena" || it.tipo === "transforma" || it.tipo === "escribe") && it.solucion.join(" ").toLowerCase() !== String(it.frase || it.respuesta || "").toLowerCase()) fallos.push(`${pieza.codigo}: ${it.tipo} no reconstruye la frase original (${it.solucion.join(" ")})`);
    if ((it.tipo === "mc" || it.tipo === "elige") && (it.opciones.length < 3 || it.correcta < 0 || it.correcta >= it.opciones.length)) fallos.push(`${pieza.codigo}: ${it.tipo} con opciones inválidas (${it.pregunta.slice(0, 40)})`);
    if ((it.tipo === "mc" || it.tipo === "elige") && new Set(it.opciones).size !== it.opciones.length) fallos.push(`${pieza.codigo}: ${it.tipo} con opciones repetidas (${it.pregunta.slice(0, 40)})`);
    if (it.tipo === "completa" && it.opciones.indexOf(it.respuesta) < 0) fallos.push(`${pieza.codigo}: completa sin la respuesta entre las opciones`);
    if (it.tipo === "empareja" && it.pares.length < 3) fallos.push(`${pieza.codigo}: empareja con menos de 3 pares`);
  }
  // Tres tandas seguidas no deben repetir ejercicio mientras queden sin ver.
  const vistos = {};
  const ids = new Set();
  for (let k = 0; k < 3; k++) {
    const t = P.tanda(b.items, { vistos, semilla: `${pieza.codigo}:todos:${k}` });
    if (t.items.length !== 8) fallos.push(`${pieza.codigo}: tanda ${k} con ${t.items.length} ejercicios`);
    for (const it of t.items) { if (ids.has(it.id)) fallos.push(`${pieza.codigo}: repite ${it.id} antes de agotar el banco`); ids.add(it.id); vistos[it.id] = true; }
  }
  porPieza[pieza.codigo] = b.items.length;
  total += b.items.length;
  console.log(`  ${pieza.codigo}: ${b.items.length} ejercicios ${JSON.stringify(b.porTipo)} · fuentes ${JSON.stringify(b.fuentes)}`);
  if (b.items.length < (completo ? 75 : 60)) fallos.push(`${pieza.codigo}: solo ${b.items.length} ejercicios`);
  if (!b.fuentes.bloques) fallos.push(`${pieza.codigo}: sin bloques para llevarte`);
}
// Diagnóstico del fallo: casos fijos que no dependen del contenido.
{
  const d = P.diagnosticar;
  const sol = ["neste", "uke", "begynner", "hun", "på", "den", "nye", "avdelingen."];
  const v2 = d({ tipo: "ordena", solucion: sol }, "neste uke hun begynner på den nye avdelingen.", "M01");
  if (!/intercambiado «hun», «begynner»/.test(v2) || !/«begynner» es el verbo y va justo después de «neste uke», en segunda posición/.test(v2) || !/Regla de la pieza/.test(v2)) fallos.push("diagnóstico: orden V2 no explica el intercambio (" + v2 + ")");
  const hueco = d({ tipo: "completa", respuesta: "at" }, "om", "M09");
  if (!/Has puesto «om»; aquí va «at»/.test(hueco) || !/afirmación/.test(hueco)) fallos.push("diagnóstico: hueco at/om sin explicación (" + hueco + ")");
  const esc = d({ tipo: "escribe", respuesta: "Hun sa at hun ikke kunne komme.", solucion: ["hun", "sa", "at", "hun", "ikke", "kunne", "komme."] }, "Hun sa at hun kunne komme.", "M09");
  if (!/Te falta «ikke»/.test(esc)) fallos.push("diagnóstico: escrito no detecta la palabra que falta (" + esc + ")");
  const err = d({ tipo: "escribe", respuesta: "Jeg forsto ingenting.", solucion: ["jeg", "forsto", "ingenting."] }, "Jeg forstå ingenting.", "M04");
  if (!/Revisa «forstå»/.test(err)) fallos.push("diagnóstico: escrito no detecta la errata (" + err + ")");
  const sub = d({ tipo: "ordena", solucion: ["hun", "sa", "at", "hun", "ikke", "kunne", "komme."] }, "hun sa at hun kunne ikke komme.", "M02");
  if (!/«ikke» va delante del verbo porque está dentro de una subordinada/.test(sub)) fallos.push("diagnóstico: adverbio en subordinada (" + sub + ")");
  const noVerbo = d({ tipo: "ordena", solucion: ["etter", "min", "mening", "bør"] }, "etter mening min bør", "M01");
  if (/es el verbo/.test(noVerbo) || !/«min» va justo después de «etter»/.test(noVerbo)) fallos.push("diagnóstico: llama verbo a lo que no lo es (" + noVerbo + ")");
  if (!fallos.some((f) => f.startsWith("diagnóstico"))) console.log("  diagnóstico del fallo: intercambio, V2, hueco at/om, palabra que falta, errata y adverbio en subordinada OK");
}
console.log("  tipos en total:", JSON.stringify(tipos), "· total:", total);
if (fallos.length) { console.log("\nFALLOS:\n  " + fallos.slice(0, 40).join("\n  ")); process.exit(1); }
if (completo && process.argv.includes("--meta")) {
  const meta = { version: 1, actualizado: new Date().toISOString().slice(0, 10), ejercicios_totales: total, por_pieza: porPieza };
  writeFileSync(new URL("../data/norsk-practica-meta.json", import.meta.url), JSON.stringify(meta, null, 2) + "\n");
  console.log("  data/norsk-practica-meta.json escrito");
}
if (completo && existsSync(new URL("../data/norsk-practica-meta.json", import.meta.url))) {
  const meta = JSON.parse(readFileSync(new URL("../data/norsk-practica-meta.json", import.meta.url), "utf8"));
  if (Math.abs(meta.ejercicios_totales - total) > total * 0.15) { console.log(`\nFALLO: data/norsk-practica-meta.json dice ${meta.ejercicios_totales} y el banco real es ${total}; regenera con --meta`); process.exit(1); }
}
console.log(`\nPASS norsk_practica_selftest: ${piezas.length} pieza(s), ${total} ejercicios sin inventar noruego`);
