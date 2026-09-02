// Sirve ejercicios de comprensión oral de Larsito a compradores con acceso activo.
// GET ?nivel=A2|B1&tema=<slug opcional>&cursor=<codigo opcional>
//   -> hasta 10 ejercicios con audio firmado y cursor para la tanda siguiente
//
// Contrato:
//   1. Dos interruptores cerrados por defecto: LARSITO_ON=true y
//      LARSITO_LISTENING=on. Sin ambos no toca autenticacion, Supabase ni audio.
//   2. Con el flag activo, mismo muro que el resto de NEXO PASS: cookie de sesión
//      firmada, compra activa comprobada en servidor y reserva atomica de cuota,
//      coste global y riesgo (tipo "larsito"). Si el control falla, no sirve.
//   3. Nunca existe una llamada que devuelva el banco entero: máximo 10 ejercicios
//      por petición, igual que en norsk-preguntas. El contenido es de pago y se sirve
//      a cuentagotas, no en bloque.
//   4. El audio no se sirve por URL pública. Cada mp3 vive en un bucket privado de
//      Supabase Storage y se entrega con una URL firmada de quince minutos.

import {
  readSessionCookie,
  compraActiva,
  sbSelect,
  sbRpc,
} from "./_norsk_lib.js";

// Tope duro por llamada. Aunque el cliente pida más, aquí se corta.
const MAX_POR_LLAMADA = 10;
const MAX_POR_CONSULTA = MAX_POR_LLAMADA + 1;
const TOPE_DIARIO = 60;
const TOPE_GLOBAL_DEFECTO = 2000;
const TOPE_FALLOS_DEFECTO = 6;
const RESERVA_VIDA_SEGUNDOS = 120;

// Vida de la URL firmada del audio, en segundos. Quince minutos permiten repetir
// el ejercicio y acotan la ventana residual si la compra se revoca después.
const TTL_AUDIO = 15 * 60;

const CAMPOS = "codigo,nivel,tema,titulo,duracion_s,audio_path,preguntas,transcript_no,transcript_es";

function enteroPositivo(raw, defecto, maximo) {
  const n = Number.parseInt(raw || "", 10);
  if (!Number.isSafeInteger(n) || n < 1 || n > maximo) return defecto;
  return n;
}

function primeraFila(valor) {
  if (Array.isArray(valor)) return valor[0] || null;
  return valor && typeof valor === "object" ? valor : null;
}

async function consumir(reserva, compraId) {
  try {
    return await sbRpc("norsk_consumir_reserva_larsito", {
      p_reserva: reserva.reserva_id,
      p_compra: compraId,
      p_tipo: "larsito",
      p_jti: reserva.jti,
    }) === true;
  } catch (err) {
    console.error("larsito-listening consumo no disponible");
    return false;
  }
}

async function registrarFallo(reserva, compraId) {
  try {
    return await sbRpc("norsk_registrar_fallo_larsito", {
      p_reserva: reserva.reserva_id,
      p_compra: compraId,
      p_tipo: "larsito",
      p_jti: reserva.jti,
    }) === true;
  } catch (err) {
    console.error("larsito-listening registro de fallo no disponible");
    return false;
  }
}

