-- NEXO NORSK · memoria de Larsito por compra: informes de sesión (Conserva / Ahora /
-- Contraste / Repite) y cola de recuperación 1-3-7-14. Solo api/ con service_role
-- lee y escribe. Nunca se guarda audio ni transcripción: solo códigos, un foco de
-- feedback acotado a 300 caracteres y fechas.

create table if not exists public.norsk_larsito_informes (
  id           uuid primary key default gen_random_uuid(),
  compra_id    uuid not null references public.norsk_compras(id) on delete cascade,
  session_id   text not null check (session_id ~ '^[A-Za-z0-9:_-]{8,64}$'),
  modo         text not null check (modo in ('FREE_CONVERSATION', 'EXAM_SIMULATION', 'REAL_LIFE', 'DEEP_CORRECTION')),
  escenario    text check (escenario is null or escenario ~ '^[A-Za-z0-9:_-]{1,48}$'),
  mecanismo    text check (mecanismo is null or mecanismo ~ '^[A-Z0-9_-]{1,32}$'),
  pieza        text check (pieza is null or pieza ~ '^[A-Za-z0-9:_-]{1,48}$'),
  puerta       text check (puerta is null or puerta ~ '^O[1-7]$'),
  conserva     text not null check (char_length(conserva) between 1 and 300),
  ahora        text not null check (char_length(ahora) between 1 and 300),
  contraste    text check (contraste is null or char_length(contraste) <= 300),
  repite       text check (repite is null or char_length(repite) <= 300),
  resultado    text check (resultado is null or resultado ~ '^[A-Z_]{2,32}$'),
  created_at   timestamptz not null default now(),
  unique (compra_id, session_id)
);

create index if not exists norsk_larsito_informes_compra_idx
  on public.norsk_larsito_informes (compra_id, created_at desc);

alter table public.norsk_larsito_informes enable row level security;
revoke all on table public.norsk_larsito_informes from public, anon, authenticated;
grant all on table public.norsk_larsito_informes to service_role;

create table if not exists public.norsk_larsito_recuperaciones (
  id            uuid primary key default gen_random_uuid(),
  compra_id     uuid not null references public.norsk_compras(id) on delete cascade,
  recovery_id   text not null check (recovery_id ~ '^REC:[A-Za-z0-9:_-]{1,96}:(1|3|7|14)$'),
  focus_id      text not null check (focus_id ~ '^[A-Za-z0-9:_-]{1,96}$'),
  source_id     text not null check (source_id ~ '^[A-Za-z0-9:_-]{1,96}$'),
  contacto      smallint not null check (contacto in (1, 3, 7, 14)),
  operacion_id  text not null check (operacion_id in ('BUILD_WITH_SUPPORT', 'RETRIEVE_LESS_SUPPORT', 'VARY_TWO_DATA', 'TRANSFER_NEW_CONTEXT')),
  programada_en timestamptz not null,
  estado        text not null check (estado in ('PENDING', 'DONE')),
  completada_en timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (compra_id, recovery_id)
);

create index if not exists norsk_larsito_recuperaciones_compra_idx
  on public.norsk_larsito_recuperaciones (compra_id, estado, programada_en);

alter table public.norsk_larsito_recuperaciones enable row level security;
revoke all on table public.norsk_larsito_recuperaciones from public, anon, authenticated;
grant all on table public.norsk_larsito_recuperaciones to service_role;
