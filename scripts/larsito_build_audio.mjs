// Valida el banco de comprensión oral de Larsito, genera los audios con ElevenLabs
// y sube todo a Supabase.
// Uso:
//   node scripts/larsito_build_audio.mjs --dry            (valida y estima coste, no gasta)
//   ELEVENLABS_API_KEY=... ELEVENLABS_VOICE_LARSITO=... ELEVENLABS_VOICE_KARI=... \
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/larsito_build_audio.mjs
//   ... --codigo=LARS-A2-01                                (procesa solo ese ejercicio)
//
// Entrada (GITIGNORED, el repo es público y los guiones son contenido de pago):
//   scripts/_norsk_larsito/listening.json
//
// Necesita ffmpeg en el PATH para pegar los turnos en un solo mp3.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LISTENING = path.join(ROOT, "scripts", "_norsk_larsito", "listening.json");
const DRY = process.argv.includes("--dry");
const SOLO = (process.argv.find((a) => a.startsWith("--codigo=")) || "").split("=")[1] || null;

const PROHIBIDAS = /increíble|brutal|paraíso|trucos|hola chicos/i;
const NO_PENINSULAR = /\b(celular|manejar|acá|computadora|plata|carro)\b/i;

// Las dos voces del diálogo. La clave del objeto es lo que se escribe en el campo
// "voz" de cada turno del guion; el valor, la variable de entorno con el id real.
const VOCES = {
  larsito: "ELEVENLABS_VOICE_LARSITO",
  kari: "ELEVENLABS_VOICE_KARI",
};

const MODELO = "eleven_multilingual_v2";

function fallo(errores, id, msg) {
  errores.push(`${id}: ${msg}`);
}

function validarEjercicio(ej, errores, avisos, vistos) {
  const id = ej.codigo || "(sin codigo)";
  if (!ej.codigo || !/^LARS-(A2|B1)-\d{2,3}$/.test(ej.codigo)) fallo(errores, id, "codigo inválido (formato LARS-A2-01)");
  if (vistos.has(ej.codigo)) fallo(errores, id, "codigo duplicado");
  vistos.add(ej.codigo);

  // El nivel del código y el campo nivel tienen que decir lo mismo.
  const nivelCodigo = (String(ej.codigo || "").match(/^LARS-(A2|B1)-/) || [])[1] || null;
  if (!["A2", "B1"].includes(ej.nivel)) fallo(errores, id, "nivel debe ser A2 o B1");
  else if (nivelCodigo && nivelCodigo !== ej.nivel) fallo(errores, id, `nivel ${ej.nivel} no coincide con el código`);

  if (!ej.titulo || typeof ej.titulo !== "string") fallo(errores, id, "titulo vacío");
  if (ej.tema !== undefined && ej.tema !== null && !/^[a-z0-9-]{2,40}$/.test(String(ej.tema))) {
    fallo(errores, id, "tema debe ser un slug en minúsculas");
  }

  // Guion: turnos {voz, texto_no}. Es lo que consume ElevenLabs, turno a turno.
  if (!Array.isArray(ej.guion) || !ej.guion.length) fallo(errores, id, "guion vacío o no es un array");
  else ej.guion.forEach((t, i) => {
    if (!t || typeof t !== "object") { fallo(errores, id, `guion[${i}]: turno inválido`); return; }
    if (!Object.prototype.hasOwnProperty.call(VOCES, t.voz)) {
      fallo(errores, id, `guion[${i}]: voz "${t.voz}" desconocida (usa ${Object.keys(VOCES).join(" o ")})`);
    }
    if (typeof t.texto_no !== "string" || !t.texto_no.trim()) fallo(errores, id, `guion[${i}]: texto_no vacío`);
  });

  // Transcripciones: sin ellas el ejercicio no se puede corregir ni estudiar después.
  if (!ej.transcript_no || typeof ej.transcript_no !== "string") fallo(errores, id, "transcript_no vacía");
  if (!ej.transcript_es || typeof ej.transcript_es !== "string") fallo(errores, id, "transcript_es vacía");

  if (!Array.isArray(ej.preguntas) || !ej.preguntas.length) fallo(errores, id, "preguntas vacías o no es un array");
  else ej.preguntas.forEach((p, i) => {
    if (!p || typeof p !== "object") { fallo(errores, id, `preguntas[${i}]: inválida`); return; }
    if (!p.pregunta_no && !p.pregunta_es) fallo(errores, id, `preguntas[${i}]: sin enunciado`);
    if (!Array.isArray(p.opciones_no) || p.opciones_no.length !== 3
      || p.opciones_no.some((o) => !o || typeof o !== "string")) {
      fallo(errores, id, `preguntas[${i}]: opciones_no deben ser exactamente 3 opciones no vacías`);
    }
    if (![0, 1, 2].includes(p.correcta)) fallo(errores, id, `preguntas[${i}]: correcta debe ser 0, 1 o 2`);
  });

  // Marca: el español publicable no lleva em dash ni lenguaje de folleto.
  const preguntas = Array.isArray(ej.preguntas) ? ej.preguntas : [];
  const espanol = [
    ej.titulo,
    ej.transcript_es,
    ...preguntas.map((p) => (p && p.pregunta_es) || ""),
    ...preguntas.flatMap((p) => (p && Array.isArray(p.opciones_es) ? p.opciones_es : [])),
  ].join(" ");
  if (espanol.includes("—")) fallo(errores, id, "em dash (—) en el español");
  if (PROHIBIDAS.test(espanol)) fallo(errores, id, "palabra prohibida de marca en el español");
  if (NO_PENINSULAR.test(espanol)) avisos.push(`${id}: marcador no peninsular en el español`);
}

