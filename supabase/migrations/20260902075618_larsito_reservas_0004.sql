-- NEXO NORSK · reservas de un solo uso y control atomico de coste de Larsito.
-- Se aplica despues de 20260831192821_norsk_schema_0001.sql y 20260831192842_larsito_0002.sql.
--
-- Una reserva incrementa juntos los contadores de compra y global. Tambien
-- ocupa una plaza del limite de intentos fallidos o pendientes de esa compra.
-- Solo un consumo correcto libera esa plaza; un fallo conserva la plaza hasta
-- el cambio de dia, devuelve una sola vez la cuota de compra y mantiene la
-- global porque el proveedor externo pudo generar coste.

create table if not exists public.norsk_reservas_larsito (
  id             uuid primary key default gen_random_uuid(),
  jti            uuid not null default gen_random_uuid(),
  compra_id      uuid not null references public.norsk_compras(id) on delete cascade,
  dia            date not null,
  tipo           text not null check (tipo in ('larsito', 'larsito_tts')),
  coste          integer not null check (coste > 0),
  estado         text not null default 'reservada'
                   check (estado in ('reservada', 'consumida', 'fallida')),
  expira_at      timestamptz not null,
  compensada     boolean not null default false,
  created_at     timestamptz not null default now(),
  consumida_at   timestamptz,
  fallida_at     timestamptz,
  compensada_at timestamptz,
  unique (jti)
);

-- Si una copia temprana de 0004 se ejecuto en desarrollo, completa la tabla sin
-- borrar filas. La migracion aun no abre el producto ni concede acceso al cliente.
alter table public.norsk_reservas_larsito
  add column if not exists jti uuid default gen_random_uuid(),
  add column if not exists estado text not null default 'reservada',
  add column if not exists expira_at timestamptz,
  add column if not exists consumida_at timestamptz,
  add column if not exists fallida_at timestamptz,
  add column if not exists compensada boolean not null default false,
  add column if not exists compensada_at timestamptz;

update public.norsk_reservas_larsito
   set jti = coalesce(jti, gen_random_uuid()),
       expira_at = coalesce(expira_at, created_at + interval '15 minutes')
 where jti is null or expira_at is null;

alter table public.norsk_reservas_larsito
  alter column jti set not null,
  alter column expira_at set not null;

create unique index if not exists norsk_reservas_larsito_jti_idx
  on public.norsk_reservas_larsito (jti);
create index if not exists norsk_reservas_larsito_compra_idx
  on public.norsk_reservas_larsito (compra_id, created_at desc);

create table if not exists public.norsk_riesgo_larsito (
  compra_id               uuid not null references public.norsk_compras(id) on delete cascade,
  dia                     date not null,
  tipo                    text not null check (tipo in ('larsito', 'larsito_tts')),
  fallidos_o_pendientes   integer not null default 0 check (fallidos_o_pendientes >= 0),
  updated_at              timestamptz not null default now(),
  primary key (compra_id, dia, tipo)
);

alter table public.norsk_reservas_larsito enable row level security;
alter table public.norsk_riesgo_larsito enable row level security;
revoke all on table public.norsk_reservas_larsito from public, anon, authenticated;
revoke all on table public.norsk_riesgo_larsito from public, anon, authenticated;
grant all on table public.norsk_reservas_larsito to service_role;
grant all on table public.norsk_riesgo_larsito to service_role;

drop function if exists public.norsk_reservar_larsito(uuid, text, integer, bigint, integer);

