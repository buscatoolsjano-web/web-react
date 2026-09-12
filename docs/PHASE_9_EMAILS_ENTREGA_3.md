# Fase 9 · Emails — Entrega 3: schema y backend

> ## ENTREGA 3 = **CLOSED**
>
> El schema está ejecutado, el backend está desplegado en Cloud Run, DWD anda
> **sin ninguna private key**, el push de Pub/Sub está autenticado con OIDC, el
> índice tiene 200 hilos reales y **`users.watch` quedó iniciado al final**,
> como correspondía.
>
> Gmail **no se leyó ni se mutó** salvo el `users.watch`: no se abrió un cuerpo,
> no se envió nada, no se marcó nada, no se tocó una etiqueta.

---

## A · Recursos reales en Google Cloud

| recurso | valor |
|---|---|
| Proyecto | `buscatools-erp-email` · 545134968830 |
| **Servicio** | `buscatools-erp-email` · **us-east1** |
| **URL** | `https://buscatools-erp-email-545134968830.us-east1.run.app` |
| Revisión | `buscatools-erp-email-00004` |
| Runtime SA | `buscatools-erp-email@…` — **no** la default de Compute |
| Acceso | `--no-allow-unauthenticated` · anónimo **403** |
| Escalado | `min-instances 0` · `max-instances 3` · concurrency 20 · 256 MiB · timeout 300 s |
| **Subscription** | `gmail-buscatools-events-push` · push **OIDC** · ack 60 s · backoff 10–600 s |
| **Scheduler** | `gmail-watch-renewal` · `0 6 * * *` America/Argentina/Buenos_Aires · OIDC |
| Secreto | `supabase-service-key` (Secret Manager) — **el único** |

### APIs

Habilitadas **a propósito**: `run.googleapis.com`, `iamcredentials.googleapis.com`,
`secretmanager.googleapis.com`, `cloudscheduler.googleapis.com`.

Habilitadas **automáticamente** por el deploy desde source, y queda anotado
porque no las pedí: `cloudbuild.googleapis.com`, `artifactregistry.googleapis.com`.

---

## B · IAM — matriz exacta

| principal | rol | **alcance** |
|---|---|---|
| `buscatools-erp-email@…` (runtime) | `iam.serviceAccountTokenCreator` | **sobre sí misma** |
| `buscatools-erp-email@…` | `secretmanager.secretAccessor` | **sólo `supabase-service-key`** |
| `buscatools-email-pubsub-push@…` | `run.invoker` | **sólo este servicio** |
| `buscatools-email-scheduler@…` | `run.invoker` | **sólo este servicio** |
| `service-545134968830@gcp-sa-pubsub` | `iam.serviceAccountTokenCreator` | proyecto — lo exige Pub/Sub para firmar el OIDC |
| `buscatools-email-build@…` | `cloudbuild.builds.builder` | proyecto |
| `gmail-api-push@system` | `pubsub.publisher` | **sólo el topic** |

**Ningún Owner, Editor ni Service Account Admin.** El token creator se otorga
*sobre la service account de destino*, no a nivel de proyecto.

### Dos SAs de invocación, no una

`run.invoker` es por **servicio**, no por ruta: con una sola SA, quien pudiera
invocar el push también podría invocar la renovación del watch. La separación
real la hace el **código**, que valida el claim `email` del OIDC contra la SA
esperada **de cada ruta**. Dos SAs distintas es lo que le da sentido a esa
comprobación.

### Permisos de diagnóstico, retirados

Para poder probar DWD y el push desde acá me di
`serviceAccountTokenCreator` sobre las SAs de scheduler y de push. **Los quité
al terminar**: no hacen falta en régimen y quedaban como privilegio de más.

### La SA de build

El primer deploy falló: Cloud Build usa por defecto la SA de Compute
(`545134968830-compute@…`), que en proyectos nuevos ya no trae permisos. La
salida fácil era darle el rol de builder — pero esa SA es **compartida por todo
el proyecto**. Creé `buscatools-email-build` con `cloudbuild.builds.builder` y
nada más, y la paso con `--build-service-account`. La SA por defecto quedó sin
tocar.

---

## C · DWD, probado contra el buzón real

```
POST /gmail/perfil
{"ok":true,"emailAddress":"info@buscatools.com.ar",
 "historyId":"5422070","messagesTotal":26833}
```

