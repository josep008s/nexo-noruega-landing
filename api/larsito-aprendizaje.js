// Memoria de Larsito por compra: informes de sesión y cola de recuperación 1-3-7-14.
//
// GET  ?accion=perfil                  -> {ok, informes:[últimos 5], recuperaciones:[pendientes]}
// POST {accion:"informe", ...}         -> guarda el informe de una sesión (uno por session_id)
// POST {accion:"recuperaciones", cola} -> sincroniza la cola local (upsert por recovery_id)
//
// Contrato: interruptor LARSITO_ON cerrado por defecto; cookie firmada y compra activa
// comprobadas en servidor; cuerpo acotado; todo campo de texto cabe en 300 caracteres;
// nunca se acepta audio, transcripción ni texto libre del alumno (las claves con esos
// nombres se rechazan); respuesta privada sin caché.

import {
  readSessionCookie,
  compraActiva,
  sbSelect,
  sbUpsert,
  readJsonBodyLimited,
} from "./_norsk_lib.js";

const MAX_BODY_BYTES = 8 * 1024;
const MAX_TEXTO = 300;
const MAX_COLA = 40;
const MAX_INFORMES_DIA = 40;
const TABLA_INFORMES = "norsk_larsito_informes";
const TABLA_RECUPERACIONES = "norsk_larsito_recuperaciones";

const MODOS = new Set(["FREE_CONVERSATION", "EXAM_SIMULATION", "REAL_LIFE", "DEEP_CORRECTION"]);
const OPERACIONES = new Set(["BUILD_WITH_SUPPORT", "RETRIEVE_LESS_SUPPORT", "VARY_TWO_DATA", "TRANSFER_NEW_CONTEXT"]);
const CONTACTOS = new Set([1, 3, 7, 14]);
const RE = {
  session: /^[A-Za-z0-9:_-]{8,64}$/,
  id48: /^[A-Za-z0-9:_-]{1,48}$/,
  id96: /^[A-Za-z0-9:_-]{1,96}$/,
  mecanismo: /^[A-Z0-9_-]{1,32}$/,
  puerta: /^O[1-7]$/,
  resultado: /^[A-Z_]{2,32}$/,
  recovery: /^REC:[A-Za-z0-9:_-]{1,96}:(1|3|7|14)$/,
  control: /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,
};
// Claves que nunca se aceptan: el servidor no recibe voz ni texto del alumno.
const CLAVES_PROHIBIDAS = /^(audio|grabacion|grabación|transcripcion|transcripción|transcript|texto_alumno|turnos|mensajes)$/i;

function texto(valor, obligatorio) {
  if (valor === undefined || valor === null || valor === "") return obligatorio ? undefined : null;
  if (typeof valor !== "string") return undefined;
  const limpio = valor.replace(RE.control, "").replace(/\s+/g, " ").trim();
  if (!limpio.length || limpio.length > MAX_TEXTO) return undefined;
  return limpio;
}

function codigo(valor, re, obligatorio) {
  if (valor === undefined || valor === null || valor === "") return obligatorio ? undefined : null;
  return typeof valor === "string" && re.test(valor) ? valor : undefined;
}

