# Migración Supabase · Ohio → São Paulo · RUNBOOK

**Origen** `uaxcfufvapzulqvynanp` · us-east-2 · WEB REACT
**Destino** `jiudqbusyknubonpedde` · sa-east-1 · virgen, 10 MB
**Ganancia medida** 125 ms por viaje (Ohio warm p50 173,7 ms → São Paulo 48,7 ms)

> Este archivo es el guion del cutover. Nada de acá se ejecutó todavía.
> Cada comando lleva su etiqueta: `[RO]` sólo lectura, `[FREEZE]` corta
> escrituras en el origen, `[TW]` escribe en el destino, `[CUT]` cambia a
> dónde apunta el tráfico, `[RB]` rollback.

---

## 0 · Lo que NO migra solo

Esto es lo que hace que un restore "sin errores" igual deje el sistema roto:

| Cosa | Por qué no viaja | Cuándo se arregla |
|---|---|---|
| **Extensiones** `pg_cron`, `pg_net`, `pg_trgm`, `unaccent` | El destino sólo trae las de fábrica | **Antes** del restore |
| **Publicación realtime** | `supabase_realtime` existe pero vacía | Después del restore |
| **Secretos de Edge Functions** (12) | No están en la base | Antes de desplegar |
| **Secreto de vault** `whatsapp_ai_worker_token` | El valor es irrecuperable: hay que generarlo de nuevo | Después del restore |
| **URL escrita en `app.disparar_worker_ia_whatsapp()`** | Apunta a Ohio; el restore la copia igual | **Después** del restore, obligatorio |
| **Cron jobs** | Viajan como filas, pero conviene recrearlos | Después del restore |
| **JWT secret** | Distinto por proyecto → las 13 sesiones se invalidan | Se acepta: todos vuelven a loguearse |
| **Historial de migraciones** (314) | Va en su propio schema | Dump aparte |

---

## 1 · Preflight `[RO]` — se puede correr hoy

```bash
npx supabase orgs list          # tiene que listar BUSCATOOLS REACT
npx supabase projects list      # origen y destino visibles
```

Huellas e inventario de seguridad del **origen**, para comparar después:

```bash
# Guardar las dos salidas; son la referencia del cutover.
psql "$OHIO_URL" -f scripts/migracion-huellas.sql            > /tmp/huellas-ohio.txt
psql "$OHIO_URL" -f scripts/migracion-comparar-seguridad.sql > /tmp/seguridad-ohio.txt
```

---

## 2 · Congelar escritores `[FREEZE]` — T0

**Todos** los escritores, en este orden. Ninguno puede quedar suelto: si uno
escribe después del dump, ese dato no llega a São Paulo.

| # | Escritor | Estado hoy | Cómo se corta | Vuelve solo |
|---|---|---|---|---|
| 1 | **Cloud Run emails** | activo (push de Gmail) | `gcloud run services update ... --no-traffic` o escalar a 0 | sí, al reanudar |
| 2 | **Cron `whatsapp-ai-worker`** | cada 2 min | `select cron.unschedule('whatsapp-ai-worker');` | no, recrear |
| 3 | **Cron `whatsapp-ai-informes`** | cada 15 min | `select cron.unschedule('whatsapp-ai-informes');` | no, recrear |
| 4 | **Usuarios del ERP** | activo | avisar y cerrar sesión | sí |
| 5 | **whatsapp-webhook** (Edge, sin JWT) | dormido (último msj 18/09) | Meta sigue pudiendo llamar: tenerlo en cuenta | sí |
| 6 | **whatsapp-listener** (backend) | no desplegado | nada que hacer | — |
| 7 | **STEL sync** | sin cron ni servicio propio | verificar que no haya disparador externo | — |

Verificación de que quedó congelado `[RO]`:

```sql
select count(*) from cron.job;                         -- 0
select max(created_at) from email_sync_log;            -- no avanza
select max(updated_at) from sales_quotes;              -- no avanza
```

---

## 3 · Preparar el destino `[TW]` — antes del restore

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists pg_trgm;
create extension if not exists unaccent;
-- pgcrypto, uuid-ossp, pg_stat_statements y supabase_vault ya están.
```

---

## 4 · Dump `[RO]` — no toca el origen

```bash
supabase db dump --db-url "$OHIO_URL" -f roles.sql  --role-only
supabase db dump --db-url "$OHIO_URL" -f schema.sql
supabase db dump --db-url "$OHIO_URL" -f data.sql --use-copy --data-only \
  -x "storage.buckets_vectors" -x "storage.vector_indexes"

