-- NEXO NORSK · exposicion atomica e idempotente de estimulos EX.
-- La fila se crea antes de devolver el codigo: mostrar consume el estimulo aunque
-- la sesion se abandone. Solo api/ con service_role puede invocar la RPC.

create table if not exists public.norsk_exposiciones_ex (
  id           uuid primary key default gen_random_uuid(),
  compra_id    uuid not null references public.norsk_compras(id) on delete cascade,
  ruta         text not null check (ruta ~ '^[a-z0-9-]{3,48}$'),
  tarea        text not null check (tarea in ('A', 'B', 'C')),
  attempt_id   uuid not null,
  request_id   uuid not null,
  stimulus_id  text not null check (stimulus_id ~ '^EX-[ABC]-[0-9]{2}$'),
  shown_at     timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (compra_id, ruta, request_id),
  unique (compra_id, ruta, attempt_id, tarea),
  unique (compra_id, ruta, stimulus_id)
);

create index if not exists norsk_exposiciones_ex_compra_ruta_idx
  on public.norsk_exposiciones_ex (compra_id, ruta, shown_at desc);

alter table public.norsk_exposiciones_ex enable row level security;
revoke all on table public.norsk_exposiciones_ex from public, anon, authenticated;
grant all on table public.norsk_exposiciones_ex to service_role;

create or replace function public.norsk_mostrar_estimulo_ex(
  p_compra uuid,
  p_ruta text,
  p_tarea text,
  p_attempt_id uuid,
  p_request_id uuid,
  p_candidatos text[]
)
returns table (
  ok boolean,
  stimulus_id text,
  error text,
  shown_at timestamptz
)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_existente public.norsk_exposiciones_ex%rowtype;
  v_stimulus text;
  v_shown_at timestamptz;
begin
  if p_compra is null
     or p_request_id is null
     or p_attempt_id is null
     or p_ruta is null
     or p_ruta !~ '^[a-z0-9-]{3,48}$'
     or p_tarea is null
     or p_tarea not in ('A', 'B', 'C')
     or p_candidatos is null
     or cardinality(p_candidatos) < 1
     or cardinality(p_candidatos) > 32
     or exists (
       select 1
         from unnest(p_candidatos) c
        where c !~ ('^EX-' || p_tarea || '-[0-9]{2}$')
     )
     or cardinality(p_candidatos) <> (
       select count(distinct c) from unnest(p_candidatos) c
     ) then
    return query select false, null::text, 'solicitud'::text, null::timestamptz;
    return;
  end if;

  if not exists (
    select 1
      from public.norsk_compras c
     where c.id = p_compra
       and c.status = 'activa'
       and c.expires_at > now()
  ) then
    return query select false, null::text, 'acceso'::text, null::timestamptz;
    return;
  end if;

  -- Serializa solo esta compra/ruta/tarea. Dos peticiones simultaneas nunca ven
  -- el mismo candidato como libre.
  perform pg_advisory_xact_lock(
    hashtextextended(p_compra::text || ':' || p_ruta || ':' || p_tarea, 0)
  );

  select * into v_existente
    from public.norsk_exposiciones_ex e
   where e.compra_id = p_compra
     and e.ruta = p_ruta
     and e.request_id = p_request_id;
  if found then
    if v_existente.tarea <> p_tarea or v_existente.attempt_id <> p_attempt_id then
      return query select false, null::text, 'solicitud'::text, null::timestamptz;
      return;
    end if;
    return query select true, v_existente.stimulus_id, null::text, v_existente.shown_at;
    return;
  end if;

  -- Una tarea por intento. Un request_id nuevo no puede reasignar la misma A/B/C.
  select * into v_existente
    from public.norsk_exposiciones_ex e
   where e.compra_id = p_compra
     and e.ruta = p_ruta
     and e.attempt_id = p_attempt_id
     and e.tarea = p_tarea;
  if found then
    return query select false, null::text, 'solicitud'::text, null::timestamptz;
    return;
  end if;

  select c.codigo into v_stimulus
    from unnest(p_candidatos) with ordinality as c(codigo, posicion)
   where not exists (
     select 1
       from public.norsk_exposiciones_ex e
      where e.compra_id = p_compra
        and e.ruta = p_ruta
        and e.stimulus_id = c.codigo
   )
     and not (
       p_tarea = 'C'
       and c.codigo = 'EX-C-02'
       and exists (
         select 1
           from public.norsk_exposiciones_ex b
          where b.compra_id = p_compra
            and b.ruta = p_ruta
            and b.attempt_id = p_attempt_id
            and b.tarea = 'B'
            and b.stimulus_id = 'EX-B-02'
       )
     )
   order by c.posicion
   limit 1;

  if v_stimulus is null then
    return query select false, null::text, 'agotados'::text, null::timestamptz;
    return;
  end if;

  insert into public.norsk_exposiciones_ex (
    compra_id, ruta, tarea, attempt_id, request_id, stimulus_id
  ) values (
    p_compra, p_ruta, p_tarea, p_attempt_id, p_request_id, v_stimulus
  )
  returning norsk_exposiciones_ex.shown_at into v_shown_at;

  return query select true, v_stimulus, null::text, v_shown_at;
end;
$$;

revoke all on function public.norsk_mostrar_estimulo_ex(uuid, text, text, uuid, uuid, text[])
  from public, anon, authenticated;
grant execute on function public.norsk_mostrar_estimulo_ex(uuid, text, text, uuid, uuid, text[])
  to service_role;
