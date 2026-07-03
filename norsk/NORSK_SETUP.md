# NEXO NORSK — Setup y runbook

Producto: preparación en español de la statsborgerprøven y la samfunnskunnskapsprøven.
URL: https://www.nexonoruega.com/norsk/ · Rector: `Business/Nexo Noruega/norsk/PLAN_NORSK_v1.md` (Drive).

## Arquitectura

- **Landing y guías**: estáticas e indexables (`/norsk/`, `/norsk/que-examen-necesitas/`…).
- **App** (`/norsk/app/`): shell estático SIN contenido de pago. Sin cookie carga la demo pública
  (`/data/norsk-demo.json`); con cookie pide sesiones a la API.
- **Banco completo**: SOLO en Supabase, servido por `api/norsk-preguntas.js` / `api/norsk-leccion.js`
  con cookie válida. Máximo 38 preguntas por llamada, rate limit 120 peticiones/día por compra.
  El repo es PÚBLICO: el banco jamás se commitea (`scripts/_norsk_banco/` está en .gitignore).
- **Pago**: Stripe Checkout → webhook → alta idempotente en `norsk_compras` → email magic link (Resend)
  → cookie HttpOnly → API. `/norsk/gracias/` da acceso inmediato sin esperar el email.

## Variables de entorno (Vercel → Settings → Environment Variables)

| Variable | Entornos | Nota |
|---|---|---|
| `STRIPE_SECRET_KEY` | Prod: `sk_live_…` · Preview/Dev: `sk_test_…` | |
| `STRIPE_WEBHOOK_SECRET` | Prod: `whsec_…` del endpoint live · Dev: el de `stripe listen` | |
| `SUPABASE_URL` | todos | ya prevista por api/lead.js |
| `SUPABASE_SERVICE_KEY` | todos | service_role, nunca en cliente |
| `NORSK_JWT_SECRET` | todos | 32+ bytes aleatorios (`openssl rand -hex 32`), distinto test/live |
| `RESEND_API_KEY` | Prod/Preview | dominio nexonoruega.com verificado (SPF/DKIM) |
| `NORSK_SITE_URL` | opcional | por defecto https://www.nexonoruega.com |

## SQL (Supabase → SQL Editor, ejecutar una vez)

```sql
create table if not exists norsk_preguntas (
  id            uuid primary key default gen_random_uuid(),
  codigo        text unique not null,
  modulo        smallint not null check (modulo between 1 and 3),
  leccion       smallint not null default 0 check (leccion between 0 and 12),
  tema          text not null,
  pregunta_no   text not null,
  pregunta_es   text not null,
  opciones_no   jsonb not null,
  opciones_es   jsonb not null,
  correcta      smallint not null check (correcta between 0 and 2),
  explicacion_es text not null,
  fuente        text,
  nivel         smallint default 2 check (nivel between 1 and 3),
  activa        boolean default true,
  updated_at    timestamptz default now()
);

create table if not exists norsk_lecciones (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  orden       smallint not null,
  modulo      smallint not null,
  titulo      text not null,
  resumen     text not null,
  cuerpo_html text not null,
  vocab       jsonb default '[]',
  publica     boolean default false,
  updated_at  timestamptz default now()
);

create table if not exists norsk_compras (
  id                    uuid primary key default gen_random_uuid(),
  email                 text not null,
  stripe_session_id     text unique not null,
  stripe_payment_intent text,
  plan                  text not null,
  amount                integer not null,
  currency              text not null default 'nok',
  starts_at             timestamptz not null default now(),
  expires_at            timestamptz not null,
  status                text not null default 'activa',
  created_at            timestamptz default now()
);

create table if not exists norsk_uso (
  compra_id  uuid references norsk_compras(id),
  dia        date not null default current_date,
  peticiones integer not null default 0,
  primary key (compra_id, dia)
);

alter table norsk_preguntas enable row level security;
alter table norsk_lecciones enable row level security;
alter table norsk_compras   enable row level security;
alter table norsk_uso       enable row level security;
-- Sin políticas anon: solo la service_role key (desde api/) lee y escribe.

-- Rate limit atómico. p_coste 1 por petición normal, 40 por reenvío de magic link.
create or replace function norsk_incr_uso(p_compra uuid, p_coste int default 1)
returns integer language plpgsql security definer as $$
declare v int;
begin
  insert into norsk_uso (compra_id, dia, peticiones) values (p_compra, current_date, p_coste)
  on conflict (compra_id, dia) do update set peticiones = norsk_uso.peticiones + p_coste
  returning peticiones into v;
  return v;
end $$;

-- Muestra aleatoria acotada (nunca el banco entero, nunca campos internos).
create or replace function norsk_muestra(p_modulo int, p_leccion int, p_n int)
returns table (
  codigo text, modulo smallint, leccion smallint, tema text,
  pregunta_no text, pregunta_es text, opciones_no jsonb, opciones_es jsonb,
  correcta smallint, explicacion_es text, fuente text, nivel smallint
) language sql stable security definer as $$
  select codigo, modulo, leccion, tema, pregunta_no, pregunta_es, opciones_no, opciones_es,
         correcta, explicacion_es, fuente, nivel
  from norsk_preguntas
  where activa
    and (p_modulo is null or modulo = p_modulo)
    and (p_leccion is null or leccion = p_leccion)
  order by random()
  limit least(coalesce(p_n, 10), 40);
$$;
```

