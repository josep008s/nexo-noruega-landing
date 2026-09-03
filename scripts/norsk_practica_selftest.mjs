#!/usr/bin/env node
// Autotest sin navegador de norsk/curso/practica.js: el generador de ejercicios
// interactivos tiene que producir una tanda completa para cada mecanismo con el
// noruego ya revisado de la pieza (bloques, ficha T, ficha P, ficha E), sin
// inventar frases y sin romperse con las variantes de formato de cada archivo.
// Usa el curso completo si está en el disco (api/_curso_privado.js, fuera del
// repo) y, si no, la pieza abierta de la demo pública.
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", hellip: "…" };
function decode(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return Object.prototype.hasOwnProperty.call(ENT, e) ? ENT[e] : m;
  });
}
// DOM mínimo: solo lo que usa la extracción (textarea.innerHTML → value).
const fakeDocument = {
  createElement() {
    const n = { _html: "", set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; }, get value() { return decode(this._html); }, get textContent() { return decode(this._html.replace(/<[^>]+>/g, "")); } };
    return n;
  },
};
const sandbox = { window: undefined, document: fakeDocument, navigator: {}, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL("../norsk/curso/practica.js", import.meta.url), "utf8"), sandbox);
const P = sandbox.NexoPractica;

let piezas;
const privado = new URL("../api/_curso_privado.js", import.meta.url);
if (existsSync(privado)) {
  const raw = readFileSync(privado, "utf8");
  piezas = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)).piezas.filter((p) => p.tipo === "mecanismo");
} else {
  const demo = JSON.parse(readFileSync(new URL("../data/norsk-curso-demo.json", import.meta.url), "utf8"));
  piezas = [demo.mecanismo];
}

const fallos = [];
const tipos = {};
for (const pieza of piezas.sort((a, b) => a.codigo.localeCompare(b.codigo))) {
  let g;
  try { g = P.generar(pieza, 0); } catch (e) { fallos.push(`${pieza.codigo}: excepción ${e.message}`); continue; }
  const cuenta = {};
  for (const it of g.items) {
    cuenta[it.tipo] = (cuenta[it.tipo] || 0) + 1;
    tipos[it.tipo] = (tipos[it.tipo] || 0) + 1;
    if ((it.tipo === "ordena" || it.tipo === "transforma" || it.tipo === "escribe") && it.solucion.join(" ").toLowerCase() !== String(it.frase || it.respuesta || "").toLowerCase()) fallos.push(`${pieza.codigo}: ${it.tipo} no reconstruye la frase original (${it.solucion.join(" ")})`);
    if (it.tipo === "mc" && (it.opciones.length < 3 || it.correcta >= it.opciones.length)) fallos.push(`${pieza.codigo}: mc con opciones inválidas (E${it.id})`);
    if (it.tipo === "completa" && it.opciones.indexOf(it.respuesta) < 0) fallos.push(`${pieza.codigo}: completa sin la respuesta entre las opciones`);
    if (it.tipo === "empareja" && it.pares.length < 3) fallos.push(`${pieza.codigo}: empareja con menos de 3 pares`);
  }
  const g2 = P.generar(pieza, 1);
  const distintas = g2.items.filter((it) => !g.items.some((x) => x.id === it.id)).length;
  console.log(`  ${pieza.codigo}: ${g.items.length} ítems ${JSON.stringify(cuenta)} · fuentes ${JSON.stringify(g.fuentes)} · tanda 2 cambia ${distintas}`);
  if (g.items.length < 6) fallos.push(`${pieza.codigo}: solo ${g.items.length} ejercicios`);
  if (!g.fuentes.bloques) fallos.push(`${pieza.codigo}: sin bloques para llevarte`);
  if (piezas.length > 1 && !g.fuentes.fichaE && !g.fuentes.fichaP && !g.fuentes.fichaT) fallos.push(`${pieza.codigo}: sin ninguna ficha reconocida`);
}
console.log("  tipos en total:", JSON.stringify(tipos));
if (fallos.length) { console.log("\nFALLOS:\n  " + fallos.join("\n  ")); process.exit(1); }
console.log(`\nPASS norsk_practica_selftest: ${piezas.length} pieza(s) con tanda completa sin inventar noruego`);
