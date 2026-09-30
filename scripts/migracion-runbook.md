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

---

## 13 · Estado real al 2026-09-28 — la migración se hizo por FDW, no por dump

Las secciones 4 y 5 quedaron obsoletas: no hacía falta `pg_dump` ni Docker. El
esquema se **volvió a ejecutar** desde `supabase_migrations.schema_migrations`
(la columna `statements` guarda cada sentencia) y los datos se copiaron
**servidor a servidor** con `postgres_fdw`, sin pasar por esta máquina.

`DESTINO = jiudqbusyknubonpedde` (sa-east-1, ACTIVE_HEALTHY, PG 17.6.1.166)

### Hecho y verificado contra producción

| Qué | Cómo se verificó | Resultado |
| --- | --- | --- |
| Firmas de función | hash de las 332 firmas | `287665d1089626c5072b868c583a5743` en los dos |
| **Cuerpos de función** | `prosrc`, `prosecdef`, lenguaje, volatilidad y `search_path`, uno por uno contra el origen por FDW | **idénticos**, salvo la única diferencia deliberada (ver abajo) |
| Estructura | conteos | 97 tablas (97 con RLS), 2 vistas, 129 triggers, 128 policies, 14 secuencias, 357 FK |
| Datos | huella por contenido de 18 tablas | 99 tablas / 67.659 filas; 17 idénticas y `email_threads` al día |
| Secuencias | `pg_get_serial_sequence` + `setval` | al día |
| Auth | `auth.users` + `auth.identities` con los hash | copiados; sesiones NO (el JWT secret cambia: todos vuelven a entrar) |
| Realtime | publicación | 8 tablas, idéntico |
| **Grants de tabla** | `aclexplode(relacl)`, hash | 2.430 / `ae84b9eb97dd88b5b5729b4c70d719a9` en los dos |
| **EXECUTE de funciones** | `aclexplode(proacl)`, hash | 652 / `696b0062576c30c3c1f34786375c44c9` en los dos |
| Storage | buckets y policies, hash | buckets `a0266a72…`, 5 policies `5d74e6b2…`, idénticos |
| Referencias cruzadas | barrido de cuerpos de función y de TODAS las tablas | 0 apuntando a Ohio |
| Extensiones | esquema de instalación de cada una | idénticas (`postgres_fdw` es andamiaje) |
| Advisors de seguridad | diff de hallazgos contra el origen | 0 hallazgos que estén en producción y falten acá; 1 ERROR en los dos (la vista `product_availability`, preexistente) |

### Tres agujeros de permisos que hubo que tapar

Recrear objetos a mano los abre sin avisar: ni `pg_get_functiondef` ni
`create table` arrastran los ACL, y Postgres concede EXECUTE a PUBLIC y
Supabase concede todo a `anon` y `authenticated` sobre lo nuevo en `public`.

- `customer_legacy_tax_ids` tenía `anon` y `authenticated` con los 8
  privilegios. Producción: `anon` nada, `authenticated` sólo SELECT.
- `crear_remito_desde_pedido` (**security definer**) tenía EXECUTE para PUBLIC
  y `anon`. Producción: sólo `authenticated`.
- `grupos_cuit_legacy`, lo mismo.

**Lección para cualquier migración futura: comparar los grants por hash.** Es
la única parte que no se ve mirando ni los datos ni el esquema.

### El agujero grande: 30 funciones con el cuerpo viejo

**De las 317 migraciones, mi reproducción aplicó 220, falló en 5 y SALTEÓ 92.**
El clasificador que decidía qué sentencia era DDL las descartó, y con ellas se
fue la versión nueva de **30 funciones**. Las verifiqué normalizando espacios y
comentarios: ninguna era diferencia de formato, las 30 eran código distinto.

El historial de producción está completo —el arreglo de la E1 figura como
`20260925195616 fase29_e1_bandeja_email_security_definer`—; el problema fue
mío, no del historial. (Los conteos quedan en `public._replica_log`.)

La peor era `listar_bandeja_email`, que en el destino había vuelto a
`language sql` **sin `security definer`**: exactamente la versión que tardaba
4.400 ms en vez de 215 ms. El destino habría arrancado con la bandeja de correo
20 veces más lenta.

**Por qué no lo vio la verificación anterior:** comparé el hash de las 332
*firmas*, y ni el cuerpo ni `prosecdef` ni el lenguaje están en la firma. Un
hash de firmas dice que la API es la misma, no que la base haga lo mismo.

Se corrigió trayendo del origen por FDW `prosrc`, `prosecdef`, lenguaje,
volatilidad, `strict`, `leakproof`, paralelismo y `search_path`, y rearmando la
DDL en el servidor. Del destino se conservó sólo la firma. Así no pasa código
por el chat ni se copia a mano. `create or replace function` **preserva los
ACL**: los grants siguieron en 652 / `696b0062…` después de rehacer las 30.

**Para el cutover: volver a correr este diff.** Está en
`public._diff_funciones`, se rearma con la consulta de más abajo, y tiene que
dar una sola fila (`app.disparar_worker_ia_whatsapp`).

```sql
-- requiere el esquema remoto_cat importado por FDW y correr como `postgres`
select n.nspname||'.'||p.proname, p.pronargs
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  join remoto_cat.pg_proc rp on rp.proname = p.proname and rp.pronargs = p.pronargs
  join remoto_cat.pg_namespace rn on rn.oid = rp.pronamespace and rn.nspname = n.nspname
 where n.nspname in ('public','app') and p.prokind in ('f','p')
   and (md5(p.prosrc) <> md5(rp.prosrc) or p.prosecdef <> rp.prosecdef);
```

### Verificación estructural completa (lo que el conteo no ve)

Después de lo de las funciones no alcanzaba con contar objetos, así que comparé
**definición contra definición** trayendo el catálogo del origen por FDW:

| Objeto | Diferencias reales |
| --- | --- |
| índices (`indexdef`) | 0 |
| policies (`cmd`, roles, `qual`, `with_check`) | 0 |
| vistas (`definition`) | 0 |
| columnas (tipo, nulabilidad, default, identidad, generada) | 0 |
| CHECK con nombre propio (`check_clause`) | 0 |
| PK / UNIQUE / FK (columnas en orden + `ON UPDATE` / `ON DELETE`) | 0 |
| triggers (`timing`, evento, condición, `action_statement`) | 0 |
| funciones (cuerpo, definer, lenguaje, volatilidad, `search_path`) | 1, la deliberada |

Lo único que «sobra» en el destino son las dos PK de mis tablas de andamiaje.

### Tres falsos positivos de MI método, para no volver a perseguirlos

Comparar catálogos entre dos bases tiene trampas que inventan diferencias:

1. **El `search_path` del render.** `pg_policies.qual`, `pg_views.definition`,
   `pg_indexes.indexdef` y los `column_default` se rinden calificando los
   nombres según el `search_path` **de la sesión**. El lado remoto llega por FDW
   con `search_path = pg_catalog` y califica todo (`FROM public.sales_quotes`);
   el local no (`FROM sales_quotes`). Daba **24 diferencias falsas**. Se arregla
   leyendo el lado local también con `set_config('search_path','pg_catalog',true)`.
2. **Los pseudo-CHECK de NOT NULL.** `information_schema` inventa un constraint
   por columna NOT NULL, con el **OID de la tabla en el nombre**
   (`2200_17839_1_not_null`). Los OID difieren entre bases, así que esos nombres
   jamás coinciden: **1.496 diferencias falsas**. Hay que excluirlos; la
   nulabilidad ya se compara por columna.
3. **Filtrar un solo lado.** Al lado remoto le olvidé el
   `constraint_type <> 'CHECK'` que sí tenía el local, y los ~230 CHECK salieron
   todos como «falta en el destino». **Señal de que el filtro no es simétrico:
   las diferencias aparecen todas en una sola dirección.**

**Y la consecuencia para el repo:** vale la pena que los `scripts/fase*.sql`
entren por `apply_migration` y no por el editor, para que el historial sea
suficiente para reconstruir la base. Hoy lo es —está todo registrado—, pero la
verificación de arriba es la que hay que correr, no el conteo de objetos.

### Única diferencia deliberada con producción

`app.disparar_worker_ia_whatsapp()` lleva la URL del proyecto escrita en el
cuerpo. En el destino ya apunta al destino. Sin esto, el cron del destino
dispararía el worker de PRODUCCIÓN cada 2 minutos con un token que allá no
vale: no procesaría nada y golpearía producción en silencio.

### Lo que falta, y por qué no lo pude hacer yo

**a · Desplegar las 6 Edge Functions.** Necesita un token personal de Supabase,
que no va por chat. El CLI corre por `npx` y para funciones NO pide Docker:

```bash
export SUPABASE_ACCESS_TOKEN=...        # sbp_… de supabase.com/dashboard/account/tokens
cd C:/Users/janog/web-react
for f in config-empresa-logo config-usuarios whatsapp-ai-analyze whatsapp-ai-worker whatsapp-send-message whatsapp-webhook; do
  npx supabase@latest functions deploy "$f" --project-ref jiudqbusyknubonpedde
done
```

`verify_jwt` NO es uniforme; el CLI lo toma de `supabase/config.toml`, así que
hay que confirmar que quede igual que en producción:

| función | verify_jwt |
| --- | --- |
| config-empresa-logo | true |
| config-usuarios | true |
| whatsapp-ai-analyze | true |
| whatsapp-send-message | true |
| **whatsapp-webhook** | **false** (la llama Meta, la protege la firma HMAC) |
| **whatsapp-ai-worker** | **false** (la protege `x-worker-token`) |

**b · Confirmar que el repo es lo que corre en producción.** No hay CI que
despliegue funciones, así que el repo pudo quedar atrás de un hotfix hecho a
mano. Comparé 2 de las 6 contra producción y son **idénticas byte a byte**
(`whatsapp-ai-worker` y `whatsapp-ai-analyze`: 9 archivos, incluidos los tres
módulos compartidos, que son el grueso del código). Las otras cuatro quedan
por comparar; se cierra en un minuto y sin secretos en el chat:

```bash
cd C:/Users/janog/web-react
for f in config-empresa-logo config-usuarios whatsapp-send-message whatsapp-webhook; do
  npx supabase@latest functions download "$f" --project-ref uaxcfufvapzulqvynanp
done
git status --short supabase/functions/   # vacío = el repo ES producción
```

Si sale algo modificado, **ese** es el código que hay que desplegar, no el del
repo, y hay que commitearlo.

**c · Los 12 secretos de las funciones + el secreto de vault.** Los pone quien
los tiene. El de vault (`whatsapp_ai_worker_token`) es nuevo y se genera:

```bash
npx supabase@latest secrets set --project-ref jiudqbusyknubonpedde \
  ANTHROPIC_API_KEY=... OPENAI_API_KEY=... META_GRAPH_VERSION=... \
  META_WHATSAPP_ACCESS_TOKEN=... META_WHATSAPP_APP_SECRET=... \
  META_WHATSAPP_VERIFY_TOKEN=... WHATSAPP_AI_EFFORT=... \
  WHATSAPP_AI_MODEL=... WHATSAPP_AI_PROVIDER=...
```

**d · El único objeto de Storage** (`empresa-logos/bbcb2cee-…/logo-….png`, PNG,
46.384 bytes). Es un byte, no una fila: SQL no lo copia. Lo más simple es
volver a subir el logo desde la pantalla de Configuración después del cutover.

**e · El cron del destino.** `permission denied for table job` desde el MCP. Se
crea en el cutover, y **deliberadamente apagado** hasta entonces: encenderlo
antes haría que dos proyectos procesen la misma cola.

**f · Re-sincronizar los datos en el cutover.** Producción sigue cambiando (el
sync de correo está vivo). La copia de hoy es una base, no el final.

**g · Limpiar el andamiaje** cuando ya no haga falta —**pero recién después del
cutover**, porque el re-sync y la verificación final lo necesitan:

```sql
drop schema if exists remoto      cascade;   -- foreign tables de datos
drop schema if exists remoto_auth cascade;
drop schema if exists remoto_cat  cascade;   -- pg_proc, pg_indexes, pg_policies…
drop schema if exists remoto_is   cascade;   -- information_schema
drop table if exists public._replica_log, public._replica_plan, public._copia_log;
drop table if exists public._diff_funciones, public._diff_policies_detalle,
                     public._diff_estructura, public._diff_estructura2,
                     public._diff_constraints;
drop table if exists public._is_tc, public._is_kcu, public._is_rc, public._is_chk;
drop table if exists public._resync_prueba, public._verif_datos, public._unificacion;
drop table if exists public._dup_refs, public._merge_productos, public._rename_tohnichi;
drop table if exists public._norm_modelo;
drop table if exists public._deriva, public._deriva_col, public._deriva_detalle;
drop table if exists public._reaplicar_informe, public._preflight_informe;
drop function if exists public._resync(text[]);
drop function if exists public._verificar_datos(text[]);
drop function if exists public._reaplicar_calidad(boolean);
drop function if exists public._reaplicar_unificacion(boolean);
drop user mapping if exists for postgres server ohio;
drop server if exists ohio cascade;
drop extension if exists postgres_fdw;
```