// ---------- ElevenLabs ----------

async function tts(texto, voiceId, apiKey) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: texto,
      model_id: MODELO,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${await r.text()}`);
  return Buffer.from(await r.arrayBuffer());
}

// ---------- ffmpeg ----------

function hayBinario(bin) {
  try { execFileSync(bin, ["-version"], { stdio: "ignore" }); return true; }
  catch (e) { return false; }
}

// Pega los mp3 de los turnos en uno solo con el demuxer concat. Todos vienen del
// mismo modelo y con los mismos ajustes, así que se copian sin recodificar.
function concatenar(archivos, destino, dir) {
  const lista = path.join(dir, "lista.txt");
  fs.writeFileSync(lista, archivos.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", lista, "-c", "copy", destino], { stdio: "ignore" });
}

function duracionSegundos(archivo) {
  if (!hayBinario("ffprobe")) return null;
  try {
    const out = execFileSync("ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", archivo],
      { encoding: "utf8" });
    const s = parseFloat(out.trim());
    return Number.isFinite(s) ? Math.round(s) : null;
  } catch (e) { return null; }
}

// ---------- Supabase ----------

async function subirAudio(rutaLocal, destino) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const seguro = destino.split("/").map(encodeURIComponent).join("/");
  const r = await fetch(`${url}/storage/v1/object/norsk-audio/${seguro}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "audio/mpeg",
      // Sin esto, volver a generar un ejercicio daría 409 en vez de reemplazarlo.
      "x-upsert": "true",
    },
    body: fs.readFileSync(rutaLocal),
  });
  if (!r.ok) throw new Error(`Supabase Storage ${destino} ${r.status}: ${await r.text()}`);
}

