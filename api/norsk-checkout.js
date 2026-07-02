// Crea una Stripe Checkout Session para NEXO NORSK.
// POST {plan: "p10"|"p30"|"p90"} -> {url}

import { PLANES, siteUrl, stripe, readBody } from "./_norsk_lib.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "method" }); return; }

  const body = await readBody(req);
  const plan = PLANES[body.plan] ? body.plan : null;
  if (!plan) { res.status(400).json({ ok: false, error: "plan" }); return; }

  try {
    const session = await stripe("checkout/sessions", {
      mode: "payment",
      locale: "es",
      customer_creation: "if_required",
      metadata: { plan },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "nok",
          unit_amount: PLANES[plan].amount,
          product_data: {
            name: `NEXO NORSK · ${PLANES[plan].nombre} (${PLANES[plan].dias} días)`,
            description: "Curso y simulacros de la statsborgerprøven y la samfunnskunnskapsprøven, en español.",
          },
        },
      }],
      success_url: `${siteUrl()}/norsk/gracias/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl()}/norsk/#precios`,
    });
    res.status(200).json({ ok: true, url: session.url });
  } catch (e) {
    console.error("norsk-checkout", e);
    res.status(500).json({ ok: false, error: "stripe" });
  }
}