**Antes de correr esto**: `_merge_productos`, `_norm_modelo`, `_rename_tohnichi` y
`_unificacion` son el único registro de qué se fusionó y qué se renombró (§16–§23),
y lo que `_reaplicar_calidad()` necesita para reconstruirlo (§24). Se borran
**recién cuando el cutover está verificado**, y conviene guardarlos aparte antes:

```sql
copy (select * from public._merge_productos) to stdout with csv header;
```

**`_preflight()` no está en esa lista a propósito**: sus once comprobaciones
(sobre todo la 7, que ningún producto tenga un valor de atributo fuera de su
lista cerrada) sirven para siempre, no sólo para el cutover. Conviene quedárselo
y sacarle el guión bajo del nombre, que es lo que lo marca como andamiaje.

Después de eso el diff de advisors contra producción tiene que dar **0 y 0**.
Hoy el destino tiene 14 hallazgos de más y son **todos** este andamiaje:
12 tablas con RLS y sin policy, `postgres_fdw` en `public`, y los reg types de
`remoto_cat.pg_proc`. Ojo que `postgres_fdw` mete además 5 funciones en `public`
sin `search_path` fijo; desaparecen al borrar la extensión.

**h · Decidir qué pasa con el legacy** `hnyngsejohkmlaccpkux` (us-west-2), que
sigue PAUSADO desde el 26/9 para liberar cupo del plan free.

**i · La regresión de RLS con contraseñas** sigue en `PENDING_PASSWORDS`
(`scripts/regresion-rls-roles.mjs` necesita `BT_PW_JANO` y `BT_PW_TEST`).

### Lo que ya no hay que discutir

La ganancia está **medida**, no estimada: 20 muestras intercaladas contra
`/auth/v1/health` dieron **Ohio 173,7 ms p50 contra São Paulo 48,7 ms**. Son
**125 ms menos por viaje**, el 72 % del tiempo de red, en todas las pantallas
a la vez. Ninguna optimización de consulta se acerca.

---

## 14 · CUTOVER — la lista ejecutable

Estado al 2026-09-28. `DESTINO = jiudqbusyknubonpedde` (sa-east-1).

```
VITE_SUPABASE_URL      = https://jiudqbusyknubonpedde.supabase.co
VITE_SUPABASE_ANON_KEY = sb_publishable_ZrIVBQYQkTTRxp_XtAJpeA_GSMRjHmV
```

### Ya hecho en Brasil (no hay que repetirlo)

- Esquema, datos, usuarios con sus contraseñas, secuencias, Realtime, grants,
  Storage (buckets y policies) — verificado definición por definición (§13).
- `app.disparar_worker_ia_whatsapp()` apuntando a Brasil y no a Ohio.
- Secreto de Vault `whatsapp_ai_worker_token`: **generado nuevo en la base**. No
  hace falta el de Ohio: vive sólo en Vault y se valida por RPC, no es un secret
  de Edge Function.
- Los dos jobs de `cron.job` existen con el mismo horario que producción y
  quedaron **apagados**. (`update cron.job` da permission denied; se maneja con
  `cron.alter_job`, que sí funciona.)
- Edge Function `config-empresa-logo` desplegada y verificada (`booted 24ms`).

### Las tres patas que faltan

El ERP no es sólo Supabase. Son tres servicios y **los tres tienen que apuntar a
Brasil**, o queda mitad y mitad.

#### Pata 1 · Supabase: sólo los secretos — las 6 funciones YA están

Las **6 Edge Functions están desplegadas** en Brasil por MCP y **verificadas
byte a byte contra el repo**: se volvió a bajar cada bundle desplegado y se
comparó archivo por archivo con hash normalizado a LF. 14 de 14 idénticos,
incluido el `logica.ts` de 36 KB.

`verify_jwt` **no es uniforme**, y quedó igual que en producción:

| función | verify_jwt | por qué |
| --- | --- | --- |
| config-empresa-logo | true | |
| config-usuarios | true | |
| whatsapp-ai-analyze | true | |
| whatsapp-send-message | true | |
| **whatsapp-webhook** | **false** | la llama Meta, la protege la firma HMAC |
| **whatsapp-ai-worker** | **false** | la protege el token de Vault |

Probadas contra la función desplegada, no sólo compiladas:

- `whatsapp-webhook`: GET sin token → **403 `Forbidden`** en `text/plain`;
  POST sin firma → **403**; PUT → **405**. Falla cerrado, como debe.
- `whatsapp-ai-worker`: POST sin token → **401**; con un token inválido →
  **401 decidido por la BASE** (la RPC comparó el hash contra el Vault), o sea
  que el secreto que se generó y el circuito de validación funcionan.
- `config-empresa-logo`: `booted (time: 24ms)`.

Si alguna vez hay que redesplegarlas desde el repo:

```bash
export SUPABASE_ACCESS_TOKEN=...   # supabase.com/dashboard/account/tokens
cd C:/Users/janog/web-react
for f in config-empresa-logo config-usuarios whatsapp-ai-analyze \
         whatsapp-ai-worker whatsapp-send-message whatsapp-webhook; do
  npx supabase@latest functions deploy "$f" --project-ref jiudqbusyknubonpedde
done
```

**Ojo con el CORS al probar en local:** la lista de orígenes de `config-*` y
`whatsapp-send-message` es `app.buscatools.com`, `localhost:5173` y
`localhost:3000`. **El preview corre en 4173 y NO está en la lista**: para
probar Configuración hay que usar `npm run dev`.

Los secretos, sacados del **código** (`Deno.env.get`), no de una lista de memoria.
`SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` **los inyecta la
plataforma**: no van acá.

Qué proveedor de IA usa producción **de verdad**, leído de `whatsapp_ai_runs` en
Ohio: `provider = openai`, `model = gpt-5.6-luna`, 4 corridas, la última el
2026-09-17. O sea que de IA sólo hace falta la clave de OpenAI; Anthropic no se
está usando.

`WHATSAPP_AI_PROVIDER = openai` y `WHATSAPP_AI_MODEL = gpt-5.6-luna` **ya están
puestos** (2026-09-28, desde el panel). No son secretos, pero hacían falta: el
default de `WHATSAPP_AI_PROVIDER` en el código es `'falso'`, el proveedor de
mentira de los tests, y sin esa variable el análisis con IA queda simulado y no
avisa.

Quedan **los cuatro valores reales**, que sólo existen en el panel de Meta y en
el de OpenAI:

```bash
npx supabase@latest secrets set --project-ref jiudqbusyknubonpedde \
  OPENAI_API_KEY=...             \
  META_WHATSAPP_ACCESS_TOKEN=... \
  META_WHATSAPP_APP_SECRET=...   \
  META_WHATSAPP_VERIFY_TOKEN=...
```

**Cómo saber que entraron, sin exponer nada.** El webhook registra POR QUÉ
rechaza. Sin el secreto dice `sin_secreto`; con el secreto puesto, una firma
falsa pasa a decir `no_coincide`:

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -H 'x-hub-signature-256: sha256=0000000000000000000000000000000000000000000000000000000000000000' \
  -d '{"object":"whatsapp_business_account"}' \
  https://jiudqbusyknubonpedde.supabase.co/functions/v1/whatsapp-webhook
```

Sigue devolviendo 403 en los dos casos —tiene que hacerlo—; el motivo se lee en
los logs de la función. **Mientras diga `sin_secreto`, NO hay que tocar los
secrets de GitHub**: significa que Meta no va a poder entregar ni un mensaje.

`META_GRAPH_VERSION` (default `v23.0`) y `WHATSAPP_AI_EFFORT` (default `low` en
OpenAI) se pueden dejar al default.

#### Pata 2 · La web (GitHub Pages)

Sólo dos secretos del repo `buscatoolsjano-web/web-react`. La URL de la API de
correo está escrita en `deploy.yml` y **no** cambia.

```
Settings -> Secrets and variables -> Actions
  VITE_SUPABASE_URL      -> https://jiudqbusyknubonpedde.supabase.co
  VITE_SUPABASE_ANON_KEY -> sb_publishable_ZrIVBQYQkTTRxp_XtAJpeA_GSMRjHmV
```

Después, un push a `main` (o *Run workflow*) reconstruye y publica.

#### Pata 3 · La API de correo en Cloud Run — **la que es fácil de olvidar**

`backend/emails` lee `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y
`SUPABASE_SECRET_KEY`. **Si no se actualiza, después del cutover el sync de
correo sigue leyendo y escribiendo en OHIO**, con la web ya en Brasil: los
correos entrarían a la base vieja y no aparecerían en el ERP.

```bash
gcloud run services update buscatools-erp-email-api \
  --region us-east1 --project 545134968830 \
  --update-env-vars VITE_SUPABASE_URL=https://jiudqbusyknubonpedde.supabase.co,VITE_SUPABASE_ANON_KEY=sb_publishable_ZrIVBQYQkTTRxp_XtAJpeA_GSMRjHmV \
  --update-secrets SUPABASE_SECRET_KEY=...   # la service key de Brasil
```

Y después **reiniciar el watch de Gmail**, porque el cursor (`historyId`) vive en
la base: al cambiar de base, el sync arranca del cursor que viajó en la copia.
No se pierden correos —Pub/Sub es push y el cursor nunca retrocede— pero hay que
re-sincronizar los datos justo antes (ver abajo).

Nota para más adelante, no para el cutover: este servicio está en **us-east1**.
Con la base en São Paulo le queda un viaje largo para cada operación de sync.
Moverlo a `southamerica-east1` mejoraría el sync, pero cambia su URL y eso
obliga a tocar `deploy.yml` y la suscripción de Pub/Sub.

### El momento del cutover, en orden

1. **Frenar escrituras**: pausar el sync de correo (o el servicio de Cloud Run).
2. **Re-sincronizar los datos** desde Ohio por FDW, con `public._resync()`.
   **Corrido completo el 2026-09-28: 97 tablas, 67.651 filas, 144 segundos.**

   ```sql
   -- sin argumentos = las 97 tablas. Con un array = sólo ésas.
   -- El `set local` NO es opcional: la función se niega a correr sin él, porque
   -- con los triggers vivos la auditoría duplica filas y las FK bloquean los delete.
   begin;
     set local session_replication_role = replica;
     select * from public._resync();
   commit;
   ```

   **Ojo con el timeout**: las 97 juntas no entran en una sola sentencia. Hay que
   partirlo; `products` sola tarda 39 s y `product_prices` 18 s. Lo que se hizo:
   una tanda con esas dos, otra con `product_images`, `product_equivalences` y
   `stel_reconciliation_log`, y el resto en dos mitades alfabéticas.

   Después, verificar con `public._verificar_datos()`, que compara **huella de
   contenido** de cada tabla contra el origen por FDW —hash de cada fila,
   ordenado por ese mismo hash, así no depende del orden físico ni de saber cuál
   es la PK— y también hay que partirlo en tandas:

   ```sql
   insert into public._verif_datos
     select * from public._verificar_datos(array['products','customers', ...])
   on conflict (nombre_tabla) do update set ...;

   select count(*) filter (where not coincide) as difieren from public._verif_datos;
   ```

   **Resultado del 2026-09-28: 97 de 97 coinciden, 0 difieren.**

   Después del re-sync, `_verificar_datos` **tiene que** marcar diferencias en
   las tablas del catálogo: son el trabajo de calidad de datos, que se re-aplica
   en el paso siguiente. Ver §24.
3. **Volver a aplicar la calidad de datos**, que el `delete`+`insert` del paso 2
   acaba de borrar. **Sin este paso el cutover revierte §16 a §23.**

   ```sql
   -- primero en seco: informa y no escribe
   select * from public._reaplicar_calidad(false);
   select * from public._reaplicar_unificacion(false);

   -- si no hay filas CONFLICTO, aplicar
   begin;
     select * from public._reaplicar_calidad(true);
     select * from public._reaplicar_unificacion(true);
   commit;
   ```

   Las filas `CONFLICTO` son productos que **Ohio editó después** de nuestra
   foto: la función no los pisa, los informa. Hay que resolverlos a mano.
4. **Pata 2 y pata 3** (secrets de GitHub + Cloud Run), y publicar.
5. **Encender el cron en Brasil**:
   `select cron.alter_job(job_id := 1, active := true); select cron.alter_job(job_id := 2, active := true);`
6. **Apagar el cron en Ohio** — si no, los dos procesan y los informes salen
   duplicados. Es el paso que más fácil se olvida.
   Estado al 2026-09-28: Ohio `active = true` (los dos), Brasil `active = false`
   (los dos). Es el estado correcto hasta el cutover.
7. Volver a subir el logo de la empresa desde Configuración (46 KB; es un byte,
   SQL no lo copia — se puede guardar desde el ERP de Ohio antes de cambiar).
8. Smoke test de §11, y recién entonces limpiar el andamiaje (§13 g).

### Punto de no retorno

