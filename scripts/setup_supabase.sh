#!/usr/bin/env bash
# Alta completa de Supabase para NEXO, en un solo comando.
#
# Hace TODO lo automatizable:
#   1. Comprueba (o inicia) el login de Supabase
#   2. Enlaza o crea el proyecto
#   3. Aplica el esquema (0001_norsk_schema.sql + 0002_leads.sql)
#   4. Sube SUPABASE_URL y SUPABASE_SERVICE_KEY a Vercel (los 3 entornos)
#   5. Verifica que la tabla leads responde
#
# Lo único que no puede hacer solo: tu login en el navegador (paso 1).
#
#   bash scripts/setup_supabase.sh                 # proyecto nuevo
#   bash scripts/setup_supabase.sh <project-ref>   # proyecto que ya existe
#
# No necesita entidad legal. El plan gratuito de Supabase sirve para empezar.

set -euo pipefail
cd "$(dirname "$0")/.."

azul()  { printf '\033[1;36m%s\033[0m\n' "$1"; }
verde() { printf '\033[1;32m%s\033[0m\n' "$1"; }
rojo()  { printf '\033[1;31m%s\033[0m\n' "$1"; }

REF="${1:-}"

azul "== 1. Login de Supabase =="
if supabase projects list >/dev/null 2>&1; then
  verde "   Ya estás autenticado."
else
  echo "   Se abrirá el navegador para autorizar. Vuelve aquí al terminar."
  supabase login
fi

azul "== 2. Proyecto =="
if [ -z "$REF" ]; then
  echo "   Proyectos disponibles:"
  supabase projects list
  echo
  echo "   Si ya tienes uno, relanza con:  bash scripts/setup_supabase.sh <project-ref>"
  echo "   Si no, créalo (30 segundos) en https://supabase.com/dashboard/projects"
  echo "   y relanza con su ref. Es la cadena del subdominio: https://<REF>.supabase.co"
  exit 0
fi
verde "   Usando proyecto: $REF"
supabase link --project-ref "$REF"

azul "== 3. Esquema =="
supabase db push
verde "   Aplicados 0001_norsk_schema.sql y 0002_leads.sql"

azul "== 4. Variables en Vercel =="
URL="https://${REF}.supabase.co"
echo "   Necesito la SERVICE ROLE KEY (Supabase > Project Settings > API > service_role)."
echo "   No se escribe en pantalla ni se guarda en el repo."
read -rsp "   Pega la service_role key: " KEY; echo

for ENTORNO in production preview development; do
  printf '%s' "$URL" | vercel env add SUPABASE_URL "$ENTORNO" --force >/dev/null 2>&1 || true
  printf '%s' "$KEY" | vercel env add SUPABASE_SERVICE_KEY "$ENTORNO" --force >/dev/null 2>&1 || true
done
verde "   SUPABASE_URL y SUPABASE_SERVICE_KEY subidas a los 3 entornos."

azul "== 5. Verificación =="
CODIGO=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  "$URL/rest/v1/leads?select=id&limit=1")
if [ "$CODIGO" = "200" ]; then
  verde "   La tabla leads responde. Supabase ACTIVO."
  echo
  echo "   Siguiente: redespliega para que las funciones cojan las variables."
  echo "   Y comprueba el guard:  node scripts/aterrizaje_prelaunch_check.mjs --env"
  echo
  rojo "   OJO: con Supabase activo ya guardas datos personales."
  rojo "   El guard pasa a BLOQUEAR hasta que rellenes el titular en"
  rojo "   legal/privacidad/index.html (ver PENDIENTES_EMPRESA.md, PASO 1)."
else
  rojo "   La tabla leads devolvió HTTP $CODIGO. Revisa el esquema o la key."
  exit 1
fi