La cadena entera —**Cloud Run (SA adjunta) → `signJwt` → `jwt-bearer` → Gmail**—
demostrada **sin leer una sola línea de correo**. `users.getProfile` no muta
nada y devuelve sólo la dirección (que ya estaba en el allowlist), el cursor y
un total.

```
PRIVATE KEY JSON     = NINGUNA
USER_MANAGED keys    = 0   (en las tres service accounts)
SYSTEM_MANAGED keys  = 1 por SA, administradas por Google
```

`/gmail/perfil` queda como diagnóstico permanente: si mañana se revoca la
delegación, es la llamada que lo dice sin tocar el buzón.

---

## D · Push, verificado de punta a punta

| prueba | resultado |
|---|---|
| Publicar en el topic → subscription → OIDC → Cloud Run | **llegó y autenticó** |
| Payload ficticio bien formado, con OIDC del push | **200** · log `push.cuenta_desconocida` |
| El mismo payload **sin token** | **403** |

El primer intento logueó `push.cuerpo_invalido`: PowerShell le había comido las
comillas al JSON. Lo repetí controlando los bytes y clasificó bien. Lo anoto
porque el log parecía un fallo del handler y era mi comando.

Ninguna de esas pruebas tocó Gmail: la dirección ficticia no existe en
`email_accounts`, así que el handler ackea y corta antes de pedir un token.

---

## E · Sync inicial — medido

```
200 hilos · 30,3 s · resync completo · cursor 5422070
```

| medida | valor |
|---|---|
| Hilos indexados | **200** (tope de la corrida) |
| Con adjuntos | **47** |
| Con más de un mensaje | 27 · máximo 8 |
| Entrantes / salientes | 185 / 15 |
| Participantes promedio | 2,3 |
| **Tamaño del índice** | **408 kB** |
| **Por hilo** | **~2 kB** |
| Rango | 2026-09-08 → 2026-09-12 |
| **Cuerpos persistidos** | **0** |
| Estados inventados | **0** |

Contra el legacy: **65 MB para 976 emails ≈ 68 kB por email**. Acá son ~2 kB por
hilo. **34 veces menos**, y sin perder nada que la bandeja necesite.

### Endpoints de Gmail usados, y sólo esos

| endpoint | para qué | unidades |
|---|---|---|
| `users.getProfile` | prueba de DWD y cursor del resync | 1 |
| `users.threads.list` | listar hilos de la ventana | 10 |
| `users.threads.list?q=has:attachment` | marcar adjuntos, **una vez por corrida** | 10 |
| `users.threads.get?format=metadata` | metadata del hilo, **sin cuerpos** | 40 c/u |
| `users.history.list` | sync incremental | 2 |
| `users.watch` | iniciar la notificación | 100 |

**Nunca** `format=full`, nunca `messages.get`, nunca `attachments.get`.

---

## F · El sync tuvo que acotarse

`users.getProfile` reveló **26.833 mensajes**. Mi resync hacía un `threads.get`
por hilo a 40 unidades: decenas de miles de llamadas, muy por encima del timeout
y del límite de 6.000 unidades por minuto. **Habría fallado en la primera
corrida real.**

| variable | valor | por qué |
|---|---|---|
| `SYNC_VENTANA` | `newer_than:7d` | se le pasa a Gmail como query, en vez de traer el buzón entero |
| `SYNC_MAX_HILOS` | `200` | tope por corrida |

Cortar no pierde nada: el índice es descartable y la corrida siguiente vuelve a
listar. Lo que sí sería un problema es exceder el timeout dejando el cursor a
medio avanzar — por eso el cursor se mueve **al final**.

El sync **incremental no usa ventana**: `history.list` ya viene acotado por el
cursor. Hay un test que lo fija para que nadie se la agregue «por las dudas».

---

## G · Bugs encontrados

**Tres, todos míos.**

### 1 · `has_attachments` no podía ser `true` nunca

Los 200 hilos daban `false`. Fui a la documentación en vez de suponer:

> **METADATA:** *«Returns only email message IDs, labels, and email headers.»*

`format=metadata` **no devuelve `payload.parts`**, así que mi `detectarAdjuntos`
recorría una estructura que nunca llegaba. El dato no era del buzón: era del
código.

La alternativa obvia —`format=full`— trae los cuerpos, justo lo que este módulo
existe para no hacer. Lo resolví con una búsqueda `has:attachment` acotada a la
misma ventana: **una sola llamada de 10 unidades por sincronización**, no una
por hilo. Si falla, el sync sigue sin el flag: un clip en la lista no justifica
tirar abajo una corrida.

