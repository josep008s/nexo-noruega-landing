// Crea una Stripe Checkout Session para NEXO PASS.
// POST {plan: "p3"|"p30"|"p90"} -> {url}

import { PLANES, siteUrl, stripe, readJsonBodyLimited } from "./_norsk_lib.js";

const MAX_BODY_BYTES = 2 * 1024;

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "method" }); return; }

  let body;
  try {
    body = await readJsonBodyLimited(req, MAX_BODY_BYTES);
  } catch (e) {
    const status = e && e.status === 413 ? 413 : 400;
    res.status(status).json({ ok: false, error: status === 413 ? "cuerpo" : "json" });
    return;
  }
  // hasOwnProperty: "constructor" y compañía no son planes.
  const plan = Object.prototype.hasOwnProperty.call(PLANES, body.plan) ? body.plan : null;
  if (!plan) { res.status(400).json({ ok: false, error: "plan" }); return; }

  try {
    const session = await stripe("checkout/sessions", {
      mode: "payment",
      locale: "es",
      customer_creation: "if_required",
      metadata: { plan },
      // Consentimiento expreso (angrerettloven): checkbox obligatorio de condiciones
      // + texto de entrega inmediata. Requiere la URL de condiciones configurada en
      // el Dashboard de Stripe (ver pass/PASS_SETUP.md).
      consent_collection: { terms_of_service: "required" },
      custom_text: {
        terms_of_service_acceptance: {
          message: "Acepto que el acceso empiece de inmediato y que, al usar el contenido de pago, pierdo el derecho de desistimiento de 14 días. [Condiciones](https://www.nexonoruega.com/pass/condiciones/)",
        },
      },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "nok",
          unit_amount: PLANES[plan].amount,
          product_data: {
            name: `NEXO PASS · ${PLANES[plan].nombre} (${PLANES[plan].dias} días)`,
            description: "Curso y simulacros de la statsborgerprøven y la samfunnskunnskapsprøven, en español.",
          },
        },
      }],
      success_url: `${siteUrl()}/pass/gracias/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl()}/pass/#precios`,
    });
    res.status(200).json({ ok: true, url: session.url });
  } catch (e) {
    console.error("norsk-checkout", e);
    res.status(500).json({ ok: false, error: "stripe" });
  }
}
