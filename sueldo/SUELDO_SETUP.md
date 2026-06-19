# Calculadora de sueldos (/sueldo) — Puesta en marcha

Embudo: post en RRSS → comentario con palabra clave → ManyChat manda DM con enlace
→ `/sueldo` → el usuario escribe su oficio + correo → ve sueldo bruto, rango real,
neto y lo que deja de pagar → suscriptor de la newsletter.

## Qué hay aquí

```
sueldo/index.html   La página (hereda los tokens Aurora Classic de la web)
sueldo/app.js       Matching + cálculo fiscal + UI (todo client-side)
data/data.json      350 oficios SSB + alias + fiscalidad 2026 (lo consume la página)
api/lead.js         Captura de correo -> Supabase (serverless)
scripts/            Pipeline de datos (se ejecuta a mano, una vez al año)
```

## 1. Supabase (almacén de leads)

1. Crear proyecto gratis en supabase.com.
2. SQL Editor → ejecutar:

```sql
create table public.leads (
  id bigint generated always as identity primary key,
  email text not null,
  oficio text,
  styrk text,
  confianza numeric,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  token text,
  created_at timestamptz default now()
);
alter table public.leads enable row level security;
-- Sin políticas públicas: solo la service_role key (servidor) puede insertar.
```

3. Settings → API: copiar `Project URL` y la `service_role` key.
4. En Vercel (proyecto nexo-noruega-landing) → Settings → Environment Variables:
   - `SUPABASE_URL` = el Project URL
   - `SUPABASE_SERVICE_KEY` = la service_role key
   (Sin estas variables la web sigue funcionando: el correo se registra en el log
   de la función y se responde ok, pero no se guarda en base. Configúralas para
   no perder leads.)
5. Exportar leads: Supabase → Table editor → leads → Export CSV. Importar ese CSV
   en Substack (Subscribers → Import) cada semana. Substack no tiene API fiable de
   alta, por eso la base propia es la fuente de verdad.

## 2. ManyChat (comentario → DM)

- Cuenta Business/Creator de Instagram o TikTok + ManyChat de pago.
- Growth Tool de comentarios: palabra clave (p.ej. `SUELDO`).
- Respuesta pública al comentario: "Te lo mando al privado. Mira el bruto, pero quédate con el neto."
- DM con el enlace y UTM (la web los guarda con cada lead):
  ```
  https://www.nexonoruega.com/sueldo/?utm_source=instagram&utm_medium=manychat&utm_campaign=calc_sueldos
  ```
- Límites Meta: ventana 24 h, 200 DMs/h, 1 DM por usuario/24 h.

## 3. Refresco anual de datos (cada febrero, cuando SSB publica)

```bash
cd nexo-noruega-landing
node scripts/fetch_ssb.mjs        # baja SSB 11418 del último año
# Revisar/actualizar scripts/_fiscal_params.json con los tramos Skatteetaten del año
node scripts/build_datajson.mjs   # reensambla data/data.json
```

Cambiar el año en `scripts/fetch_ssb.mjs` (constante `ANIO`). Las traducciones y
alias (`scripts/_tr_batch*.json` + `scripts/_alias_overrides.json`) se reutilizan;
solo hay que traducir oficios nuevos si SSB añade códigos.

Tipo de cambio EUR/NOK: `nok_por_eur` en `scripts/_fiscal_params.json` (orientativo).

## 4. Deploy

Push a `main` del repo → Vercel despliega producción (igual que el resto de la web).
La página queda en `https://www.nexonoruega.com/sueldo/`.

## Fuentes de los datos
- Sueldos: SSB tabla 11418 (jornada completa, todos los sectores, ambos sexos).
- Impuestos: Skatteetaten / regjeringen.no 2026.
- Servicios (guardería, sanidad, universidad): regjeringen.no, Helfo, PBL 2026.