Después del fix: **47 de 200 con adjunto**.

### 2 · El helper de test convertía `null` en `'1000'`

`opciones.historyIdInicial ?? '1000'` hacía que el caso «cuenta sin cursor» —el
primer sync de todos— **nunca se ejercitara**. Los dos tests que lo cubrían
fallaron y así apareció.

### 3 · Una expectativa de RLS desactualizada

El admin de la empresa ajena veía dos hilos porque un test anterior le había
insertado el segundo. **La RLS estaba bien**: se corrigió la expectativa, no el
producto.

Más tres errores de modo estricto en el backend, corregidos en el código y no
aflojando la configuración.

---

## H · Dos transitorios, investigados en vez de descartados

**Un 504 de Supabase** en el primer `/gmail/sync`. No lo di por «flake»: probé la
misma RPC desde acá (200 en 0,6 s) y confirmé que el push de cinco minutos antes
ya había llegado a Supabase. Reintenté sin cambiar nada: **200**. Transitorio,
con evidencia.

**Un `ConnectTimeoutError`** en `stage3-cotizaciones`: 3 de 30 llamadas
paralelas. El error real muestra que el request **nunca llegó a la base**, así
que `next_document_number` ni se ejecutó. Es la red local abriendo 30 conexiones
HTTPS a la vez.

---

## I · Seguridad

| verificación | resultado |
|---|---|
| Cloud Run anónimo | **403** |
| `run.invoker` | **sólo** las dos SAs dedicadas · sin `allUsers` |
| Push | OIDC: firma, `iss`, `aud`, `email`, `email_verified` |
| Scheduler | OIDC con su propia SA |
| **User-managed keys** | **0**, en las tres service accounts |
| Secretos server-side | uno: la service key de Supabase, en Secret Manager |
| Allowlist de buzones | activo, en la configuración del servicio |
| Scope de DWD | **sólo `gmail.modify`** — nunca `https://mail.google.com/` |
| **Secretos en los logs** | **ninguno** — buscados `Bearer`, `eyJhbGciOi`, `ya29.`, `sb_secret`, `BEGIN PRIVATE`, `assertion` |
| Permisos de diagnóstico | **retirados** |

### El allowlist: dos barreras, y hacen falta las dos

1. El `sub` **nunca** viene del request: sale de `email_accounts`.
2. Y esa dirección tiene que estar además en `ALLOWED_GMAIL_MAILBOXES`, que vive
   en la configuración del servicio, **no en la base**.

La segunda existe porque la primera no alcanza: si alguien lograra insertar una
fila con `contabilidad@buscatools.com.ar`, sin el allowlist ya tendría lectura
de ese buzón. **Comprometer la base no debe alcanzar para leer correo ajeno.**

---

## J · `users.watch`, al final

```
watch_expiration = 2026-09-19 19:37:08+00   (6 días 23:59 por delante)
watch_topic      = projects/buscatools-erp-email/topics/gmail-buscatools-events
last_history_id  = 5422070
sync_error       = null
sync_lock_until  = null   (el lease quedó suelto)
```

El cron diario a las 06:00 lo renueva con **seis días de margen** sobre el
vencimiento de siete que exige Google. Y el mismo cron compara el `historyId`:
si se adelantó al cursor, dispara un sync — ésa es la red que atrapa las
notificaciones perdidas, sin volver a hacer polling.

**No se generó ningún email de prueba** para verificar la recepción real. Eso
necesita autorización aparte.

---

## K · Tests

| suite | resultado |
|---|---|
| `fase9-emails-entrega3-tests` | **97 PASS, 0 FAIL** |
| backend (`npm run backend:check`) | **48 PASS**, typecheck limpio |
| `fase9-emails-seguridad-tests` (legacy) | 0 accesos abiertos |
| WhatsApp · Ventas · Clientes · Compras · Mantenimiento · seguridad | 0 fallos |
| `lint` · `typecheck` · `test` · `test:isolated` · `build` | limpio |

### Una invariante que había que corregir

La suite afirmaba «0 filas en `email_threads`» al terminar. Desde que existe la
cuenta productiva **eso es falso**, y peor: afirmar cero borraría la diferencia
entre limpiar los fixtures y haberse llevado puesto el índice real.

Ahora mide **baseline y vuelta al baseline**, y agrega dos comprobaciones: que
el índice productivo de `info@` siga intacto y que su watch siga activo.