function fechaIso(valor, obligatorio) {
  if (valor === undefined || valor === null || valor === "") return obligatorio ? undefined : null;
  const ms = Date.parse(valor);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function tieneClaveProhibida(objeto) {
  return !!objeto && typeof objeto === "object" && Object.keys(objeto).some((k) => CLAVES_PROHIBIDAS.test(k));
}

export function validarInforme(body) {
  if (tieneClaveProhibida(body)) return null;
  const informe = {
    session_id: codigo(body.session_id, RE.session, true),
    modo: MODOS.has(body.modo) ? body.modo : undefined,
    escenario: codigo(body.escenario, RE.id48, false),
    mecanismo: codigo(body.mecanismo, RE.mecanismo, false),
    pieza: codigo(body.pieza, RE.id48, false),
    puerta: codigo(body.puerta, RE.puerta, false),
    conserva: texto(body.conserva, true),
    ahora: texto(body.ahora, true),
    contraste: texto(body.contraste, false),
    repite: texto(body.repite, false),
    resultado: codigo(body.resultado, RE.resultado, false),
  };
  return Object.values(informe).some((v) => v === undefined) ? null : informe;
}

export function validarCola(cola) {
  if (!Array.isArray(cola) || cola.length > MAX_COLA) return null;
  const filas = [];
  const vistos = new Set();
  for (const x of cola) {
    if (!x || typeof x !== "object" || tieneClaveProhibida(x)) return null;
    const fila = {
      recovery_id: codigo(x.recovery_id, RE.recovery, true),
      focus_id: codigo(x.focus_id, RE.id96, true),
      source_id: codigo(x.source_id, RE.id96, true),
      contacto: CONTACTOS.has(x.contacto) ? x.contacto : undefined,
      operacion_id: OPERACIONES.has(x.operacion_id) ? x.operacion_id : undefined,
      programada_en: fechaIso(x.programada_en, true),
      estado: x.estado === "PENDING" || x.estado === "DONE" ? x.estado : undefined,
      completada_en: fechaIso(x.completada_en, false),
    };
    if (Object.values(fila).some((v) => v === undefined)) return null;
    if (vistos.has(fila.recovery_id)) return null;
    vistos.add(fila.recovery_id);
    filas.push(fila);
  }
  return filas;
}

export async function handler(req, res, deps) {
  const d = Object.assign({
    readSessionCookie, compraActiva, sbSelect, sbUpsert, readJsonBodyLimited,
    env: process.env, ahora: () => new Date(),
  }, deps || {});
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (d.env.LARSITO_ON !== "true") { res.status(200).json({ ok: false, error: "cerrado" }); return; }
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ ok: false, error: "metodo" });
    return;
  }
  if (!d.env.NORSK_JWT_SECRET || !d.env.SUPABASE_URL || !d.env.SUPABASE_SERVICE_KEY) {
    res.status(503).json({ ok: false, error: "no_disponible" });
    return;
  }

  const sesion = d.readSessionCookie(req);
  if (!sesion || !sesion.sub) { res.status(401).json({ ok: false, error: "acceso" }); return; }
  let activa = false;
  try { activa = await d.compraActiva(sesion.sub); }
  catch (err) { res.status(503).json({ ok: false, error: "no_disponible" }); return; }
  if (!activa) { res.status(401).json({ ok: false, error: "acceso" }); return; }
  const compra = encodeURIComponent(sesion.sub);

  if (req.method === "GET") {
    const accion = req.query && req.query.accion;
    if (accion !== "perfil") { res.status(400).json({ ok: false, error: "peticion" }); return; }
    try {
      const informes = await d.sbSelect(`${TABLA_INFORMES}?compra_id=eq.${compra}&select=created_at,modo,escenario,mecanismo,pieza,puerta,ahora,resultado&order=created_at.desc&limit=5`);
      const recuperaciones = await d.sbSelect(`${TABLA_RECUPERACIONES}?compra_id=eq.${compra}&estado=eq.PENDING&select=recovery_id,focus_id,source_id,contacto,operacion_id,programada_en,estado,completada_en&order=programada_en.asc&limit=${MAX_COLA}`);
      res.status(200).json({
        ok: true,
        informes: Array.isArray(informes) ? informes : [],
        recuperaciones: Array.isArray(recuperaciones) ? recuperaciones : [],
      });
    } catch (err) {
      console.error("larsito-aprendizaje perfil no disponible");
      res.status(503).json({ ok: false, error: "no_disponible" });
    }
    return;
  }

  let body;
  try { body = await d.readJsonBodyLimited(req, MAX_BODY_BYTES); }
  catch (err) { res.status(err && err.status === 413 ? 413 : 400).json({ ok: false, error: (err && err.code) || "cuerpo" }); return; }
  if (!body || typeof body !== "object" || Array.isArray(body)) { res.status(400).json({ ok: false, error: "json" }); return; }

  if (body.accion === "informe") {
    const informe = validarInforme(body);
    if (!informe) { res.status(400).json({ ok: false, error: "informe" }); return; }
    try {
      const inicioDia = new Date(d.ahora());
      inicioDia.setUTCHours(0, 0, 0, 0);
      const hoy = await d.sbSelect(`${TABLA_INFORMES}?compra_id=eq.${compra}&created_at=gte.${encodeURIComponent(inicioDia.toISOString())}&select=id&limit=${MAX_INFORMES_DIA + 1}`);
      if (Array.isArray(hoy) && hoy.length >= MAX_INFORMES_DIA) { res.status(429).json({ ok: false, error: "tope" }); return; }
      const filas = await d.sbUpsert(
        TABLA_INFORMES,
        [Object.assign({ compra_id: sesion.sub }, informe)],
        "compra_id,session_id",
        "resolution=ignore-duplicates,return=representation",
      );
      res.status(200).json({ ok: true, guardado: Array.isArray(filas) && filas.length > 0 });
    } catch (err) {
      console.error("larsito-aprendizaje informe no disponible");
      res.status(503).json({ ok: false, error: "no_disponible" });
    }
    return;
  }

  if (body.accion === "recuperaciones") {
    const filas = validarCola(body.cola);
    if (!filas) { res.status(400).json({ ok: false, error: "cola" }); return; }
    try {
      if (filas.length) {
        const marca = d.ahora().toISOString();
        await d.sbUpsert(
          TABLA_RECUPERACIONES,
          filas.map((f) => Object.assign({ compra_id: sesion.sub, updated_at: marca }, f)),
          "compra_id,recovery_id",
          "resolution=merge-duplicates,return=minimal",
        );
      }
      res.status(200).json({ ok: true, sincronizadas: filas.length });
    } catch (err) {
      console.error("larsito-aprendizaje recuperaciones no disponible");
      res.status(503).json({ ok: false, error: "no_disponible" });
    }
    return;
  }

  res.status(400).json({ ok: false, error: "peticion" });
}

export default function (req, res) { return handler(req, res); }