Desde que se cambian los secrets de GitHub, **las escrituras nuevas van a
Brasil**. Volver a Ohio a partir de ahí significa perder lo que se escribió en
el medio, o copiarlo a mano. El ensayo con `.env.local` no tiene ese problema:
se borra el archivo y listo.

---

## 15 · Lo que NO vive en la base y hay que configurar aparte

Revisado el 2026-09-28 comparando panel contra panel. Una copia de datos no trae
nada de esto.

### Ya alineado

| Qué | Producción | Brasil | Estado |
| --- | --- | --- | --- |
| Auth · **Site URL** | `https://app.buscatools.com` | era `http://localhost:3000` | **corregido** |
| Auth · **Redirect URLs** | `https://app.buscatools.com/**`, `http://localhost:5173/**` | estaba vacío | **corregidas las dos** |
| Auth · plantillas de mail | las de fábrica (`You've been invited`) | las de fábrica | coinciden, nada que hacer |
| PostgREST · esquemas expuestos | sólo `public` | ídem | el front no usa `.schema()` ni RPC de `app` |

Sin el Site URL y la lista de redirects, los mails de **recuperar contraseña**
apuntaban a `localhost:3000` y las **invitaciones** se rechazaban por no estar
`app.buscatools.com` en la lista permitida.

### Falta: SMTP propio

**Producción tiene `Enable custom SMTP` PRENDIDO. Brasil lo tiene APAGADO.**

```
Host           smtp.gmail.com
Sender email   info@buscatools.com.ar
Sender name    Buscatools
```
La contraseña es una *app password* de Google: no está en ningún lado que no sea
el panel, hay que ponerla a mano en
`.../project/jiudqbusyknubonpedde/auth/smtp`.

**Sin esto no se puede invitar a nadie ni recuperar una contraseña.** El mailer
interno de Supabase sólo entrega a miembros del equipo del proyecto y con un
límite muy bajo; el código ya lo contempla y devuelve `correo_no_autorizado`
(ver `clasificarErrorAuth` en `config-usuarios/logica.ts`).

### Falta: la URL del webhook en Meta

El webhook de WhatsApp Cloud API está apuntado a
`https://uaxcfufvapzulqvynanp.supabase.co/functions/v1/whatsapp-webhook`, o sea
**a Ohio**. Eso se cambia en el panel de Meta, no en Supabase:

```
https://jiudqbusyknubonpedde.supabase.co/functions/v1/whatsapp-webhook
```

Meta hace un GET de verificación con el `hub.verify_token` cuando se guarda: si
`META_WHATSAPP_VERIFY_TOKEN` no está cargado como secret en Brasil, **el cambio
no se puede guardar**. O sea: primero el secret, después la URL.

Es el paso más fácil de olvidar de toda la migración, porque no falla: los
mensajes simplemente siguen entrando a la base vieja.

### El plan de la organización

`BUSCATOOLS REACT` (la org que tiene producción **y** el destino) está en plan
**free**. No es que Brasil esté peor que Ohio: están igual. Pero conviene saber:

- **No hay backups automáticos** en ninguno de los dos. Hoy tampoco los hay en
  producción, así que la migración no empeora nada — pero se va a depender de un
  proyecto nuevo, y vale la pena considerar el plan Pro aunque sea por eso.
- El free permite **2 proyectos activos por organización**, y ya son dos. Después
  del cutover conviene pausar o borrar el de Ohio.
- Un proyecto free se **pausa solo a los 7 días sin actividad**. Mientras Brasil
  no sea producción, algo tiene que tocarlo, o hay que restaurarlo a mano.

---

## 16 · Fase 30 — esquema nuevo, sólo en Brasil

Decisión del 2026-09-28: lo nuevo nace donde va a vivir el ERP. **Ohio no se
toca.** Consecuencia directa: hasta el cutover, **no hay que publicar la web**,
porque seguiría apuntando a Ohio.

Se le puso una red igual: si `is_enumerated` no existe, el catálogo degrada a
texto libre en vez de romperse entero (`listarDefinicionesDeAtributos` reintenta
sin esa columna ante el error 42703).

### Lo que se agregó

| Objeto | Para qué |
| --- | --- |
| `product_attribute_definitions.is_enumerated` | marca los atributos de lista cerrada |
| `product_attribute_options` | los valores permitidos (623 sembrados) |
| `product_kit_components` | la receta de un kit |
| `public.stock_de_kit(uuid, uuid)` | kits armables por cuello de botella |
| `public.stock_kit(products)` | columna calculada de PostgREST |
| bucket `productos` | imágenes de producto, 5 MB, sólo imágenes |
| `confirmar_entrega` | ahora expande el kit en sus componentes |

**`_resync` se cambió antes que nada** para usar la INTERSECCIÓN de columnas
entre las dos bases. Sin eso, la primera columna que exista sólo en Brasil
haría fallar la copia entera del cutover.

### El kit no tiene stock propio

Es una receta. Su disponibilidad se calcula siempre del componente que primero
se acaba, y venderlo descuenta los componentes. Así el stock del kit y el de sus
partes no pueden desincronizarse.

Verificado de punta a punta contra la base real, con transacciones que se
revierten al final (`raise exception 'TEST_OK'`), así que no quedó ni un dato de
prueba:

- 9 patas · 1 tablón → **1 kit**; 8 patas · 3 tablones → **2 kits**.
- Entregar 3 mesas genera **2 movimientos**: −12 patas y −3 tablones, y
  **ninguno sobre el kit**. El saldo baja de verdad.
- Un kit sin receta **no se puede despachar**: error explícito, porque un remito
  que no mueve stock es el error silencioso que hay que evitar.
- Bloqueados por trigger: kits anidados, auto-referencia, receta en un producto
  no marcado como kit, cantidad cero, y componentes de otra empresa.

Ojo con un detalle que apareció probando: la auto-referencia la atrapa el
TRIGGER (`KIT_ANIDADO`) antes que el CHECK `kit_no_se_contiene`, porque los
BEFORE corren antes que las restricciones. Queda bloqueada igual.

### Atributos: sembrar sin fusionar

Las opciones se sembraron con los valores **exactos** que ya había. Un primer
intento normalizaba espacios y mayúsculas para detectar duplicados, y marcaba
`1 5/16"` y `15/16"` como el mismo valor: **son dos medidas distintas**. Fusionar
por parecido habría corrompido `medida`.

Lo que separa una lista de un identificador es la REPETICIÓN, no la cantidad de
valores: `encastre` tiene 240 usos por valor y `modelo` tiene 1,0.

### La unificación de duplicados (hecha el 2026-09-28)

Se unificó lo que era el mismo valor escrito distinto. **La regla quedó escrita
como regla y no para el caso puntual**, así que se puede volver a correr:

- **El mismo valor** = difiere sólo en mayúsculas y en espacios REPETIDOS.
- **No se quitan los espacios.** Es la diferencia entre unificar y romper:
  `1 5/16"` y `15/16"` difieren por un espacio y son dos medidas distintas.
- **Gana la variante más usada**, no la primera alfabética.

Lo único que apareció en los 16 atributos con lista: `encastre`, `1/4 Hex` →
`1/4 HEX`. **9 productos tocados** (el otro lado ya tenía 1.167). Las opciones
bajaron de 623 a 622 y `encastre` de 35 a 34.

Verificado después: 0 duplicados en TODOS los atributos (también los libres),
0 productos con el valor viejo, los 21.828 productos intactos, y **`medida`
sigue con sus 258 valores** — las seis fracciones que un criterio más agresivo
habría fusionado siguen separadas.

No hay duplicados en marcas ni en categorías: se revisó con el mismo criterio.

La tabla `public._unificacion` tiene el detalle de lo que se cambió; va a la
limpieza final junto al resto del andamiaje.

---

## 17 · Auditoría de datos y comparación con la web vieja (2026-09-28)

### Contra `buscatoolsjano-web.github.io/Buscatools`

Esa web sirve un `productos-data.json` estático de 15,6 MB con 21.772
productos. Se bajó y se comparó campo por campo contra el ERP.

| Campo | Web vieja | ERP | Δ |
| --- | ---: | ---: | --- |
| productos | 21.772 | 21.828 | +56 |
| marca | 16.316 | 16.319 | +3 |
| tipo | 9.181 | 9.172 | −9 |
| medida / largo / encastre / sufijos | 4.745 / 7.765 / 8.422 / 3.306 | idénticos | 0 |
| origen / NCM / serie | 8.818 / 5.329 / 9.089 | idénticos | 0 |
| descripción larga | 21.713 | idéntico | 0 |
| peso / volumen | 21.772 / 21.772 | idénticos | 0 |
| imágenes | 8.859 en 7.523 productos | idénticos | 0 |

**La migración no perdió nada.** Los dos únicos desvíos se explican y los dos
son a favor del ERP:

- **+56 productos**: creados en el ERP después de la exportación (45 `PRO#####`,
  7 `SER000xx` de servicio). Verificado contra el conjunto de SKU de la web.
- **−9 en `tipo`**: **8 tenían `-`** como tipo en la web vieja —un guion, o sea
  «ninguno»— y el ERP los dejó vacíos, que es lo correcto. Otros 7 pasaron de
  `Balanceador` a `Servicio`, un tipo que la web vieja no tiene.

La web vieja tampoco tiene SKU duplicados: el problema de los pares
`IR.xxxx` / `PRO12xxx` viene de ANTES, y los dos sistemas lo heredaron.

### Las imágenes son todas prestadas

**Las 8.859 imágenes son enlaces externos (`source_url`); ninguna es un archivo
propio.** Salen de dos sitios de terceros:

```
www.buscatool.com   5.315   (fotos de producto)
apexbits.com.ar     3.544   (diagramas)
```

Se probaron seis al azar y las seis responden 200 con bytes reales, así que hoy
funcionan. Pero el catálogo depende de que esas dos webs sigan en pie y no
reorganicen sus rutas. Con el bucket `productos` (§16) ya se pueden traer.

**Y el número real de fotos es más bajo de lo que parece:**

| kind | imágenes | productos |
| --- | ---: | ---: |
| `product_image` (foto de verdad) | 5.315 | **3.979** |
| `shared_diagram` | 3.526 | 3.526 |
| `technical_diagram` | 18 | 18 |

O sea: **sólo el 18,2 % del catálogo tiene una foto del producto.** Los 3.526
que tienen únicamente un diagrama compartido se ven en el listado, pero lo que
muestran no es el producto.

### Estado de los atributos

Limpio: 26 definiciones, las 26 claves usadas tienen definición (0 huérfanas),
0 valores fuera de su lista, 0 claves vacías, 0 opciones sin uso.

**Corregido**: `rpm` estaba definido como `number` y sus 57 valores son rangos
(`50-800`, `0-1200 / 0-1900 / 0-3000`) o `-`. Pasó a `text`. Los otros seis
numéricos —torque, capacidad, pesos, 1.168 valores— son números de verdad.

### Lo que falta arreglar, y no toqué

1. **59 pares de productos duplicados**: el mismo artículo cargado dos veces,
   una con referencia de marca y otra genérica (`IR.92073972` + `PRO12192`),
   con idéntico nombre, descripción y atributos. **Algunos tienen stock de un
   lado y documentos del otro**, así que unificarlos exige decidir cuál queda y
   mover las referencias. No es un `update`.
2. **155 productos se llaman todos «TOHNICHI»**: quedó la marca como nombre.
3. **5.441 (24,9 %) con referencia genérica `PRO#####`**, que son casi
   exactamente los 5.509 sin marca. La regla nueva corta el problema hacia
   adelante, no hacia atrás.
4. **8 clientes con el dígito verificador del CUIT mal** (algunos son demo;
   otros parecen typos reales, y eso importa al facturar). De los 29 con CUIT
   «raro», 21 son **extranjeros** y no son errores.

### Integridad: sin hallazgos

0 saldos negativos, 0 reservas mayores al stock, 0 imágenes huérfanas, 0
imágenes sin origen, 0 duplicados en marcas, categorías, proveedores, nombres
de clientes ni contactos.

---

## 18 · Fusión de productos duplicados (2026-09-28)

**21.828 → 21.780 productos vivos. 48 fundidos, 0 referencias perdidas.**

### Cómo se decidió qué era un duplicado

Mismo nombre normalizado **y además** misma descripción, misma descripción
larga, mismos atributos y misma categoría. Las cuatro compuertas, no sólo el
nombre.

**Sin la compuerta de la descripción esto rompía datos.** `SER00012` y
`SER00013` se llaman igual —«ALQUILER DE DISPENSER FRIO CALOR»— pero uno es el
estándar y el otro el de **alta capacidad y recuperación**, y tienen **24
documentos cada uno**. Fusionarlos habría reescrito 48 líneas de venta.

Lo mismo con los grupos grandes: **TOHNICHI son 155 productos con 155
descripciones distintas** y el nombre mal puesto (quedó la marca), y los
«SHINANO SI 4800 - O-RING» son **cinco medidas diferentes**. Ninguno es
duplicado.

### Quién sobrevive

1. El que tiene **marca**, si sólo uno la tiene — es el que puede llevar una
   referencia como `IR.92073972` en vez de `PRO12192`.
2. Si no, el que tiene **más referencias**.
3. Si no, el **más viejo**.

