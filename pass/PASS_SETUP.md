# NEXO PASS — Setup y runbook

Producto: preparación en español de la statsborgerprøven y la samfunnskunnskapsprøven.
URL: https://www.nexonoruega.com/pass/ · Rector: `Business/Nexo Noruega/norsk/PLAN_NORSK_v1.md` (Drive).

## Arquitectura

- **Compatibilidad interna**: las API, tablas, variables y scripts conservan el prefijo `norsk_` para no romper Stripe, Supabase ni enlaces de acceso ya emitidos. Solo cambia la marca y la ruta pública.
- **Landing y guías**: estáticas e indexables (`/pass/`, `/pass/que-examen-necesitas/`…).
- **App** (`/pass/app/`): shell estático SIN contenido de pago. Sin cookie carga la demo pública
  (`/data/norsk-demo.json`); con cookie pide sesiones a la API.
- **Banco completo**: SOLO en Supabase, servido por `api/norsk-preguntas.js` / `api/norsk-leccion.js`
  con cookie válida. Máximo 38 preguntas por llamada, rate limit 120 peticiones/día por compra.
  El repo es PÚBLICO: el banco jamás se commitea (`scripts/_norsk_banco/` está en .gitignore).
- **Pago**: Stripe Checkout → webhook → alta idempotente en `norsk_compras` → email magic link (Resend)
  → cookie HttpOnly → API. `/pass/gracias/` da acceso inmediato sin esperar el email.

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
| `LARSITO_ON` | todos | cerrado salvo valor exacto `true`; no activar antes de los gates finales de privacidad, proveedor y apertura comercial |
| `LARSITO_CONSUMER_READY` | todos | segundo cierre de runtime; el endpoint también exige el puente real a ElevenLabs integrado en `api/larsito-sesion.js` |
| `LARSITO_AGENT_ID` | todos | identificador privado del agente del producto completo |
| `ELEVENLABS_API_KEY` | servidor | clave privada para pedir signed URLs de Conversational AI; nunca en el cliente |
| `LARSITO_AGENT_PRIVACY_READY` | todos | segundo cierre del agente de voz; `true` solo tras fijar y publicar la conservación de audio/transcripciones de ElevenLabs |
| `LARSITO_TOPE_GLOBAL` | opcional | sesiones diarias globales; por defecto 2000 |
| `LARSITO_TOPE_FALLOS` | opcional | sesiones fallidas o pendientes por compra y día; por defecto 6 |
| `LARSITO_LISTENING` | todos | cerrado salvo valor exacto `on`; sirve audio preparado solo tras reserva y consumo atómicos |
| `LARSITO_TTS` | todos | cerrado salvo valor exacto `on`; la demo nunca lo usa y no se abre antes del gate de privacidad |
| `LARSITO_PRIVACY_READY` | todos | segundo cierre del TTS; `true` solo tras confirmar y publicar la conservación del proveedor |
| `OPENAI_API_KEY` | servidor | necesaria solo para el TTS del producto completo |
| `LARSITO_TTS_VOZ` | opcional | por defecto `ash` |
| `LARSITO_TTS_TOPE_COMPRA` | opcional | síntesis diarias por compra; por defecto 300 |
| `LARSITO_TTS_TOPE_GLOBAL` | opcional | síntesis diarias globales; por defecto 10000 |
| `LARSITO_TTS_TOPE_FALLOS` | opcional | síntesis fallidas o pendientes por compra y día; por defecto 6 |

## Aplicar el esquema y las migraciones

La fuente está en `supabase/migrations/`. Los nombres llevan las versiones exactas registradas en el historial remoto de Supabase y se aplican en orden cronológico; no basta con `20260831192821_norsk_schema_0001.sql`. Dos vías:
- **Studio**: Supabase → SQL Editor → ejecutar cada migración pendiente en orden → Run.
- **CLI**: `supabase link --project-ref <ref>` (con `SUPABASE_ACCESS_TOKEN`) y `supabase db push`.

### Decisión de esquema para Larsito