## Captura de leads de la demo (opcional)

Al terminar el simulacro de la demo, la app ofrece guardar el resultado por email
(consentimiento explícito para la newsletter). Usa `api/lead.js` → tabla `leads`.
Para activarlo cuando configures Supabase, añade dos columnas a `leads`:

```sql
alter table leads add column if not exists source text;
alter table leads add column if not exists newsletter boolean default false;
```
Sin `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`, la captura degrada a "guardado" sin persistir
(no rompe la experiencia). El embudo previsto: demo → email (source `norsk-demo`) → newsletter.

## Runbook: publicar/actualizar el banco

El canónico editorial vive en el Drive: `Business/Nexo Noruega/norsk/banco/BANCO_PREGUNTAS_NORSK_v1.xlsx`
(preguntas) y `norsk/curso/` (lecciones). Supabase se carga DESDE ahí:

1. Exportar del Drive al repo (carpeta gitignored):
   ```bash
   python3 "$HOME/Library/CloudStorage/GoogleDrive-josep.muttt@gmail.com/Mi unidad/Business/Nexo Noruega/norsk/banco/exportar_banco.py"
   # escribe scripts/_norsk_banco/banco.json y lecciones.json en este repo
   ```
2. Validar y subir:
   ```bash
   node scripts/norsk_build_banco.mjs --dry     # solo validar
   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node scripts/norsk_build_banco.mjs
   ```
3. Regenerar la demo pública (único artefacto commiteado):
   ```bash
   node scripts/norsk_build_demo.mjs
   git add data/norsk-demo.json
   ```

## Desarrollo local

`python3 -m http.server` NO ejecuta `api/`. Para probar pago y acceso:

```bash
npm i -g vercel && vercel link            # una vez
vercel env pull .env.local                # trae las env vars de Development
vercel dev                                # localhost:3000 con api/ funcionando
stripe listen --forward-to localhost:3000/api/norsk-webhook/   # da el whsec_ de dev
```
Tarjeta de test: `4242 4242 4242 4242`, cualquier fecha futura y CVC.

> **Barra final en /api/ (importante).** `vercel.json` tiene `trailingSlash: true`, que
> 308-redirige `/api/x` a `/api/x/`. El frontend ya llama a todas las rutas CON barra final
> (`/api/norsk-checkout/`, etc.) para evitar el redirect. Al registrar el **webhook de Stripe
> en producción**, usa la URL **con barra**: `https://www.nexonoruega.com/api/norsk-webhook/`.
> Si la registras sin barra, Stripe recibe un 308 en el POST y podría no reintentar en la URL nueva.

## Checklist E2E antes de lanzar

- [ ] `curl -X POST localhost:3000/api/norsk-checkout/ -d '{"plan":"p30"}' -H 'Content-Type: application/json'` → 200 con url; `{"plan":"px"}` → 400. (Usa la barra final; sin ella hay 308.)
- [ ] Compra test completa → 1 fila en `norsk_compras` + 1 email de Resend + `/norsk/gracias/?session_id=…` pone cookie y da acceso.
- [ ] Replay del mismo evento (`stripe events resend …` o reenvío desde el Dashboard) → sigue habiendo 1 fila y 1 email.
- [ ] `/api/norsk-preguntas/?modo=practica` sin cookie → 401; con cookie → 10 preguntas; `?modo=simulacro&examen=statsborger` → 36 con 4 `piloto:true`; `?examen=samfunns` → 38 con 4 piloto.
- [ ] Petición 121 del día → 429.
- [ ] Webhook con firma manipulada → 400.
- [ ] Token caducado en `/api/norsk-activar` → redirect a `/norsk/acceso/?e=expirado`.
- [ ] Compra con `expires_at` en el pasado (editar la fila) → API 401 y la app muestra renovación con el progreso local intacto.
- [ ] Demo completa sin cookie y sin Supabase (solo `/data/norsk-demo.json`).
- [ ] `/norsk` sin barra final → redirect a `/norsk/` (trailingSlash). Rutas absolutas verificadas navegando desde `/norsk/app/`.
- [ ] Lighthouse ≥95 en landing y guías; JSON-LD válido (Rich Results Test); navegación completa con teclado (1/2/3, Tab); `prefers-reduced-motion`.
- [ ] En live: compra real de 249 kr verificada y reembolsada; sitemap enviado a Search Console.

## Operación

- Re-verificación anual (enero): tasas municipales, cifras SSB/UDI, `fecha_verificacion` del banco.
- Vigilancia trimestral de prove.hkdir.no y de la høring de la statsborgerloven (jun 2026, plazo oct 2026):
  toca el botid, no las pruebas; afectaría al copy de landing y Lección 0, no al banco.
- MVA: sin registro por debajo de 50.000 NOK/12 meses (~143 ventas del plan medio). Al 80% del umbral,
  decidir registro o exención de enseñanza (mval. § 3-5, exigiría tutoría real).
- Vipps: en private preview en Stripe (Checkout + NOK ya soportados). Al pasar a GA se activa en
  `api/norsk-checkout.js` sin tocar nada más.