| Motivo | Pares |
| --- | ---: |
| el que tiene marca | 20 |
| el más viejo | 25 |
| el que tiene más referencias | 1 |
| grupo de tres (`PRO03835/36/37`) | 1 grupo, 2 fundidos |

### Qué se movió

Las referencias se sacaron del **catálogo de claves foráneas** (23 en 21
tablas), no de una lista escrita a mano. Sólo tres tablas tenían filas:

| Tabla | Filas |
| --- | ---: |
| `product_prices` | 24 |
| `delivery_lines` | 1 |
| `sales_quote_lines` | 1 |

`product_prices` es único por (lista, producto, vigencia): si el que sobrevive
ya tenía precio para esa lista y esa fecha, manda el suyo y el otro se descarta.

**El documento impreso no cambia**: las líneas guardan su `sku_snapshot` y su
`name_snapshot`. Lo que se corrige es a qué producto del catálogo apuntan.

### La red de seguridad

Las dos migraciones terminan recorriendo **las 23 claves foráneas** y fallando
si alguna sigue apuntando a un producto fundido. Si mañana aparece una tabla
nueva que referencia productos, esto revienta ahí y no meses después.

Verificado al final: **0 grupos realmente idénticos**, y 0 saldos, 0
cotizaciones, 0 remitos y 0 precios apuntando a un producto borrado. Quedan 16
grupos con el nombre repetido y **ninguno es un duplicado**: todos difieren en
descripción o atributos.

### Lo que sigue abierto

Los **155 «TOHNICHI»** siguen llamándose todos igual. No es un duplicado, es un
nombre faltante: habría que componerlo desde la referencia o desde la
descripción, y eso necesita decidir el formato.

---

## 19 · Los 155 «TOHNICHI» sin nombre (2026-09-28)

155 productos se llamaban todos **«TOHNICHI»**: había quedado la marca como
nombre y la identidad real vivía sólo en la referencia (`TC.A4`, `TC.QL`,
`TC.Setting box`).

Se armó el nombre con la **misma convención que los otros 2.736 productos de la
marca** —`TOHNICHI <modelo> <descriptor>`, como «TOHNICHI 28000T-A-S TORQUE
WRENCH»—, sacando el modelo de la referencia sin el prefijo `TC.`:

```
TC.A4                        →  TOHNICHI A4
TC.Receiver & Modules        →  TOHNICHI Receiver & Modules
TC.Accessories for DOTE4-MD2 →  TOHNICHI Accessories for DOTE4-MD2
```

**El descriptor no se inventó.** Estos 155 no lo tienen en ningún campo, y
ponerle «TORQUE WRENCH» a algo que puede ser un socket es escribir un dato que
nadie verificó.

Comprobado antes de escribir: los 155 nombres nuevos son **distintos entre sí**
y **ninguno choca** con un producto existente. Después: 0 siguen llamándose
«TOHNICHI», y los grupos con nombre repetido bajaron de 16 a 15.

### De paso: la descripción de esos 155 era una plantilla vacía

```
MARCA: TOHNICHI
MODELO: A4
DESCRIPCION:
```

Por eso figuraban «155 descripciones distintas»: lo único que cambiaba era la
línea del modelo, y el campo de descripción estaba **vacío**. Sirvió igual para
demostrar que eran 155 productos diferentes y no duplicados, pero como
descripción no dice nada.

### Hallazgo sin resolver: `model_code` a veces repite la referencia

De 21.725 productos con modelo cargado:

| | productos | |
| --- | ---: | --- |
| el modelo **repite la referencia entera**, prefijo incluido | 7.193 | 33,1 % |
| el modelo es la referencia **sin el prefijo** (lo correcto) | 9.184 | 42,3 % |
| ninguna de las dos | 5.348 | 24,6 % |

O sea: `TC.A4` tiene `model_code = 'TC.A4'` cuando el modelo es `A4`. Por marca
es casi todo o nada — FIAM y TOHNICHI lo repiten siempre, APEX y TORERO nunca,
SPEEDRILL casi nunca (112 de 4.928).

**Por qué importa**: la referencia nueva se arma como `<2 letras de la marca>.<modelo>`.
Con un modelo que ya trae el prefijo daría `TC.TC.A4`. Hoy sólo afecta al alta
—no se regenera la referencia al editar—, pero es una bomba de tiempo si alguna
vez se recalculan.

Normalizarlo es un `update` sobre 7.193 productos y conviene decidirlo aparte:
el modelo es un dato que también se usa para buscar.

---

## 20 · Normalización de `model_code` (2026-09-28)

**7.132 productos corregidos.** El modelo repetía la referencia entera, prefijo
incluido: `TC.A4` tenía `model_code = 'TC.A4'` cuando el modelo es `A4`.

| | antes | después |
| --- | ---: | ---: |
| el modelo repite la referencia | 7.193 (33,1 %) | **61 (0,3 %)** |
| el modelo es la referencia sin prefijo | 9.184 (42,3 %) | **16.316 (75,1 %)** |

Los 61 que quedan son los **sin marca**: ahí la referencia (`4134200`,
`49-A-TX-25`) ES el modelo, y no hay prefijo que quitar.

### Cómo se validó que el prefijo era de la marca y no del modelo

Agrupando por marca: **cada una usa un prefijo consistente** —FIAM→`FI`,
INGERSOLL RAND→`IR`, CHICAGO PNEUMATIC→`CP`, ESTIC→`ET`—. No son las dos
primeras letras del nombre y por eso una comprobación ingenua daba 3.474
«errores» que no lo eran.

El corte es `^[A-Za-z]{2,4}\.` y no `{2}`: TOHNICHI usa **dos** prefijos, `TC.`
(2.723 productos) y `TOH.` (13), y SAIPOR usa `SAI.`.

Casos que se verificaron uno por uno porque podían romperse:

```
FI.1.1480716E8        →  1.1480716E8          (conserva los puntos del modelo)
TC.Receiver & Modules →  Receiver & Modules
AP.*5422              →  ya estaba bien, no se tocó
```

### Lo que destapó: 5 productos TOHNICHI con dos referencias

Al quitar el prefijo aparecieron 5 colisiones de (marca, modelo). No eran un
error de la regla: son **el mismo producto cargado con dos referencias**.

```
TC.DB100N-S  «TOHNICHI DB100N-S TORQUE WRENCH»
TOH.DB100N-S «TOHNICHI DB100N-S TORQUIMETRO DE MANO»
```

La detección por nombre no los agarró porque uno tiene el descriptor en inglés
y el otro en castellano. Son `CTB100N2X15D-G`, `DB100N-S`, `DB50N-S`,
`QSP100N4` y `QSP25N3`; **dos de ellos tienen historia** (3 referencias cada
uno). Quedan sin fusionar: hay que decidir qué referencia sobrevive, y `TOH.`
no respeta la convención de dos letras.

**Nota**: `model_code` no tiene índice único por (marca, modelo), así que las
5 colisiones no bloquean nada. Que no lo tenga es justamente lo que permitió
que este duplicado existiera.

---

## 21 · Los 5 TOHNICHI con doble referencia (2026-09-28)

Fusionados. **21.780 → 21.775 productos vivos. 53 fundidos en total.**

### La decisión importante: sobrevive el que tiene los datos

Lo previsible era quedarse con `TC.`, que respeta la convención de dos letras.
**Habría estado mal.** Toda la vida real estaba del lado `TOH.`:

| modelo | `TC.` | `TOH.` |
| --- | --- | --- |
| CTB100N2X15D-G | 1 precio | **stock 1** |
| DB100N-S | 1 precio | **stock 1** |
| DB50N-S | 1 precio | **stock 1** |
| QSP100N4 | 1 precio · 1 remito | **stock 11** · 1 cotiz · 1 pedido |
| QSP25N3 | 1 precio | **stock 14** · 1 cotiz · 1 pedido · 1 remito |

Quedarse con `TC.` significaba mover **28 unidades de stock** y toda la historia
a una ficha vacía, por una cuestión cosmética. La referencia se arregla después;
el stock movido mal, no. La migración lleva una comprobación que **aborta si
algún `TC.` tuviera más stock que su `TOH.`**.

Los saldos se SUMAN cuando los dos tienen fila para el mismo depósito, no se
pisa una con la otra. Stock antes y después: **28 unidades**.

### Queda abierto: la referencia sigue siendo `TOH.`

Los 5 sobrevivientes conservan `TOH.CTB100N2X15D-G` y compañía, que no respeta
la convención (`TC.` la usan 2.723 productos de la marca).

**Renombrarlos NO es un `update` simple**: el índice único es
`UNIQUE (company_id, sku)` **sin filtro de borrado**, así que el `TC.` que
acabamos de dar de baja sigue ocupando el nombre. Para liberar la referencia hay
que renombrar antes al fundido (por ejemplo `TC.DB100N-S#fusionado`), y eso es
tocar el SKU de un registro histórico. **Hecho en §22.**

### Verificación

0 saldos, 0 cotizaciones, 0 remitos y 0 precios apuntando a un producto borrado.
**0 pares (marca, modelo) repetidos** en todo el catálogo.

---

## 22 · Unificación del prefijo TOHNICHI: `TOH.` → `TC.` (2026-09-28)

Resuelto lo que §21 dejaba abierto. Migración `unificar_prefijo_tohnichi_a_tc`.

**No eran 5, eran 13.** Los 5 de la fusión más 8 que nunca habían tenido gemelo
y venían con el prefijo viejo desde el sistema anterior. La marca queda con
**un solo prefijo**: los 2.731 productos vivos de TOHNICHI arrancan con `TC.` y
cumplen `sku = 'TC.' || model_code`.

### El obstáculo: un registro borrado sigue ocupando el nombre

`UNIQUE (company_id, sku)` **no filtra por `deleted_at`**. De los 13, en 5 el
nombre destino lo tenía todavía el gemelo que §21 había dado de baja. Un
`update` directo chocaba contra el índice.

La secuencia, en una sola transacción:

1. A los 5 fundidos se les agrega el sufijo `#FUNDIDO` al SKU, que libera el
   nombre. Su `legacy_ref` guarda el `TC.` original, así que la referencia con la
   que existieron no se pierde.
2. Los 13 vivos pasan a `sku = 'TC.' || model_code`.
3. Se verifica: 0 productos de la marca con `TOH.`, 0 con `sku <> 'TC.' || model_code`.

| referencia nueva | `legacy_ref` | stock |
| --- | --- | --- |
| `TC.931` | `TOH.931` | 1 |
| `TC.A1-310` | `TOH.A1-310` | 10 |
| `TC.A3-312` | `TOH.A3-312` | 5 |
| `TC.CTB100N2X15D-G` | `TOH.CTB100N2X15D-G` | 1 |
| `TC.DB100N-S` | `TOH.DB100N-S` | 1 |
| `TC.DB25N-S` | `TOH.DB25N-S` | 1 |
| `TC.DB50N-S` | `TOH.DB50N-S` | 1 |
| `TC.QSP100N4` | `TOH.QSP100N4` | 11 |
| `TC.QSP12N4` | `TOH.QSP12N4` | 2 |
| `TC.QSP200N4` | `TOH.QSP200N4` | 4 |
| `TC.QSP25N3` | `TOH.QSP25N3` | 14 |
| `TC.SP38NX19` | `TOH.SP38NX19` | 1 |
| `TC.SPLS19N-4X10N` | `TOH.SPLS19N-4X10N` | 1 |

**53 unidades de stock, las mismas antes y después.** 0 SKU duplicados en todo
el catálogo, 21.775 productos vivos (el renombre no crea ni borra nada).

### Lo que NO se tocó, y por qué

Antes de renombrar hubo que confirmar que el SKU no es una clave viva en
ningún otro lado. Tres cosas quedaron deliberadamente intactas:

- **`legacy_ref`** es el rastro al sistema anterior. Es lo único que permite
  reconciliar contra el histórico viejo; reescribirlo dejaba el renombre sin
  auditoría.
- **`sku_snapshot` y `name_snapshot`** de las líneas de documentos son fotos a
  propósito: una cotización vieja debe seguir diciendo lo que decía el día que se
  emitió. Un remito no cambia de texto porque hoy renombremos el catálogo.
- **`external_id`** de la integración es el id numérico de STEL (`32455839`),
  no la referencia. El renombre no le llega.

`maintenance_service_source_lines.sku` es dato importado de terceros, no nuestra
referencia: tampoco se toca.

### Único prefijo que sigue fuera de convención

**`SAI.`**, 10 productos de SAIPOR (debería ser `SA.`). Son 10 fichas y ninguna
tiene gemelo, así que es un renombre directo sin el paso `#FUNDIDO`. Pendiente.

---

## 23 · SAIPOR: `SAI.` → `SA.` (2026-09-28)

Migración `unificar_prefijo_saipor_a_sa`. **10 productos renombrados.**

Mucho más simple que TOHNICHI: ninguna de las 10 fichas está borrada y **nadie
ocupaba el nombre destino**, así que fue un `update` directo, sin el paso
`#FUNDIDO` de §22. La migración igual comprueba la colisión antes de escribir
—si algún `SA.*` estuviera tomado, aborta— porque el índice único sigue siendo
`UNIQUE (company_id, sku)` sin filtro de borrado.

