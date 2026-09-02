// Unica funcion serverless para las cinco rutas comerciales de NEXO PASS.
// vercel.json conserva las URLs publicas y las dirige a este unico bundle.

import activar from "../server/commercial/norsk-activar.mjs";
import checkout from "../server/commercial/norsk-checkout.mjs";
import gracias from "../server/commercial/norsk-gracias.mjs";
import reenviar from "../server/commercial/norsk-reenviar.mjs";
import webhook from "../server/commercial/norsk-webhook.mjs";

// El webhook de Stripe necesita el cuerpo exacto para verificar su firma. Los
// otros dos endpoints con JSON ya leen el stream con readBody().
export const config = { api: { bodyParser: false } };

const RUTAS_PUBLICAS = Object.freeze({
  "/api/norsk-activar": activar,
  "/api/norsk-checkout": checkout,
  "/api/norsk-gracias": gracias,
  "/api/norsk-reenviar": reenviar,
  "/api/norsk-webhook": webhook,
});

export default async function handler(req, res) {
  let ruta = "";
  try {
    ruta = new URL(req.url || "/", "http://nexo.internal").pathname.replace(/\/+$/, "");
  } catch (e) { /* URL invalida: 404 cerrado */ }
  // req.url conserva la ruta publica tras el rewrite. La query se ignora como
  // selector para que el cliente no pueda cambiar el handler de una URL.
  const delegado = Object.prototype.hasOwnProperty.call(RUTAS_PUBLICAS, ruta)
    ? RUTAS_PUBLICAS[ruta]
    : null;

  if (!delegado) {
    res.status(404).json({ ok: false, error: "ruta" });
    return;
  }

  await delegado(req, res);
}
