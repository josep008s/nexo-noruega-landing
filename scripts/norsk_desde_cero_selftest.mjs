#!/usr/bin/env node
// Autotest sin navegador del recorrido «Noruego desde cero hasta A2».
// Comprueba la demo pública (data/norsk-desde-cero-demo.json) y, si existe en disco
// la exportación completa (scripts/_norsk_curso/norsk-desde-cero-a2/curso.json,
// gitignored), todas las piezas: front-matter mínimo, secciones en orden, banco
// explícito construible, tipos conocidos, respuestas aceptadas normalizadas,
// audios declarados, feedback completo, cero em dash, y ratio opcional/esencial.
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", hellip: "…" };
function decode(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return Object.prototype.hasOwnProperty.call(ENT, e) ? ENT[e] : m;
  });
}
const fakeDocument = { createElement() { return { _html: "", set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; }, get value() { return decode(this._html); }, get textContent() { return decode(this._html.replace(/<[^>]+>/g, "")); } }; } };
const sandbox = { window: undefined, document: fakeDocument, navigator: {}, console }; sandbox.globalThis = sandbox; vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL("../norsk/curso/practica.js", import.meta.url), "utf8"), sandbox);
const P = sandbox.NexoPractica;

const SECC = ["responde", "repara", "bloques", "practica", "repite", "con-larsito", "cierre", "soluciones"];
const TIPOS = new Set(["elige", "ordena", "arrastra", "empareja", "completa", "escucha_elige", "dictado", "reconstruye", "escribe", "graba_compara", "larsito"]);
const fallos = [];
const demo = JSON.parse(readFileSync(new URL("../data/norsk-desde-cero-demo.json", import.meta.url), "utf8"));
if (demo.meta.ruta !== "norsk-desde-cero-a2") fallos.push("demo: ruta incorrecta");
if (!Array.isArray(demo.piezas) || !demo.piezas.length) fallos.push("demo: sin piezas abiertas");
const texto = JSON.stringify(demo);
if (texto.includes("—")) fallos.push("demo: em dash");
if (/increíble|brutal|paraíso|trucos|hola chicos/i.test(texto)) fallos.push("demo: palabra prohibida de marca");
if (/\b(celular|manejar|acá|computadora|plata|carro)\b/i.test(texto)) fallos.push("demo: marcador no peninsular");
if (/revisi[oó]n nativa|firma nativa/i.test(texto)) fallos.push("demo: menciona revisión o firma nativa en la superficie de alumno");
demo.indice.forEach((m) => { if (m.secciones || m.html) fallos.push(`${m.codigo}: el índice de la demo lleva cuerpo`); });

let piezas = demo.piezas, completo = false;
const privado = new URL("../scripts/_norsk_curso/norsk-desde-cero-a2/curso.json", import.meta.url);
if (existsSync(privado)) { piezas = JSON.parse(readFileSync(privado, "utf8")); completo = true; }