`20260902075618_larsito_reservas_0004.sql` añade un libro de reservas, un contador de riesgo y tres RPC cerradas a `service_role`:

- `norsk_reservar_larsito` bloquea y comprueba en una sola transacción el contador de la compra, el global y el límite de fallos o pendientes. Si Supabase, la compra o cualquiera de los topes falla, el endpoint no llama al proveedor.
- `norsk_consumir_reserva_larsito` canjea una reserva una sola vez y libera su plaza pendiente justo antes de entregar el resultado.
- `norsk_registrar_fallo_larsito` devuelve una sola vez el crédito de la compra cuando no llega el resultado. Conserva el contador global y la plaza de riesgo porque el intento pudo generar coste externo. La transición bloqueada hace idempotente el reintento, incluso después de medianoche.

`20260902094330_norsk_aprendizaje_0006.sql` añade la exposición de estímulos `EX-*`. `norsk_mostrar_estimulo_ex` vuelve a comprobar que la compra sigue activa, serializa por compra/ruta/tarea, registra el estímulo antes de devolverlo y rechaza reutilizaciones. Un `request_id` repetido con el mismo intento y tarea devuelve la misma asignación; si cambia tarea o intento, falla cerrado. La tabla y la RPC quedan reservadas a `service_role`. El navegador nunca elige ni envía un código `EX-*`: pide A, B y C con UUID estables y pasa solo la respuesta del servidor a `dynamicVariables` del agente. La combinación `EX-B-02 + EX-C-02` queda bloqueada por la RPC.

Los endpoints dependen de estas migraciones y fallan cerrados si las RPC no existen. Aplicarlas y probarlas en un proyecto de desarrollo antes de cambiar `LARSITO_ON`, `LARSITO_LISTENING` o `LARSITO_TTS`; aplicar el SQL no abre ninguna función comercial. La sesión del agente exige `LARSITO_CONSUMER_READY=true`, `LARSITO_AGENT_PRIVACY_READY=true` y la clave privada de ElevenLabs. `api/larsito-sesion.js` pide el signed URL con `include_conversation_id=true`, canjea la reserva con `consumirFirmaLarsito` y solo entonces devuelve el URL al navegador. Así, la firma de conversación tampoco puede reutilizarse; la JWT interna y la API key nunca salen del servidor. El agente usa autenticación por signed URL, no una allowlist simultánea.

El TTS remoto envía a OpenAI únicamente el texto que el usuario elige escuchar, nunca audio del alumno. Requiere a la vez `LARSITO_TTS=on` y `LARSITO_PRIVACY_READY=true`. El agente conversacional transmite audio y transcripciones a ElevenLabs y requiere además `LARSITO_AGENT_PRIVACY_READY=true`. Ambos gates siguen cerrados hasta confirmar y publicar la conservación aplicable de cada proveedor en `/pass/privacidad/` y probar el flujo en desarrollo. La QA lingüística y de audio aceptada para v1 es sistémica/técnica; no se presenta como firma humana o nativa.

Después, verificar el backend SIN Stripe:
```bash
SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node scripts/norsk_selftest.mjs
node scripts/larsito_reservas_selftest.mjs
```
El primer comando comprueba el esquema, las RPCs, el muestreo 36/38 por módulo,
los contadores separados api/reenvio y la revocación. El segundo prueba sin red
trece flujos: privacidad, configuración cerrada, reserva, TTS, fallo, replay, consumidor, paginación de listening, compensación segura, cola local 1-3-7-14 y asignación concurrente e idempotente de estímulos `EX-*`; no sustituye la concurrencia
real en PostgreSQL. Luego subir el contenido con `norsk_build_banco.mjs`.

## SQL (referencia; la fuente es supabase/migrations/20260831192821_norsk_schema_0001.sql)

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
  email_enviado         boolean not null default false,
  created_at            timestamptz default now()
);

-- Contadores separados por tipo: 'api' (práctica/simulacros, tope 120/día)
-- y 'reenvio' (magic links, tope 3/día). Así reenviar no quema estudio ni al revés.
create table if not exists norsk_uso (
  compra_id  uuid references norsk_compras(id),
  dia        date not null default current_date,
  tipo       text not null default 'api',
  peticiones integer not null default 0,
  primary key (compra_id, dia, tipo)
);

