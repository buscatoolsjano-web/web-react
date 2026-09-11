# Fase 9 · Emails — Entrega 0: auditoría del legacy y del estado actual

**Esta entrega no programó, no creó tablas, no ejecutó migraciones, no modificó
datos, no tocó el legacy, no cambió credenciales y no envió, marcó, movió ni
borró ningún email.** Todo lo que sigue sale de lectura estática del bundle,
consultas `SELECT` sobre el Supabase legacy, lectura de los escenarios de
Make y un respaldo de sólo lectura.

Fecha de la auditoría: **2026-09-11**.

> **Nota de seguridad sobre este documento.** Se encontraron cinco credenciales.
> Ninguna se transcribe acá: se identifican por tipo, ubicación, prefijo parcial
> y riesgo. Tampoco se copia el contenido de ningún email; todo lo relativo a
> datos personales está agregado o hasheado.

---

## A · Resumen ejecutivo

El módulo de Emails del legacy es **una bandeja de entrada de solo-lectura con
estado de trabajo encima**, no un cliente de correo. Funciona así:

```
Gmail info@buscatools.com.ar
      │  (Make.com, escenario "ERP | Gmail info@ → Supabase")
      │  3 veces por día · 09:00, 13:00, 17:00 · máx. 25 mails por corrida
      ▼
Supabase legacy · tabla erp_emails  (976 filas, 65 MB, ventana de 5 semanas)
      │  PostgREST directo desde el navegador, con la anon key del bundle
      ▼
Bundle legacy · _emailsLoadList()  → 200 filas, 766 kB por request
      │  recargado ENTERO cada 60 segundos por el badge
      ▼
Bandeja en el navegador
```

Y para responder:

```
Bandeja → webhook de Make (URL fija en el bundle, sin autenticación) → Gmail
```

**Lo que realmente resuelve:** que el equipo vea los mails de `info@` sin entrar
a Gmail, se los asigne entre ellos y marque en qué estado están. Eso es todo, y
lo hace.

**Lo que no es:** no hay borradores, no hay reenviar, no hay responder a todos,
no hay CC ni BCC, no hay firmas, no hay plantillas, no hay búsqueda real, no hay
carpetas, no hay papelera, no hay hilos de Gmail bien armados y no hay ninguna
relación con clientes, ventas ni compras.

### Los seis hallazgos que importan

| # | hallazgo | gravedad |
|---|---|---|
| 1 | **Cualquiera puede escribir en la bandeja sin autenticarse.** Dos caminos independientes: la policy `make_insert` es `FOR INSERT WITH CHECK (true)` a `PUBLIC`, y la RPC `insert_email` es `SECURITY DEFINER` con `EXECUTE` a `PUBLIC`. Con la anon key —que está en el bundle— se puede inyectar un email falso en `info@`. | **CRÍTICA** |
| 2 | **`anon` tiene `arwdDxtm` sobre `erp_emails`**: leer, escribir, borrar y truncar las 976 filas. Y las policies de Storage sobre `email-attachments` no miran el rol: cualquiera lee, sube, pisa y **borra** los 479 adjuntos. El bucket además es **público**. | **CRÍTICA** |
| 3 | **El badge recarga la bandeja entera cada 60 segundos**: 766 kB por request, de los cuales **716 kB son `body_text` que la lista no muestra**. Son **~46 MB/hora** por usuario con la app abierta, esté o no en Emails, esté o no visible la pestaña. | **ALTA** |
| 4 | **El correo entra 3 veces por día, un minuto cada vez, máximo 25 mails.** La bandeja puede estar hasta 4 horas atrasada y, con más de 25 mails en una ventana, **se pierden silenciosamente**. | **ALTA** |
| 5 | **El control de acceso es puramente de frontend.** Todos los usuarios se bajan los 976 emails y después el JavaScript filtra cuáles dibuja. La pantalla «🔐 Control de acceso» no restringe nada en la base. | **ALTA** |
| 6 | **`erp_emails` no es el histórico**: cubre del 2026-08-03 al 2026-09-07. Gmail sigue siendo el archivo real. | informativa, pero **define toda la estrategia** |

### La decisión que se desprende

`erp_emails` es **caché, no archivo**. Lo único que existe sólo ahí es el estado
de trabajo: **186 filas** con algo distinto del default, y de esas **91** llevan
`status`/`assignee` de verdad (las otras 95 sólo tienen `is_read`).

Eso apunta con bastante claridad a la opción **C — índice de metadata + cuerpo
bajo demanda**, no a un espejo completo. Está desarrollado en **AG**.

---

## B · Arquitectura del legacy

El módulo vive en `app.js`, líneas **40293–42168** (~1.875 líneas, 61
funciones), más piezas repartidas: el badge en 37264, las notificaciones en
37138, la IA en 12487–12534 y 44245–44420, las etiquetas en 43898–43960.

No hay backend propio. El navegador habla **directo** con PostgREST del proyecto
legacy usando la anon key y un header `x-erp-token`, ambos incrustados en el
bundle. Make.com es el único componente server-side, y está afuera.

---

## C · Proveedor

**Gmail, a través de Make.com.** Verificado en el escenario, no inferido.

| | |
|---|---|
| Proveedor real | **Gmail** (`google-email:TriggerNewEmail`, conexión `google-restricted`) |
| Cuenta | `MAIL INFO@BUSCATOOLS (info@buscatools.com.ar)`, conexión Make `1826051` |
| Carpeta | `INBOX`, criterio `ALL` |
| Orquestador | **Make.com**, organización BUSCATOOLS (`2223199`), equipo `169294`, zona `us2` |
| `markSeen` | **`false`** — el ERP **no** marca leído en Gmail |
| Tope por corrida | **25** mails |
| Frecuencia | cada 60 s **pero restringido** a 09:00–09:01, 13:00–13:01, 17:00–17:01 |

**No hay Gmail API directa, ni IMAP, ni SMTP, ni Microsoft Graph, ni STEL, ni
worker propio, ni webhook de proveedor, ni push, ni `watch`.** El ERP nunca
habla con Gmail: habla con Supabase, y Make llena Supabase.

### Escenarios de Make relacionados

