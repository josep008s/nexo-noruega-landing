// Captura de leads (calculadora de sueldos, Mapa 90 días, lista de espera del Kit) -> Supabase.
// Función serverless de Vercel, sin dependencias (usa fetch global, Node 18+).
//
// Variables de entorno necesarias (Vercel -> Settings -> Environment Variables):
//   SUPABASE_URL          p.ej. https://xxxx.supabase.co
//   SUPABASE_SERVICE_KEY  service_role key (solo en servidor, nunca en el cliente)
//
// Tabla esperada (ver SUELDO_SETUP.md y PENDIENTES_EMPRESA.md):
//   leads(email text, oficio text, styrk text, confianza numeric,
//         source text, newsletter boolean default false, segmento text,
//         utm_source text, utm_medium text, utm_campaign text, token text,
//         created_at timestamptz default now())

function readBody(req) {
  if (req.body) {
    if (typeof req.body === "string") {
      try { return JSON.parse(req.body); } catch (e) { return {}; }
    }
    return req.body;
  }
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); } catch (e) { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "method" }); return; }

  const body = await readBody(req);
  const email = (body.email || "").toString().trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ ok: false, error: "email" });
    return;
  }

  const row = {
    email: email,
    oficio: (body.oficio || "").toString().slice(0, 120),
    styrk: (body.styrk || "").toString().slice(0, 8),
    confianza: typeof body.confianza === "number" ? body.confianza : null,
    // source distingue el embudo (p.ej. "sueldo", "norsk-demo", "mapa", "kit-espera");
    // newsletter = consentimiento explícito.
    // Requiere en la tabla leads: source text, newsletter boolean default false (ver norsk/NORSK_SETUP.md).
    source: (body.source || "").toString().slice(0, 40),
    newsletter: body.newsletter === true,
    // segmento: la ruta del lector ("ue" | "no-ue"), el eje del catálogo de aterrizaje.
    // Requiere en la tabla leads: segmento text.
    segmento: (body.segmento || "").toString().slice(0, 10),
    utm_source: (body.utm_source || "").toString().slice(0, 60),
    utm_medium: (body.utm_medium || "").toString().slice(0, 60),
    utm_campaign: (body.utm_campaign || "").toString().slice(0, 120),
    token: (body.token || "").toString().slice(0, 80),
  };

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  // Sin Supabase configurado todavía: no rompemos la experiencia, registramos en log.
  if (!url || !key) {
    console.log("LEAD (sin Supabase):", JSON.stringify(row));
    res.status(200).json({ ok: true, stored: false });
    return;
  }

  try {
    const r = await fetch(`${url}/rest/v1/leads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error("Supabase insert error", r.status, t);
      res.status(200).json({ ok: true, stored: false });
      return;
    }
    res.status(200).json({ ok: true, stored: true });
  } catch (e) {
    console.error("lead handler error", e);
    res.status(200).json({ ok: true, stored: false });
  }
}
