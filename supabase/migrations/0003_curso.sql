-- NEXO NORSK · Curso Norskprøven B1 (línea Idioma).
-- Se aplica DESPUÉS de 0001_norsk_schema.sql, que crea el esquema base de NEXO PASS
-- (norsk_compras, norsk_uso y sus RPCs). Esta migración no lo repite: solo añade la
-- tabla del curso. El contador de uso del tipo 'curso' sale de norsk_incr_uso, que
-- ya existe desde la 0001, así que aquí no hay que crear ninguna función nueva.
-- Dos formas de aplicarla:
--   A) Supabase Studio → SQL Editor → pegar todo → Run.
--   B) supabase link --project-ref <ref> && supabase db push  (necesita SUPABASE_ACCESS_TOKEN).
-- Idempotente: se puede reejecutar sin romper nada.

-- ---------- Contenido del curso ----------
-- Una pieza es un documento del material: el diagnóstico de entrada, uno de los
-- dieciséis mecanismos, o un documento por destreza. El cuerpo viaja troceado en
-- secciones, cada una con su id, su título y su HTML ya convertido, porque la app
-- pinta una sección por pantalla y así no tiene que interpretar Markdown en el
-- cliente. En "meta" van los campos del front-matter que interesan a la app
-- (piezas del canon, unidades de destino, delprøver, estado de La Lupa y de la
-- revisión nativa). El Markdown original vive en el Drive, no aquí.
create table if not exists norsk_curso (
  codigo     text primary key,
  tipo       text not null,
  titulo     text not null,
  orden      int not null default 0,
  meta       jsonb,
  secciones  jsonb not null,
  palabras   int,
  activa     boolean not null default true,
  updated_at timestamptz not null default now()
);

-- El endpoint lista siempre por activa y por orden, y nunca lee el curso entero:
-- el índice va sin cuerpo y las piezas se piden de una en una.
create index if not exists norsk_curso_orden_idx on norsk_curso (activa, orden);

-- ---------- RLS: nada para anon; solo la service_role key (desde api/) ----------
alter table norsk_curso enable row level security;

-- Sin policies a propósito: con RLS activada y sin ninguna policy, anon y
-- authenticated no ven ni una fila aunque algún día se publique la anon key.
-- Encima se revocan los privilegios de tabla, que es lo que de verdad cierra la
-- puerta si mañana se añadiera una policy por descuido.
revoke all on table norsk_curso from public, anon, authenticated;
grant all on table norsk_curso to service_role;
