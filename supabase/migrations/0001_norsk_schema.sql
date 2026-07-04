-- NEXO NORSK · esquema completo.
-- Aplicar UNA vez. Dos formas:
--   A) Supabase Studio → SQL Editor → pegar todo → Run.
--   B) supabase link --project-ref <ref> && supabase db push  (necesita SUPABASE_ACCESS_TOKEN).
-- Idempotente: se puede reejecutar sin romper nada.

-- ---------- Contenido ----------
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

-- ---------- Compras y uso ----------
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
  email_enviado         boolean not null default false,
  created_at            timestamptz default now()
);
create index if not exists norsk_compras_pi_idx on norsk_compras (stripe_payment_intent);

-- Contadores separados por tipo: 'api' (práctica/simulacros, tope 120/día)
-- y 'reenvio' (magic links, tope 3/día).
create table if not exists norsk_uso (
  compra_id  uuid references norsk_compras(id),
  dia        date not null default current_date,
  tipo       text not null default 'api',
  peticiones integer not null default 0,
  primary key (compra_id, dia, tipo)
);

-- ---------- Leads (captura de la demo, compartida con /sueldo) ----------
create table if not exists leads (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  oficio      text,
  styrk       text,
  confianza   numeric,
  source      text,
  newsletter  boolean default false,
  utm_source  text,
  utm_medium  text,
  utm_campaign text,
  token       text,
  created_at  timestamptz default now()
);

-- ---------- RLS: nada para anon; solo la service_role key (desde api/) ----------
alter table norsk_preguntas enable row level security;
alter table norsk_lecciones enable row level security;
alter table norsk_compras   enable row level security;
alter table norsk_uso       enable row level security;
alter table leads           enable row level security;

-- ---------- RPCs ----------
create or replace function norsk_incr_uso(p_compra uuid, p_tipo text default 'api', p_coste int default 1)
returns integer language plpgsql security definer as $$
declare v int;
begin
  insert into norsk_uso (compra_id, dia, tipo, peticiones)
  values (p_compra, current_date, coalesce(p_tipo, 'api'), p_coste)
  on conflict (compra_id, dia, tipo) do update set peticiones = norsk_uso.peticiones + p_coste
  returning peticiones into v;
  return v;
end $$;

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

-- Las RPCs son SECURITY DEFINER y saltan RLS a propósito (las llama api/ con la
-- service key). No conceder EXECUTE a anon si algún día se publica la anon key:
revoke execute on function norsk_incr_uso(uuid, text, int) from anon;
revoke execute on function norsk_muestra(int, int, int) from anon;