| id | nombre | estado | disparo |
|---|---|---|---|
| 5856917 | `ERP \| Gmail info@ → Supabase` | **activo** | 3 ventanas/día |
| 5856923 | `ERP \| Reply Webhook → Gmail + Supabase` | **activo** | webhook, inmediato |
| 6036490 | `AT-BACKFILL \| Mails 14-24 ago → Supabase (temporal)` | activo | on-demand |
| 6060632 | `ERP \| Enviar Cotización/Pedido → Gmail` | activo | inmediato |
| 4741405 | `AT-MAILS \| Carga automatica mails clientes` | activo | cada 3 h |
| 4804789 | `AT-COTIZADOR \| Mails info@ → Firebase` | activo | cada 3 h |
| 5290238 | `ERP - Enviar email Gmail` | **parado** | — |
| 4741527 | `AT-MAILS \| Marcar CONTESTADO al responder` | **parado** | — |

El backfill temporal explica la ventana de fechas: alguien cargó a mano el tramo
del 14 al 24 de agosto.

> Hay un segundo consumidor de `info@` —`AT-COTIZADOR → Firebase`— que está
> **fuera del alcance de esta fase** y no se tocó. Queda anotado porque, si
> algún día se cambia la cuenta o los permisos de Gmail, también se rompe.

---

## D · Cuentas de email

**Una sola.** `info@buscatools.com.ar`, de la empresa **buscatools**.

Las 976 filas tienen `empresa = 'buscatools'`; no hay ni una de torquetools. El
badge además se apaga explícitamente si la empresa activa no es la default, con
el comentario *«Multi-empresa: sin bandeja propia todavía»*.

**No existe ningún concepto de buzón, cuenta ni mailbox en el modelo de datos.**
`to_email` está **hardcodeado** en el escenario de Make al literal
`info@buscatools.com.ar`: no sale del mail, se escribe fijo. Multiempresa y
multi-cuenta son, hoy, cero.

---

## E · Credenciales

Cinco. **Ningún valor se transcribe.**

| # | nombre | ubicación | la lee | la escribe | ¿expuesta al browser? | clasificación |
|---|---|---|---|---|---|---|
| 1 | Supabase **anon/publishable key** (`sb_publishable_70D…`) | `SUPA_KEY`, bundle línea 1177 | bundle, Make | — | **sí, por diseño** | **PUBLICABLE** — pero con la RLS actual es la puerta de entrada |
| 2 | **`SUPA_APP_TOKEN`** (`bterp_Klq…`) | `SUPA_APP_TOKEN`, bundle línea 1182; header `x-erp-token` | `erp_valid_token()` | — | **sí** | **SECRET — expuesto**. Es el mismo que el `x-suite-key` de WhatsApp |
| 3 | **`x-erp-token` de Make** (`bterp_8Gx…prod26`) | headers de los escenarios 5856917 / 5856923 | *nadie* (ver abajo) | — | no | **SECRET** — guardado bien, pero **no coincide con el de la base** |
| 4 | **Webhook de reply** (`hook.us2.make.com/1g5qq…`) | `MAKE_URL`, bundle línea ~40726 | Make | — | **sí** | **SECRET — expuesto**. La URL *es* la autenticación |
| 5 | **Webhook de reply (viejo)** (`hook.us2.make.com/uggyr…`) | default de `erp_emails_webhook_reply`, bundle línea 41035 | Make | localStorage | **sí** | **SECRET — expuesto** |

**Los tokens de OAuth de Gmail no están en ningún lado del ERP.** Viven dentro
de Make, en la conexión `google-restricted`. Eso está **bien resuelto** y es lo
único de esta lista que no hay que arreglar: el refresh token nunca toca el
navegador ni la base.

### El detalle del token que no coincide

`erp_valid_token()` compara el header contra un valor fijo. **El valor que manda
Make no es ese.** Es decir: las llamadas de Make **no pasan** la policy de token.
Funcionan igual por dos motivos separados —la policy `make_insert` abierta y la
RPC `SECURITY DEFINER` pública— que son exactamente los agujeros del hallazgo 1.
Dicho de otro modo: **el agujero no es un descuido, es lo que sostiene la
ingesta**. Cerrarlo sin arreglar Make primero rompe la entrada de correo.

### Qué invalida qué

Borrar el token del bundle **no sirve**: el bundle ya publicado sigue en el
caché de los navegadores y en el historial. Lo único que invalida el valor
expuesto es **rotarlo**. Lo mismo para las dos URLs de webhook: la forma de
invalidarlas es **regenerar el hook en Make**.

**No se rotó nada en esta entrega, como se pidió.**

---

## F · Pantallas

| pantalla | función | origen | estado |
|---|---|---|---|
| Bandeja (lista + hilos) | `renderEmailsLista` | `_emailsCache` (200 filas) | **REAL** |
| Detalle del email | `renderEmailDetalle` | `_emailsLoadOne(id)` → `select=*` | **REAL** |
| Hilo (timeline) | `_emailsLoadAndRenderThread` | `erp_emails?thread_id=eq.` | **PARCIAL** — ver K |
| Responder | `_emailsDoReply` → `_emailsSendReply` | webhook de Make | **REAL** |
| Nuevo email | `_emailsNuevoModal` | webhook de Make | **REAL**, muy limitado |
| Spam por remitente | `_emailsMarkSenderSpam` | localStorage + `erp_store` | **REAL** |
| Configuración | `renderEmailsConfig` | localStorage | **PARCIAL** — el texto miente (ver O) |
| Control de acceso | `_emailsSaveAccess` / `_emailsCanSee` | localStorage + `erp_store` | **PLACEHOLDER de seguridad** — filtra en el navegador |
| Reglas de auto-asignación | `renderEmailsRules` | `erp_email_rules` | **CÓDIGO MUERTO** — la tabla tiene **0 filas** |
| Etiquetas | `_labelsLoad` / `_labelsComputeForEmail` | localStorage | **CÓDIGO MUERTO** — **0 filas** con labels |
| Forzar sincronización | `_emailsForceSync` | URL en localStorage | **PLACEHOLDER** — sin URL configurada no hace nada |
| Notificación de asignado | `_notifCheckEmailsNuevos` | `_emailsCache` | **REAL** |

### Lo que se buscó y NO existe

Borradores · papelera · archivados como carpeta real · reenviar · responder a
todos · CC · BCC · firmas · plantillas · autocompletado de destinatarios ·
adjuntar desde el CRM · búsqueda del lado del servidor · paginación real ·
carpetas de Gmail · sincronización de leído con Gmail.

De la lista del punto 3 del pedido, lo único que existe de verdad es: **bandeja
de entrada, enviados (4 mails), spam (propio, no el de Gmail), hilos (rotos),
respuesta, composición, adjuntos (de bajada), asociación con clientes (columna
vacía) e IA.**

---

## G · Funciones

61 en el bloque principal. Las que tocan datos:

| función | qué hace | efecto |
|---|---|---|
| `_emailsLoadList(force)` | `GET erp_emails` 200 filas | **lee 766 kB** |
| `_emailsLoadOne(id)` | `GET …?id=eq.&select=*` | lee el `body_html` entero |
| `_emailsPatch(id,data)` | `PATCH erp_emails` | **escribe** |
| `_emailsDelete(id)` | `DELETE erp_emails` | **borra, definitivo** |
| `_emailsSendReply(...)` | `POST` al webhook de Make | **envía correo** |
| `_emailsFetchBadge()` | llama a `_emailsLoadList(true)` | **lee 766 kB cada 60 s** |
| `_emailsMarkSenderSpam` | `PATCH` en bucle, uno por email | **escribe N veces** |
| `_aiEmailsLoadFullIndex()` | pagina **todo** `erp_emails` (metadata) | lee ~150 kB |
| `_aiEmailsFetchFullBody(id)` | `select=*` por cada mail relevante | lee hasta 10 cuerpos |

---

## H · Datos

Medido, no estimado. Fuente: `erp_emails`, 2026-09-11.

| | |
|---|---|
| **Filas totales** | **976** |
| Rango de fechas | **2026-08-03 → 2026-09-07** (5 semanas) |
| Entrantes | 972 |
| **Salientes** | **4** |
| Hilos distintos (`thread_id`) | 811 |
| No leídos | **873** |
| Leídos | 103 |
| Con `body_html` | 755 |
| Con `body_text` | 966 |
| Con `snippet` | **0** |
| Con adjuntos guardados | 271 |
| Marcados `has_attachments` | 297 |
| Con etiquetas | **0** |
| Con `related_cliente` | **0** |
| Con `cc` / `reply_to` / `notes` | **0 / 0 / 0** |
| Empresa | `buscatools` = 976 · `torquetools` = 0 |

Por estado: `sin_responder` 899 · `spam` 67 · `en_proceso` 5 · `enviado` 4 ·
`resuelto` 1. Por asignación: **953 sin asignar**, JUAN 16, ADMIN 4, JANO 2,
FACUNDO 1.

**Producción / test / no determinado:** las 976 son de producción. No se
encontró ni una fila de prueba. La única anomalía es el tramo cargado por el
backfill del 14 al 24 de agosto, que también es correo real.

---

## I · Supabase legacy

Se buscaron tablas con `email|mail|inbox|thread|attach|smtp|gmail|message|msg`.

| tabla | filas | total | RLS | uso |
|---|---|---|---|---|
| `erp_emails` | **976** | **65 MB** | sí | **en uso** |
| `erp_email_rules` | **0** | 24 kB | sí | **vacía** — código muerto |
| `erp_whatsapp_messages` | 0 | 48 kB | sí | fuera de alcance |
| `messages` | 0 | 40 kB | sí | vacía |

Más el bucket de Storage **`email-attachments`**: **público**, 479 objetos,
**89 MB**, límite 25 MB por archivo.

Y `erp_store`, que no es de emails pero lleva tres claves del módulo:
`erp_emails_spam`, `erp_emails_access` y `erp_email_labels`.

### Privilegios y policies

```
erp_emails       anon=arwdDxtm   authenticated=arwdDxtm   ← CRUD + TRUNCATE
erp_email_rules  anon=arwdDxtm   authenticated=arwdDxtm
```

```sql
-- erp_emails
erp_app_token   ALL     USING erp_valid_token()   WITH CHECK erp_valid_token()
make_insert     INSERT  USING —                   WITH CHECK true        ← a PUBLIC
```

Las policies se combinan con **OR**: `make_insert` anula la protección del token
para cualquier `INSERT`.

```sql
-- storage.objects
email_attachments_all     ALL     bucket_id = 'email-attachments'   ← sin mirar el rol
email_attachments_select  SELECT  bucket_id = 'email-attachments'
email_attachments_delete  DELETE  bucket_id = 'email-attachments'
```

Y `insert_email` es `SECURITY DEFINER` con `EXECUTE` a `PUBLIC`.

> **No se ejecutó ningún INSERT, UPDATE ni DELETE para comprobarlo.** Es
> demostrable leyendo la definición de las policies y el ACL; probarlo habría
> significado escribir en producción.

---

## J · `erp_emails` — dónde están los 65 MB

| parte | tamaño |
|---|---|
| Total | **65 MB** |
| Heap (la tabla en sí) | 1.096 kB |
| Índices | 384 kB |
| **TOAST** | **63 MB** |

Y dentro del TOAST:

| columna | total | filas |
|---|---|---|
| **`body_html`** | **68 MB** | 755 |
| `body_text` | 4.090 kB | 966 |
| `attachments` (jsonb) | **75 kB** | 271 |
| `snippet` | 31 kB | 0 |

(El total por columna supera el TOAST porque Postgres comprime antes de
guardar.)

**El 98 % de la tabla es `body_html`.** Todo lo demás —metadata, índices,
adjuntos, estado— entra en 1,5 MB.

---

## K · Hilos

`thread_id` viene del `threadId` de Gmail, que es un identificador de
conversación real: **no hace falta agrupar por asunto, y el legacy no lo hace**.
`_emailsGroupThreads` agrupa por `thread_id`, con `id` como respaldo.

811 hilos para 976 mensajes → 1,2 mensajes por hilo. La conversación con más
mensajes no llega a un puñado.

### El bug del hilo

Make guarda el `thread_id` de los entrantes en **base64**. El bundle, cuando
guarda una respuesta enviada, lo guarda **en claro**:

```js
thread_id: _b64d(_emailsOpenData.thread_id) || null   // ← decodificado
```

Medido: **970 de 972** entrantes tienen `thread_id` con pinta de base64; **los 4
salientes, ninguno**.

Consecuencia: **una respuesta enviada nunca se agrupa con el hilo que
responde.** Aparece como un hilo suelto. Con 4 salientes el daño es invisible
hoy, pero el defecto está.

---

## L · Modelo real del email

Nombres reales de la tabla. **Cargado** = lo llena el pipeline.

