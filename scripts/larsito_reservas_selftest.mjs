// Pruebas locales sin red del contrato de reservas de Larsito.
// No sustituye una prueba de concurrencia real sobre PostgreSQL/Supabase.

import assert from "node:assert/strict";
import { COOKIE, jwtSign, jwtVerify } from "../api/_norsk_lib.js";
import sesionHandler, { crearFirmaLarsito } from "../api/larsito-sesion.js";
import ttsHandler from "../api/larsito-tts.js";
import listeningHandler from "../api/larsito-listening.js";
import compensarHandler from "../api/larsito-compensar.js";
import estimuloHandler from "../api/larsito-estimulo.js";
import "../norsk/larsito/learning-core.js";
import {
  consumirFirmaLarsito,
  registrarFalloFirmaLarsito,
} from "../api/_larsito_reservas.js";

const SECRET = "test-secret-".padEnd(64, "x");
const COMPRA = "11111111-1111-4111-8111-111111111111";
const RESERVA = "22222222-2222-4222-8222-222222222222";
const JTI = "33333333-3333-4333-8333-333333333333";
const RESERVA_FALLO = "44444444-4444-4444-8444-444444444444";
const JTI_FALLO = "55555555-5555-4555-8555-555555555555";
const REQUEST_1 = "66666666-6666-4666-8666-666666666666";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

process.env.NORSK_JWT_SECRET = SECRET;
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SERVICE_KEY = "service-test";
process.env.OPENAI_API_KEY = "openai-test";
process.env.LARSITO_TTS = "on";