async function subir(tabla, filas, onConflict) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const r = await fetch(`${url}/rest/v1/${tabla}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(filas),
  });
  if (!r.ok) throw new Error(`Supabase ${tabla} ${r.status}: ${await r.text()}`);
}

// ---------- main ----------

if (!fs.existsSync(LISTENING)) {
  console.error(`No existe ${LISTENING}. Exporta los guiones de listening del Drive antes de ejecutar.`);
  process.exit(1);
}

const fuente = JSON.parse(fs.readFileSync(LISTENING, "utf8"));
const todos = fuente.ejercicios || fuente;
if (!Array.isArray(todos)) {
  console.error("listening.json debe ser un array de ejercicios o un objeto con la clave 'ejercicios'.");
  process.exit(1);
}

const ejercicios = SOLO ? todos.filter((e) => e && e.codigo === SOLO) : todos;
if (SOLO && !ejercicios.length) {
  console.error(`No hay ningún ejercicio con código ${SOLO} en listening.json.`);
  process.exit(1);
}

const errores = [];
const avisos = [];
const vistos = new Set();
ejercicios.forEach((e) => validarEjercicio(e || {}, errores, avisos, vistos));

const porNivel = { A2: 0, B1: 0 };
ejercicios.forEach((e) => { if (e && porNivel[e.nivel] !== undefined) porNivel[e.nivel] += 1; });
const turnos = ejercicios.reduce((n, e) => n + (Array.isArray(e && e.guion) ? e.guion.length : 0), 0);

console.log(`Listening: ${todos.length} ejercicios en el canónico, ${ejercicios.length} a procesar (A2 ${porNivel.A2} · B1 ${porNivel.B1}), ${turnos} turnos de diálogo.`);
if (avisos.length) console.log(`\nAVISOS (${avisos.length}):\n- ${avisos.join("\n- ")}`);
if (errores.length) {
  console.error(`\nERRORES (${errores.length}):\n- ${errores.join("\n- ")}`);
  process.exit(1);
}

// Coste: ElevenLabs cobra por carácter enviado a síntesis.
const caracteres = {};
Object.keys(VOCES).forEach((v) => { caracteres[v] = 0; });
ejercicios.forEach((e) => {
  (e.guion || []).forEach((t) => { caracteres[t.voz] += String(t.texto_no).length; });
});
const totalCaracteres = Object.values(caracteres).reduce((a, b) => a + b, 0);

console.log("\nCoste estimado:");
Object.entries(caracteres).forEach(([voz, n]) => console.log(`  ${voz}: ${n} caracteres`));
console.log(`  total: ${totalCaracteres} caracteres, unos ${totalCaracteres} créditos con ${MODELO}.`);
console.log("  Es una estimación: el modelo multilingüe gasta en torno a 1 crédito por carácter.");
console.log("  Confirma el precio y el saldo en tu panel de ElevenLabs ANTES de lanzarlo sin --dry.");

if (DRY) { console.log("\n--dry: validación OK, no se genera ni se sube nada."); process.exit(0); }

// A partir de aquí se gasta dinero: se exige que esté todo puesto.
const faltan = [
  ["ELEVENLABS_API_KEY", process.env.ELEVENLABS_API_KEY],
  ["ELEVENLABS_VOICE_LARSITO", process.env.ELEVENLABS_VOICE_LARSITO],
  ["ELEVENLABS_VOICE_KARI", process.env.ELEVENLABS_VOICE_KARI],
  ["SUPABASE_URL", process.env.SUPABASE_URL],
  ["SUPABASE_SERVICE_KEY", process.env.SUPABASE_SERVICE_KEY],
].filter(([, v]) => !v).map(([k]) => k);
if (faltan.length) {
  console.error(`\nFaltan variables de entorno: ${faltan.join(", ")}.`);
  console.error("Ponlas en el entorno y vuelve a lanzarlo, o usa --dry para validar sin gastar.");
  process.exit(1);
}

if (!hayBinario("ffmpeg")) {
  console.error("\nNo encuentro ffmpeg en el PATH y hace falta para pegar los turnos en un mp3.");
  console.error("En macOS: brew install ffmpeg. Después vuelve a lanzarlo.");
  process.exit(1);
}

const apiKey = process.env.ELEVENLABS_API_KEY;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "larsito-"));
const filas = [];

console.log("");
for (const ej of ejercicios) {
  const dir = path.join(tmp, ej.codigo);
  fs.mkdirSync(dir, { recursive: true });
  const trozos = [];

  for (let i = 0; i < ej.guion.length; i++) {
    const turno = ej.guion[i];
    const voiceId = process.env[VOCES[turno.voz]];
    const mp3 = await tts(turno.texto_no, voiceId, apiKey);
    const archivo = path.join(dir, `${String(i).padStart(2, "0")}-${turno.voz}.mp3`);
    fs.writeFileSync(archivo, mp3);
    trozos.push(archivo);
  }

  const final = path.join(dir, `${ej.codigo}.mp3`);
  concatenar(trozos, final, dir);

  const destino = ej.audio_path || `listening/${ej.codigo}.mp3`;
  await subirAudio(final, destino);

  const duracion = duracionSegundos(final) || ej.duracion_s || null;
  filas.push({
    codigo: ej.codigo,
    nivel: ej.nivel,
    tema: ej.tema || null,
    titulo: ej.titulo,
    guion: ej.guion,
    transcript_no: ej.transcript_no,
    transcript_es: ej.transcript_es,
    audio_path: destino,
    duracion_s: duracion,
    preguntas: ej.preguntas,
    activa: ej.activa === undefined ? true : !!ej.activa,
    updated_at: new Date().toISOString(),
  });

  console.log(`${ej.codigo}: ${ej.guion.length} turnos, ${duracion ? `${duracion} s` : "duración desconocida"}, subido a norsk-audio/${destino}`);
}

await subir("norsk_listening", filas, "codigo");
console.log(`\nSubidos ${filas.length} ejercicios a norsk_listening.`);
console.log(`Archivos temporales en ${tmp} (bórralos cuando hayas comprobado los audios).`);