let totalEsen = 0, totalOpc = 0;
const tipos = {};
for (const pieza of piezas) {
  const id = pieza.codigo;
  if (pieza.tipo !== "leccion" && pieza.tipo !== "puente" && pieza.tipo !== "salto") continue;
  const secs = pieza.secciones.map((s) => s.id);
  if (pieza.tipo === "leccion" && secs.join(",") !== SECC.join(",")) fallos.push(`${id}: secciones ${secs.join(",")}`);
  if (pieza.tipo !== "leccion" && secs.indexOf("comprueba") < 0) fallos.push(`${id}: la pieza de comprobación no tiene la sección «Comprueba» (${secs.join(",")})`);
  const meta = pieza.meta || {};
  for (const k of ["zona", "unidad", "mision", "competencias", "audios", "ejercicios"]) if (meta[k] === undefined || meta[k] === null) fallos.push(`${id}: meta sin ${k}`);
  if (!/^(PREA1|A1|A2)-U\d\d-L\d\d$|^PUENTE-A2-B1$|^SALTO-(PREA1-A1|A1-A2)$/.test(id)) fallos.push(`${id}: código de lección inválido`);
  for (const e of meta.ejercicios || []) {
    if (!TIPOS.has(e.tipo)) fallos.push(`${id}:${e.id}: tipo ${e.tipo}`);
    if (!e.feedback || !e.feedback.regla || !e.feedback.conserva || !e.feedback.cambia) fallos.push(`${id}:${e.id}: feedback incompleto`);
    if (/\b(incorrecto|inténtalo otra vez|no es esa|revisa la gramática)\b/i.test(JSON.stringify(e.feedback))) fallos.push(`${id}:${e.id}: feedback vacío prohibido`);
    if (e.audio && !(meta.audios && meta.audios[e.audio])) fallos.push(`${id}:${e.id}: audio ${e.audio} sin texto en meta.audios`);
    if ((e.tipo === "escribe" || e.tipo === "dictado") && (!Array.isArray(e.aceptadas) || !e.aceptadas.length)) fallos.push(`${id}:${e.id}: sin respuestas aceptadas`);
    if ((e.tipo === "elige" || e.tipo === "escucha_elige") && (!Array.isArray(e.opciones) || e.opciones.length < 3 || new Set(e.opciones).size !== e.opciones.length || e.correcta < 0 || e.correcta >= e.opciones.length)) fallos.push(`${id}:${e.id}: opciones inválidas`);
    if (e.tipo === "completa" && (!e.frase_hueco || !e.frase_hueco.includes("___") || !e.opciones.includes(e.correcta))) fallos.push(`${id}:${e.id}: hueco inválido`);
    if (e.tipo === "graba_compara" && !e.modelo_no) fallos.push(`${id}:${e.id}: sin modelo`);
  }
  let b;
  try { b = P.banco(pieza, null); } catch (err) { fallos.push(`${id}: excepción en el banco: ${err.message}`); continue; }
  if (!b.explicito) { fallos.push(`${id}: el banco no es explícito`); continue; }
  const esenJson = (meta.ejercicios || []).filter((e) => e.esencial).length;
  if (b.esenciales.length !== esenJson) fallos.push(`${id}: ${b.esenciales.length} esenciales montados de ${esenJson} declarados`);
  const ordenJson = (meta.ejercicios || []).filter((e) => e.esencial).map((e) => e.id).join(",");
  if (b.esenciales.map((i) => i.id).join(",") !== ordenJson) fallos.push(`${id}: la sesión no respeta el orden de los esenciales`);
  for (const it of b.items) {
    tipos[it.tipo] = (tipos[it.tipo] || 0) + 1;
    if ((it.tipo === "ordena" || it.tipo === "escribe" || it.tipo === "dictado") && it.solucion && it.frase && it.solucion.join(" ").toLowerCase() !== String(it.frase || it.respuesta || "").toLowerCase() && !(it.aceptadas || []).some((a) => a.toLowerCase() === it.solucion.join(" ").toLowerCase())) fallos.push(`${id}: ${it.tipo} ${it.id} no reconstruye su frase`);
    if ((it.tipo === "elige" || it.tipo === "escucha_elige") && (it.correcta < 0 || it.correcta >= it.opciones.length)) fallos.push(`${id}: ${it.id} correcta fuera de rango`);
    if (it.tipo === "completa" && it.opciones.indexOf(it.respuesta) < 0) fallos.push(`${id}: ${it.id} completa sin la respuesta entre las opciones`);
    if (it.tipo === "empareja" && it.pares.length < 3) fallos.push(`${id}: ${it.id} empareja con menos de 3 pares`);
  }
  const ratio = b.opcionales.length / Math.max(1, b.esenciales.length);
  totalEsen += b.esenciales.length; totalOpc += b.opcionales.length;
  console.log(`  ${id}: sesión ${b.esenciales.length} · extra ${b.opcionales.length} (ratio ${ratio.toFixed(1)}) ${JSON.stringify(b.porTipo)}`);
  const comprobacion = pieza.tipo === "puente" || pieza.tipo === "salto";
  if (ratio < 4.5 && !comprobacion) fallos.push(`${id}: ratio opcional/esencial ${ratio.toFixed(1)} < 4,5`);
  const vistos = {}; const ids = new Set();
  for (let k = 0; k < 2; k++) {
    const t = P.tanda(b.opcionales, { vistos, semilla: `${id}:${k}` });
    if (!t.items.length && !comprobacion) fallos.push(`${id}: tanda ${k} vacía`);
    for (const it of t.items) { if (ids.has(it.id)) fallos.push(`${id}: repite ${it.id} antes de agotar el banco`); ids.add(it.id); vistos[it.id] = true; }
  }
}
// Diagnóstico con reglas del recorrido desde cero.
{
  const d = P.diagnosticar({ tipo: "ordena", solucion: ["jeg", "kommer", "fra", "spania."] }, "kommer jeg fra spania.", "BLOQUE");
  if (!/Regla de la pieza/.test(d) || !/«jeg» delante/.test(d)) fallos.push("diagnóstico: la regla BLOQUE no aparece (" + d + ")");
  const h = P.diagnosticar({ tipo: "completa", respuesta: "eller" }, "og", "REPAR");
  if (!/Has puesto «og»; aquí va «eller»/.test(h)) fallos.push("diagnóstico: hueco eller/og (" + h + ")");
}
console.log(`  totales: sesión ${totalEsen} · extra ${totalOpc} · tipos ${JSON.stringify(tipos)}${completo ? " (curso completo en disco)" : " (solo demo)"}`);
if (fallos.length) { console.log("\nFALLOS:\n  " + fallos.slice(0, 40).join("\n  ")); process.exit(1); }
console.log(`\nPASS norsk_desde_cero_selftest: ${piezas.filter((p) => p.tipo === "leccion").length} lección(es) y ${piezas.filter((p) => p.tipo === "puente" || p.tipo === "salto").length} pieza(s) de comprobación sin inventar noruego`);
