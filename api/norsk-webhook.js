// Webhook de Stripe para NEXO NORSK.
// checkout.session.completed -> alta idempotente en norsk_compras + email con magic link.
//
// Necesita el body RAW para verificar la firma: bodyParser desactivado.

import {
  PLANES, sbUpsert, sendMagicLink, stripeVerifySignature, readRawBody,
} from "./_norsk_lib.js";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ ok: false }); return; }

  const raw = await readRawBody(req);
  const ok = stripeVerifySignature(raw, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  if (!ok) { res.status(400).json({ ok: false, error: "firma" }); return; }

  let event;
  try { event = JSON.parse(raw); } catch (e) { res.status(400).json({ ok: false, error: "json" }); return; }

  if (event.type !== "checkout.session.completed") {
    res.status(200).json({ ok: true, ignored: event.type });
    return;
  }

  const session = event.data.object;
  if (session.payment_status !== "paid") { res.status(200).json({ ok: true, unpaid: true }); return; }

  const plan = PLANES[session.metadata && session.metadata.plan] ? session.metadata.plan : "p30";
  const email = ((session.customer_details && session.customer_details.email) || session.customer_email || "").toLowerCase();
  if (!email) { res.status(200).json({ ok: true, noemail: true }); return; }

  const expiresAt = new Date(Date.now() + PLANES[plan].dias * 86400000);

  try {
    // Idempotencia: stripe_session_id UNIQUE + ignore-duplicates.
    // Si la respuesta viene vacía, la fila ya existía (reintento o carrera con /gracias): no reenviamos email.
    const inserted = await sbUpsert("norsk_compras", [{
      email,
      stripe_session_id: session.id,
      stripe_payment_intent: session.payment_intent || null,
      plan,
      amount: session.amount_total || PLANES[plan].amount,
      currency: session.currency || "nok",
      expires_at: expiresAt.toISOString(),
    }], "stripe_session_id");

    if (inserted.length) {
      await sendMagicLink(email, inserted[0].id, new Date(inserted[0].expires_at).getTime());
    }
    res.status(200).json({ ok: true, created: inserted.length > 0 });
  } catch (e) {
    // 500 a propósito: Stripe reintenta durante 3 días si Supabase o Resend fallan.
    console.error("norsk-webhook", e);
    res.status(500).json({ ok: false });
  }
}
