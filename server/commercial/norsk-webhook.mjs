// Webhook de Stripe para NEXO PASS.
// - checkout.session.completed (solo sesiones NORSK, con metadata.plan válido):
//   alta idempotente en norsk_compras + email con magic link (flag email_enviado,
//   así el email sale aunque /gracias haya insertado la fila primero).
// - charge.refunded / charge.dispute.created: revoca el acceso de la compra.
//
// Necesita el body RAW para verificar la firma: bodyParser desactivado.
// Registrar el endpoint en Stripe CON barra final: /api/norsk-webhook/

import {
  PLANES, sbUpsert, sbPatch, sendMagicLink, stripeVerifySignature, readRawBody,
} from "../shared/norsk-lib.mjs";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ ok: false }); return; }

  const raw = await readRawBody(req);
  const ok = stripeVerifySignature(raw, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  if (!ok) { res.status(400).json({ ok: false, error: "firma" }); return; }

  let event;
  try { event = JSON.parse(raw); } catch (e) { res.status(400).json({ ok: false, error: "json" }); return; }

  // Reembolso o disputa: se corta el acceso. compraActiva exige status=activa.
  if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
    const pi = event.data.object && event.data.object.payment_intent;
    try {
      if (pi) {
        await sbPatch("norsk_compras",
          `stripe_payment_intent=eq.${encodeURIComponent(pi)}`, { status: "revocada" });
      }
      res.status(200).json({ ok: true, revocada: !!pi });
    } catch (e) {
      console.error("norsk-webhook revocar", e);
      res.status(500).json({ ok: false }); // Stripe reintenta
    }
    return;
  }

  if (event.type !== "checkout.session.completed") {
    res.status(200).json({ ok: true, ignored: event.type });
    return;
  }

  const session = event.data.object;
  if (session.payment_status !== "paid") { res.status(200).json({ ok: true, unpaid: true }); return; }

  // Solo NORSK: la cuenta de Stripe puede tener otros productos. Sin metadata.plan
  // válido (creado por /api/norsk-checkout/), este webhook no da acceso a nada.
  const plan = session.metadata && session.metadata.plan;
  if (!Object.prototype.hasOwnProperty.call(PLANES, plan)) {
    res.status(200).json({ ok: true, ignored: "not-norsk" });
    return;
  }

  const email = ((session.customer_details && session.customer_details.email) || session.customer_email || "").toLowerCase();
  if (!email) { res.status(200).json({ ok: true, noemail: true }); return; }

  const expiresAt = new Date(Date.now() + PLANES[plan].dias * 86400000);

  try {
    // Idempotencia por stripe_session_id UNIQUE. Da igual quién inserte primero
    // (este webhook o /api/norsk-gracias).
    await sbUpsert("norsk_compras", [{
      email,
      stripe_session_id: session.id,
      stripe_payment_intent: session.payment_intent || null,
      plan,
      amount: session.amount_total || PLANES[plan].amount,
      currency: session.currency || "nok",
      expires_at: expiresAt.toISOString(),
    }], "stripe_session_id", "resolution=ignore-duplicates,return=minimal");

    // Compare-and-swap: solo UNA invocación (aunque Stripe entregue el evento dos
    // veces a la vez) pasa email_enviado de false→true y envía el correo.
    const sid = encodeURIComponent(session.id);
    const won = await sbPatch(
      `norsk_compras`,
      `stripe_session_id=eq.${sid}&email_enviado=is.false&status=eq.activa&select=id,email,expires_at`,
      { email_enviado: true });

    if (won.length) {
      const c = won[0];
      try {
        await sendMagicLink(c.email, c.id, new Date(c.expires_at).getTime());
      } catch (e) {
        // Rollback del flag para que un reintento (o /acceso) pueda reenviar.
        await sbPatch(`norsk_compras`, `id=eq.${c.id}`, { email_enviado: false }).catch(() => {});
        throw e;
      }
    }
    res.status(200).json({ ok: true, email_enviado: won.length > 0 });
  } catch (e) {
    // 500 a propósito: Stripe reintenta durante 3 días si Supabase o Resend fallan.
    console.error("norsk-webhook", e);
    res.status(500).json({ ok: false });
  }
}