| columna | tipo | cargado | nota |
|---|---|---|---|
| `id` | uuid | sí | PK |
| `gmail_id` | text | 972/976 | **UNIQUE** — la clave de idempotencia |
| `thread_id` | text | sí | base64 en entrantes, claro en salientes |
| `from_email` | text | sí | **base64** |
| `from_name` | text | sí | **base64** |
| `to_email` | text | sí | **en claro y hardcodeado** a `info@…` |
| `cc` | text | **0** | existe, nunca se llena |
| `reply_to` | text | **0** | existe, nunca se llena |
| `subject` | text | sí | **base64** |
| `body_text` | text | 966 | **base64** |
| `body_html` | text | 755 | **base64** |
| `snippet` | text | **0** | el módulo de Gmail de Make no lo entrega |
| `date` | timestamptz | sí | la fecha del proveedor |
| `has_attachments` | boolean | sí | 26 en `true` sin adjunto guardado |
| `attachments` | jsonb | 271 | `[{filename, mimeType, url}]` |
| `labels` | text[] | **0** | |
| `is_read` | boolean | sí | **local, no se sincroniza con Gmail** |
| `status` | text | sí | CHECK de 6 valores |
| `assignee` | text | 23 | texto libre con el nombre del usuario |
| `notes` | text | **0** | |
| `related_cliente` | text | **0** | el enganche con el CRM que nunca se usó |
| `created_at` / `updated_at` | timestamptz | sí | |
| `direction` | text | sí | `inbound` / `outbound` |
| `empresa` | text | sí | siempre `buscatools` |

**No hay `bcc`. No hay `message-id` de internet. No hay `in-reply-to`. No hay
`references`. No hay headers.**

### El base64 no es cifrado

Está para que Make pueda meter texto arbitrario en un JSON sin romperlo. No
protege nada: `from_email`, `subject` y los cuerpos son legibles con una función
de una línea. **A efectos de privacidad, la tabla está en claro.**

---

## M · HTML y XSS

El cuerpo se dibuja en un `<iframe srcdoc>`:

```html
<iframe sandbox="allow-same-origin allow-popups" srcdoc="…">
```

**No hay `allow-scripts`**, así que hoy **no se ejecuta JavaScript**. No hay
DOMPurify ni ninguna sanitización: la defensa es el `sandbox`, y alcanza.

Medido sobre los 755 cuerpos HTML:

| | |
|---|---|
| Con `<script>` | **4** |
| Con `<iframe>` | 0 |
| Con manejadores inline (`onclick=`…) | 0 |
| Con imagen remota | **590** |

**Los 4 con `<script>` son la advertencia que importa.** Hoy son inertes. El día
que alguien dibuje ese mismo HTML sin el sandbox —un `dangerouslySetInnerHTML`
en la migración a React sería suficiente— se ejecutan. **Ya hay contenido
hostil guardado en la base esperando un renderizador descuidado.**

Riesgo actual: **BAJO**. Riesgo si se migra sin cuidado: **ALTO**.

Detalle menor: `allow-same-origin` combinado con `srcdoc` pone el iframe en el
mismo origen que la app. Sin `allow-scripts` es inofensivo, pero las dos
banderas **nunca** deben viajar juntas.

---

## N · Imágenes remotas y tracking

**No hay ningún bloqueo.** Al abrir un email —o al desplegar un mensaje del
hilo— el iframe carga todo lo externo: imágenes, pixeles y fuentes. No se
proxifica, no se bloquea, no se pregunta.

| | |
|---|---|
| Cuerpos con imagen remota | **590 de 755 (78 %)** |
| Con algo de 1 píxel (probable tracking) | **275** |

Cada vez que alguien abre uno de esos mails, **el remitente se entera**: cuándo
se abrió, desde qué IP y con qué navegador. Para correo comercial entrante eso
es exactamente lo que los pixeles vienen a medir.

---

## O · Envío

```
_emailsDoReply / _emailsNuevoModal
   → _emailsSendReply()
   → POST https://hook.us2.make.com/1g5qq…   ← URL fija en el bundle, SIN auth
   → escenario "ERP | Reply Webhook → Gmail + Supabase"
   → Gmail (conexión OAuth de Make)
```

**No se ejecutó ningún envío.** Lo que sigue sale de leer el código y el
escenario.

| capacidad | estado |
|---|---|
| Nuevo email | **sí** — un destinatario, asunto, texto plano |
| Responder | **sí** |
| Responder a todos | **no existe** |
| Reenviar | **no existe** |
| Adjuntos | **sí** — base64 en el POST |
| CC / BCC | **no existen** |
| HTML | **no** — el texto se envuelve en un `<div>` con `<br>` |
| Firma | **no existe** |

### Dos defectos del envío

**1 · La pantalla de configuración miente.** Dice *«Envío configurado con Resend
— Supabase Edge Function»*. El comentario del propio código dice que Resend se
descartó porque el dominio nunca se verificó y devolvía 403. El mensaje de error
al usuario también manda a *«revisá los logs de la Edge Function send-email»*,
que no existe.

**2 · El `PATCH` posterior al envío siempre falla.** Tras enviar:

```js
_emailsPatch(id, { status: 'respondido', … })
```

`respondido` **no está** en el CHECK (`sin_responder`, `en_proceso`, `resuelto`,
`archivado`, `enviado`, `spam`). El `PATCH` devuelve error, `_emailsPatch` lo
traga y sólo lo escribe en la consola. **Confirmado en los datos: 0 filas con
`status = 'respondido'`.** Responder un mail no cambia su estado.

**3 · La URL del webhook es la credencial.** No lleva firma ni header. Cualquiera
que abra el bundle puede mandar correo desde `info@buscatools.com.ar` a quien
quiera. Es el mismo patrón que la entrega 0.5 encontró en WhatsApp.

---

## P · Borradores

**No existen.** Ni en el proveedor, ni en Supabase, ni en localStorage, ni en
estado del navegador. No hay ni una aparición de `draft` o `borrador` en el
módulo.

Si se cierra el modal de «Nuevo email» a medio escribir, **se pierde el texto**.

La pregunta de si dos empleados se pisan el mismo borrador no aplica: no hay
borradores que pisar.

---

## Q · Acciones: archivar, papelera, spam

| acción | ¿existe? | actúa sobre |
|---|---|---|
| Archivar | `status='archivado'` en el CHECK, **pero ningún botón lo escribe** | — |
| Papelera | **no existe** |  |
| Eliminar | **sí** — `DELETE` a `erp_emails` | **sólo Supabase** |
| Spam | **sí** — por remitente | **sólo Supabase + localStorage** |
| Restaurar de spam | **sí** | sólo Supabase |

**Ninguna acción toca Gmail.** Marcar spam en el ERP no marca spam en Gmail;
borrar en el ERP no borra en Gmail. Son dos mundos separados, y como Make
reimporta con criterio `ALL`, **un email borrado del ERP puede volver a entrar**
si cae en una ventana de sincronización.

El borrado es `DELETE` físico, sin papelera y sin vuelta atrás, restringido a
los superusuarios del módulo por una comprobación de frontend.

