-- Tabla de leads de NEXO NORUEGA.
-- La usan /sueldo, /mapa y /kit a través de api/lead.js.
-- Aplicar en Supabase: SQL Editor -> pegar -> Run.  (O `supabase db push`.)
--
-- No necesita entidad legal: un proyecto gratuito de Supabase basta para
-- empezar a acumular la lista propia con su segmentación UE / no-UE.

create table if not exists leads (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,

  -- De dónde viene: "mapa" | "kit-espera" | "sueldo" | "norsk-demo"
  source      text,
  -- Consentimiento explícito de newsletter (opt-in real, sin premarcar)
  newsletter  boolean default false,
  -- La ruta del lector: "ue" | "no-ue". El eje de todo el catálogo.
  segmento    text,

  -- Solo los rellena la calculadora de sueldos
  oficio      text,
  styrk       text,
  confianza   numeric,

  utm_source  text,
  utm_medium  text,
  utm_campaign text,
  token       text,

  created_at  timestamptz not null default now()
);

-- Un correo puede volver por varios embudos, pero no se duplica dentro del mismo.
create unique index if not exists leads_email_source_idx on leads (email, source);

create index if not exists leads_created_at_idx on leads (created_at desc);
create index if not exists leads_segmento_idx on leads (segmento) where segmento is not null;

-- El repo es público y la API usa la service key: nadie más debe poder leer esto.
alter table leads enable row level security;
-- Sin políticas: RLS bloquea a anon y authenticated. La service_role las omite.

comment on table leads is 'Leads propios de NEXO. Alta desde api/lead.js con service key.';
comment on column leads.segmento is 'ue | no-ue. Determina qué embudo y qué producto tocan.';
