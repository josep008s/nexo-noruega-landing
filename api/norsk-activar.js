// Magic link de NEXO NORSK: valida el JWT del email y pone la cookie de sesión.
// GET ?token=... -> 302 /norsk/app/  (o /norsk/acceso/?e=expirado)

import { jwtVerify, compraActiva, setSessionCookie } from "./_norsk_lib.js";

export default async function handler(req, res) {
  const token = (req.query && req.query.token) || "";
  const payload = jwtVerify(token, process.env.NORSK_JWT_SECRET);

  if (!payload || payload.uso !== "activar" || !payload.sub) {
    res.statusCode = 302;
    res.setHeader("Location", "/norsk/acceso/?e=expirado");
    res.end();
    return;
  }

  try {
    const compra = await compraActiva(payload.sub);
    if (!compra) {
      res.statusCode = 302;
      res.setHeader("Location", "/norsk/acceso/?e=expirado");
      res.end();
      return;
    }
    setSessionCookie(res, compra.id, new Date(compra.expires_at).getTime());
    res.statusCode = 302;
    res.setHeader("Location", "/norsk/app/");
    res.end();
  } catch (e) {
    console.error("norsk-activar", e);
    res.statusCode = 302;
    res.setHeader("Location", "/norsk/acceso/?e=error");
    res.end();
  }
}