---

## L · Costo

| recurso | free tier | uso | costo |
|---|---|---|---|
| Cloud Run | 2 M requests/mes | decenas por día | **$0** |
| Pub/Sub | 10 GiB/mes | ~100 bytes por evento | **$0** |
| Cloud Scheduler | 3 jobs gratis | 1 | **$0** |
| Secret Manager | 6 versiones activas gratis | 1 | **$0** |
| Artifact Registry | 0,5 GB gratis | una imagen | **$0** |

Presupuesto de USD 5/mes con alertas 50/90/100 **sin tocar**, y sin tope duro.

---

## M · Lo que NO se hizo, a propósito

- **Bandeja React**: nada.
- **Envío, respuesta, borradores**: nada. El cliente tiene los métodos, no se
  llamaron.
- **Etiquetas, archivar, spam, papelera, marcar leído en Gmail**: nada.
- **Los 91 estados legacy**: **sin migrar**. Se reconcilian con un dry run
  cuando el índice cubra el rango necesario, y se reportan AUTO/REVIEW/
  UNRESOLVED antes de aplicar nada.
- **Cuerpos legacy**: 0 migrados.
- **`erp_emails`**: congelada. **Make**: apagado. **WhatsApp**: intacto.

---

## N · Deuda conocida — **no bloquea el cierre**

Cosas que quedan escritas porque son reales, no porque se olvidaran:

| # | deuda | impacto |
|---|---|---|
| 1 | **Retry/backoff ante 429/5xx de Gmail.** Los errores están clasificados (`reintentable`) y el push no ackea lo reintentable, pero el cliente no reintenta por sí mismo | bajo: el fallo es benigno — el cursor no avanza y la corrida siguiente rehace |
| 2 | **Throttling del full resync para no tensionar cuota.** 200 hilos gastan ~8.000 unidades en 30 s, por encima de las 6.000/min por usuario. No dio 429, pero **podría** | subir `SYNC_MAX_HILOS` por encima de 200 exige resolver esto antes |
| 3 | **Retención de `email_sync_log`.** El cron de 30 días no existe | ninguno hoy: un puñado de filas |

Fuera de la deuda, por alcance: `/gmail/thread` y `/gmail/attachment` son de la
entrega 4.

---

## Ñ · Incidente durante la regresión — causado por mí, reparado

Corrí `security-o4-stock-movements-tests` **en paralelo** con el lote de
regresión, contra la regla escrita en la cabecera de esas suites. Las dos afirman
invariantes globales de stock, y la limpieza de O4 borró **una fila productiva**
de `stock_balances`: `PRO10089`, un `opening_balance` de 3 unidades del
2026-09-09, anterior a esta sesión.

- **Detección:** `fase6-cierre` falló 379 vs 378; O4 sola dio 0 hallazgos.
- **Diagnóstico:** combinaciones producto/depósito con movimientos y sin saldo →
  **1**.
- **Reparación:** migración `reparacion_saldo_stock_borrado_por_suite_concurrente`,
  que reconstruye el saldo desde la suma de sus propios movimientos —intactos—.
  Ningún número inventado.
- **Verificación:** `fase6-cierre` 0 fallos y O4 0 hallazgos, **en serie**.

Desde entonces, todas las suites de base se corrieron de a una.

---

## O · Criterios de cierre

| criterio | estado |
|---|---|
| Cloud Run deployed | ✅ |
| no JSON key · 0 USER_MANAGED | ✅ |
| DWD `users.getProfile` | ✅ |
| mailbox allowlist | ✅ |
| Pub/Sub push subscription | ✅ |
| OIDC push | ✅ |
| lease | ✅ |
| sync metadata | ✅ 200 hilos |
| 0 bodies persisted | ✅ |
| `email_account` productiva | ✅ |
| `users.watch` iniciado **al final** | ✅ |
| `historyId` + `expiration` guardados | ✅ |
| Scheduler renewal listo | ✅ |
| security review | ✅ |
| regression | ✅ |
| CI | ✅ |

**Dieciséis de dieciséis.**

---

# PHASE 9 — EMAILS · ENTREGA 3 = CLOSED

Deudas conocidas, **no bloqueantes**: retry/backoff Gmail 429/5xx · throttling
del full resync · retención de `email_sync_log`.

Gmail no se leyó ni se mutó salvo `users.watch`. No se envió correo, no se
abrió ningún cuerpo, no se tocó ninguna etiqueta.