También se verificó que ninguna otra marca reclamara `SA.`: SAIPOR es la única
marca del catálogo que empieza con `SA`, así que el prefijo no queda ambiguo.

| referencia nueva | `legacy_ref` | stock |
| --- | --- | --- |
| `SA.VPTX6/200` | `SAI.VPTX6/200` | 5 |
| `SA.VPTX7/200` | `SAI.VPTX7/200` | 5 |
| `SA.VPTX8/200` | `SAI.VPTX8/200` | 30 |
| `SA.VPTX10/200` | `SAI.VPTX10/200` | 25 |
| `SA.VPTX15/200` | `SAI.VPTX15/200` | 25 |
| `SA.VPTX20/200` | `SAI.VPTX20/200` | 27 |
| `SA.VPTX25/200` | `SAI.VPTX25/200` | 25 |
| `SA.VPTX27/200` | `SAI.VPTX27/200` | 25 |
| `SA.VPTX30/200` | `SAI.VPTX30/200` | 25 |
| `SA.VPTX40/200` | `SAI.VPTX40/200` | 25 |

`legacy_ref` ya traía el `SAI.` viejo de la importación: no hubo que escribirlo,
y no se tocó. **217 unidades de stock, las mismas antes y después** (la
migración aborta si el total cambia).

### Estado del catálogo: los prefijos quedaron cerrados

| comprobación | resultado |
| --- | --- |
| Marcas con más de un prefijo | **0** |
| Prefijos de más de 2 letras | **ninguno** |
| SKU duplicados (vivos + borrados) | **0** |
| Productos vivos | 21.775 |

Cada marca del catálogo usa **exactamente un prefijo de dos letras**. `IR`
(Ingersoll Rand), `CP` (Chicago Pneumatic) y `TC` (TOHNICHI) no son las dos
primeras letras del nombre sino abreviaturas deliberadas de la casa: la regla
que vale es *un prefijo por marca*, no *las dos primeras letras del nombre*.

Lo que sigue abierto del análisis de datos (§19) es de otra naturaleza —faltan
datos, no hay inconsistencias—: 5.441 productos con referencia genérica
`PRO#####`, 9.491 sin precio, 8 clientes con dígito verificador de CUIT mal.

---

## 24 · El re-sync del cutover borraba todo el trabajo de calidad de datos (2026-09-28)

Esto salió de mirar el cutover antes de ejecutarlo, y es el problema más grave
que apareció en toda la migración.

### El problema

`_resync()` hace, por tabla, **`delete from` + `insert ... select from remoto`**.
Es un reemplazo, no un merge — y está bien que lo sea: para copiar una base es
exactamente lo que hay que hacer.

Pero de §16 a §23 el catálogo de Brasil **se separó de Ohio a propósito**: 53
productos fusionados, 155 nombres corregidos, 7.132 `model_code` normalizados,
23 referencias renombradas, atributos de lista cerrada. Ohio quedó read-only,
así que nada de eso existe allá.

El paso 2 del cutover, tal como estaba escrito, re-sincronizaba las 97 tablas.
**Habría revertido las ocho secciones anteriores** y nadie se habría dado cuenta
hasta buscar un producto.

### Por qué el conteo de filas no lo mostraba

La primera medición comparó cantidad de filas por tabla y dio **3 tablas
distintas**. Tranquilizador y falso: casi todo el trabajo de calidad son
**`update`**, no inserciones ni borrados. El borrado de los fusionados es lógico
(`deleted_at`), que también es un `update`. La cantidad de filas de `products` es
idéntica en las dos bases y el contenido de 7.300 no.

Sirve la **huella de contenido** (`_verificar_datos`), que hashea cada fila. Con
eso: **10 tablas divergen**.

### De qué lado se movió cada una

La pregunta que decide el plan. Una tabla que movió Ohio hay que re-sincronizarla;
una que movimos nosotros, no. Se resolvió comparando fila por fila contra Ohio por
FDW y sacando **qué columnas** difieren (`_deriva_col`):

| tabla | columnas que difieren | de quién |
| --- | --- | --- |
| `email_sync_log` | +65 filas | **Ohio**: sigue entrando correo |
| `email_threads` | +15 filas, `synced_at`, `gmail_labels`… | **Ohio** |
| `email_accounts` | `last_history_id`, `last_synced_at` | **Ohio**: el cursor de Gmail avanzó |
| `products` | sku, name, model_code, attributes, deleted_at | **nuestro** |
| `product_prices` | −31 filas | **nuestro**: dedupe de la fusión |
| `product_attribute_definitions` | `is_enumerated` (26), `data_type` (1) | **nuestro** |
| `delivery_lines` | `product_id` (2) | **nuestro**: re-apuntado al sobreviviente |
| `sales_quote_lines` | `product_id` (1) | **nuestro** |
| `deliveries`, `sales_quotes` | `updated_at` (2 y 1) | **nuestro**: efecto del trigger |

**Ninguna tabla se movió de los dos lados.** Ese es el dato que hace que el
cutover sea seguro.

Ojo con un falso positivo que casi se colaba: `product_attribute_definitions`
difería en `is_enumerated` **en las 26 filas**, y no es que los datos cambiaran
—es una columna que sólo existe en Brasil, y `_verificar_datos` hashea
`to_jsonb(t)`, la fila entera. La única diferencia real de datos ahí es
`data_type` de `rpm`, que pasó de `number` a `text` porque sus opciones son
rangos. Misma lección de §17: **si la comparación acusa todo, revisá la
comparación.**

### La solución: `_reaplicar_calidad()`

En vez de elegir a mano qué tablas re-sincronizar —que obliga a revisar la lista
cada vez que Ohio trabaja un rato más— el re-sync queda completo y la calidad de
datos **se vuelve a aplicar después**. El andamiaje que guarda las decisiones
(`_merge_productos`, `_norm_modelo`, `_rename_tohnichi`, `_unificacion`) vive en
`public.` y **no está en `remoto`**, así que el re-sync no lo toca: sigue ahí
para reconstruir.

Todo está indexado por `id` (uuid), que sobrevive a la copia porque viene de Ohio.

Seis pasos, en orden (`model_code` antes que los prefijos, porque la referencia
se deriva del modelo): normalizar `model_code` → corregir nombres → fusionar
(mover referencias de las 23 FK, sumar saldos, dar de baja) → unificar prefijos →
`rpm` a lista cerrada → unificar valores de atributo.

**Control optimista, no sobrescritura ciega.** Cada paso compara contra el valor
que registramos como «viejo». Si Ohio lo cambió a un tercer valor después de la
foto, sale como fila **`CONFLICTO`** y **no se pisa**. Es la diferencia entre
re-aplicar y atropellar una edición real.

Es idempotente: corrida sobre el estado actual da **cero en los nueve pasos**.

### La prueba

Que sea idempotente sólo demuestra que hoy no hace nada. Lo que hay que
demostrar es que **restaura**. Se hizo en una transacción que se revierte:

1. Huella de negocio de `products` (id, sku, name, model_code, borrado,
   attributes — **no** `updated_at`, que por definición cambia al re-aplicar).
2. `_resync()` de las 5 tablas afectadas → el trabajo de calidad queda destruido.
3. `_reaplicar_calidad(true)` + `_reaplicar_unificacion(true)`.
4. Comparar y `raise exception 'TEST_OK'`.

```
huella  antes=70d36c318caf despues=70d36c318caf -> IGUAL
vivos   antes=21775 despues=21775
precios antes=12527 despues=12527
stock   antes=29864.000 despues=29864.000
lineas  antes=[dl:PRO12439 | dl:TC.QSP100N4 | sql:IR.92073972]
lineas  despues=[dl:PRO12439 | dl:TC.QSP100N4 | sql:IR.92073972]
```

Huella idéntica, incluidas las 3 líneas de documento re-apuntadas. Y como
terminó en `raise`, la base quedó como estaba: no se escribió nada.

### Dos defectos del informe, encontrados al correrlo

- El paso 4 contaba los 5 fundidos con `TC.x#FUNDIDO` como pendientes, porque
  los comparaba contra `TC.x`. Informaba 5 cuando lo correcto era 0.
- El paso 4 le ponía `#FUNDIDO` a **cualquier** TOHNICHI borrado. Hoy los 5
  borrados son los de la fusión (Ohio tiene **0** productos borrados, se
  verificó), pero si Ohio diera de baja un TOHNICHI le cambiaríamos el SKU sin
  motivo. Ahora el sufijo se aplica sólo a los que están en `_merge_productos`.
- El paso 6 informaba `_unificacion.productos_tocados`, que es el registro
  histórico (9), no lo pendiente. Parecía trabajo sin hacer cuando no lo había.

Un informe que avisa de más es peor que no tener informe: se deja de mirar.

---

## 25 · Todo lo verificable sin secretos, verificado (2026-09-28)

Lo que sigue del cutover necesita valores que sólo tiene el dueño de la cuenta.
Esto es todo lo demás, comprobado.

### El código está verde contra el esquema de Brasil

| control | resultado |
| --- | --- |
| `npm run typecheck` | limpio |
| `npm run lint` | limpio |
| `npm test` | **173 archivos, 2.332 pruebas, todas pasan** |
| `npm run build` | compila en 3,4 s |

Importa porque el repo **ya requiere el esquema de Brasil** (atributos de lista
cerrada, kits, imagen por archivo). Publicar antes del cutover rompería el
catálogo; hay un fallback para que no explote del todo, pero el orden correcto es
cutover primero.

### Advisors: 0 hallazgos que estén sólo en Ohio

La condición del §13 g es que el diff de advisors dé 0 y 0. Comparados hallazgo
por hallazgo (regla + objeto), no por totales:

| | Brasil | Ohio | sólo en Brasil | **sólo en Ohio** |
| --- | --- | --- | --- | --- |
| security | 139 | 110 | 29 | **0** |
| performance | 247 | 253 | 25 | 31 (†) |

**Sólo en Ohio: 0 en seguridad.** Brasil no perdió ninguna protección.

De los 29 de seguridad que sólo están en Brasil, **27 son el andamiaje**
(`public._*` sin RLS) y 2 son el FDW (`postgres_fdw` en `public`, `remoto_cat`).
Los 29 desaparecen con la limpieza de §13 g, que borra las tablas, el FDW y los
esquemas `remoto*`.

(†) Los `unused_index` de los dos lados son ruido: miden uso real, y Brasil casi
no se usó. No son una diferencia de esquema.

### Dos hallazgos de performance que decidí NO tocar

Las dos tablas nuevas (`product_attribute_options`, `product_kit_components`)
aparecen con `multiple_permissive_policies` y `unindexed_foreign_keys`. Los miré
uno por uno y **los dos son el patrón de la casa**, no algo que introdujimos:

- **`multiple_permissive_policies`**: tienen una política `SELECT` y una `ALL`,
  y `ALL` incluye SELECT, así que un SELECT evalúa las dos. Pasa igual en
  **41 tablas**, entre ellas `products` y `product_images`. Cambiar sólo estas dos
  las dejaría distintas de las otras 39 por una ganancia marginal. Cambiar las 41
  es una decisión aparte y no es trabajo de cutover.
- **`unindexed_foreign_keys`**: es `company_id` en las dos. **21 tablas** no lo
  indexan, y las que no lo hacen son justamente las tablas de detalle a las que
  siempre se llega por el padre: `product_prices`, `stock_balances`,
  `goods_receipt_lines`, `maintenance_order_parts`. Las dos nuevas son
  exactamente ese caso (se leen por `definition_id` y por `kit_product_id`, que
  sí están indexados).

Queda anotado para que dentro de seis meses no se lea como una regresión.

### Edge Functions: las 6, y con el `verify_jwt` correcto

Las 6 están `ACTIVE` en Brasil, y —lo que de verdad importa— la bandera
`verify_jwt` coincide con Ohio en las 6:

| función | `verify_jwt` | por qué |
| --- | --- | --- |
| `whatsapp-webhook` | **false** | Meta la llama sin token |
| `whatsapp-ai-worker` | **false** | la llama el cron |
| `config-usuarios`, `config-empresa-logo`, `whatsapp-send-message`, `whatsapp-ai-analyze` | true | las llama la app con sesión |

Si `whatsapp-webhook` hubiera quedado en `true`, Meta habría empezado a comer
401 después del cutover y el síntoma habría sido «no entran mensajes», sin error
visible en ningún lado.

### Storage: falta exactamente un byte

| bucket | Ohio | Brasil |
| --- | --- | --- |
| `empresa-logos` | **1 objeto, 46.384 bytes** | 0 |
| `ventas` | 0 | 0 |
| `whatsapp` | 0 | 0 |
| `productos` | no existe | 0 (nuevo, para las fotos de producto) |

Límites de tamaño, mime types y políticas coinciden en los tres que existen en
las dos. El logo hay que subirlo desde Configuración: SQL no mueve bytes.

### Cron: el estado correcto hasta el cutover

