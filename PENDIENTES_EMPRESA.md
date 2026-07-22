# PENDIENTES DE EMPRESA — el único documento que hay que tocar cuando exista la entidad

Todo el código de la capa de aterrizaje (/empezar, /mapa, /kit) y de NEXO NORSK está
construido y funciona en modo pre-venta SIN empresa. Este documento lista, en orden,
lo único que falta y dónde se toca cada cosa. Nada más.

Comprobación en cualquier momento:

```bash
node scripts/aterrizaje_prelaunch_check.mjs    # capa de aterrizaje
node scripts/norsk_prelaunch_check.mjs         # NEXO NORSK
```

Los dos guards saben en qué modo está cada cosa y avisan de lo que falta.
Con placeholders pendientes en pre-venta: AVISO. Con la venta abierta: BLOQUEO.

---

## PASO 1 · Entidad legal (el desbloqueo de todo)

Decidir ENK noruego vs LLC (insatumllc) con el asesor. Al tenerla, sustituir los
placeholders del titular. Son 3 archivos, mismo formato en todos:

| Archivo | Placeholder |
|---|---|
| `legal/privacidad/index.html` | `[RAZÓN SOCIAL · nº de registro (org.nr./NIF) · dirección postal]` y `[CORREO DE CONTACTO]` |
| `norsk/condiciones/index.html` | `[RAZÓN SOCIAL · nº de registro (org.nr./NIF) · dirección postal]` (rama feat/norsk) |
| `norsk/privacidad/index.html` | `[RAZÓN SOCIAL · org.nr./NIF · dirección]` (rama feat/norsk) |

MVA: el umbral de registro es 50.000 NOK de ventas en 12 meses. Decidir con el asesor
si conviene registro voluntario desde el inicio.

## PASO 2 · Supabase (los leads empiezan a guardarse)

1. Crear el proyecto en supabase.com.
2. Aplicar el esquema NORSK: `supabase/migrations/0001_norsk_schema.sql` (SQL Editor → Run).
3. Crear/ampliar la tabla de leads (la usan /sueldo, /mapa y /kit):

```sql
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  oficio text, styrk text, confianza numeric,
  source text,                       -- "mapa" | "kit-espera" | "sueldo" | "norsk-demo"
  newsletter boolean default false,  -- consentimiento explícito
  segmento text,                     -- "ue" | "no-ue" (el eje del catálogo)
  utm_source text, utm_medium text, utm_campaign text, token text,
  created_at timestamptz default now()
);
alter table leads enable row level security;  -- sin políticas: solo service key
```

4. En Vercel → Settings → Environment Variables (todos los entornos):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY` (service_role; jamás en el cliente)

Sin este paso NADA se rompe: `api/lead.js` degrada a log y las páginas funcionan igual.

## PASO 3 · Resend (los magic links de NORSK)

1. Cuenta en resend.com + verificar dominio nexonoruega.com (3 registros DNS en Webempresa).
2. `RESEND_API_KEY` en Vercel (Prod/Preview).
3. Activar el buzón de contacto y ponerlo donde está `[CORREO DE CONTACTO]`.

## PASO 4 · Stripe live

1. Activar la cuenta live con los datos de la entidad del PASO 1.
2. NORSK: `STRIPE_SECRET_KEY` (sk_live) y `STRIPE_WEBHOOK_SECRET` en Vercel (ver `norsk/NORSK_SETUP.md`).
3. KIT (cuando el contenido esté producido y validada la lista de espera):
   crear un Payment Link o Checkout de 299 NOK y abrir la venta. Son 3 toques:

| Dónde | Qué |
|---|---|
| `kit/index.html` | `var VENTA_ABIERTA = false;` → `true` |
| `kit/index.html` | `var CHECKOUT_URL = "";` → la URL de Stripe |
| `kit/MODO.json` | `"venta": false` → `true` |

El guard bloquea cualquier incoherencia entre los tres (y exige el PASO 1 hecho).

## PASO 5 · Verificación final antes de abrir la venta

1. `node scripts/aterrizaje_prelaunch_check.mjs` → "Listo para VENDER."
2. Una compra real con tarjeta propia y reembolso inmediato (E2E de verdad).
3. Enviar un lead de prueba en /mapa/ y verlo en la tabla `leads` de Supabase.

---

## Qué pasa HOY con los correos (importante)

Sin Supabase, `api/lead.js` **descarta el correo** (solo cuenta de qué formulario
vino). Por eso el alta real la hace el **embed de Substack** que aparece en
`/mapa/guia/` y en `/kit/` tras enviar: funciona hoy, sin empresa y sin Supabase.

Consecuencia a tener clara: **el dato de segmento UE / no-UE se pierde** hasta que
actives Supabase (PASO 2). Ese paso NO necesita empresa: un proyecto gratuito de
Supabase basta para empezar a acumular la lista propia con su segmentación.

## Notas de coordinación

- **feat/norsk ya está en main** (PRs #19 y #20) y `/norsk/` responde en producción,
  así que los enlaces a `/norsk/` son válidos y el guard los trata como bloqueantes.
- **El sitemap** ya incluye `/mapa/` y `/kit/` (`/empezar` y `/mapa/guia` son noindex).
- **Re-verificar los datos de la guía** (`mapa/guia/index.html`) contra las fuentes
  oficiales antes del empujón público: llevan fecha "julio 2026" en el copy.
- **Antes de mandar tráfico**: la newsletter tiene 0 ediciones publicadas. Todas las
  llamadas a la acción llevan allí, así que conviene publicar una o dos ediciones y
  dejar pegada la secuencia de bienvenida antes del empujón en redes.
