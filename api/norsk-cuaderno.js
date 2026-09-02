// Descarga del Cuaderno de la Ruta Norskprøven B1 (seis tomos en PDF).
// GET ?tomo=1..6 -> exige compra activa (cookie de sesión) y responde 302 a una
// URL firmada de quince minutos contra el bucket privado norsk-cuaderno.
// La función no envía el archivo: Vercel no puede servir cuerpos grandes desde
// una función, y el navegador lo descarga directo del almacén con la URL firmada.
// Sin claves de Supabase responde 503 y la app no llega a llamar aquí en la demo.

import { readSessionCookie, compraActiva } from "./_norsk_lib.js";

export const BUCKET = "norsk-cuaderno";
export const TOMOS = {
  1: "NEXO-NORSK_Cuaderno-B1_Tomo-1_Los-16-mecanismos-primera-parte.pdf",
  2: "NEXO-NORSK_Cuaderno-B1_Tomo-2_Los-16-mecanismos-segunda-parte.pdf",
  3: "NEXO-NORSK_Cuaderno-B1_Tomo-3_Hablar.pdf",
  4: "NEXO-NORSK_Cuaderno-B1_Tomo-4_Escuchar-y-leer.pdf",
  5: "NEXO-NORSK_Cuaderno-B1_Tomo-5_Escribir.pdf",
  6: "NEXO-NORSK_Cuaderno-B1_Tomo-6_Simulacros.pdf",
};
const SEGUNDOS = 15 * 60;

export async function urlFirmada(archivo, segundos, deps) {
  const f = (deps && deps.fetch) || fetch;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const seguro = String(archivo).split("/").map(encodeURIComponent).join("/");
  const r = await f(`${url}/storage/v1/object/sign/${BUCKET}/${seguro}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
    // download: el navegador guarda el archivo con su nombre en vez de abrirlo en una pestaña.
    body: JSON.stringify({ expiresIn: segundos, download: archivo }),
  });
  if (!r.ok) throw new Error(`storage sign ${r.status}: ${await r.text()}`);
  const json = await r.json();
  if (!json || !json.signedURL) throw new Error("storage sign sin signedURL");
  return `${url}/storage/v1${json.signedURL}`;
}

export async function handler(req, res, deps) {
  deps = deps || {};
  const leerSesion = deps.readSessionCookie || readSessionCookie;
  const activa = deps.compraActiva || compraActiva;

  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ ok: false, error: "metodo" });
    return;
  }
  if (!process.env.NORSK_JWT_SECRET || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    res.status(503).json({ ok: false, error: "no_disponible" });
    return;
  }

  const q = req.query || {};
  const tomo = /^[1-6]$/.test(String(q.tomo || "")) ? Number(q.tomo) : 0;
  if (!tomo) { res.status(400).json({ ok: false, error: "tomo" }); return; }

  // Primero la puerta, después el almacén: sin sesión no se firma nada.
  const sesion = leerSesion(req);
  if (!sesion) { res.status(401).json({ ok: false, error: "acceso" }); return; }
  let compra;
  try { compra = await activa(sesion.sub); } catch (e) {
    console.error("norsk-cuaderno compra no consultable");
    res.status(503).json({ ok: false, error: "no_disponible" });
    return;
  }
  if (!compra) { res.status(401).json({ ok: false, error: "caducado" }); return; }

  try {
    const destino = await urlFirmada(TOMOS[tomo], SEGUNDOS, deps);
    res.statusCode = 302;
    res.setHeader("Location", destino);
    res.end();
  } catch (e) {
    console.error("norsk-cuaderno firma no disponible");
    res.status(503).json({ ok: false, error: "no_disponible" });
  }
}

export default function (req, res) { return handler(req, res); }