function respuestaJson(valor, status = 200) {
  return new Response(JSON.stringify(valor), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cookieSesion() {
  const token = jwtSign({
    sub: COMPRA,
    uso: "sesion",
    exp: Math.floor(Date.now() / 1000) + 600,
  }, SECRET);
  return `${COOKIE}=${token}`;
}

function reqJson(body = {}) {
  return {
    method: "POST",
    headers: {
      cookie: cookieSesion(),
      "content-type": "application/json",
    },
    body,
  };
}

function nuevaRespuesta() {
  return {
    headers: {},
    statusCode: 200,
    tipo: null,
    body: null,
    setHeader(nombre, valor) { this.headers[nombre] = valor; },
    status(codigo) { this.statusCode = codigo; return this; },
    json(body) { this.tipo = "json"; this.body = body; return this; },
    send(body) { this.tipo = "send"; this.body = body; return this; },
  };
}

function compraActivaMock(url) {
  if (!String(url).includes("/rest/v1/norsk_compras?")) return null;
  return respuestaJson([{
    id: COMPRA,
    email: "test@example.invalid",
    plan: "test",
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  }]);
}

function rpc(url, options) {
  const nombre = String(url).split("/rpc/")[1] || "";
  return { nombre, args: JSON.parse(options.body || "{}") };
}

function reservaOk() {
  return [{
    ok: true,
    reserva_id: RESERVA,
    jti: JTI,
    usos_compra: 1,
    usos_global: 1,
    fallidos_o_pendientes: 1,
  }];
}

function ejercicioListening(numero) {
  const codigo = `LYTT-A-${String(numero).padStart(2, "0")}`;
  return {
    codigo,
    nivel: "B1",
    tema: "arbeid",
    titulo: `Test ${numero}`,
    duracion_s: 10,
    audio_path: `${codigo}.mp3`,
    preguntas: [],
    transcript_no: "Hei",
    transcript_es: "Hola",
  };
}

async function pruebaGatePrivacidadTts() {
  delete process.env.LARSITO_PRIVACY_READY;
  globalThis.fetch = async () => { throw new Error("el TTS sin gate de privacidad no debe usar red"); };
  const res = nuevaRespuesta();
  await ttsHandler(reqJson({ texto: "Hei", velocidad: 1 }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.error, "cerrado");
  process.env.LARSITO_PRIVACY_READY = "true";
}

async function pruebaTtsExito() {
  const orden = [];
  globalThis.fetch = async (url, options = {}) => {
    const compra = compraActivaMock(url);
    if (compra) { orden.push("compra"); return compra; }
    if (String(url).includes("/rpc/")) {
      const llamada = rpc(url, options);
      orden.push(llamada.nombre);
      if (llamada.nombre === "norsk_reservar_larsito") {
        assert.equal(llamada.args.p_compra, COMPRA);
        assert.equal(llamada.args.p_tipo, "larsito_tts");
        assert.equal(llamada.args.p_tope_fallos, 6);
        assert.equal(llamada.args.p_vida_segundos, 120);
        return respuestaJson(reservaOk());
      }
      if (llamada.nombre === "norsk_consumir_reserva_larsito") {
        assert.deepEqual(llamada.args, {
          p_reserva: RESERVA,
          p_compra: COMPRA,
          p_tipo: "larsito_tts",
          p_jti: JTI,
        });
        return respuestaJson(true);
      }
    }
    if (String(url).includes("api.openai.com/v1/audio/speech")) {
      orden.push("proveedor");
      return new Response(Buffer.from([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      });
    }
    throw new Error(`llamada inesperada: ${url}`);
  };

  const res = nuevaRespuesta();
  await ttsHandler(reqJson({ texto: "Hei, hvordan går det?", velocidad: 1 }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.tipo, "send");
  assert.deepEqual([...res.body], [1, 2, 3]);
  assert.deepEqual(orden, [
    "compra",
    "norsk_reservar_larsito",
    "proveedor",
    "norsk_consumir_reserva_larsito",
  ]);
}

async function pruebaTtsFalloProveedor() {
  const orden = [];
  globalThis.fetch = async (url, options = {}) => {
    const compra = compraActivaMock(url);
    if (compra) { orden.push("compra"); return compra; }
    if (String(url).includes("/rpc/")) {
      const llamada = rpc(url, options);
      orden.push(llamada.nombre);
      if (llamada.nombre === "norsk_reservar_larsito") return respuestaJson(reservaOk());
      if (llamada.nombre === "norsk_registrar_fallo_larsito") {
        assert.equal(llamada.args.p_jti, JTI);
        return respuestaJson(true);
      }
    }
    if (String(url).includes("api.openai.com/v1/audio/speech")) {
      orden.push("proveedor");
      return new Response("fallo", { status: 500 });
    }
    throw new Error(`llamada inesperada: ${url}`);
  };

  const res = nuevaRespuesta();
  await ttsHandler(reqJson({ texto: "Hei", velocidad: 0.8 }), res);
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.body, { ok: false, error: "voz", compensada: true });
  assert.deepEqual(orden, [
    "compra",
    "norsk_reservar_larsito",
    "proveedor",
    "norsk_registrar_fallo_larsito",
  ]);
}

async function pruebaTtsSinConsumo() {
  const orden = [];
  globalThis.fetch = async (url, options = {}) => {
    const compra = compraActivaMock(url);
    if (compra) { orden.push("compra"); return compra; }
    if (String(url).includes("/rpc/")) {
      const llamada = rpc(url, options);
      orden.push(llamada.nombre);
      if (llamada.nombre === "norsk_reservar_larsito") return respuestaJson(reservaOk());
      if (llamada.nombre === "norsk_consumir_reserva_larsito") return respuestaJson(false);
      if (llamada.nombre === "norsk_registrar_fallo_larsito") return respuestaJson(true);
    }
    if (String(url).includes("api.openai.com/v1/audio/speech")) {
      orden.push("proveedor");
      return new Response(Buffer.from([1]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      });
    }
    throw new Error(`llamada inesperada: ${url}`);
  };

  const res = nuevaRespuesta();
  await ttsHandler(reqJson({ texto: "Hei", velocidad: 1 }), res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.tipo, "json");
  assert.equal(res.body.compensada, true);
  assert.deepEqual(orden.slice(-2), [
    "norsk_consumir_reserva_larsito",
    "norsk_registrar_fallo_larsito",
  ]);
}

async function pruebaTopeFallos() {
  let proveedorLlamado = false;
  globalThis.fetch = async (url, options = {}) => {
    const compra = compraActivaMock(url);
    if (compra) return compra;
    if (String(url).includes("/rpc/norsk_reservar_larsito")) {
      const llamada = rpc(url, options);
      assert.equal(llamada.args.p_tope_fallos, 6);
      return respuestaJson([{ ok: false, error: "fallos" }]);
    }
    if (String(url).includes("api.openai.com")) proveedorLlamado = true;
    throw new Error(`llamada inesperada: ${url}`);
  };

  const res = nuevaRespuesta();
  await ttsHandler(reqJson({ texto: "Hei", velocidad: 1 }), res);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error, "fallos");
  assert.equal(proveedorLlamado, false);
}

async function pruebaCompensacionFirmada() {
  const token = jwtSign({
    sub: COMPRA,
    reserva: RESERVA,
    jti: JTI,
    tipo: "larsito_tts",
    uso: "larsito_compensar",
    exp: Math.floor(Date.now() / 1000) + 600,
  }, SECRET);
  globalThis.fetch = async (url, options = {}) => {
    const llamada = rpc(url, options);
    assert.equal(llamada.nombre, "norsk_registrar_fallo_larsito");
    assert.deepEqual(llamada.args, {
      p_reserva: RESERVA,
      p_compra: COMPRA,
      p_tipo: "larsito_tts",
      p_jti: JTI,
    });
    return respuestaJson(true);
  };

  const res = nuevaRespuesta();
  await compensarHandler(reqJson({ token }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, compensada: true });
}

async function pruebaSesionYConsumidor() {
  process.env.LARSITO_ON = "true";
  process.env.LARSITO_AGENT_ID = "agent-test";
  process.env.LARSITO_CONSUMER_READY = "true";
  process.env.ELEVENLABS_API_KEY = "eleven-test";
  globalThis.fetch = async () => { throw new Error("el flag cerrado no debe usar red"); };
  let res = nuevaRespuesta();
  await sesionHandler(reqJson(), res);
  assert.equal(res.body.error, "cerrado");
  process.env.LARSITO_AGENT_PRIVACY_READY = "true";

  const ordenSesion = [];
  globalThis.fetch = async (url, options = {}) => {
    const texto = String(url);
    const compra = compraActivaMock(url);
    if (compra) { ordenSesion.push("compra"); return compra; }
    if (texto.includes("/rpc/")) {
      const llamada = rpc(url, options);
      ordenSesion.push(llamada.nombre);
      if (llamada.nombre === "norsk_reservar_larsito") {
        assert.equal(llamada.args.p_tipo, "larsito");
        return respuestaJson(reservaOk());
      }
      if (llamada.nombre === "norsk_consumir_reserva_larsito") {
        assert.deepEqual(llamada.args, {
          p_reserva: RESERVA,
          p_compra: COMPRA,
          p_tipo: "larsito",
          p_jti: JTI,
        });
        return respuestaJson(true);
      }
    }
    if (texto.includes("api.elevenlabs.io/v1/convai/conversation/get-signed-url")) {
      ordenSesion.push("proveedor");
      assert.equal(options.method, "GET");
      assert.equal(options.headers["xi-api-key"], "eleven-test");
      assert.match(texto, /agent_id=agent-test/);
      assert.match(texto, /include_conversation_id=true/);
      return respuestaJson({ signed_url: "wss://api.elevenlabs.io/v1/convai/conversation?token=test" });
    }
    throw new Error(`llamada inesperada: ${url}`);
  };
  res = nuevaRespuesta();
  await sesionHandler(reqJson(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.signed_url, "wss://api.elevenlabs.io/v1/convai/conversation?token=test");
  assert.equal(res.body.expira_en, 900);
  assert.equal(Object.prototype.hasOwnProperty.call(res.body, "firma"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(res.body, "agente_id"), false);
  assert.deepEqual(ordenSesion, [
    "compra",
    "norsk_reservar_larsito",
    "proveedor",
    "norsk_consumir_reserva_larsito",
  ]);

  const ordenFallo = [];
  globalThis.fetch = async (url, options = {}) => {
    const texto = String(url);
    const compra = compraActivaMock(url);
    if (compra) { ordenFallo.push("compra"); return compra; }
    if (texto.includes("/rpc/")) {
      const llamada = rpc(url, options);
      ordenFallo.push(llamada.nombre);
      if (llamada.nombre === "norsk_reservar_larsito") return respuestaJson(reservaOk());
      if (llamada.nombre === "norsk_registrar_fallo_larsito") return respuestaJson(true);
    }
    if (texto.includes("api.elevenlabs.io/v1/convai/conversation/get-signed-url")) {
      ordenFallo.push("proveedor");
      return new Response("provider failure", { status: 503 });
    }
    throw new Error(`llamada inesperada: ${url}`);
  };
  res = nuevaRespuesta();
  await sesionHandler(reqJson(), res);
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.body, { ok: false, error: "proveedor" });
  assert.deepEqual(ordenFallo, [
    "compra",
    "norsk_reservar_larsito",
    "proveedor",
    "norsk_registrar_fallo_larsito",
  ]);

  const ordenSinConsumo = [];
  globalThis.fetch = async (url, options = {}) => {
    const texto = String(url);
    const compra = compraActivaMock(url);
    if (compra) { ordenSinConsumo.push("compra"); return compra; }
    if (texto.includes("/rpc/")) {
      const llamada = rpc(url, options);
      ordenSinConsumo.push(llamada.nombre);
      if (llamada.nombre === "norsk_reservar_larsito") return respuestaJson(reservaOk());
      if (llamada.nombre === "norsk_consumir_reserva_larsito") return respuestaJson(false);
      if (llamada.nombre === "norsk_registrar_fallo_larsito") return respuestaJson(true);
    }
    if (texto.includes("api.elevenlabs.io/v1/convai/conversation/get-signed-url")) {
      ordenSinConsumo.push("proveedor");
      return respuestaJson({ signed_url: "wss://api.elevenlabs.io/v1/convai/conversation?token=discarded" });
    }
    throw new Error(`llamada inesperada: ${url}`);
  };
  res = nuevaRespuesta();
  await sesionHandler(reqJson(), res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { ok: false, error: "no_disponible" });
  assert.deepEqual(ordenSinConsumo, [
    "compra",
    "norsk_reservar_larsito",
    "proveedor",
    "norsk_consumir_reserva_larsito",
    "norsk_registrar_fallo_larsito",
  ]);

  const emitida = Math.floor(Date.now() / 1000);
  const firmada = crearFirmaLarsito(COMPRA, reservaOk()[0], SECRET, emitida);
  const payload = jwtVerify(firmada.firma, SECRET);
  assert.equal(payload.reserva_id, RESERVA);
  assert.equal(payload.jti, JTI);
  assert.equal(payload.aud, "larsito-consumer");
  assert.equal(firmada.exp, emitida + 900);

  let estado = "reservada";
  globalThis.fetch = async (url, options = {}) => {
    const llamada = rpc(url, options);
    if (llamada.nombre === "norsk_consumir_reserva_larsito") {
      if (estado !== "reservada") return respuestaJson(false);
      estado = "consumida";
      return respuestaJson(true);
    }
    if (llamada.nombre === "norsk_registrar_fallo_larsito") {
      if (estado !== "reservada") return respuestaJson(false);
      estado = "fallida";
      return respuestaJson(true);
    }
    throw new Error(`llamada inesperada: ${url}`);
  };
  assert.equal((await consumirFirmaLarsito(firmada.firma, SECRET)).ok, true);
  assert.equal((await consumirFirmaLarsito(firmada.firma, SECRET)).ok, false);
  assert.equal((await registrarFalloFirmaLarsito(firmada.firma, SECRET)).ok, false);

  const firmaFallo = jwtSign({
    sub: COMPRA,
    aud: "larsito-consumer",
    uso: "larsito",
    reserva_id: RESERVA_FALLO,
    jti: JTI_FALLO,
    exp: Math.floor(Date.now() / 1000) + 600,
  }, SECRET);
  estado = "reservada";
  assert.equal((await registrarFalloFirmaLarsito(firmaFallo, SECRET)).ok, true);
  assert.equal((await registrarFalloFirmaLarsito(firmaFallo, SECRET)).ok, false);
  assert.equal((await consumirFirmaLarsito(firmaFallo, SECRET)).ok, false);
}

async function pruebaListeningAtomico() {
  process.env.LARSITO_ON = "true";
  process.env.LARSITO_LISTENING = "on";
  const orden = [];
  globalThis.fetch = async (url, options = {}) => {
    const texto = String(url);
    const compra = compraActivaMock(url);
    if (compra) { orden.push("compra"); return compra; }
    if (texto.includes("/rpc/")) {
      const llamada = rpc(url, options);
      orden.push(llamada.nombre);
      if (llamada.nombre === "norsk_reservar_larsito") return respuestaJson(reservaOk());
      if (llamada.nombre === "norsk_consumir_reserva_larsito") return respuestaJson(true);
    }
    if (texto.includes("/rest/v1/norsk_listening?")) {
      orden.push("contenido");
      return respuestaJson([ejercicioListening(1)]);
    }
    if (texto.includes("/storage/v1/object/sign/norsk-audio/")) {
      orden.push("firma_audio");
      return respuestaJson({ signedURL: "/object/sign/norsk-audio/LYTT-A-01.mp3?token=test" });
    }
    throw new Error(`llamada inesperada: ${url}`);
  };

  const req = reqJson();
  req.method = "GET";
  req.query = { nivel: "B1" };
  const res = nuevaRespuesta();
  await listeningHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ejercicios.length, 1);
  assert.deepEqual(orden, [
    "compra",
    "norsk_reservar_larsito",
    "contenido",
    "firma_audio",
    "norsk_consumir_reserva_larsito",
  ]);

  // Dos tandas reales de cursor: la consulta pide una fila extra para saber si
  // hay mas, pero nunca firma ni devuelve mas de diez. La segunda pagina avanza
  // con codigo=gt.<cursor> y no puede repetir codigos de la primera.
  const consultas = [];
  let reservas = 0;
  let consumos = 0;
  let firmasAudio = 0;
  globalThis.fetch = async (url, options = {}) => {
    const texto = String(url);
    const compra = compraActivaMock(url);
    if (compra) return compra;
    if (texto.includes("/rpc/")) {
      const llamada = rpc(url, options);
      if (llamada.nombre === "norsk_reservar_larsito") {
        reservas += 1;
        return respuestaJson(reservaOk());
      }
      if (llamada.nombre === "norsk_consumir_reserva_larsito") {
        consumos += 1;
        return respuestaJson(true);
      }
    }
    if (texto.includes("/rest/v1/norsk_listening?")) {
      consultas.push(texto);
      if (texto.includes("codigo=gt.LYTT-A-10")) {
        return respuestaJson(Array.from({ length: 5 }, (_, i) => ejercicioListening(i + 11)));
      }
      assert.equal(texto.includes("codigo=gt."), false);
      return respuestaJson(Array.from({ length: 11 }, (_, i) => ejercicioListening(i + 1)));
    }
    if (texto.includes("/storage/v1/object/sign/norsk-audio/")) {
      firmasAudio += 1;
      return respuestaJson({ signedURL: "/object/sign/norsk-audio/test.mp3?token=test" });
    }
    throw new Error(`llamada inesperada: ${url}`);
  };

  const reqPrimera = reqJson();
  reqPrimera.method = "GET";
  reqPrimera.query = { nivel: "B1" };
  const primera = nuevaRespuesta();
  await listeningHandler(reqPrimera, primera);
  assert.equal(primera.statusCode, 200);
  assert.equal(primera.body.ejercicios.length, 10);
  assert.equal(primera.body.has_more, true);
  assert.equal(primera.body.next_cursor, "LYTT-A-10");

  const reqSegunda = reqJson();
  reqSegunda.method = "GET";
  reqSegunda.query = { nivel: "B1", cursor: primera.body.next_cursor };
  const segunda = nuevaRespuesta();
  await listeningHandler(reqSegunda, segunda);
  assert.equal(segunda.statusCode, 200);
  assert.equal(segunda.body.ejercicios.length, 5);
  assert.equal(segunda.body.has_more, false);
  assert.equal(segunda.body.next_cursor, null);

  const codigosPrimera = new Set(primera.body.ejercicios.map((x) => x.codigo));
  const codigosSegunda = new Set(segunda.body.ejercicios.map((x) => x.codigo));
  assert.equal(codigosPrimera.size, primera.body.ejercicios.length);
  assert.equal(codigosSegunda.size, segunda.body.ejercicios.length);
  assert.equal([...codigosSegunda].some((codigo) => codigosPrimera.has(codigo)), false);
  assert.equal(consultas.length, 2);
  assert.equal(consultas.every((url) => url.includes("limit=11")), true);
  assert.equal(reservas, 2);
  assert.equal(consumos, 2);
  assert.equal(firmasAudio, 15);

  let redInvalida = 0;
  globalThis.fetch = async (url) => {
    redInvalida += 1;
    const compra = compraActivaMock(url);
    if (compra) return compra;
    throw new Error(`el cursor invalido no debe reservar ni consultar contenido: ${url}`);
  };
  const reqInvalida = reqJson();
  reqInvalida.method = "GET";
  reqInvalida.query = { nivel: "B1", cursor: "../todo" };
  const invalida = nuevaRespuesta();
  await listeningHandler(reqInvalida, invalida);
  assert.equal(invalida.statusCode, 400);
  assert.equal(invalida.body.error, "cursor");
  assert.equal(redInvalida, 1);

  const ordenSinAudio = [];
  globalThis.fetch = async (url, options = {}) => {
    const texto = String(url);
    const compra = compraActivaMock(url);
    if (compra) { ordenSinAudio.push("compra"); return compra; }
    if (texto.includes("/rpc/")) {
      const llamada = rpc(url, options);
      ordenSinAudio.push(llamada.nombre);
      if (llamada.nombre === "norsk_reservar_larsito") return respuestaJson(reservaOk());
      if (llamada.nombre === "norsk_registrar_fallo_larsito") return respuestaJson(true);
    }
    if (texto.includes("/rest/v1/norsk_listening?")) {
      ordenSinAudio.push("contenido");
      return respuestaJson([]);
    }
    throw new Error(`llamada inesperada: ${url}`);
  };
  const sinAudio = nuevaRespuesta();
  await listeningHandler(req, sinAudio);
  assert.equal(sinAudio.statusCode, 503);
  assert.deepEqual(sinAudio.body, { ok: false, error: "no_disponible" });
  assert.deepEqual(ordenSinAudio, [
    "compra",
    "norsk_reservar_larsito",
    "contenido",
    "norsk_registrar_fallo_larsito",
  ]);
}

async function pruebaListeningSinSecreto() {
  const secreto = process.env.NORSK_JWT_SECRET;
  delete process.env.NORSK_JWT_SECRET;
  let red = false;
  globalThis.fetch = async () => {
    red = true;
    throw new Error("listening sin secreto no debe usar red");
  };
  const req = reqJson();
  req.method = "GET";
  req.query = {};
  const res = nuevaRespuesta();
  await listeningHandler(req, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { ok: false, error: "no_disponible" });
  assert.equal(red, false);
  process.env.NORSK_JWT_SECRET = secreto;
}

function pruebaRecuperacionLocal() {
  const aprendizaje = globalThis.NexoLarsitoLearning;
  assert.ok(aprendizaje);
  const base = "2026-09-01T08:00:00.000Z";
  let cola = aprendizaje.programar([], "FOCUS:M11:01", "VIDA-05", base);
  assert.equal(cola.length, 4);
  assert.deepEqual(cola.map((x) => [x.contacto, x.programada_en]), [
    [1, "2026-09-01T08:00:00.000Z"],
    [3, "2026-09-03T08:00:00.000Z"],
    [7, "2026-09-07T08:00:00.000Z"],
    [14, "2026-09-14T08:00:00.000Z"],
  ]);
  assert.equal(cola.every((x) => x.estado === "PENDING" && x.completada_en === null), true);
  assert.equal(cola.every((x) => Object.keys(x).sort().join(",")
    === "completada_en,contacto,estado,focus_id,operacion_id,programada_en,recovery_id,source_id"), true);

  // Reintentar el mismo foco es idempotente: no crea otros cuatro contactos.
  cola = aprendizaje.programar(cola, "FOCUS:M11:01", "VIDA-05", base);
  assert.equal(cola.length, 4);

  // Un foco mas antiguo gana aunque se haya insertado despues.
  cola = aprendizaje.programar(cola, "FOCUS:M16:00", "VIDA-12", "2026-08-31T08:00:00.000Z");
  let primera = aprendizaje.primeraVencida(cola, "2026-09-01T09:00:00.000Z");
  assert.equal(primera.recovery_id, "REC:FOCUS:M16:00:1");
  assert.throws(() => aprendizaje.completarVencida(
    cola,
    "REC:FOCUS:M11:01:1",
    "2026-09-01T09:00:00.000Z",
  ), /fuera_de_orden/);
  cola = aprendizaje.completarVencida(cola, primera.recovery_id, "2026-09-01T09:00:00.000Z");
  primera = aprendizaje.primeraVencida(cola, "2026-09-01T09:00:00.000Z");
  assert.equal(primera.recovery_id, "REC:FOCUS:M11:01:1");
}

async function pruebaEstimulosExAtomicos() {
  process.env.LARSITO_ON = "true";
  process.env.LARSITO_CONSUMER_READY = "true";
  process.env.LARSITO_AGENT_PRIVACY_READY = "true";

  const porRequest = new Map();
  const porIntentoTarea = new Map();
  const usados = new Set();
  let compraActivaEnRpc = true;

  function resolverAsignacion(args) {
    if (!args.p_tarea || !["A", "B", "C"].includes(args.p_tarea)) {
      return [{ ok: false, stimulus_id: null, error: "solicitud", shown_at: null }];
    }
    if (!compraActivaEnRpc) {
      return [{ ok: false, stimulus_id: null, error: "acceso", shown_at: null }];
    }
    if (porRequest.has(args.p_request_id)) {
      const anterior = porRequest.get(args.p_request_id);
      if (anterior.tarea !== args.p_tarea || anterior.attempt_id !== args.p_attempt_id) {
        return [{ ok: false, stimulus_id: null, error: "solicitud", shown_at: null }];
      }
      return anterior.fila;
    }
    const claveIntento = `${args.p_attempt_id}:${args.p_tarea}`;
    if (porIntentoTarea.has(claveIntento)) {
      return [{ ok: false, stimulus_id: null, error: "solicitud", shown_at: null }];
    }
    const bDelIntento = porIntentoTarea.get(`${args.p_attempt_id}:B`);
    const codigo = args.p_candidatos.find((x) =>
      !usados.has(x)
      && !(args.p_tarea === "C" && x === "EX-C-02" && bDelIntento === "EX-B-02"));
    if (!codigo) return [{ ok: false, stimulus_id: null, error: "agotados", shown_at: null }];
    usados.add(codigo);
    porIntentoTarea.set(claveIntento, codigo);
    const fila = [{
      ok: true,
      stimulus_id: codigo,
      error: null,
      shown_at: "2026-09-02T09:00:00.000Z",
    }];
    porRequest.set(args.p_request_id, {
      tarea: args.p_tarea,
      attempt_id: args.p_attempt_id,
      fila,
    });
    return fila;
  }

  let serial = Promise.resolve();
  globalThis.fetch = async (url, options = {}) => {
    const compra = compraActivaMock(url);
    if (compra) return compra;
    if (!String(url).includes("/rpc/norsk_mostrar_estimulo_ex")) {
      throw new Error(`llamada inesperada: ${url}`);
    }
    const llamada = rpc(url, options);
    assert.equal(llamada.args.p_compra, COMPRA);
    assert.equal(llamada.args.p_ruta, "norskproven-b1-v1");
    assert.equal(UUID_RE.test(llamada.args.p_attempt_id), true);
    assert.deepEqual(llamada.args.p_candidatos,
      [1, 2, 3, 4].map((n) => `EX-${llamada.args.p_tarea}-0${n}`));
    const resultado = serial.then(async () => {
      // Fuerza intercalado de promesas; el modelo conserva la seccion critica.
      await Promise.resolve();
      return resolverAsignacion(llamada.args);
    });
    serial = resultado.then(() => undefined, () => undefined);
    return respuestaJson(await resultado);
  };

  const intentos = [
    "11111111-aaaa-4111-8111-111111111111",
    "22222222-aaaa-4222-8222-222222222222",
    "33333333-aaaa-4333-8333-333333333333",
    "44444444-aaaa-4444-8444-444444444444",
  ];
  const requests = [
    [REQUEST_1, "77777777-7777-4777-8777-777777777777", "88888888-8888-4888-8888-888888888888"],
    ["99999999-9999-4999-8999-999999999999", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    ["cccccccc-cccc-4ccc-8ccc-cccccccccccc", "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"],
    ["ffffffff-ffff-4fff-8fff-ffffffffffff", "12121212-1212-4121-8121-121212121212", "13131313-1313-4131-8131-131313131313"],
  ];
  async function asignarIntento(attemptId, ids) {
    const salida = {};
    for (const [i, tarea] of ["A", "B", "C"].entries()) {
      const res = nuevaRespuesta();
      await estimuloHandler(reqJson({
        tarea,
        attempt_id: attemptId,
        request_id: ids[i],
      }), res);
      assert.equal(res.statusCode, 200);
      salida[tarea] = res.body.stimulus_id;
    }
    return salida;
  }
  const asignados = await Promise.all(intentos.map((attemptId, i) => asignarIntento(attemptId, requests[i])));
  assert.equal(usados.size, 12);
  assert.equal(new Set(asignados.flatMap((x) => Object.values(x))).size, 12);
  assert.equal(asignados.some((x) => x.B === "EX-B-02" && x.C === "EX-C-02"), false);

  const agotada = nuevaRespuesta();
  await estimuloHandler(reqJson({
    tarea: "A",
    attempt_id: "14141414-1414-4141-8141-141414141414",
    request_id: "15151515-1515-4151-8151-151515151515",
  }), agotada);
  assert.equal(agotada.statusCode, 409);
  assert.equal(agotada.body.error, "agotados");

  // Repetir el request que ya se mostro devuelve el mismo codigo sin consumir otro.
  const repetida = nuevaRespuesta();
  await estimuloHandler(reqJson({
    tarea: "A",
    attempt_id: intentos[0],
    request_id: REQUEST_1,
  }), repetida);
  assert.equal(repetida.statusCode, 200);
  assert.equal(repetida.body.stimulus_id, "EX-A-01");
  assert.equal(usados.size, 12);

  // El mismo request no puede reaparecer con otra tarea o intento.
  const tareaCambiada = nuevaRespuesta();
  await estimuloHandler(reqJson({
    tarea: "B",
    attempt_id: intentos[0],
    request_id: REQUEST_1,
  }), tareaCambiada);
  assert.equal(tareaCambiada.statusCode, 400);
  assert.equal(tareaCambiada.body.error, "solicitud");

  // La RPC vuelve a verificar la compra, aunque la API ya lo haya hecho.
  compraActivaEnRpc = false;
  const revocada = nuevaRespuesta();
  await estimuloHandler(reqJson({
    tarea: "A",
    attempt_id: "16161616-1616-4161-8161-161616161616",
    request_id: "17171717-1717-4171-8171-171717171717",
  }), revocada);
  assert.equal(revocada.statusCode, 401);
  assert.equal(revocada.body.error, "caducado");
  compraActivaEnRpc = true;

  let red = false;
  globalThis.fetch = async () => { red = true; throw new Error("solicitud invalida"); };
  const invalida = nuevaRespuesta();
  await estimuloHandler(reqJson({
    tarea: null,
    attempt_id: intentos[0],
    request_id: REQUEST_1,
  }), invalida);
  assert.equal(invalida.statusCode, 400);
  assert.equal(red, false);
}

await pruebaGatePrivacidadTts();
await pruebaTtsExito();
await pruebaTtsFalloProveedor();
await pruebaTtsSinConsumo();
await pruebaTopeFallos();
await pruebaCompensacionFirmada();
await pruebaSesionYConsumidor();
await pruebaListeningAtomico();
await pruebaListeningSinSecreto();
pruebaRecuperacionLocal();
await pruebaEstimulosExAtomicos();

console.log("PASS larsito_reservas_selftest: 13 flujos sin red");