Ohio `active = true` en los dos jobs; Brasil `active = false` en los dos. Así
tiene que estar: si Brasil se enciende antes del cutover, los dos procesan y los
informes salen duplicados. No se tocó ninguno.

### `_preflight()`: un solo control para el día del cutover

Once comprobaciones en una consulta, para no tener que acordarse de doce:
estructura, SKU duplicados, un prefijo por marca, (marca, modelo) único,
referencias a productos de baja, listas cerradas con opciones, **valores fuera de
la lista**, kits anidados, kits sin receta, cron encendido, logo subido,
andamiaje limpiado.

```sql
select * from public._preflight();
```

Corrido hoy: **9 OK**. Y dos `FALLA` que **hoy son correctas**, porque son pasos
del cutover que todavía no pasaron: el cron de Brasil está apagado a propósito y
el logo no está subido. Es un control de llegada, no un informe del estado actual.

El control 7 merece atención: **0 productos de los 21.775 vivos tienen un valor
de atributo fuera de su lista cerrada.** Es la verificación contra datos reales
de lo que se pidió —que no se pueda escribir `1/4 HEXAGONAL` donde va `1/4 HEX`—
y sirve para siempre, no sólo para el cutover.

### Lo que falta, y por qué no puedo hacerlo yo

| paso | quién | por qué |
| --- | --- | --- |
| 4 secrets de Supabase | **el dueño** | son API keys; no las tipeo yo en ningún campo |
| SMTP de Brasil | **el dueño** | contraseña de aplicación de Gmail |
| Webhook de Meta | cualquiera, después del token | la URL no es secreta; el verify token sí |
| Cloud Run | **el dueño primero** | `gcloud` está, pero vencido: hay que correr `gcloud auth login` a mano (§26). Después, la URL y la publishable key son públicas; `SUPABASE_SECRET_KEY` no |
| 2 secrets de GitHub | **puedo yo** (`gh` está autenticado, ver §26) | valores públicos, pero es **el último paso** |
| Subir el logo | **el dueño** | desde Configuración del ERP |

`META_WHATSAPP_VERIFY_TOKEN` no hay que recuperarlo de Ohio: **lo elegimos
nosotros**. Se inventa uno nuevo y se pone en los dos lados (Supabase y Meta).

---

## 26 · Correcciones al inventario de herramientas (2026-09-29)

Tres cosas que en §25 estaban mal, encontradas al ir a usarlas.

### `gh` SÍ está instalado y autenticado

Figuraba como no disponible, y por eso los 2 secrets de GitHub estaban
listados como trabajo manual del dueño. No lo son: `gh` está en el PATH y
autenticado como `janoguarini`. El cambio de las dos patas se puede hacer
desde acá, y de todos modos **sus dos valores son públicos** —viajan en el
bundle del frontend, que es un archivo que cualquiera descarga—.

```bash
gh secret set VITE_SUPABASE_URL      --body "https://jiudqbusyknubonpedde.supabase.co"
gh secret set VITE_SUPABASE_ANON_KEY --body "sb_publishable_ZrIVBQYQkTTRxp_XtAJpeA_GSMRjHmV"
```

Sigue siendo **el último paso**: cambiarlos antes deja el frontend hablando con
Brasil mientras el correo y WhatsApp siguen escribiendo en Ohio.

Confirmado contra el repo: son exactamente **dos** secrets, sin variables y con
un solo environment (`github-pages`).

| secret | última vez |
| --- | --- |
| `VITE_SUPABASE_ANON_KEY` | 2026-09-08 |
| `VITE_SUPABASE_URL` | 2026-09-08 |

### `VITE_EMAILS_API_URL` no es un secret: está escrito en `deploy.yml`

Apunta a `https://buscatools-erp-email-api-545134968830.us-east1.run.app`. Si
alguna vez se mueve el servicio a `southamerica-east1` —que es lo que conviene
con la base en São Paulo— hay que **editar el workflow**, no un secret. Es el
tipo de cosa que se busca media hora en el lugar equivocado.

### `gcloud` está instalado, pero hay que volver a loguearse

También figuraba como no disponible. Está, en
`~/AppData/Local/Google/Cloud SDK/`, con la cuenta `info@buscatools.com.ar`.
Dos detalles para que ande:

1. **Su Python está roto** en esta máquina: el alias de la Microsoft Store se
   come el `python` del PATH. El SDK trae el suyo, hay que señalárselo:

   ```bash
   export CLOUDSDK_PYTHON="$HOME/AppData/Local/Google/Cloud SDK/google-cloud-sdk/platform/bundledpython/python.exe"
   ```

2. **Las credenciales están vencidas.** Cualquier comando que toque la API
   falla con `Reauthentication failed. cannot prompt during non-interactive
   execution`. Hay que correr `gcloud auth login` a mano, en una terminal
   interactiva: es un flujo de navegador y nadie más lo puede hacer.

3. Y `--project` quiere el **project ID**, no el número: `545134968830` lo
   rechaza. El ID sale de `gcloud projects list` una vez reautenticado.

### El deploy corre la suite aislada — y ahí apareció un error

`deploy.yml` corre `lint`, `typecheck`, `test`, **`test:isolated`** y `build`
antes de publicar. Eso significa dos cosas buenas: un push roto no llega a
producción, y `npm test` solo **no alcanza** para dar algo por verificado.

`test:isolated` corre ignorando cualquier `.env` (ADR-019). Con los cambios de
la Fase 30, `CatalogoPage.test.tsx` se caía ahí y pasaba en local: el editor de
la receta del kit importa `services/productos`, ese módulo levanta el cliente de
Supabase al cargarse, y la página llega hasta él por `ModalNuevoProducto`. Sin
`.env` el cliente no valida y el archivo entero no carga.

Se arregló con el mismo mock que ya usaba `ModalNuevoProducto.test`:

```ts
vi.mock('@/services/supabase/client', () => ({ supabase: {} }))
```

Y el `.env.local` que apunta a Brasil es justamente lo que tapaba el problema en
esta máquina. Por eso existe la suite aislada.

---

## 27 · Importar la OC del cliente: los dos emparejadores (2026-09-29)

Fase 30 · E1 y E3. Lo que decide si la función sirve: dado un PDF leído por la
IA, **a qué cliente nuestro corresponde** y **qué producto nuestro es cada
línea**. Todo lo demás —subir el archivo, llamar al modelo, la pantalla— es
plomería alrededor de esto.

Las dos funciones devuelven **por qué** matchearon, no sólo un número. Eso vale
más que la confianza: el que revisa puede confiar en un `alias` sin mirarlo y
desconfiar de un `parecido` de 0,42.

### `emparejar_lineas_de_oc(empresa, cliente, lineas)`

De lo más confiable a lo menos:

| método | confianza | qué es |
| --- | --- | --- |
| `alias` | 1.00 | alguien de la casa ya dijo que ese texto es ese producto |
| `sku` | 0.98 | nuestra referencia, escrita por el cliente |
| `alias_sin_cantidad` | 0.95 | el alias, ignorando el `x N` del final |
| `modelo` | 0.92 | el modelo del fabricante |
| `referencia_vieja` | 0.90 | nuestra referencia ANTES del renombre de prefijos |
| `parecido` | la similitud real | trigramas sobre el nombre, umbral 0,35 |
| `sin_match` | 0 | no sabe, y lo dice |

Probado contra los 21.775 productos reales: 7 de 7 casos correctos, incluido
`tornillo de la suerte` → `sin_match`. **Que diga «no sé» es tan importante
como que acierte**: un producto equivocado en una cotización es peor que un
renglón vacío.

Dos cosas aparecieron probando, y ninguna se habría visto sin datos reales:

**Los alias viejos traen la cantidad pegada.** La migración los guardó como
`punta phillips ph2 largo 70 mm x 5`. Buscando por texto exacto, la misma OC
pidiendo 10 unidades no matchea nunca. Se prueba primero el exacto (1.00) y
recién después sacando el ` x N` (0.95) — vale menos a propósito, porque en
algunas descripciones ese «x 3» es parte del producto.

**Los clientes tienen nuestras referencias VIEJAS.** Después de §22 y §23
—TOHNICHI `TOH.` → `TC.`, SAIPOR `SAI.` → `SA.`— hay 23 productos cuya
referencia anterior sigue circulando en los sistemas de los clientes.
`legacy_ref` la resuelve. Sin este paso, esos 23 habrían empezado a fallar
justo después del cutover, y el síntoma habría sido «la importación no
encuentra productos que existen».

### `emparejar_cliente_de_oc(empresa, nombre, cuit)`

El dato duro sería el CUIT, pero **565 de 1.010 clientes lo tienen cargado**, y
sólo 544 con 11 dígitos. Para casi la mitad, el nombre no es un respaldo: es el
único camino.

| método | confianza | nota |
| --- | --- | --- |
| `cuit` | 1.00 | hay índice ÚNICO sobre el CUIT normalizado: si coincide, no hay ambigüedad y se devuelve **sólo ése** |
| `nombre_exacto` | 0.95 | contra los TRES nombres: razón social, fantasía y el del sistema viejo |
| `parecido` | la similitud | hasta 5 candidatos, para que la pantalla PREGUNTE |

La clave de comparación saca la **forma jurídica**, que es justo lo que cada uno
escribe distinto: «METALÚRGICA ZZ S.A.», «Metalurgica ZZ SA» y «METALURGICA ZZ
S.A.I.C.» dan lo mismo.

Probado con clientes reales, buscándolos por su nombre deformado como lo
escribirían en su membrete —sin acentos, sin puntos, en mayúscula—: 4 de 4 por
CUIT y 4 de 4 por nombre. Un nombre inventado devuelve un candidato al 0,33, no
una certeza.

**Nunca elige solo cuando el método es `parecido`.** Equivocarse de producto
sale una cotización mal hecha; equivocarse de cliente manda la mercadería a
otra empresa.

### Lo que falta

`index.ts` de la Edge Function —extraer el texto del PDF y llamar al
proveedor—, la RPC que persiste la OC y busca cotizaciones que coincidan, y la
pantalla. Sigue bloqueado por `OPENAI_API_KEY`, que es una de las 4 secrets del
cutover (§25).

### E5 · Guardar la OC y engancharla a una cotización (2026-09-29)

`cotizaciones_para_oc(empresa, cliente, productos[], meses)` e
`importar_oc(...)`. Las dos probadas contra datos reales; la segunda, con una
transacción que se revierte, así que no quedó ni una cotización de prueba ni un
número de serie consumido.

**Buscar la cotización.** La señal que sirve es cuántos de los productos de la
OC aparecen en la cotización. El total no alcanza —el cliente pide una parte de
lo cotizado más seguido que todo— y el número de cotización rara vez viene en
la OC. A igual cobertura, primero la que ya se mandó: a un borrador el cliente
no pudo responderle.

Probado tomando una cotización real de 32 líneas y usando sus productos como si
fueran los de una OC: la encuentra primera con cobertura 1,00, entre 6
candidatas del mismo cliente. Pidiendo sólo 2 de sus productos, también. Con
productos que ese cliente nunca cotizó, **0 candidatas** — no ofrece la menos
mala.

**Guardar.** Todo en una transacción: si algo falla no queda ni la OC, ni las
líneas, ni media cotización con el número ya consumido. La cotización no se
arma a mano: se llama a `crear_cotizacion`, que ya valida cliente, tarifa y
moneda, reserva el número, calcula totales y audita.

Las líneas **sin producto entran igual**, con el texto del cliente y sin
`product_id`. Perderlas sería peor que dejarlas para completar a mano: el que
revisa ve exactamente qué falta.

Rebota la **OC duplicada** comparando sin distinguir mayúsculas ni espacios.
Importar dos veces el mismo PDF es el error más fácil de cometer, y deja dos
cotizaciones por el mismo pedido.

### Tres correcciones que salieron de la prueba

**`match_status` no era lo que yo creía.** Había inventado `'partial'`; el
CHECK dice `unmatched | match | difference | missing | extra`. El vocabulario
del esquema es mejor que el mío: no describe *cómo encontré el producto* sino
*cómo queda la línea contra la cotización*, que es la pregunta que se hace el
que revisa —«¿me está pidiendo algo distinto de lo que le cotizamos?»—.

El cómo se emparejó es otro eje y no tenía dónde vivir. Va en `match_method`,
columna nueva: la confianza sola no alcanza, porque 0,95 puede ser un alias o
un parecido muy bueno y no se revisan igual.

**`v_ql := null` no limpia un record.** Leerle un campo a un record sin asignar
no da null: da error. Con variables sueltas, «esta línea no está en la
cotización» se expresa sin ambigüedad.

**El título tartamudeaba**: «OC OC-PRUEBA-9001», porque casi todo número de
orden ya empieza con OC. `app.titulo_de_oc` lo antepone sólo cuando hace falta.
Es un renglón que se imprime y lo ve el cliente.

## 28 · Memoria de cliente por CUIT y por nombre (2026-09-29)

### El caso que la pide