---

## R · Leído / no leído

**Abrir un email no lo marca como leído.** No hay ningún `is_read: true` en el
camino de apertura. Los únicos tres lugares donde se escribe son: el botón
explícito «marcar como no leído», el envío de una respuesta y la creación de un
email nuevo.

Eso explica el dato: **873 de 976 sin leer**. El badge muestra un número que
nadie puede bajar salvo respondiendo.

Y el estado es **por email, no por usuario**: si Juan marca uno, se marca para
todos. No hay noción de lectura individual.

`markSeen: false` en Make confirma la otra mitad: **el ERP tampoco marca leído
en Gmail**. Las dos bandejas llevan contadores independientes.

---

## S · Polling

```js
setInterval(function(){
  if (state.user && typeof _emailsFetchBadge === 'function') _emailsFetchBadge();
}, 60000);                                              // app.js:37264
```

| | |
|---|---|
| Frecuencia | **cada 60 s** |
| Arranca | al cargar la app, con un primer disparo a los 800 ms |
| Se detiene | **nunca**, mientras haya sesión |
| ¿Depende de la pestaña visible? | **no** |
| ¿Depende de estar en Emails? | **no** |
| Qué pide | `_emailsLoadList(true)` — **la lista entera, 200 filas** |
| ¿Trae `body_text`? | **sí** |
| ¿Trae `body_html`? | no |
| ¿Trae adjuntos? | no |

Única puerta: si la empresa activa no es buscatools, sale temprano.

**Es un `SELECT` de 200 filas con los cuerpos de texto para pintar un número
en un badge.**

Y hay un segundo temporizador, ajeno al módulo pero que corre siempre:
`_supaPoll` cada **30 s** trae `erp_store` completo (30 claves, **1.279 kB**),
donde viajan la lista de spam, las reglas de acceso y las etiquetas de emails.

---

## T · Realtime y webhooks

**No hay Realtime.** Ni una suscripción a `erp_emails`. Todo es polling.

**No hay webhook de proveedor.** Ni Gmail push, ni `watch`, ni suscripción de
Graph, ni IMAP IDLE. El correo entra **sólo** cuando Make corre, tres veces por
día.

El único webhook del módulo es el de **salida** (bandeja → Make → Gmail).

### La consecuencia del punto 4

Con `maxResults: 25` y tres corridas diarias, el techo es **75 emails por día**.
Con 976 mails en 5 semanas el promedio ronda los 28 diarios, así que hoy no se
está perdiendo nada — **pero el margen es de menos de 3×**, y una tanda de más
de 25 mails entre dos ventanas se pierde **sin ningún aviso**: el escenario no
lleva cursor, toma los 25 más recientes y sigue.

---

## U · Egress

Medido sobre las filas reales; son bytes de contenido, antes de la sobrecarga
de JSON de PostgREST y sin descontar gzip.

| escenario | requests/min | por request | por hora |
|---|---|---|---|
| App abierta, **sin** entrar a Emails | 1 (badge) | **766 kB** | **~46 MB** |
| App abierta con la pestaña **oculta** | 1 | 766 kB | **~46 MB** (no se detiene) |
| Bandeja de Emails abierta | 1 | 766 kB | ~46 MB |
| Abrir un email | +1 por apertura | ~100 kB (`select=*`, `body_html` medio 92 kB) | según uso |
| Desplegar un mensaje del hilo | +1 por mensaje | ~100 kB | según uso |
| Pregunta a la IA sobre emails | +1 índice +N cuerpos | ~150 kB + hasta 10 × 100 kB | según uso |
| *(fuera del módulo)* `erp_store` | 2 | 1.279 kB | **~150 MB** |

**De los 766 kB del badge, 716 kB (93 %) son `body_text` que la lista no
muestra.** El listado dibuja remitente, asunto y un extracto; el extracto sale
de `snippet`, que está **vacío en las 976 filas**, y por eso alguien agregó
`body_text` al `select`. Se arrastra el cuerpo entero de 200 mails para mostrar
las primeras palabras de cada uno.

Con cinco personas trabajando ocho horas: **~1,8 GB/día** sólo por el badge de
emails. No se optimizó nada en esta entrega.

---

## V · Multiusuario

| situación | qué pasa hoy |
|---|---|
| Dos empleados abren la bandeja | **los dos se bajan los 976 emails completos** |
| Uno marca leído | se marca **para todos** |
| Uno se asigna un email | `assignee` es un campo único; **el último `PATCH` gana**, sin bloqueo ni aviso |
| Dos responden el mismo email | **se envían las dos respuestas**; no hay nada que lo impida |
| Uno marca spam a un remitente | se aplica **para todos**, y hace un `PATCH` por cada email afectado |
| Uno borra un email | **desaparece para todos**, sin papelera |
| Borradores | no hay |

No hay bloqueos, no hay control de concurrencia y no hay auditoría de quién
hizo qué.

---

## W · Multiempresa

**No hay modelo.** `empresa` es una columna de texto con un único valor en las
976 filas, y `to_email` está escrito fijo en Make.

El badge ya trae un parche: se esconde si la empresa activa no es la default,
con el comentario *«sin bandeja propia todavía»*. Es decir, **el legacy sabe que
no soporta multiempresa y lo esquiva**.

---

## X · Vínculo con el CRM

**Hoy: cero.** `related_cliente` está vacía en las 976 filas. No hay
autocompletado, no hay vínculo manual, no hay nada.

### Cuánto se podría vincular

Se midió cruzando los remitentes reales contra los **1010 clientes** y **87
contactos** del proyecto nuevo. El cruce se hizo **por hash**: las direcciones
nunca salieron de su base.

De los 971 entrantes, **320 son internos** (`@buscatools…`). Quedan **651 mails
externos de 171 remitentes distintos**:

| clasificación | remitentes | emails | % de los externos |
|---|---|---|---|
| **EXACT EMAIL** (una dirección, un cliente) | 17 | **135** | **20,7 %** |
| **DOMAIN UNIQUE** (dominio de un solo cliente) | 25 | 57 | 8,8 % |
| **AMBIGUOUS** (dominio compartido) | 8 | 30 | 4,6 % |
| EXACT pero apuntando a varios clientes | 1 | 1 | 0,2 % |
| **NO MATCH** | 120 | **428** | **65,7 %** |

**Conclusión honesta: el vínculo automático por email exacto resuelve 1 de cada
5 mails externos.** Es poco, pero es sólido y no se equivoca. Sumar el dominio
llevaría a ~30 %, con el riesgo que marca el punto 33 del pedido: **hay 8
remitentes cuyo dominio corresponde a más de un cliente**, así que el dominio no
se puede aplicar a ciegas.

