// Magic link de NEXO PASS: valida el JWT del email y pone la cookie de sesión.
// GET ?token=... -> 302 /pass/app/  (o /pass/acceso/?e=expirado)

import { jwtVerify, compraActiva, setSessionCookie } from "../shared/norsk-lib.mjs";

export default async function handler(req, res) {
  const token = (req.query && req.query.token) || "";
  const payload = jwtVerify(token, process.env.NORSK_JWT_SECRET);

  if (!payload || payload.uso !== "activar" || !payload.sub) {
    res.statusCode = 302;
    res.setHeader("Location", "/pass/acceso/?e=expirado");
    res.end();
    return;
  }

  try {
    const compra = await compraActiva(payload.sub);
    if (!compra) {
      res.statusCode = 302;
      res.setHeader("Location", "/pass/acceso/?e=expirado");
      res.end();
      return;
    }
    setSessionCookie(res, compra.id, new Date(compra.expires_at).getTime());
    res.statusCode = 302;
    res.setHeader("Location", "/pass/app/");
    res.end();
  } catch (e) {
    console.error("norsk-activar", e);
    res.statusCode = 302;
    res.setHeader("Location", "/pass/acceso/?e=error");
    res.end();
  }
}