alter table norsk_preguntas enable row level security;
alter table norsk_lecciones enable row level security;
alter table norsk_compras   enable row level security;
alter table norsk_uso       enable row level security;
-- Sin políticas anon: solo la service_role key (desde api/) lee y escribe.

-- Rate limit atómico por tipo de uso.
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
   python3 "$HOME/Library/CloudStorage/GoogleDrive-josep.muttt@gmail.com/Mi unidad/Business/Nexo Noruega/pass/banco/exportar_banco.py"
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

## Legales (obligatorio antes de la primera venta)

- Páginas publicadas: `/pass/condiciones/` (compra, angrerett, garantía formal, reclamaciones)
  y `/pass/privacidad/` (RGPD, encargados, derechos). Enlazadas desde el footer de /norsk,
  la pantalla de compra de la app y la FAQ.
- **Rellenar el bloque [RAZÓN SOCIAL · org.nr./NIF · dirección]** en ambas páginas con la
  entidad que facture (LLC/ENK/autónomo). Sin esto NO se lanza.
- **Stripe Dashboard** → Settings → Business → Public details: poner la URL de términos
  `https://www.nexonoruega.com/pass/condiciones/` y la de privacidad. El checkout usa
  `consent_collection.terms_of_service=required` (checkbox obligatorio) + texto de
  consentimiento de entrega inmediata (angrerett): si la URL no está configurada,
  la creación de la Checkout Session FALLA. Probar en test mode.
- Crear el buzón **pass@nexonoruega.com** (o alias) y que lo lea alguien: es el canal de
  desistimiento, garantía y derechos RGPD.

## Checklist E2E antes de lanzar