El 66 % restante son mayormente proveedores, newsletters y remitentes que
simplemente no están en el CRM. **No hay forma de vincularlos y no hay que
forzarlo.**

---

## Y · Relación con Ventas y Compras

**No existe ninguna.** Se buscó en todo el bloque del módulo: no hay forma de
abrir una cotización, un pedido, un remito ni una factura desde un email, ni de
crear un documento a partir de uno, ni de adjuntar un email a un cliente o a un
documento. Tampoco del lado de proveedores, pedidos de compra, recepciones ni
facturas de proveedor.

Clasificación: **NO EXISTE** en ambos casos.

(Sí existe el camino inverso, fuera de este módulo: el escenario
`ERP | Enviar Cotización/Pedido → Gmail` manda documentos por mail. No lee la
bandeja.)

---

## Z · IA

Es la integración más profunda del módulo, y la que más datos mueve.

```
pregunta del usuario
  → _emailsLoadList()            200 mails: remitente, asunto, extracto, estado
  → _aiEmailsLoadFullIndex()     TODO el histórico (id, fecha, remitente, asunto)
  → _aiEmailsPickRelevantIds()   paso semántico en el Worker
  → _aiEmailsFetchFullBody()     hasta 10 CUERPOS COMPLETOS, 6.000 caracteres c/u
  → POST https://buscatools-ai.buscatools-jano.workers.dev  → OpenAI
```

| | |
|---|---|
| Qué se manda | remitente, asunto y **cuerpo completo** de correo real de clientes |
| Dónde está el token | en el Worker de Cloudflare, **no en el frontend** |
| ¿Llama desde el frontend? | **sí**, al Worker; el Worker llama a OpenAI |
| ¿Guarda el resultado? | no |
| Acciones | `asignar_email` — la IA puede cambiar `assignee` y `status` |

**No se ejecutó ninguna llamada de IA en esta auditoría.**

Lo que hay que anotar sin dramatizarlo: **correspondencia comercial de clientes
identificables sale hacia un tercero**. El token está bien guardado; el problema
no es la credencial, es el dato. Hoy no hay aviso al usuario ni registro de qué
se envió.

El `WORKER_SECRET` de ese mismo Worker **fue rotado en la entrega 0.5**, así que
por ese lado está cubierto.

---

## AA · Firmas y plantillas

**No existen ni una ni otra.** Se buscó `firma`, `signature`, `plantilla`,
`template` en todo el módulo: las únicas apariciones son detección de adjuntos
S/MIME (`application/pkcs7-signature`) y `grid-template-columns` de CSS.

Los mails salen sin firma. El HTML que se manda es un `<div>` con el texto y
`<br>`.

**Etiquetas**, que serían lo más cercano a plantillas de clasificación, existen
como código (`erp_email_labels` en localStorage, reglas de coincidencia,
auto-asignación) pero **con 0 datos**. Y **reglas de auto-asignación** tienen su
tabla, su ABM y su pantalla, con **0 filas**.

Las tres son **CÓDIGO MUERTO**: construidas, nunca usadas.

---

## AB · Seguridad — resumen

| # | hallazgo | clasificación |
|---|---|---|
| 1 | `make_insert` = `INSERT WITH CHECK (true)` a `PUBLIC` → **escritura anónima en la bandeja** | **CRÍTICA** |
| 2 | `insert_email` es `SECURITY DEFINER` con `EXECUTE` a `PUBLIC` → **segunda vía, independiente** | **CRÍTICA** |
| 3 | `anon` con `arwdDxtm` sobre `erp_emails` → leer, modificar, **borrar y truncar** | **CRÍTICA** |
| 4 | `email_attachments_all` sin mirar el rol → **anon borra los 479 adjuntos** | **CRÍTICA** |
| 5 | Bucket `email-attachments` **público**, URLs permanentes sin token | **ALTA** |
| 6 | Webhook de envío sin autenticación en el bundle → **cualquiera manda correo como `info@`** | **ALTA** |
| 7 | `SUPA_APP_TOKEN` publicado en el bundle (el mismo de WhatsApp) | **ALTA** |
| 8 | Control de acceso sólo en el frontend: **todos se bajan todo** | **ALTA** |
| 9 | 4 cuerpos con `<script>` guardados; hoy inertes por el `sandbox` | **MEDIA** (alta si se migra mal) |
| 10 | Imágenes remotas y pixeles sin bloquear en 590 de 755 cuerpos | **MEDIA** (privacidad) |
| 11 | Cuerpos completos de clientes enviados a OpenAI vía Worker | **MEDIA** (privacidad) |
| 12 | `body_html` sin sanitizar en la base | **MEDIA** |

Los puntos 1 a 5 son **peores que el `LEGACY PUBLIC TOKEN SURFACE`** que dejó
abierto la entrega 0.5 de WhatsApp: ahí el token al menos se pedía. Acá, para
escribir, **no se pide nada**.

**No se corrigió nada.** Hace falta una decisión, y está en AI.

### Privacidad — dónde vive el dato personal