// Firma una URL temporal contra el bucket privado norsk-audio. Devuelve la URL
// absoluta lista para el <audio> del cliente.
async function urlFirmada(path, segundos) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  // El path puede tener carpetas: se codifica segmento a segmento para no romper
  // las barras ni dejar pasar caracteres raros.
  const seguro = String(path).split("/").map(encodeURIComponent).join("/");
  const r = await fetch(`${url}/storage/v1/object/sign/norsk-audio/${seguro}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ expiresIn: segundos }),
  });
  if (!r.ok) throw new Error(`storage sign ${r.status}: ${await r.text()}`);
  const json = await r.json();
  if (!json || !json.signedURL) throw new Error("storage sign sin signedURL");
  return `${url}/storage/v1${json.signedURL}`;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  // Interruptores antes que cualquier autenticacion, consulta o firma de audio.
  if (process.env.LARSITO_ON !== "true"
      || process.env.LARSITO_LISTENING !== "on") {
    res.status(200).json({
      ok: false,
      error: "cerrado",
      mensaje: "Larsito todavía no está abierto.",
    });
    return;
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ ok: false, error: "metodo" });
    return;
  }

  if (!process.env.NORSK_JWT_SECRET) {
    console.error("larsito-listening configuracion incompleta");
    res.status(503).json({ ok: false, error: "no_disponible" });
    return;
  }

  const sesion = readSessionCookie(req);
  if (!sesion) { res.status(401).json({ ok: false, error: "acceso" }); return; }

  let compra;
  try { compra = await compraActiva(sesion.sub); } catch (e) {
    console.error("larsito-listening compra no disponible");
    res.status(503).json({ ok: false, error: "no_disponible" });
    return;
  }
  if (!compra) { res.status(401).json({ ok: false, error: "caducado" }); return; }

  const q = req.query || {};

  const nivel = q.nivel ? String(q.nivel).toUpperCase() : null;
  if (nivel && nivel !== "A2" && nivel !== "B1") { res.status(400).json({ ok: false, error: "nivel" }); return; }

  const tema = q.tema ? String(q.tema).trim() : null;
  if (tema && !/^[a-z0-9-]{2,40}$/.test(tema)) { res.status(400).json({ ok: false, error: "tema" }); return; }

  // Cursor estable sobre la clave unica codigo. Solo aceptamos el mismo alfabeto
  // que usa el banco; no se interpola texto arbitrario en la consulta PostgREST.
  const cursor = q.cursor ? String(q.cursor).trim().toUpperCase() : null;
  if (cursor && !/^[A-Z0-9_-]{3,40}$/.test(cursor)) {
    res.status(400).json({ ok: false, error: "cursor" });
    return;
  }

  const topeGlobal = enteroPositivo(
    process.env.LARSITO_TOPE_GLOBAL,
    TOPE_GLOBAL_DEFECTO,
    1000000,
  );
  const topeFallos = enteroPositivo(
    process.env.LARSITO_TOPE_FALLOS,
    TOPE_FALLOS_DEFECTO,
    100,
  );

  let reserva;
  try {
    reserva = primeraFila(await sbRpc("norsk_reservar_larsito", {
      p_compra: compra.id,
      p_tipo: "larsito",
      p_tope_compra: TOPE_DIARIO,
      p_tope_global: topeGlobal,
      p_tope_fallos: topeFallos,
      p_vida_segundos: RESERVA_VIDA_SEGUNDOS,
      p_coste: 1,
    }));
  } catch (e) {
    console.error("larsito-listening reserva no disponible");
    res.status(503).json({ ok: false, error: "no_disponible" });
    return;
  }

  if (!reserva || reserva.ok !== true || !reserva.reserva_id || !reserva.jti) {
    const motivo = reserva && reserva.error;
    if (motivo === "limite" || motivo === "saturado" || motivo === "fallos") {
      res.status(429).json({ ok: false, error: motivo });
      return;
    }
    if (motivo === "acceso") {
      res.status(401).json({ ok: false, error: "caducado" });
      return;
    }
    res.status(503).json({ ok: false, error: "no_disponible" });
    return;
  }

  try {
    const filtros = ["activa=is.true"];
    if (nivel) filtros.push(`nivel=eq.${nivel}`);
    if (tema) filtros.push(`tema=eq.${encodeURIComponent(tema)}`);
    if (cursor) filtros.push(`codigo=gt.${encodeURIComponent(cursor)}`);
    const rows = await sbSelect(
      `norsk_listening?${filtros.join("&")}&select=${CAMPOS}&order=codigo.asc&limit=${MAX_POR_CONSULTA}`);

    // Se pide una fila extra solo para saber si hay otra tanda. Nunca se firma ni
    // se devuelve mas de MAX_POR_LLAMADA, y el cursor avanza sobre la ultima fila
    // de esta pagina para que la siguiente consulta no pueda repetirla.
    const candidatas = Array.isArray(rows) ? rows : [];
    const pagina = candidatas.slice(0, MAX_POR_LLAMADA);
    const hasMore = candidatas.length > MAX_POR_LLAMADA;
    const nextCursor = hasMore && pagina.length
      ? String(pagina[pagina.length - 1].codigo || "").toUpperCase()
      : null;
    if (nextCursor && !/^[A-Z0-9_-]{3,40}$/.test(nextCursor)) {
      throw new Error("cursor de contenido invalido");
    }

    // Se firma el audio de cada ejercicio en paralelo. Si la firma de uno falla, se
    // omite ese ejercicio y los demás siguen: un mp3 que falta no puede tumbar la
    // pantalla entera de comprensión oral.
    const firmados = await Promise.all(pagina.map(async (ej) => {
      if (!ej.audio_path) {
        console.error(`larsito-listening ${ej.codigo}: sin audio_path`);
        return null;
      }
      try {
        const audio_url = await urlFirmada(ej.audio_path, TTL_AUDIO);
        const { audio_path, ...resto } = ej;
        return Object.assign({}, resto, { audio_url });
      } catch (e) {
        console.error(`larsito-listening firma ${ej.codigo}`, e);
        return null;
      }
    }));

    const ejercicios = firmados.filter(Boolean);
    // Una petición sin ningún recurso reproducible no ha entregado listening:
    // no debe consumir la reserva ni aparentar éxito vacío. La compensación es
    // idempotente y conserva el coste global/riesgo del intento externo.
    if (!ejercicios.length) {
      await registrarFallo(reserva, compra.id);
      res.status(503).json({ ok: false, error: "no_disponible" });
      return;
    }
    const consumida = await consumir(reserva, compra.id);
    if (!consumida) {
      await registrarFallo(reserva, compra.id);
      res.status(503).json({ ok: false, error: "no_disponible" });
      return;
    }
    res.status(200).json({
      ok: true,
      nivel,
      tema,
      audio_ttl: TTL_AUDIO,
      ejercicios,
      has_more: hasMore,
      next_cursor: nextCursor,
    });
  } catch (e) {
    await registrarFallo(reserva, compra.id);
    console.error("larsito-listening no disponible");
    res.status(503).json({ ok: false, error: "no_disponible" });
  }
}