# El historial de migraciones va aparte o se pierde.
supabase db dump --db-url "$OHIO_URL" -f hist_schema.sql --schema supabase_migrations
supabase db dump --db-url "$OHIO_URL" -f hist_data.sql --use-copy --data-only --schema supabase_migrations
```

Duración estimada: **2–4 min** (124 MB, la tabla más grande es `products` con 65 MB).

---

## 5 · Restore `[TW]`

```bash
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file roles.sql --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql --dbname "$SP_URL"

psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file hist_schema.sql --file hist_data.sql --dbname "$SP_URL"
```

`session_replication_role = replica` apaga los 129 triggers durante la carga:
sin eso, cada fila insertada dispararía auditoría y recálculos, y los datos
llegarían modificados.

Errores esperables y **benignos**: `object already exists` sobre schemas de
Supabase, y `ALTER ... OWNER TO supabase_admin` (se comentan si molestan).

---

## 6 · Post-restore obligatorio `[TW]`

**6.1 · La URL que apunta a Ohio.** Sin esto, el cron de São Paulo dispara el
worker de Ohio:

```sql
-- Verificar primero que sigue apuntando al origen:
select prosrc from pg_proc where proname = 'disparar_worker_ia_whatsapp';
-- Y reemplazar uaxcfufvapzulqvynanp por jiudqbusyknubonpedde en su cuerpo.
```

**6.2 · Realtime** (8 tablas):

```sql
alter publication supabase_realtime add table
  chat_conversaciones, chat_mensajes,
  email_thread_reads, email_thread_state, email_threads,
  whatsapp_conversations, whatsapp_media, whatsapp_messages;
```

**6.3 · Vault**: generar de nuevo `whatsapp_ai_worker_token` (el valor viejo no
se puede leer) y dejarlo consistente con el secreto de la Edge Function.

**6.4 · Cron**:

```sql
select cron.schedule('whatsapp-ai-worker',   '*/2 * * * *',  $$select app.disparar_worker_ia_whatsapp()$$);
select cron.schedule('whatsapp-ai-informes', '*/15 * * * *', $$select app.generar_informes_programados_whatsapp()$$);
```

**6.5 · Secuencias**: verificar que las 14 quedaron por encima del máximo real.

```sql
select schemaname, sequencename, last_value from pg_sequences where schemaname='public';
```

**6.6 · Storage**: 3 buckets (todos privados, con sus límites y mime types) y
**1 solo objeto**: `empresa-logos/bbcb2cee-…/logo-1789477492911.png`, PNG de
46.384 bytes. Se copia preservando bucket, path y content-type.

**6.7 · Edge Functions** (6) y sus 12 secretos:

```bash
supabase functions deploy --project-ref jiudqbusyknubonpedde
# secretos: ANTHROPIC_API_KEY, OPENAI_API_KEY, META_GRAPH_VERSION,
# META_WHATSAPP_ACCESS_TOKEN, META_WHATSAPP_APP_SECRET,
# META_WHATSAPP_VERIFY_TOKEN, WHATSAPP_AI_EFFORT, WHATSAPP_AI_MODEL,
# WHATSAPP_AI_PROVIDER  (SUPABASE_URL / SUPABASE_ANON_KEY /
# SUPABASE_SERVICE_ROLE_KEY los inyecta la plataforma)
```

`whatsapp-webhook` y `whatsapp-ai-worker` van **sin** verificación de JWT;
`config-usuarios`, `config-empresa-logo`, `whatsapp-send-message` y
`whatsapp-ai-analyze` **con**. Hay que respetarlo o se rompe el webhook de Meta.

---

## 7 · Validar antes de cambiar el tráfico `[RO]`

```bash
psql "$SP_URL" -f scripts/migracion-huellas.sql            > /tmp/huellas-sp.txt
psql "$SP_URL" -f scripts/migracion-comparar-seguridad.sql > /tmp/seguridad-sp.txt