La OC de Mabe trae el logo «mabe» como **imagen**, y el texto que sí se puede
leer dice `Razon Social: DREAN S.A.` con RFC `30502680478`. La IA lee bien: eso
es literalmente lo que está escrito. El cliente de la casa, en cambio, es *Mabe
Argentina S.A.*, que además no tiene CUIT cargado.

No es un problema de prompt, y ajustarlo no lo arregla: el dato **no está en el
documento**. Lo único que puede resolverlo es que alguien lo diga una vez.

Es el mismo patrón que la memoria de productos (`recordar_alias_de_oc`), un
escalón más arriba: en vez de «este cliente llama así a este producto», es «este
papel corresponde a este cliente».

### Por qué NO sirvió `customer_legacy_tax_ids`

Parecía la tabla obvia y no lo es: su **PRIMARY KEY es `customer_id` solo**, o
sea una fila por cliente. Acá hace falta lo contrario —varias claves apuntando
al mismo cliente—, porque una misma empresa aparece con su razón social, con la
de un grupo y con más de un CUIT según la planta que emite la orden.

Tabla nueva, `customer_oc_aliases`, con `unique (company_id, tipo, clave)`: una
clave apunta a UN cliente por empresa, y si mañana resulta que era otro, la
corrección **pisa** en vez de duplicar.

### Sólo se guarda lo que no se podía deducir

`app.recordar_cliente_de_oc` compara contra la ficha del cliente antes de
escribir: si el CUIT del papel ya es su CUIT, o el nombre ya es alguno de los
tres que guardamos (`legal_name`, `trade_name`, `legacy_name`), la fila no
aporta nada. Guardarla llenaría la tabla de ruido y taparía las correcciones de
verdad, que son las que hay que poder auditar a ojo.

Se decide en la base y no en la pantalla: el frontend manda **siempre** lo que
leyó, y la base resuelve si vale la pena. Decidirlo del otro lado obligaría a
duplicar esa comparación en TypeScript.

### La memoria se consulta ANTES que el CUIT

Parece al revés y es a propósito. Si el CUIT del papel figura en la ficha de
algún cliente, la memoria para ese CUIT **no existe** —`recordar` no la guarda
por redundante—, salvo que alguien la haya escrito corrigiendo justamente eso. Y
en ese caso la corrección de la persona vale más que la coincidencia.

Orden final de `emparejar_cliente_de_oc`: memoria por CUIT → memoria por nombre
→ CUIT en la ficha → nombre exacto → parecido.

`memoria` entra a `DUROS_CLIENTE`, así que la pantalla elige sola. Y cuando lo
hace, ahora dice por qué: «Ya lo habías corregido para este mismo documento. La
orden dice «DREAN S.A.».» Sin ese renglón, la pantalla muestra *Mabe Argentina*
sobre una orden que dice *Drean* y parece un error.

### Probado contra los datos reales, revirtiendo al final

Siete comprobaciones en un bloque que termina en `raise exception 'TEST_OK'`,
corriendo como `authenticated` con claims de JWT —no como `postgres`, que
saltea RLS y prueba otra cosa—:

1. antes de guardar nada, «DREAN S.A. / 30502680478» no lleva a Mabe;
2. al importar corrigiendo a Mabe, quedan 2 filas de memoria (CUIT y nombre);
3. la OC siguiente resuelve por CUIT, con `metodo = 'memoria'`;
4. y también sólo por el nombre escrito distinto («Drean Sociedad Anonima»),
   que además desambigua entre los DOS clientes Mabe que hay en la base;
5. un segundo uso **cuenta** (`times_used = 2`), no duplica;
6. si alguien se equivocó y era otro cliente, la corrección pisa y la cuenta
   arranca de nuevo en 1;
7. lo redundante no se guarda: importar con el nombre propio del cliente no
   deja rastro.

### Efecto lateral: `clave_de_razon_social` reconoce dos formas más

La prueba 4 falló primero, y no por la memoria: la función que saca la forma
jurídica no conocía «Sociedad Anónima» escrito con todas las letras, ni las
variantes largas del acrónimo (S.A.C.I.F., S.A.I.C.F., S.A.C.I.F.I.A.).

Medido contra los 1.010 clientes reales antes de cambiarla: **7 claves mejoran,
ninguna queda vacía y no aparece ninguna clave repetida nueva** —lo peligroso
sería eso último, porque convertiría un «nombre exacto» en dos empresas
indistinguibles—. Y se verificó que la función, aunque es `IMMUTABLE`, no está
dentro de ningún índice, vista materializada ni restricción: cambiarla ahí
habría dejado el índice inconsistente en silencio.

### `importar_oc` cambió de firma

Se agregó `p_cliente_leido jsonb default null` y se **reemplazó** la versión de
8 argumentos en vez de dejar una sobrecarga: con un parámetro con default, las
dos conviven y una llamada de 8 argumentos queda ambigua. PostgREST llama por
nombre, así que el frontend ya publicado sigue funcionando —le falta un
parámetro que tiene default—.

## 29 · La revisión de la OC, en una tabla (2026-09-29)

Cada línea era una tarjeta de tres bloques —las dos referencias enfrentadas,
los dos nombres completos, y un pie con la insignia del método, la cantidad y
el botón «Machear»—. Con una OC de 19 líneas eso es mucho scroll para una tarea
que consiste en leer una columna de arriba abajo comparándola contra el PDF.

Ahora es una tabla de verdad: **una fila por producto**, cuatro columnas —lo
que pide el cliente, nuestra referencia, cantidad × precio, y el estado—.

**Por qué `<table>` y no una grilla de `<div>`.** Lo que se hace acá es comparar
una columna contra otra, y para eso las referencias tienen que estar alineadas
entre sí. Además el encabezado queda asociado a cada celda para un lector de
pantalla, y la fila del buscador se expande con `colspan` sin romper nada.

**Las referencias van en monoespaciada y en una sola línea.** `SP.2008VP/100`
contra `SP.2008VP/100` se compara carácter por carácter, y con tipografía de
ancho variable eso es imposible. El nombre completo va en el `title`; el PDF
está al lado. Cuando la línea no trae código, la descripción del cliente **es**
la referencia y se muestra ella: es lo único que hay para buscar el producto.

### Tres marcas, no dos

Lo pedido eran dos: tilde y cruz. Son tres, y la que sobra es a propósito.

| marca | qué dice | al tocarla |
|---|---|---|
| ✔ verde | emparejado en firme (SKU, alias, modelo…) | abre el buscador |
| ⚠ ámbar | **parecido**: es una propuesta, no una certeza | abre el buscador |
| ✘ rojo | no se encontró nada | abre el buscador |

Mostrar un parecido como tilde sería aceptar una adivinanza en silencio, que es
justo lo que evita `DUROS_LINEA`: los trigramas devuelven el más parecido que
encontraron, no el correcto, y con 21.775 productos siempre hay algo que se
parece. La acción es una sola para las tres, así que no agrega nada que
aprender.

El icono solo no distingue «el código es nuestra referencia» de «se parece al
nombre», y no se revisan igual: el motivo viaja en el `title` y en el rótulo
accesible del botón.

### El modal por fin tiene pruebas

No tenía ninguna, siendo la pantalla donde se decide qué entra a una cotización.
Tres, sobre la tabla: que hay una fila por producto con las dos referencias
—y que sin código se muestra la descripción—, que las tres marcas se distinguen
por su rótulo accesible, y que tocarlas abre y cierra el buscador.

El PDF se saltea: la lectura vive en una Edge Function y el test devuelve lo que
habría devuelto. Ojo para la próxima: el proyecto **no tiene
`@testing-library/user-event`**, se usa `fireEvent`.

## 30 · El ejército de agentes: arquitectura (Fase 31 · E1–E4)

Se arma de cero. El legacy (`app.js`, 45.345 líneas) sirvió para saber qué
agentes hacían falta y, sobre todo, qué NO repetir.

### Lo que hacía el legacy, y por qué no alcanzaba

Un asistente general más cinco por sección (catálogo, ventas, compras, emails,
mantenimiento). El problema no era la cantidad de agentes: era que **ninguno
consultaba la base**. Los datos se pegaban como TEXTO dentro del prompt.

| | legacy | ahora |
|---|---|---|
| Catálogo | volcaba hasta **400 líneas** de producto: el 1,8 % de 21.775 | consulta con herramientas; llega a cualquiera |
| Derivación | tablero de regex + memoria pegajosa de 12 turnos | lo decide el modelo, y puede consultar a dos |
| Datos | texto pegado al prompt | RPC con `function calling` |
| Acciones | `:::ACCION:::{json}:::FIN:::` sacado con regex, error tragado en `catch{}` | herramientas tipadas; el fallo vuelve como texto |
| Claves | `localStorage` + token fijo en el JS público | secrets de la Edge Function |
| Permisos | ninguno: el Worker corría con lo que tuviera | JWT de la persona; manda la RLS |

El parche más elocuente del legacy: «¿llegó algún mail con una orden de
compra?» matcheaba «orden de compra» y caía en Compras, que no ve los correos.
Hubo que escribir una regla de prioridad a mano para Emails. Acá hay un test de
ese caso exacto, y el general consulta a los DOS.

### La arquitectura

`bucle.ts` + `agentes.ts` + `herramientas.ts` son PUROS: entran dos funciones
inyectadas (`modelo` y `ejecutar`) y todo lo demás es decisión. Por eso los
límites se prueban con un modelo guionado, que es la única forma de verificar
ciclos y presupuesto sin gastar ni depender de que el modelo se porte igual
dos veces.

Los cortes, todos probados: un colega que ya está en la pila **no se le
ofrece** al modelo —rechazarlo después gasta vueltas—; tope de profundidad;
tope de vueltas por agente; y un presupuesto global de llamadas. Todos
terminan en una RESPUESTA, nunca en una excepción hacia la persona.

### Lo que salió de probar las herramientas contra datos reales

Cinco errores, todos de los que hacen «responder con errores»:

1. **El grave**: preguntar por un cliente inexistente devolvía los documentos
   de OTRO. El CUIT se comparaba normalizado a cifras y 447 clientes no tienen
   CUIT: vacío igual a vacío matcheaba a todos. No fallaba: contestaba mal con
   datos reales ajenos.
2. «fein oscilante» devolvía **un** producto: se exigía la frase entera y se
   llaman «FEIN MULTIMASTER». Ahora busca por palabra contra nombre, SKU y
   marca.
3. «punta philips ph2» ponía **BR.PH1 arriba de BR.PH2**. Los trigramas miran
   la cadena entera: un carácter es ruido para ellos y TODO para una persona.
4. Buscar por palabra suelta trajo lo contrario: «zzzz no existe» devolvía «NO
   UTILIZAR ESTE ITEM» porque «no» matchea. Palabras vacías y un piso de
   coincidencia.
5. `informe_documentos` habla en **plural** y `informe_rankings_comerciales`
   rechaza «clientes + cantidad» y exige moneda con importe. Traducir es
   trabajo del envoltorio: pedirle al modelo que adivine el plural es que un
   día devuelva cero sobre una base con 218 cotizaciones.

Y se descubrió que los módulos de las Edge Functions nuevas **no se estaban
typecheckeando**: metí un error a propósito y `tsc` no dijo nada. Ahora están
en `tsconfig.node.json`, que además necesitó `allowImportingTsExtensions`
porque Deno exige la extensión en los imports relativos.

### Encenderlo

El proveedor arranca en `falso`, como `importar-oc`: desplegado sin configurar
no manda los datos de nadie a un tercero. Se enciende con un secret:

    IA_PROVIDER = openai

`OPENAI_API_KEY` ya está cargada (la usa `importar-oc`). `IA_MODELO` y
`IA_ESFUERZO` tienen default.

### Pendiente

- El Worker del legacy sigue vivo con su token publicado: **rotarlo o
  apagarlo**, exista o no el asistente nuevo.
- El asistente sólo LEE. Crear una cotización es otra decisión y necesita su
  confirmación en pantalla.
- Compras no puede LISTAR documentos de compra (no hay informe equivalente a
  `informe_documentos`); sí abrir uno por número. Está dicho en su prompt.
- Memoria entre conversaciones: el legacy tiene 5 tablas. Sin migrar.

## 31 · Lo que salió de probar el asistente con preguntas reales (Fase 31 · E5)

Con el proveedor encendido y preguntas de verdad aparecieron cuatro cosas que
ninguna prueba con modelo guionado podía encontrar.

### 1 · No sabía en qué día vivía

«¿Cuál fue el mejor cliente de agosto?» → «¿De qué año querés consultar
agosto?». El modelo tenía razón: no lo podía saber. Se inyecta el contexto de
la consulta —fecha en zona horaria de Buenos Aires, y quién pregunta— por el
`Entorno`, no leyendo el reloj adentro del bucle, que es puro y tiene que
poder tener fecha fija en un test.

La zona horaria importa: a las 21 de Argentina, en UTC ya es mañana, y «lo de
hoy» sería el día equivocado.

### 2 · Preguntaba de más

Después de la fecha, seguía: «¿en qué moneda querés medirlo?», teniendo USD
por defecto. La regla del prompt decía «si es ambiguo, preguntá», y eso
convierte cada consulta en un interrogatorio. Ahora la regla distingue:

