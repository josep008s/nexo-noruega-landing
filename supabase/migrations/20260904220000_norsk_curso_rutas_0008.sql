-- NEXO NORSK · dos rutas en la misma tabla de curso (migración 0008).
-- Hasta ahora norsk_curso solo contenía la Ruta Norskprøven B1. El recorrido
-- «Noruego desde cero hasta A2» comparte tabla, endpoint y app: cada fila lleva
-- su ruta y la clave primaria pasa a ser (ruta, codigo). Las filas existentes
-- quedan en 'norskproven-b1' por defecto y nada cambia para la app actual.
-- Idempotente: se puede reejecutar. Se aplica primero en el Supabase aislado.

alter table public.norsk_curso
  add column if not exists ruta text not null default 'norskproven-b1';

alter table public.norsk_curso drop constraint if exists norsk_curso_ruta_check;
alter table public.norsk_curso
  add constraint norsk_curso_ruta_check check (ruta ~ '^[a-z0-9-]{3,48}$');

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'norsk_curso_pkey'
       and conrelid = 'public.norsk_curso'::regclass
       and array_length(conkey, 1) = 1
  ) then
    alter table public.norsk_curso drop constraint norsk_curso_pkey;
    alter table public.norsk_curso add primary key (ruta, codigo);
  end if;
end $$;

drop index if exists public.norsk_curso_orden_idx;
create index if not exists norsk_curso_ruta_orden_idx
  on public.norsk_curso (ruta, activa, orden);

-- Derecho de acceso por ruta. Una compra puede abrir una ruta, las dos (la
-- «ruta completa desde cero hasta B1») o ninguna (compras antiguas de NEXO PASS,
-- que siguen entrando donde entraban). El endpoint decide con este campo; la
-- venta sigue cerrada y ningún checkout escribe aquí todavía.
alter table public.norsk_compras
  add column if not exists rutas text[] not null default '{}';

-- RLS y privilegios: sin cambios. La tabla ya está cerrada a anon/authenticated.