diff /tmp/huellas-ohio.txt   /tmp/huellas-sp.txt      # debe ser vacío
diff /tmp/seguridad-ohio.txt /tmp/seguridad-sp.txt    # debe ser vacío
```

**PASS obligatorio**: los dos `diff` vacíos. Cualquier diferencia se investiga
antes de seguir. Las huellas comparan contenido fila por fila, no sólo
`count(*)`: una tabla puede tener las mismas 1.010 filas y contenido distinto.

---

## 8 · Cutover `[CUT]`

| Componente | Qué cambia | Validación |
|---|---|---|
| `.env` local | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | `npm run dev` carga datos |
| GitHub secrets | los dos mismos | build verde |
| Cloud Run emails | `VITE_SUPABASE_URL` + `SUPABASE_SECRET_KEY` | `GET /salud` → 200 |
| whatsapp-listener | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | no desplegado hoy |
| `supabase/.temp/linked-project.json` | ref | `supabase link` |

**No se tocan**: los `.mjs` de `scripts/` (migraciones históricas ya
ejecutadas), `src/lib/env.test.ts` y `backend/whatsapp-listener/src/config.test.ts`
(fixtures), `database.types.ts` (comentario), `README.md` y `docs/`
(documentación). Son 24 archivos con el ref, pero **sólo 5 cambian**.

---

## 9 · Punto de no retorno

**El POINT_OF_NO_RETURN es el paso 8**, y más precisamente el momento en que
Cloud Run empieza a escribir en São Paulo.

- **Antes**: rollback instantáneo. Ohio quedó intacto y con todos sus datos;
  se revierten las variables y listo. `[RB]`
- **Después**: hay escrituras nuevas sólo en São Paulo. Volver a Ohio a ciegas
  las pierde — eso es el split-brain.

Para mantenerlo reversible el mayor tiempo posible:

1. Ohio **no se pausa ni se borra** hasta 72 h después del cutover.
2. Los escritores se reanudan **de a uno**, empezando por los usuarios (que se
   dan cuenta si algo anda mal) y dejando Cloud Run para el final.
3. Si hay que volver después de escrituras: no revertir a ciegas — exportar de
   São Paulo lo escrito desde T0 (`created_at > T0`) y reaplicarlo en Ohio.

---

## 10 · Ventana

| Momento | Paso | Estimado |
|---|---|---|
| T-30 | Preflight, huellas de Ohio, extensiones en destino | 10 min |
| T-10 | Avisar a los usuarios | — |
| **T0** | **FREEZE** de los 7 escritores | 5 min |
| T+5 | Dump | 2–4 min |
| T+10 | Restore | 5–8 min |
| T+20 | Post-restore (6.1 a 6.7) | 15 min |
| T+35 | Validación: los dos `diff` | 5 min |
| T+40 | Cutover de variables y deploy | 10 min |
| T+50 | Smoke test | 10 min |
| T+60 | UNFREEZE escalonado | — |

**EXPECTED_DOWNTIME = 45–60 min.** El dump y el restore son lo más corto; lo
que consume la ventana son los pasos manuales del 6.

---

## 11 · Smoke test post-cutover

- **Auth**: login de admin; refresh; logout/login.
- **Dashboard**: montos de septiembre, 154 cotizaciones abiertas, 28 pedidos.
- **Clientes**: 1.010.
- **Catálogo**: búsqueda, facetas, atributos de categoría, equivalencias.
- **Ventas**: listado de cotizaciones (307), abrir COT-BTS00001, pedidos (173),
  remitos (194). **RT-ERP00001 tiene que seguir `draft`** — si figura emitido,
  algo lo escribió: parar.
- **Emails**: bandeja (1.257+), contador de no leídos, adjunto PDF.
- **Chat**: los 4 compañeros en la lista.
- **Stock**: 379 balances, 381 movimientos.
- **Realtime**: un evento controlado y que llegue.
- **WhatsApp**: `/salud` sin mandar mensajes reales.

---

## 12 · Benchmark post-migración

El mismo arnés del baseline, para tener el antes y el después:

```bash
OHIO_URL=... OHIO_KEY=... SP_URL=... SP_KEY=... N=20 \
  bash scripts/benchmark-latencia-regiones.sh
```

Y las RPC reales ya con datos: `listar_bandeja_email`, `search_products`,
`catalog_facets`, Dashboard frío y caliente. Recién con eso se decide si hace
falta plan Pro — que es otra palanca: la región arregla la red, **no** la CPU.