- **Asumí y decilo** cuando hay una respuesta obvia (el año de un mes, la
  moneda habitual, «últimamente»).
- **Pará y preguntá** sólo cuando elegir mal tiene consecuencias: cuál de dos
  clientes parecidos, cuál de dos productos que no son intercambiables.

### 3 · El grave: contestaba que NO hay stock de algo que sí hay

«¿Tenemos puntas Philips PH2 con stock?» → **«No hay stock»**, con 10 unidades
de BR.PH2 en el depósito. Dos palabras rompían la búsqueda:

- «puntas» en plural no matchea «PUNTA»;
- «philips» con una L no matchea «PHILLIPS», que es como está escrito.

Escribiendo «punta phillips ph2» aparecía perfecto. O sea: **la respuesta
dependía de cómo se escribiera la pregunta**, y el error salía como una
afirmación segura. Un vendedor le dice a un cliente que no tenemos algo que
tenemos.

Se arregla con `word_similarity` por palabra. El umbral es 0,6, medido:

| par | parecido |
|---|---|
| philips ↔ phillips | 0,700 |
| puntas ↔ punta | 0,714 |
| destornillador ↔ punta phillips | 0,067 |
| llave ↔ ídem | 0,000 |

Casi diez veces de separación entre «es la misma palabra» y «no tiene nada que
ver»: 0,6 no es un número elegido a ojo.

### 4 · Y eso costó tres veces más, así que la búsqueda va en dos etapas

Calcular el parecido palabra por palabra contra los 21.775 productos llevó la
búsqueda de ~400 ms a **1.356 ms**. Ahora: una preselección barata (`like` y
`<%`) y, sobre esos cientos, el cálculo caro que decide el orden. Vuelve a
440–920 ms en régimen; los 2.400 ms del primer tiro son arranque en frío.

La preselección es generosa a propósito: lo que deje afuera no lo rescata
nadie después.

### Detalles de la pantalla

- **La caja de escribir ocupaba media pantalla.** Las filas de la grilla se
  asignan por POSICIÓN y el cartel de «IA apagada» es condicional: sin él
  había un hijo menos y el `1fr` le tocaba a la barra. Ahora es flex y el que
  crece lo dice él mismo.
- **Los asteriscos se veían.** Se resuelven con un partidor propio de seis
  líneas que devuelve PEDAZOS, no HTML: el texto del modelo no puede inyectar
  nada en la página. Los asteriscos sin cerrar quedan como texto, así que un
  `**` de más no cambia el aspecto de media respuesta.
- **Los importes salían «USD 10811.48».** Se le pide al modelo el formato
  argentino: mismo número, escrito como se lee acá.

## 32 · Calidad del catálogo para que la IA conteste bien (Fase 32)

### Primero: ¿la migración perdió datos? NO

Era la sospecha razonable y hay con qué verificarla: el repo del legacy trae
`productos-data.json`, 21.772 productos, el mismo número que la base.

| campo | legacy | base |
|---|---|---|
| marca | 16.316 | 16.311 |
| medida | 4.745 | 4.745 |
| largo | 7.765 | 7.765 |
| encastre | 8.422 | 8.422 |
| origen | 8.818 | 8.818 |
| NCM | 5.329 | 5.329 |
| serie | 9.089 | 9.089 |

Idénticos. Y las marcas duplicadas también venían del legacy. **La base ya
estaba incompleta antes de migrar**; la migración fue fiel.

### Las «marcas» de dos letras eran prefijos de SKU

Ocho: BR, GE, KI, MI, NA, RR, SI, TO. La marca de verdad estaba en el NOMBRE.

- `GE` convivía con `GEDORE` → filtrar por Gedore dejaba la mitad afuera.
- `TO` convivía con `TORERO`, que tiene 91 productos.
- **`BR` contenía DOS fabricantes**: BREMEN y BROPPE, que comparten prefijo
  porque las dos empiezan igual.
- KI = KING TONY · MI = MILWAUKEE · NA = NAC · RR = RED ROOSTER · SI = SIOUX

### Productos de marcas conocidas, sin marca

859 tenían la marca escrita en el nombre y el campo vacío: «GEDORE 3549-05…»,
«TOHNICHI CEM100N3X15D-G», «APEX EX372». GEDORE mostraba 4 productos y tiene
100; RIVIT mostraba 2 y tiene 197.

Se asigna la marca más LARGA que coincida, no la primera: con «RED ROOSTER
RRP203», la más larga es siempre la más específica.

Más ocho marcas que faltaba dar de alta (663 productos): MERCEDES BENZ,
NORMECO, MACSI, OHMI, SUMAKE, ACRADYNE, QIMAROX, TRILOGIQ. Se miraron una por
una: hay primeras palabras muy frecuentes que son sustantivos y no marcas
—LLAVE, CINTA, PINZA, GUANTE, ZAPATO—, y darlas de alta sería peor que nada.

**Resultado: sin marca pasó de 5.461 a 3.939. Marcas: 25 → 32.**

### El banco de pruebas de formas de preguntar

`scripts/asistente-pruebas-de-busqueda.sql`: la misma pregunta escrita de
muchas maneras, con lo que TIENE que devolver. Prueba la BÚSQUEDA y no al
modelo, a propósito: corre en un segundo, no cuesta nada, es determinista, y
es la capa donde estuvo el error. Probar sólo a través del modelo mezcla dos
fuentes de fallo y cuesta plata cada vez.

Primera corrida: 29 ✓, 3 parciales, 6 ✗. Todos los fallos en un mismo lugar:
preguntar por una MARCA no devolvía productos de esa marca. «gedore»,
«ingersoll», «milwaukee» daban cero entre los primeros cinco.

La causa: el campo marca se usaba para MATCHEAR pero no para ORDENAR. Un
producto de otra marca que menciona «gedore» competía de igual a igual con los
cien que SON Gedore, y desempataba el alfabeto.

Arreglado: si una palabra de la consulta nombra una marca, esos productos van
primero. El desempate entra DESPUÉS de `palabras`, no antes — un producto de
otra marca que coincide en todo lo pedido sigue ganándole a uno de la marca
correcta que coincide en la mitad.

**Segunda corrida: 37 de 37.**

### Lo que NO se puede arreglar sin datos

FIAM (3.374) y TOHNICHI (2.731) no tienen ningún atributo, y eso **no se
inventa**. Se puede extraer lo que ya está escrito en el nombre —medidas,
encastres, torques— pero las specs que no están en ningún lado necesitan los
catálogos del fabricante.

Quedan 3.939 productos sin marca: reventa suelta cuyos nombres no empiezan con
una marca. Clasificarlos necesita reglas nuevas o criterio humano.

### Pendiente: el prefijo de SKU de las marcas nuevas

5.394 productos siguen con SKU genérico `PRO#####`. La convención es dos
letras de la marca + punto + modelo, pero **la regla choca**:

| marca | prefijo natural | choca con |
|---|---|---|
| BREMEN | BR | BROPPE (BR.PH2) |
| NAC | NA | ya usado |
| MERCEDES BENZ | ME | — |
| NORMECO | NO | — |
| MACSI | MA | — |

Ya hay un precedente de cómo se resolvió antes: TOHNICHI usa `TC.` y no `TO.`
porque TORERO tenía `TO.`. Decidir los prefijos nuevos es del dueño del
catálogo, no mío: un prefijo mal elegido se arrastra para siempre.

## 33 · Referencias, tipos y atributos (Fase 32 · E5–E6)

### Los prefijos nuevos los decidió el dueño del catálogo

BREMEN → `BM` (porque `BR` ya es BROPPE) y NAC → `NC` (porque `NA` ya estaba
usado). Es el mismo criterio con el que antes TOHNICHI quedó en `TC` y no en
`TO`: TORERO tenía `TO`. Un prefijo mal elegido se arrastra para siempre, así
que la decisión no es de quien escribe la migración.

### El modelo NO estaba en `model_code`

Parecía el campo obvio y era una trampa: en **5.348 de 5.394** productos con
SKU genérico, `model_code` es el propio número del SKU —`PRO04787` tiene
`model_code` «04787»—. Un correlativo interno, no el modelo del fabricante.
Usarlo habría producido `RI.05004` para «RIVIT **RIV504**».

El modelo sale del NOMBRE: el primer token con dígitos dentro de los tres que
siguen a la marca. Los dígitos son lo que separa un modelo de una palabra, y
el límite de tres evita agarrar un número perdido más adelante: sin él,
«MACSI ZAPATO DE SEGURIDAD ZAFIRO TALLE 35» habría quedado con modelo «35».

**890 productos renombrados, cero SKU duplicados.**

### Lo que se dejó sin tocar, a propósito

- **Sin modelo deducible** (188): se quedan con `PRO#####`. Inventar una
  referencia es peor que no tenerla.
- **Referencias que chocarían** (59 grupos): «RIV504 Trigger», «RIV504 Jaws
  opener» y «RIV504 End plug» son tres REPUESTOS del mismo modelo, y su número
  de parte está en otro lado del nombre. Ponerles `RI.RIV504`, `-2` y `-3`
  sería inventar una numeración que no existe en ningún catálogo.

### FIAM y TOHNICHI: el dato ya estaba en la base

Se pidió sacarlo de las webs de los fabricantes. No hizo falta, y conviene
saber por qué:

- **TOHNICHI**: 2.762 de 2.776 traen una ficha estructurada en `description`
  —MARCA / ORIGEN / MODELO / DESCRIPCION— con el rango de torque y el encastre
  adentro del texto. Sólo faltaba parsearla.
- **FIAM**: 3.220 de 3.378 son **REPUESTOS**. El «faltan atributos» era un
  espejismo: una bujía o un rotor no tienen torque ni encastre. El hueco real
  eran ~158 herramientas, y 68 ya traían ficha.

Scrapear 6.105 productos de dos sitios habría sido caro, lento y menos
confiable que leer lo que ya estaba.

Se usan las claves que YA usa el catálogo —`torq_min`, `torq_max`, `encastre`,
`peso_kg`— y no unas nuevas: si cada marca inventa su vocabulario, el filtro
deja de servir, que es lo que se quería arreglar. Y `attributes` se MEZCLA con
lo nuevo del lado izquierdo del `||`, así lo cargado a mano gana.

| | antes | después |
|---|---|---|
| sin tipo de producto | 12.600 | **7.897** |
| sin atributos | 12.740 | **11.445** |
| FIAM sin tipo | 3.374 | **158** |

### Lo que falta y por qué no lo decidí yo

1.293 TOHNICHI quedaron SIN tipo a propósito: son cabezales (OPEN END HEAD,
RING HEAD, HEX HEAD), tubos (SOCKET, HEX SOCKET) y puntas (BIT). Traducirlos
al vocabulario de la casa —que tiene «Embocadura», «Casquillo», «Punta»— es
elegir nomenclatura, y eso es del dueño del catálogo. Sólo se completaron
«Llave Dinamométrica» y «Destornillador Dinamométrico», que no admiten duda.

Quedan 4.504 productos con `PRO#####` y 3.939 sin marca: reventa suelta cuyos
nombres no empiezan con una marca.

## 34 · El diccionario castellano ↔ inglés del catálogo (Fase 32 · E7–E8)

La equivalencia la dio el dueño del catálogo: **socket = Embocadura,
bit = Punta, head = Cabezal**. Son los términos que el catálogo ya usaba para
APEX y SPEEDRILL, así que las herramientas importadas con nombre en inglés
pasan a filtrarse junto con las demás en vez de quedar en un limbo aparte.

Se aplicó a TODAS las marcas y no sólo a TOHNICHI: 848 productos sin tipo usan
esas palabras —NORMECO 79, NAC 55, OHMI 55, GEDORE 44—, y dejarlos afuera
habría repetido el problema un escalón más abajo.

Se verificó antes que **ningún** producto usa dos de las tres palabras, así que
el orden de las ramas no cambia ningún resultado. La única excepción es «bit
holder», que en la casa ya tiene su propio tipo, «Holder Bit»: es el que
sostiene la punta, no la punta.

### El eslabón que faltaba

Tipificar no servía de nada por sí solo: **la búsqueda no miraba el tipo**.
Un «TOHNICHI DH12D SQUARE DRIVE HEAD» quedaba tipado como Cabezal y seguía sin
aparecer buscando «cabezal», que es la palabra que se usa acá.

Ahora `product_type` y la categoría entran al texto buscable. En la práctica el
tipo funciona como un **diccionario**: el que pregunta escribe en castellano y
el catálogo está escrito mitad en inglés.

Comprobado:

| se busca | aparece |
|---|---|
| embocadura normeco | NORMECO … IMPACT SOCKET |
| puntas torx ohmi | OHMI … TORX BIT |
| embocaduras de impacto nac | NAC … IMPACT SOCKET |

| | antes de E7 | después |
|---|---|---|
| sin tipo | 7.897 | **7.051** |
| TOHNICHI sin tipo | 1.293 | **754** |

Banco de búsqueda: **36 de 36**, con los tres casos nuevos incorporados.