| dato | dónde |
|---|---|
| Nombre y dirección del remitente | `erp_emails.from_name` / `from_email` (base64) |
| Cuerpo completo de la correspondencia | `body_html` / `body_text` (base64) — **68 MB** |
| Adjuntos (facturas, remitos, documentos) | bucket **público** `email-attachments`, 89 MB |
| Fechas y horas de comunicación | `date`, `created_at`, `updated_at` |
| Quién atiende a quién | `assignee` |
| Copia local | el navegador de cada usuario, 976 mails en memoria |
| Copia en un tercero | fragmentos de cuerpo en OpenAI, vía el Worker |
| Respaldo nuevo | `C:\Users\janog\backups-legacy\emails-2026-09-11\` (fuera del repo) |

**No hay headers, ni `bcc`, ni `message-id` almacenados.**

---

## AC · Caché y deduplicación

### Deduplicación: funciona

`erp_emails.gmail_id` tiene **UNIQUE**, y la ingesta pasa por `insert_email` con
ese id. Medido: **0 `gmail_id` duplicados**. Los únicos 4 nulos son los
salientes, que no tienen id de Gmail.

El `gmail_id` es hoy **la única clave de idempotencia**, y es suficiente mientras
haya un solo buzón. Con dos cuentas habría que acotarla por cuenta, igual que se
hizo con el `wamid` en WhatsApp.

**No hay `message-id` de internet guardado**, que sería la clave estable entre
proveedores. Si algún día se migra de Gmail, la deduplicación se rompe.

### Caché

| qué | dónde | invalidación |
|---|---|---|
| Lista de 200 | `_emailsCache` (memoria) | `force=true` desde el badge, cada 60 s |
| Mensajes del hilo | `_emailsThreadMsgCache` | al salir de la sección |
| Índice de la IA | `_aiEmailsFullIndex` | 10 minutos |
| Lista de spam | `localStorage` + `erp_store` | poll de 30 s |
| Reglas de acceso | `localStorage` + `erp_store` | poll de 30 s |
| Etiquetas | `localStorage` | nunca sincroniza |

**`body_html` no se cachea**: se vuelve a bajar en cada apertura.

---

## AD · Performance

### SQL

| consulta | problema |
|---|---|
| Listado | `select=…,body_text,…` **limit 200** → 766 kB, de los cuales 716 kB no se usan |
| Badge | **la misma consulta**, cada 60 s |
| Detalle | `select=*` → trae `body_html` entero, incluido el máximo de **5.432 kB** |
| Hilo | un `SELECT` por hilo + un `_emailsLoadOne` **por mensaje desplegado** → **N+1** |
| Búsqueda | **no llega a SQL** |
| Índice de la IA | pagina de a 1000 hasta 20.000 filas |

Índices: hay sobre `date DESC`, `thread_id`, `status`, `assignee`, `is_read`,
`gmail_id` y `direction`. **Están bien y no son el problema**; el problema es
cuántas columnas se piden, no cómo se filtran.

### Frontend

| | |
|---|---|
| Payload del listado | **766 kB** |
| Payload del detalle | ~100 kB de media, **5,4 MB** en el peor caso |
| Filtros, contadores, hilos | **todo en el navegador**, sobre las 200 filas |
| Búsqueda | **DOM puro** — recorre las filas ya dibujadas y las esconde |
| Paginación | **no hay** — un botón de límite (50/100/…) que sólo cambia `display:none` |

La búsqueda dice *«Buscar en todos los hilos…»* y busca en lo que haya cargado:
como mucho 200 mails de los últimos días. **Un mail de hace seis semanas no
aparece**, y nada se lo avisa al usuario.

---

## AE · Fuente de verdad

| dato | fuente **hoy** | debería ser |
|---|---|---|
| **Email (mensaje)** | Supabase (copia parcial) | **PROVEEDOR** + índice en Supabase |
| **Thread** | Supabase (`thread_id` de Gmail) | **PROVEEDOR** |
| **Unread** | **Supabase, local** — no se sincroniza | **decisión pendiente** — ver AI |
| **Label / carpeta** | **NO DETERMINADO** — no se importan las de Gmail | **PROVEEDOR** |
| **Attachment** | Storage legacy (copia) + Gmail (original) | **PROVEEDOR**, caché en Storage |
| **Draft** | **no existe** | — |
| **Sent status** | Make → Gmail; el `status` del ERP **nunca se actualiza** (bug de O) | **PROVEEDOR** |
| **Estado de trabajo** (`status`, `assignee`) | **Supabase** — y está bien | **SUPABASE**, siempre |

La línea es clara: **todo lo que es el correo pertenece al proveedor; todo lo que
es el trabajo sobre el correo pertenece a nosotros.** El legacy mezcló las dos
cosas en una tabla, y de ahí vienen el peso, el egress y la desincronización.

---

## AF · Histórico

**`erp_emails` es una copia parcial, no el archivo.**

| evidencia | |
|---|---|
| Rango de fechas | **2026-08-03 → 2026-09-07** — 5 semanas |
| Origen del tramo más viejo | un escenario de backfill **temporal** |
| ¿Make borra de Gmail? | **no** |
| ¿Make marca leído en Gmail? | **no** (`markSeen: false`) |
| Criterio de lectura | `ALL` sobre `INBOX` — vuelve a leer lo mismo cada vez |

Clasificación: **CACHÉ / RÉPLICA INCOMPLETA**.

### Punto 56 — si `erp_emails` desapareciera mañana

**Los emails siguen existiendo en Gmail. Sí, con evidencia:** nada en el
pipeline borra ni mueve nada en el proveedor, y la ventana de fechas es mucho
más corta que la vida del buzón.

**Lo que sí se perdería** es el estado propio del ERP, que no está en ningún
otro lado:

| | |
|---|---|
| Filas con estado propio | **186** |
| De esas, sólo `is_read` | 95 |
| **Con `status` o `assignee` de verdad** | **91** |
| Etiquetas, notas, vínculo con cliente | 0 — nunca se usaron |

**91 filas.** Ese es el valor irrecuperable del histórico entero.

Los adjuntos del bucket son copias de los de Gmail; los 4 salientes salieron por
Gmail y están en «Enviados».

**Y una advertencia:** ese respaldo es hoy la única copia fuera del alcance de un
`anon` que puede truncar la tabla. Está en
`C:\Users\janog\backups-legacy\emails-2026-09-11\`.

---

## AG · Qué migrar

### La estrategia, medida y no intuida

| opción | veredicto |
|---|---|
| **A — espejo completo** | **no.** 68 MB de HTML para 5 semanas; a un año son ~700 MB de correo que Gmail ya guarda mejor |
| **B — caché selectivo** | parcial |
| **C — índice de metadata + cuerpo bajo demanda** | **sí** |
| **D — provider-first puro** | no: sin índice propio se pierden asignación, estado y búsqueda, y se depende de la latencia de Gmail para pintar la bandeja |

**Los números que lo deciden:**

- La metadata de los 976 mails entra en **~1,5 MB**. El HTML pesa **68 MB**.
  La relación es de **45 a 1**.
- La bandeja muestra remitente, asunto, fecha y estado: **todo metadata**.
- El cuerpo hace falta **sólo al abrir un email**, de a uno.
- Los adjuntos ya viven fuera de Postgres; sólo hay que dejar de publicarlos.

### Clasificación

| qué | decisión |
|---|---|
| `gmail_id`, `thread_id`, `date`, `from`, `to`, `subject` | **MIGRAR MEJORADO** — sin base64, con cuenta y empresa |
| `status`, `assignee` (**91 filas**) | **MIGRAR 1:1** — es lo único irrecuperable |
| `is_read` | **MIGRAR MEJORADO** — pasa a ser **por usuario**, como en WhatsApp |
| `body_html` / `body_text` | **NO MIGRAR** — se trae del proveedor al abrir |
| Adjuntos | **RECONSTRUIR DESDE PROVIDER** — a un bucket **privado** |
| Los 4 salientes | **NO MIGRAR** — están en «Enviados» de Gmail |
| `labels`, `notes`, `related_cliente` | **NO MIGRAR** — 0 filas |
| `erp_email_rules` | **NO MIGRAR** — 0 filas |
| Lista de spam, reglas de acceso | **RECONSTRUIR** — la de acceso pasa a ser RLS de verdad |
| Etiquetas de localStorage | **NO MIGRAR** |
| Vínculo con clientes | **FUTURO** — automático sólo por email exacto (20,7 %) |
| Firmas, plantillas, borradores | **FUTURO** — no existen, habría que inventarlos |

**El histórico de cuerpos no se borra.** Queda el respaldo con sha256, y la
tabla legacy se deja como está hasta que se decida lo de AI.

---

## AH · Riesgos

| riesgo | probabilidad | impacto |
|---|---|---|
| Alguien inyecta un email falso en la bandeja | **posible hoy, sin autenticarse** | **alto** — phishing interno con cara de correo real |
| Alguien borra los 976 mails o los 479 adjuntos | **posible hoy** | medio — Gmail los tiene, pero se van las 91 filas de estado |
| Fuga de correspondencia por el bucket público | **en curso** | **alto** — facturas y documentos de clientes |
| Alguien manda correo como `info@` con el webhook | **posible hoy** | **alto** — reputación y suplantación |
| Se pierden mails por el tope de 25 | **baja hoy** (margen <3×) | alto, y **silencioso** |
| XSS al migrar a React sin sandbox | media | **alto** — ya hay 4 cuerpos con `<script>` |
| El egress del badge | **en curso** | medio — ~46 MB/h por usuario |
| Cerrar la RLS rompe la ingesta de Make | **alta si se toca sin cuidado** | **alto** — el token de Make no coincide |

**El último es el que ordena todo lo demás:** no se puede cerrar `erp_emails`
sin arreglar antes el token de Make, o el correo deja de entrar.

---

## AI · Plan propuesto

Ajustado a lo que se midió, no a la plantilla.

### Entrega 0.5 — contención de seguridad del legacy *(recomendada, y antes que el resto)*

Es el paralelo exacto de la entrega 0.5 de WhatsApp, y hay tres diferencias que
la hacen **más urgente**: acá la escritura es anónima, el bucket es público y
hay una vía para mandar correo suplantando a la empresa.

El orden importa, porque el módulo está en uso:

1. Respaldo — **ya hecho** en esta entrega.
2. **Alinear el token de Make con el de la base.** Sin esto, cualquier cierre
   corta la entrada de correo.
3. Quitar la policy `make_insert` y el `EXECUTE` público de `insert_email`.
4. Cerrar `anon` sobre `erp_emails` — al menos `DELETE`, `UPDATE` y `TRUNCATE`.
5. **Pasar el bucket `email-attachments` a privado** y atar la policy al rol.
6. **Regenerar los dos webhooks de Make** y sacar las URLs del bundle.
7. Rotar `SUPA_APP_TOKEN` — arrastra a WhatsApp y al resto del ERP, así que
   necesita su propia ventana.

**Decisión necesaria:** el punto 4 apaga la bandeja legacy, igual que pasó con
WhatsApp. Hay que decidir si eso es aceptable o si Emails tiene que seguir
funcionando hasta que esté el módulo nuevo.

### Entrega 1 — arquitectura, schema y RLS (propuesta, sin ejecutar)

Proveedor, estrategia de sincronización, tablas, RLS por usuario y por empresa,
modelo de no-leído. Con una decisión grande arriba: **¿Gmail API directa o se
sigue con Make?**

### Entrega 2 — backend y proveedor

Edge Functions, OAuth de Gmail server-side, sincronización incremental con
cursor (`historyId`) en vez de «los 25 más recientes», webhook o `watch`.

### Entrega 3 — bandeja de solo lectura

Lista, hilo, detalle con el cuerpo **bajo demanda**, búsqueda del lado del
servidor, Realtime. Sanitización del HTML con sandbox **y** DOMPurify, y
bloqueo de imágenes remotas con un botón de «mostrar».

### Entrega 4 — responder y componer

Envío server-side, responder, responder a todos, reenviar, CC, BCC, borradores,
firma. Idempotencia de salida, como en WhatsApp.

### Entrega 5 — adjuntos y CRM

Storage privado, vínculo con clientes por email exacto, y relación con Ventas y
Compras.

### Entrega 6 — cierre

Matriz de equivalencia, regresión, migración de las 91 filas de estado.

---

## Decisiones que necesito

Ninguna de estas se puede resolver midiendo; por eso están acá y no resueltas.

| # | decisión | por qué no la puedo tomar yo |
|---|---|---|
| 1 | **¿Se hace la contención 0.5 antes que nada?** | Cerrar `anon` probablemente apague la bandeja legacy. Es una decisión de negocio, no técnica |
| 2 | **¿Gmail API directa o se sigue con Make?** | Directa da push, cursor y nada de terceros, pero hay que montar OAuth. Make ya funciona y lo mantiene otra persona |
| 3 | **¿El no-leído es por usuario o compartido?** | En WhatsApp se eligió por usuario. Acá hay 873 sin leer: con un contador compartido nadie lo va a bajar nunca |
| 4 | **¿Qué ve cada rol?** | Hoy todos ven todo. ¿Repetimos el modelo de WhatsApp —admin y employee toda la bandeja, salesperson sólo lo asignado— o Emails es sólo para admin y employee? |
| 5 | **¿Se migran los cuerpos o se dejan en el respaldo?** | Son 68 MB de 5 semanas. Mi recomendación es no migrarlos, pero implica que la bandeja nueva arranque sin cuerpos viejos hasta que se resincronice desde Gmail |
| 6 | **¿La IA sigue mandando cuerpos a OpenAI?** | Funciona y se usa. Es correspondencia de clientes saliendo a un tercero. No es mi decisión |
| 7 | **¿Multiempresa desde el día 1?** | Torquetools no tiene buzón. Diseñarlo ahora cuesta poco; agregarlo después cuesta mucho |

---

# ESTA ENTREGA NO EJECUTÓ NADA

No se envió ningún email. No se marcó nada como leído. No se archivó, no se
borró, no se movió a spam, no se creó ningún borrador y no se subió ningún
adjunto. No se llamó a ningún endpoint que mute el buzón. No se rotó ninguna
credencial. No se tocó el legacy, ni Supabase, ni Make, ni WhatsApp.

Lo único que se escribió fue el respaldo de sólo lectura, **fuera del
repositorio**.
