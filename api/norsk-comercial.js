// Unica funcion serverless para las cinco rutas comerciales de NEXO PASS.
// vercel.json conserva las URLs publicas y anade el selector interno `route`.

import activar from "../server/commercial/norsk-activar.mjs";
import checkout from "../server/commercial/norsk-checkout.mjs";
import gracias from "../server/commercial/norsk-gracias.mjs";
import reenviar from "../server/commercial/norsk-reenviar.mjs";
import webhook from "../server/commercial/norsk-webhook.mjs";

// El webhook de Stripe necesita el cuerpo exacto para verificar su firma. Los
// otros dos endpoints con JSON ya leen el stream con readBody().
export const config = { api: { bodyParser: false } };

const RUTAS = Object.freeze({ activar, checkout, gracias, reenviar, webhook });

export default async function handler(req, res) {
  const valor = req.query && req.query.route;
  const ruta = Array.isArray(valor) ? valor[0] : valor;
  const delegado = Object.prototype.hasOwnProperty.call(RUTAS, ruta) ? RUTAS[ruta] : null;

  if (!delegado) {
    res.status(404).json({ ok: false, error: "ruta" });
    return;
  }

  await delegado(req, res);
}
