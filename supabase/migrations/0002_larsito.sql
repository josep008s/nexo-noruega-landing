-- NEXO NORSK · Larsito (agente de conversación de voz y comprensión oral).
-- Se aplica DESPUÉS de 0001_norsk_schema.sql, que crea el esquema base de NEXO PASS
-- (norsk_compras, norsk_uso y sus RPCs). Esta migración no lo repite: solo añade lo
-- que Larsito necesita.
-- Dos formas de aplicarla:
--   A) Supabase Studio → SQL Editor → pegar todo → Run.
--   B) supabase link --project-ref <ref> && supabase db push  (necesita SUPABASE_ACCESS_TOKEN).
-- Idempotente: se puede reejecutar sin romper nada.

-- ---------- Contenido de comprensión oral ----------
-- Un ejercicio es un diálogo corto grabado con dos voces. El "guion" guarda los
-- turnos originales (voz + texto noruego) porque es lo que consume el pipeline de
-- audio para regenerar el mp3 si hace falta; el mp3 final vive en el bucket privado
-- norsk-audio y aquí solo se guarda su ruta.
create table if not exists norsk_listening (
  codigo        text primary key,
  nivel         text not null check (nivel in ('A2','B1')),
  tema          text,
  titulo        text not null,
  guion         jsonb,
  transcript_no text,
  transcript_es text,
  audio_path    text,
  duracion_s    int,
  preguntas     jsonb not null,
  activa        boolean not null default true,
  updated_at    timestamptz not null default now()
);

-- El endpoint filtra siempre por nivel y por activa, nunca lee el banco entero.
create index if not exists norsk_listening_nivel_idx on norsk_listening (nivel, activa);

-- ---------- Uso global del día ----------
-- norsk_uso cuenta por compra. Esta tabla cuenta por producto y día, sin mirar quién
-- consume: es el tope que protege la factura de la API de voz cuando hay una punta
-- de tráfico. Tipos previstos: 'larsito' (sesiones de conversación).
create table if not exists norsk_uso_global (
  dia      date not null default current_date,
  tipo     text not null,
  contador bigint not null default 0,
  primary key (dia, tipo)
);

-- ---------- RLS: nada para anon; solo la service_role key (desde api/) ----------
alter table norsk_listening  enable row level security;
alter table norsk_uso_global enable row level security;

-- Sin policies a propósito: con RLS activada y sin ninguna policy, anon y
-- authenticated no ven ni una fila aunque algún día se publique la anon key.
-- Encima se revocan los privilegios de tabla, que es lo que de verdad cierra la
-- puerta si mañana se añadiera una policy por descuido.
revoke all on table norsk_listening  from public, anon, authenticated;
revoke all on table norsk_uso_global from public, anon, authenticated;
grant all on table norsk_listening  to service_role;
grant all on table norsk_uso_global to service_role;

-- ---------- RPC ----------
-- Suma al contador global del día y devuelve el resultado, para que el endpoint
-- compare contra su tope en la misma llamada. No lleva SECURITY DEFINER: la invoca
-- api/ con la service key, que ya salta RLS, así que no hace falta el privilegio
-- extra y es mejor no concederlo.
create or replace function norsk_incr_global(p_tipo text, p_coste int default 1)
returns bigint language plpgsql as $$
declare v bigint;
begin
  insert into norsk_uso_global (dia, tipo, contador)
  values (current_date, coalesce(p_tipo, 'larsito'), p_coste)
  on conflict (dia, tipo) do update set contador = norsk_uso_global.contador + p_coste
  returning contador into v;
  return v;
end $$;

-- Postgres concede EXECUTE a PUBLIC por defecto en toda función nueva. Se quita.
revoke all on function norsk_incr_global(text, int) from public, anon, authenticated;
grant execute on function norsk_incr_global(text, int) to service_role;
