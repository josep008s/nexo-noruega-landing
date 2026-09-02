-- NEXO NORSK · cierre del search_path heredado y limpieza de índice duplicado.
--
-- Las RPC antiguas de 0001/0002 ya están limitadas a service_role por 0004,
-- pero fijar search_path evita que resuelvan objetos contra un esquema mutable.
-- La restricción UNIQUE(jti) ya crea su propio índice; el índice manual de 0004
-- es redundante y se elimina sin tocar datos.

alter function public.norsk_incr_uso(uuid, text, integer)
  set search_path = public, pg_temp;

alter function public.norsk_muestra(integer, integer, integer)
  set search_path = public, pg_temp;

alter function public.norsk_incr_global(text, integer)
  set search_path = public, pg_temp;

drop index if exists public.norsk_reservas_larsito_jti_idx;
