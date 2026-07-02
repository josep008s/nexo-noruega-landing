// Acceso inmediato tras el pago, sin esperar el email.
// GET ?session_id=cs_... -> verifica el pago en Stripe, upsert idempotente (misma clave que el webhook),
// pone la cookie y devuelve {ok, email, expires_at}.

import {
  PLANES, stripe, sbUpsert, sbSelect, setSessionCookie,
} from "./_norsk_lib.js";

export default async function handler(req, res) {
  const sessionId = (req.query && req.query.session_id) || "";
  if (!/^cs_/.test(sessionId)) { res.status(400).json({ ok: false, error: "session" }); return; }

  try {
    const session = await stripe(`checkout/sessions/${encodeURIComponent(sessionId)}`);
    if (session.payment_status !== "paid") { res.status(402).json({ ok: false, error: "impago" }); return; }

    const plan = PLANES[session.metadata && session.metadata.plan] ? session.metadata.plan : "p30";
    const email = ((session.customer_details && session.customer_details.email) || "").toLowerCase();
    const expiresAt = new Date(Date.now() + PLANES[plan].dias * 86400000);

    // Misma clave de idempotencia que el webhook: da igual quién llegue primero.
    await sbUpsert("norsk_compras", [{
      email,
      stripe_session_id: session.id,
      stripe_payment_intent: session.payment_intent || null,
      plan,
      amount: session.amount_total || PLANES[plan].amount,
      currency: session.currency || "nok",
      expires_at: expiresAt.toISOString(),
    }], "stripe_session_id", "resolution=ignore-duplicates,return=minimal");

    const rows = await sbSelect(`norsk_compras?stripe_session_id=eq.${encodeURIComponent(session.id)}&select=id,email,expires_at,status`);
    if (!rows.length || rows[0].status !== "activa") { res.status(403).json({ ok: false, error: "acceso" }); return; }

    setSessionCookie(res, rows[0].id, new Date(rows[0].expires_at).getTime());
    res.status(200).json({ ok: true, email: rows[0].email, expires_at: rows[0].expires_at });
  } catch (e) {
    console.error("norsk-gracias", e);
    res.status(500).json({ ok: false, error: "interno" });
  }
}