- [ ] `curl -X POST localhost:3000/api/norsk-checkout/ -d '{"plan":"p30"}' -H 'Content-Type: application/json'` → 200 con url; `{"plan":"px"}` → 400. (Usa la barra final; sin ella hay 308.)
- [ ] Compra test completa → 1 fila en `norsk_compras` + 1 email de Resend (`email_enviado=true`) + `/pass/gracias/?session_id=…` pone cookie y da acceso.
- [ ] Replay del mismo evento (`stripe events resend …` o reenvío desde el Dashboard) → sigue habiendo 1 fila y 1 email (el flag `email_enviado` lo garantiza aunque /gracias insertara primero).
- [ ] Un `checkout.session.completed` SIN `metadata.plan` (p. ej. creado a mano en el Dashboard) → el webhook responde `ignored: not-norsk` y NO crea acceso.
- [ ] `stripe trigger charge.refunded` sobre la compra test → la fila pasa a `status=revocada` y la API devuelve 401.
- [ ] 4º POST del día a `/api/norsk-reenviar/` con el mismo email → responde ok constante pero NO envía email (contador `reenvio` a 3); la cuota de práctica NO baja por reenviar.
- [ ] `/api/norsk-preguntas/?modo=practica` sin cookie → 401; con cookie → 10 preguntas; `?modo=simulacro&examen=statsborger` → 36 con 4 `piloto:true`; `?examen=samfunns` → 38 con 4 piloto.
- [ ] Petición 121 del día → 429.
- [ ] Webhook con firma manipulada → 400.
- [ ] Token caducado en `/api/norsk-activar` → redirect a `/pass/acceso/?e=expirado`.
- [ ] Compra con `expires_at` en el pasado (editar la fila) → API 401 y la app muestra renovación con el progreso local intacto.
- [ ] Demo completa sin cookie y sin Supabase (solo `/data/norsk-demo.json`).
- [ ] Demo de Larsito sin llamadas a `/api/larsito-tts/`; micrófono ausente si el navegador no confirma `processLocally=true`; voz ausente si no confirma noruego y `localService=true`.
- [x] `20260902075618_larsito_reservas_0004.sql` aplicada y verificada en desarrollo: concurrencia contra el último crédito concede una sola reserva; la misma firma solo se consume una vez; un fallo devuelve una sola vez la cuota de compra pero conserva global y riesgo; al 7.º fallo con el tope por defecto se bloquea antes del proveedor; RPC ausente devuelve 503 sin llamar al proveedor.
- [x] `20260902094330_norsk_aprendizaje_0006.sql` aplicada y verificada en desarrollo: cuatro llamadas concurrentes A recibieron `EX-A-01` a `EX-A-04` sin repetición; la quinta devolvió `agotados`; un retry devolvió el mismo código; reutilizar el request con otro intento y una tarea nula devolvieron `solicitud`; la compra caducada devolvió `acceso`; B02+C02 se evitó asignando C03. Fixture borrada (0 filas QA) y anon/auth sin `SELECT` ni `EXECUTE`.
- [x] Recuperación local: cada foco registrado crea exactamente 1/3/7/14 en fechas base, +2, +6 y +13; solo persisten IDs, fechas y estado; la interfaz presenta primero el vencido más antiguo y el selftest impide completar fuera de orden. El SDK expone `clientTools.programar_recuperacion` con IDs saneados; que el agente real la invoque después de cada foco forma parte del gate final del proveedor.
- [x] Consumidor EX técnico: `EXAM_SIMULATION` pide A, B y C a `/api/larsito-estimulo/` con `attempt_id` y `request_id` estables, no contiene códigos EX en cliente y pasa las respuestas server-issued a `dynamicVariables`. Los placeholders y el prompt reales del agente siguen en el gate de proveedor.
- [x] Puente y coste: obtiene el signed URL ligado a una conversación, consume la reserva antes de devolverlo, registra fallo seguro y pasa replay/configuración cerrada sin red. La prueba viva del proveedor queda en el gate siguiente.
- [ ] Conversación completa: con una compra de desarrollo activa, el botón llama a `/api/larsito-sesion/`, el SDK local `@elevenlabs/client` inicia `startSession({ signedUrl, dynamicVariables })`, los mensajes se muestran sin persistir audio/transcripciones y terminar la sesión llama a `endSession()`.
- [x] Listening técnico: 86 audios verificados, tandas paginadas de diez sin repetir, reserva fallida sin URL y cero degradación a fail-open. El flag comercial sigue cerrado.
- [x] TTS técnico: solo POST JSON, 2 KiB de cuerpo, 300 caracteres, velocidad 0.8 o 1, `Cache-Control: private, no-store`, timeout, rechazo de audio mayor de 4 MiB y consumo único antes de entregar audio. El proveedor vivo sigue cerrado.
- [ ] Privacidad del TTS: se ha confirmado la conservación del proveedor, se ha publicado en `/pass/privacidad/` y se ha verificado que nunca sale audio del alumno; solo entonces pueden ponerse `LARSITO_PRIVACY_READY=true` y `LARSITO_TTS=on`.
- [ ] `/norsk` sin barra final → redirect a `/pass/` (trailingSlash). Rutas absolutas verificadas navegando desde `/pass/app/`.
- [ ] Lighthouse ≥95 en landing y guías; JSON-LD válido (Rich Results Test); navegación completa con teclado (1/2/3, Tab); `prefers-reduced-motion`.
- [ ] En live: compra real de 99 kr verificada y reembolsada; sitemap enviado a Search Console.

## Operación

- Re-verificación anual (enero): tasas municipales, cifras SSB/UDI, `fecha_verificacion` del banco.
- Vigilancia trimestral de prove.hkdir.no y de la høring de la statsborgerloven (jun 2026, plazo oct 2026):
  toca el botid, no las pruebas; afectaría al copy de landing y Lección 0, no al banco.
- MVA: sin registro por debajo de 50.000 NOK/12 meses (~143 ventas del plan medio). Al 80% del umbral,
  decidir registro o exención de enseñanza (mval. § 3-5, exigiría tutoría real).
- Vipps: en private preview en Stripe (Checkout + NOK ya soportados). Al pasar a GA se activa en
  `api/norsk-checkout.js` sin tocar nada más.
