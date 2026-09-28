#!/usr/bin/env bash
# Fase 29 · E2 — Benchmark de latencia entre dos proyectos Supabase.
#
# Mide desde ESTA máquina, intercalando las regiones request por request, para
# que un bache de Internet no le pegue a una sola y sesgue la comparación.
#
# Por qué curl y no el navegador: el intento anterior desde el navegador dio
# Ohio 1350 ms cuando la verdad son ~200 ms — el control falló y hubo que
# tirar la medición entera. curl separa DNS / TCP / TLS / TTFB / total y no
# tiene nada en el medio.
#
# Uso:
#   OHIO_URL=https://xxx.supabase.co OHIO_KEY=... \
#   SP_URL=https://yyy.supabase.co   SP_KEY=...   \
#   OHIO_PATH=/rest/v1/companies?select=id&limit=1 \
#   SP_PATH=/rest/v1/latency_benchmark?select=id&limit=1 \
#   N=20 bash scripts/benchmark-latencia-regiones.sh
#
# Sólo hace GET. No escribe nada, en ningún proyecto.

set -u

N="${N:-20}"
OHIO_URL="${OHIO_URL:-}"; OHIO_KEY="${OHIO_KEY:-}"
SP_URL="${SP_URL:-}";     SP_KEY="${SP_KEY:-}"
# Default: /auth/v1/health. Responde 200, no toca datos y es IDENTICO en
# cualquier proyecto Supabase, asi que compara red contra red y no una tabla
# llena contra uno vacio (el error que advierte el plan en su punto 9).
OHIO_PATH="${OHIO_PATH:-/auth/v1/health}"
SP_PATH="${SP_PATH:-/auth/v1/health}"

[ -n "$OHIO_URL" ] && [ -n "$OHIO_KEY" ] || { echo "Faltan OHIO_URL / OHIO_KEY" >&2; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# Una corrida completa, handshake incluido: es lo comparable entre regiones.
medir() {
  curl -o /dev/null -s --no-keepalive --max-time 20 \
    -H "apikey: $2" -H "Authorization: Bearer $2" \
    -w '%{time_namelookup} %{time_connect} %{time_appconnect} %{time_starttransfer} %{time_total}\n' \
    "$1" 2>/dev/null
}

# Varias requests sobre la MISMA conexión: el estado estable, que es lo que
# paga la app una vez abierta.
medir_caliente() {
  local url="$1" key="$2" n="$3" args=()
  # OJO: `-o` vale por URL, no para toda la invocación. Sin repetirlo, el
  # cuerpo de la segunda en adelante sale por stdout y ensucia las cifras
  # (se veía como p50=0.0). Va un `-o /dev/null` por cada URL.
  for _ in $(seq 1 "$n"); do args+=(-o /dev/null "$url"); done
  curl -s --max-time 60 \
    -H "apikey: $key" -H "Authorization: Bearer $key" \
    -w '%{time_appconnect} %{time_total}\n' "${args[@]}" 2>/dev/null
}

# Percentiles sobre milisegundos por stdin. awk no los trae, así que se
# calculan sobre el array ya ordenado (método del índice superior).
resumen() {
  sort -n | awk -v etiqueta="$1" '
    { v[NR] = $1; suma += $1 }
    function pct(p,   i) { i = int(NR * p); if (i < 1) i = 1; if (NR * p > i) i++; return v[i] }
    END {
      if (NR == 0) { printf "%-22s (sin datos)\n", etiqueta; exit }
      printf "%-22s n=%-3d min=%-7.1f p50=%-7.1f p75=%-7.1f p95=%-7.1f max=%-7.1f mean=%.1f\n", \
             etiqueta, NR, v[1], pct(0.50), pct(0.75), pct(0.95), v[NR], suma / NR
    }'
}

informe() {
  local f="$1" nombre="$2"
  [ -s "$f" ] || { echo "── $nombre: sin datos"; return; }
  echo "── $nombre (REST trivial, conexión fría)"
  awk '{print $1*1000}'        "$f" | resumen "  DNS"
  awk '{print ($2-$1)*1000}'   "$f" | resumen "  TCP connect"
  awk '{print ($3-$2)*1000}'   "$f" | resumen "  TLS handshake"
  awk '{print $4*1000}'        "$f" | resumen "  TTFB"
  awk '{print $5*1000}'        "$f" | resumen "  TOTAL"
  echo
}

echo "== Benchmark de latencia · $N corridas por región, intercaladas =="
echo

for _ in $(seq 1 "$N"); do
  medir "${OHIO_URL}${OHIO_PATH}" "$OHIO_KEY" >> "$TMP/ohio.raw"
  [ -n "$SP_URL" ] && medir "${SP_URL}${SP_PATH}" "$SP_KEY" >> "$TMP/sp.raw"
  sleep 0.15
done

informe "$TMP/ohio.raw" "OHIO (us-east-2)"
informe "$TMP/sp.raw"   "SAO PAULO (sa-east-1)"

echo "── Conexión caliente (misma conexión reusada, N requests seguidas)"
medir_caliente "${OHIO_URL}${OHIO_PATH}" "$OHIO_KEY" "$N" | awk '{print $2*1000}' | resumen "  OHIO total"
[ -n "$SP_URL" ] && medir_caliente "${SP_URL}${SP_PATH}" "$SP_KEY" "$N" | awk '{print $2*1000}' | resumen "  SAO PAULO total"