create or replace function public.norsk_reservar_larsito(
  p_compra uuid,
  p_tipo text,
  p_tope_compra integer,
  p_tope_global bigint,
  p_tope_fallos integer,
  p_vida_segundos integer,
  p_coste integer default 1
)
returns table (
  ok boolean,
  error text,
  reserva_id uuid,
  jti uuid,
  usos_compra integer,
  usos_global bigint,
  fallidos_o_pendientes integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dia date := current_date;
  v_tipo text := coalesce(p_tipo, 'larsito');
  v_compra integer := 0;
  v_global bigint := 0;
  v_riesgo integer := 0;
  v_reserva uuid;
  v_jti uuid;
begin
  if p_compra is null
     or v_tipo not in ('larsito', 'larsito_tts')
     or p_coste is null or p_coste < 1
     or p_tope_compra is null or p_tope_compra < 1
     or p_tope_global is null or p_tope_global < 1
     or p_tope_fallos is null or p_tope_fallos < 1 or p_tope_fallos > 100
     or p_vida_segundos is null or p_vida_segundos < 30 or p_vida_segundos > 3600 then
    return query
      select false, 'config'::text, null::uuid, null::uuid,
             0::integer, 0::bigint, 0::integer;
    return;
  end if;

  -- Mantiene estables estado y caducidad mientras se completa la reserva.
  perform 1
    from public.norsk_compras c
   where c.id = p_compra
     and c.status = 'activa'
     and c.expires_at > now()
   for share;
  if not found then
    return query
      select false, 'acceso'::text, null::uuid, null::uuid,
             0::integer, 0::bigint, 0::integer;
    return;
  end if;

  insert into public.norsk_uso_global (dia, tipo, contador)
  values (v_dia, v_tipo, 0)
  on conflict (dia, tipo) do nothing;

  insert into public.norsk_uso (compra_id, dia, tipo, peticiones)
  values (p_compra, v_dia, v_tipo, 0)
  on conflict (compra_id, dia, tipo) do nothing;

  insert into public.norsk_riesgo_larsito
    (compra_id, dia, tipo, fallidos_o_pendientes)
  values (p_compra, v_dia, v_tipo, 0)
  on conflict (compra_id, dia, tipo) do nothing;

  -- Orden fijo de bloqueos para todas las reservas concurrentes.
  select g.contador into v_global
    from public.norsk_uso_global g
   where g.dia = v_dia and g.tipo = v_tipo
   for update;

  select u.peticiones into v_compra
    from public.norsk_uso u
   where u.compra_id = p_compra and u.dia = v_dia and u.tipo = v_tipo
   for update;

  select r.fallidos_o_pendientes into v_riesgo
    from public.norsk_riesgo_larsito r
   where r.compra_id = p_compra and r.dia = v_dia and r.tipo = v_tipo
   for update;

  if v_riesgo >= p_tope_fallos then
    return query
      select false, 'fallos'::text, null::uuid, null::uuid,
             v_compra, v_global, v_riesgo;
    return;
  end if;

  if v_compra + p_coste > p_tope_compra then
    return query
      select false, 'limite'::text, null::uuid, null::uuid,
             v_compra, v_global, v_riesgo;
    return;
  end if;

  if v_global + p_coste > p_tope_global then
    return query
      select false, 'saturado'::text, null::uuid, null::uuid,
             v_compra, v_global, v_riesgo;
    return;
  end if;

  update public.norsk_uso u
     set peticiones = u.peticiones + p_coste
   where u.compra_id = p_compra and u.dia = v_dia and u.tipo = v_tipo
   returning u.peticiones into v_compra;

  update public.norsk_uso_global g
     set contador = g.contador + p_coste
   where g.dia = v_dia and g.tipo = v_tipo
   returning g.contador into v_global;

  update public.norsk_riesgo_larsito r
     set fallidos_o_pendientes = r.fallidos_o_pendientes + 1,
         updated_at = now()
   where r.compra_id = p_compra and r.dia = v_dia and r.tipo = v_tipo
   returning r.fallidos_o_pendientes into v_riesgo;

  insert into public.norsk_reservas_larsito
    (compra_id, dia, tipo, coste, expira_at)
  values
    (p_compra, v_dia, v_tipo, p_coste, now() + make_interval(secs => p_vida_segundos))
  returning id, norsk_reservas_larsito.jti into v_reserva, v_jti;

  return query
    select true, null::text, v_reserva, v_jti,
           v_compra, v_global, v_riesgo;
end;
$$;

-- El consumidor de servidor llama a esta funcion justo antes de entregar o
-- abrir el recurso externo. La coincidencia de reserva, compra, tipo y jti y el
-- UPDATE bajo bloqueo hacen que una firma solo pueda consumirse una vez.
create or replace function public.norsk_consumir_reserva_larsito(
  p_reserva uuid,
  p_compra uuid,
  p_tipo text,
  p_jti uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reserva public.norsk_reservas_larsito%rowtype;
  v_filas integer := 0;
begin
  select r.* into v_reserva
    from public.norsk_reservas_larsito r
   where r.id = p_reserva
     and r.compra_id = p_compra
     and r.tipo = p_tipo
     and r.jti = p_jti
   for update;

  if not found
     or v_reserva.estado <> 'reservada'
     or v_reserva.expira_at <= now() then
    return false;
  end if;

  -- Una compra reembolsada, revocada o caducada después de emitir la firma no
  -- puede consumirla durante el resto de su ventana. El registro de fallo sigue
  -- disponible para devolver la cuota reservada.
  perform 1
    from public.norsk_compras c
   where c.id = v_reserva.compra_id
     and c.status = 'activa'
     and c.expires_at > now()
   for share;
  if not found then
    return false;
  end if;

  update public.norsk_reservas_larsito r
     set estado = 'consumida',
         consumida_at = now()
   where r.id = p_reserva and r.estado = 'reservada';
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    return false;
  end if;

  update public.norsk_riesgo_larsito r
     set fallidos_o_pendientes = greatest(0, r.fallidos_o_pendientes - 1),
         updated_at = now()
   where r.compra_id = v_reserva.compra_id
     and r.dia = v_reserva.dia
     and r.tipo = v_reserva.tipo;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'contador de riesgo ausente para la reserva %', p_reserva;
  end if;

  return true;
end;
$$;

-- Registra un fallo y compensa una sola vez la cuota de compra. El contador de
-- riesgo y el global no bajan: ese intento sigue contando como fallido y pudo
-- generar coste externo. Los cuatro identificadores impiden compensar otra fila.
create or replace function public.norsk_registrar_fallo_larsito(
  p_reserva uuid,
  p_compra uuid,
  p_tipo text,
  p_jti uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reserva public.norsk_reservas_larsito%rowtype;
  v_filas integer := 0;
begin
  select r.* into v_reserva
    from public.norsk_reservas_larsito r
   where r.id = p_reserva
     and r.compra_id = p_compra
     and r.tipo = p_tipo
     and r.jti = p_jti
   for update;

  if not found or v_reserva.estado <> 'reservada' then
    return false;
  end if;

  update public.norsk_uso u
     set peticiones = greatest(0, u.peticiones - v_reserva.coste)
   where u.compra_id = v_reserva.compra_id
     and u.dia = v_reserva.dia
     and u.tipo = v_reserva.tipo;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'contador de compra ausente para la reserva %', p_reserva;
  end if;

  update public.norsk_reservas_larsito r
     set estado = 'fallida',
         fallida_at = now(),
         compensada = true,
         compensada_at = now()
   where r.id = p_reserva and r.estado = 'reservada';
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'transicion de fallo perdida para la reserva %', p_reserva;
  end if;

  return true;
end;
$$;

revoke all on function public.norsk_reservar_larsito(uuid, text, integer, bigint, integer, integer, integer)
  from public, anon, authenticated;
revoke all on function public.norsk_consumir_reserva_larsito(uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.norsk_registrar_fallo_larsito(uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.norsk_reservar_larsito(uuid, text, integer, bigint, integer, integer, integer)
  to service_role;
grant execute on function public.norsk_consumir_reserva_larsito(uuid, uuid, text, uuid)
  to service_role;
grant execute on function public.norsk_registrar_fallo_larsito(uuid, uuid, text, uuid)
  to service_role;

-- 0001 revocaba estas RPC solo a anon, pero EXECUTE de PUBLIC se hereda y deja
-- abierta la funcion SECURITY DEFINER. Ademas, norsk_incr_uso acepta coste libre.
revoke all on function public.norsk_incr_uso(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.norsk_incr_uso(uuid, text, integer)
  to service_role;

-- Mismo cierre retroactivo para la muestra de contenido de pago de 0001.
revoke all on function public.norsk_muestra(integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.norsk_muestra(integer, integer, integer)
  to service_role;
