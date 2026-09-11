# Fase 9 · Emails — Entrega 1: arquitectura y schema · **versión 2**

Versión 2: incorpora las trece decisiones aprobadas. Lo que cambió está al
final, en **Cambios respecto de la versión 1**.

> ## ESTA ENTREGA NO EJECUTA NADA
>
> No se ejecutó SQL, no se creó ningún proyecto de Google Cloud, no se
> configuró OAuth, no se habilitó la Gmail API, no se tocó Gmail, no se crearon
> Edge Functions, no se programó React y no se migró ningún dato.
>
> Es una propuesta. El SQL está en
> [`database/PHASE_9_EMAILS_PROPOSAL.sql`](database/PHASE_9_EMAILS_PROPOSAL.sql),
> marcado **PROPUESTA · NO EJECUTADO**.

Documentación oficial de Google consultada el **2026-09-11**. Todo lo que sigue
sale de developers.google.com, support.google.com y
knowledge.workspace.google.com — no de tutoriales ni de memoria.

---

## A · La arquitectura, en una pantalla

```
Gmail  (info@buscatools.com.ar)          ← FUENTE DE VERDAD
  │
  │ users.watch  →  Cloud Pub/Sub  →  push
  ▼
Supabase Edge Function  ·  webhook + sync            ← server-side, con secretos
  │  history.list desde last_history_id
  │  guarda SÓLO metadata
  ▼
Supabase nuevo
  ├─ email_threads        índice, descartable, reconstruible desde Gmail
  ├─ email_thread_state   estado del ERP, NO reconstruible          ← lo valioso
  ├─ email_thread_reads   no leído por usuario
  └─ email_accounts       una fila por buzón, con el cursor de sync
  ▲
  │ Realtime
React  ·  bandeja
  │
  │ al ABRIR un hilo:
  ▼
Edge Function  →  threads.get / attachments.get  →  Gmail       ← cuerpo bajo demanda
```

La regla que ordena todo: **el correo es de Gmail; el trabajo sobre el correo es
nuestro.** El legacy mezcló las dos cosas en una tabla y por eso terminó con
68 MB de HTML, 46 MB/h de egress y un índice desincronizado.

---

## B · Documentación oficial consultada

Todo verificado el **2026-09-11**, citando la fuente.

### Push y sincronización

| dato | fuente |
|---|---|
| *«The Gmail API uses the Cloud Pub/Sub API to deliver push notifications»* — **Pub/Sub es obligatorio** | [guides/push](https://developers.google.com/workspace/gmail/api/guides/push) |
| *«You must call the watch at least once every 7 days or you'll stop receiving updates»*, y recomiendan llamarlo **una vez por día** | ídem |
| El payload del push es Base64URL de `{"emailAddress": …, "historyId": …}` | ídem |
| Hay que darle `publish` a la cuenta `gmail-api-push@system.gserviceaccount.com` | ídem |
| Tope de **un evento por segundo** por usuario; lo que excede **se descarta** | ídem |
| Las notificaciones *«might be delayed or dropped»* en situaciones extremas | ídem |
| *«If the `startHistoryId` supplied by your client is outside the available range of history records, the Gmail API returns an `HTTP 404`»* → *«your client must perform a full sync»* | [guides/sync](https://developers.google.com/workspace/gmail/api/guides/sync) |
| *«History records are typically available for at least one week and often longer. However, the time period … may be significantly less and records may sometimes be unavailable in rare cases»* | ídem |

### Mensajes

| dato | fuente |
|---|---|
| `snippet`: *«A short part of the message text»* — **Gmail lo entrega** | [users.messages](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages) |
| `internalDate`: *«…which determines ordering in the inbox … more reliable than the `Date` header»* | ídem |
| `sizeEstimate`: *«Estimated size in bytes of the message»* | ídem |
| `format` acepta `MINIMAL`, `FULL`, `RAW`, `METADATA`; con `METADATA` se eligen los headers | [messages.get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get) |
| Adjuntos: `attachmentId`, `size`, `data` **base64url** | [attachments.get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments/get) |

### Enviar y mantener el hilo

Para que una respuesta caiga en el mismo hilo, la documentación exige
([guides/sending](https://developers.google.com/workspace/gmail/api/guides/sending)):

1. *«The requested `threadId` must be specified on the `Message` or `Draft.Message`»*
2. *«The `Subject` headers match»*
3. *«The `References` and `In-Reply-To` headers follow the RFC 2822 standard»*

Y *«Gmail messages are sent as base64URL encoded strings within the `raw` field»*.

### Cuotas

De [reference/quota](https://developers.google.com/workspace/gmail/api/reference/quota):

| límite | valor |
|---|---|
| Por día y por proyecto | **80.000.000** unidades |
| Por minuto y por proyecto | 1.200.000 |
| **Por minuto, por usuario y por proyecto** | **6.000** |

| método | costo | método | costo |
|---|---|---|---|
| `history.list` | **2** | `messages.get` | 20 |
| `messages.list` | 5 | `attachments.get` | 20 |
| `threads.list` | 10 | `threads.get` | **40** |
| `drafts.create` | 10 | `messages.send` | 100 |
| | | `watch` | 100 |

Google recomienda *truncated exponential backoff*:
`min(((2^n)+random_number_milliseconds), maximum_backoff)`, con el máximo
*«typically 32 or 64 seconds»*.

**Qué significan para nosotros:** con 6.000 unidades por minuto y por usuario,
un `threads.get` de 40 da **150 aperturas de hilo por minuto**. Con ~28 mails
por día, el sync por push cuesta 2 unidades por notificación. **La cuota no es
una restricción de diseño**, y conviene decirlo porque es justo lo contrario del
techo de 75/día que impone Make.

### Scopes

De [auth/scopes](https://developers.google.com/workspace/gmail/api/auth/scopes):

| scope | qué permite | clasificación |
|---|---|---|
| `gmail.metadata` | *«email message metadata such as labels and headers, but not the email body»* | restringido |
| `gmail.readonly` | *«View your email messages and settings»* | restringido |
| `gmail.modify` | *«Read, compose, and send emails»*, **sin** borrado permanente | restringido |
| `gmail.compose` | *«Manage drafts and send emails»* | restringido |
| `gmail.send` | *«Send email on your behalf»* | sensible |
| `gmail.labels` | ver y editar etiquetas | no sensible |
| `https://mail.google.com/` | incluye **borrado permanente** | restringido |

**`gmail.metadata` no alcanza**: no da cuerpos ni adjuntos, y los necesitamos
bajo demanda. El scope mínimo real es **`gmail.modify`** (lectura + envío, sin
poder borrar nada de forma permanente). **`https://mail.google.com/` no se pide**,
justamente porque el borrado permanente es lo único que agrega.

---

## C · La cuenta real — resuelto con evidencia pública

La pregunta que ordena toda la autenticación era: **¿`info@buscatools.com.ar` es
Google Workspace o un Gmail de consumidor?** Se resolvió **sin tocar Gmail**,
mirando DNS público:

```
buscatools.com.ar    MX preference = 1, mail exchanger = SMTP.GOOGLE.COM
buscatools.com.ar    TXT  "google-site-verification=EihT15_sArDRJuL1VIK…"
```

`smtp.google.com` es el MX de **Google Workspace**, y el registro
`google-site-verification` es el que se agrega al dar de alta el dominio. Una
cuenta de Gmail de consumidor no tiene dominio propio ni MX.

**Conclusión: el dominio está en Google Workspace.** Eso desbloquea las dos
cosas caras de este proyecto (ver D).

> **Lo que esto NO prueba**, y conviene no estirarlo: no dice qué edición es, ni
> que exista un Super Admin dispuesto a autorizar una delegación. Prueba el tipo
> de cuenta, que era la pregunta.

### Un detalle al pasar, para la entrega de envío

El SPF del dominio es
`v=spf1 +a +mx +ip4:213.158.86.61 include:_spf.webempresa.eu ~all`.
**No incluye `_spf.google.com`.** Hoy pasa por el `+mx` —que resuelve a
`smtp.google.com`—, pero es frágil.

**Queda en backlog y no se toca el DNS.** Antes de habilitar el envío real hay
que revisar SPF, DKIM y DMARC juntos — no sólo el SPF, y no en esta fase.

---

## D · Autenticación: las dos opciones

| | **A · OAuth con refresh token del buzón** | **B · Service account + Domain-Wide Delegation** |
|---|---|---|
| Setup | pantalla de consentimiento + un consentimiento humano por buzón | proyecto + service account + autorización del **Super Admin** en la consola de Admin |
| Requiere Workspace | no | **sí** — y lo tenemos |
| Renovación | el refresh token **se puede morir** (ver abajo) | la clave del service account no caduca |
| Dependencia de una persona | **alta**: si cambia la contraseña, se rompe | **ninguna** |
| Revocación | el usuario puede revocar desde su cuenta | el Super Admin la quita en la consola |
| Multi-buzón | **un token por buzón**, con almacenamiento cifrado | **ninguno**: el service account impersona cada dirección |
| Verificación de Google | con scopes restringidos: verificación **+ evaluación de seguridad** | **evitable** si la app es *Internal* |
| Alcance del daño si se filtra | un buzón | *«the app has access to the data belonging to all of your users»* |

### Por qué OAuth-usuario es frágil acá

Google publica las causas por las que un refresh token deja de funcionar
([oauth2](https://developers.google.com/identity/protocols/oauth2)). Dos matan
este proyecto:

- *«A Google Cloud Platform project with an OAuth consent screen configured for
  an external user type and a publishing status of "Testing" is issued a refresh
  token expiring in **7 days**»*
- *«The user changed passwords and the refresh token contains **Gmail scopes**»*

O sea: con la app en *Testing* hay que reconsentir cada semana, y **cualquier
cambio de contraseña de `info@` corta la bandeja** sin aviso.

### Por qué Workspace cambia el cálculo

Del documento oficial de configuración del consentimiento
([configure-oauth-consent](https://developers.google.com/workspace/guides/configure-oauth-consent)):

> *«For apps used only internally by your Google Workspace organization, scopes
> aren't listed on the consent screen and use of restricted or sensitive scopes
> **doesn't require further review by Google**.»*

Con el dominio en Workspace y la app como **Internal**, **no hay verificación ni
evaluación de seguridad**. Eso ahorra semanas y un costo real.

### Decisión

> **B · Service account con Domain-Wide Delegation, con la app como *Internal*,
> y scope `gmail.modify`.**
>
> **`https://mail.google.com/` NO se pide.** Lo único que agrega es el borrado
> permanente, que no está en la v1 y no queremos poder hacerlo por accidente.

Porque elimina de un saque los tres problemas caros: el token que se muere sola
por un cambio de contraseña, el almacenamiento cifrado de N tokens cuando haya
más buzones, y la verificación de scopes restringidos.

El costo es el que Google marca en rojo y se asume con los ojos abiertos:

> *«With domain-wide delegation, the app has access to the data belonging to all
> of your users.»* — [knowledge.workspace.google.com](https://knowledge.workspace.google.com/admin/apps/control-api-access-with-domain-wide-delegation)

Se mitiga con lo que el propio Google recomienda: **autorizar sólo
`gmail.modify`**, y que el backend **impersone únicamente las direcciones dadas
de alta en `email_accounts`** — lista blanca en código, no en la consola.

### La única puerta antes de ejecutar nada

DWD **requiere un Super Admin** de Google Workspace que autorice la delegación
en la consola de Admin. Eso no se puede averiguar desde acá: no es una
propiedad del dominio sino de quién tiene la credencial.

```
GATE:  ¿hay acceso a un SUPER ADMIN de Google Workspace?

  SÍ  →  seguir con DWD  (opción B)
  NO  →  DETENERSE y pasar al plan B
```

### Plan B, si no hay Super Admin

> **OAuth con app *Internal* y refresh token del buzón.**

Sigue evitando lo más caro —al ser *Internal* no hay verificación de Google, y
no aplica el vencimiento de 7 días del estado *Testing*—, pero deja en pie un
riesgo que hay que aceptar explícitamente:

> *«The user changed passwords and the refresh token contains Gmail scopes»*

O sea: **si alguien cambia la contraseña de `info@`, la bandeja se corta** y hay
que volver a dar el consentimiento. Se mitiga con una alerta cuando el refresh
falla, no con código.

**El resto de la arquitectura no cambia en absoluto por esto.** Cambia de dónde
saca el backend su credencial, y nada más: ni las tablas, ni la RLS, ni el
sync, ni la UI.


---

## E · Backend

| | **Supabase Edge Functions** | Cloudflare Worker separado |
|---|---|---|
| Acceso a la base | directo, misma plataforma | por HTTP, con la clave de servicio viajando |
| Secretos | secretos de la función | secretos del Worker |
| Webhook de Pub/Sub | endpoint HTTP, sirve | endpoint HTTP, sirve |
| Logs | junto al resto del proyecto | en otra consola |
| Cron (renovar el `watch`) | `pg_cron` + `pg_net`, o Scheduled Functions | Cron Triggers |
| Mantenimiento | una plataforma | dos |

> **Recomendación: Supabase Edge Functions.** Es la misma decisión que en
> WhatsApp y por el mismo motivo: el trabajo es mayormente base de datos, y un
> Worker obligaría a mandar la clave de servicio por la red para cada escritura.

**No se reutiliza `buscatools-ai`**, ni su `WORKER_SECRET`. Tres funciones:

| función | qué hace |
|---|---|
| `gmail-push` | recibe el Pub/Sub, valida, encola |
| `gmail-sync` | `history.list` desde `last_history_id`, actualiza el índice, renueva el `watch` |
| `gmail-fetch` | bajo demanda: cuerpo de un hilo, adjunto, envío |

---

## F · Fuente de verdad

| entidad | fuente | por qué |
|---|---|---|
| Mensaje | **Gmail** | está completo y es el archivo real |
| Hilo | **Gmail** | `threadId` es identidad de proveedor |
| Etiquetas / carpetas | **Gmail** | son de Gmail, no nuestras |
| Leído/no leído **de Gmail** | **Gmail** | es el buzón, no el ERP |
| Adjuntos | **Gmail** | el binario vive ahí |
| Borradores | **Gmail** | ver Ñ |
| **Asignación** | **Supabase** | no existe en Gmail |
| **Estado de workflow** | **Supabase** | no existe en Gmail |
| **No leído por usuario** | **Supabase** | Gmail tiene uno por buzón, no por persona |
| **Vínculo con el CRM** | **Supabase** | no existe en Gmail |

---

## G · Índice local: qué tablas, y por qué cada una

**Seis.** Cada una se justifica sola; ninguna está por simetría.

### 1 · `email_accounts` — **sí**

Sin ella no hay multiempresa ni varios buzones, y `info@` volvería a quedar
escrito fijo como en Make. Guarda además el **cursor de sincronización**
(`last_history_id`, `watch_expiration`), que es lo que impide perder correo en
silencio.

**No guarda ningún token.**

### 2 · `email_threads` — **sí**, y es descartable

Es el índice de la bandeja: lo que se necesita para dibujar la lista **sin
llamar a Gmail**. Se puede borrar entero y reconstruir desde Gmail.

### 3 · `email_thread_state` — **sí**, y es lo único que no se puede reconstruir

Separada de `email_threads` a propósito, y **no por simetría**. Tres razones
concretas:

1. **Una resincronización completa borra y rehace el índice.** Si el estado
   viviera en la misma fila, un resync se llevaría puesta la asignación. Esa es
   exactamente la lección de las 91 filas.
2. **El estado puede existir antes que el índice.** Los 20 estados legacy
   recuperables se importan **antes** del primer sync. Con una FK al índice, no
   habría dónde ponerlos.
3. La clave es `(account_id, gmail_thread_id)` en las dos, así que se atan sin
   depender del ciclo de vida de la otra.

### 4 · `email_thread_reads` — **sí**

Cardinalidad distinta: una fila por **(hilo, usuario)**. No entra en
`email_thread_state`, que tiene una por hilo.

### 5 · `email_events` — **sí**, y chica

Sólo **acciones humanas**: asignar, cambiar estado, vincular un cliente, enviar.
**Ningún evento de sincronización.** Es la diferencia entre una auditoría útil y
un `audit_logs` infinito.

### 6 · `email_sync_log` — **sí**, con retención corta

Sin esto, un push perdido es invisible — que es exactamente el modo de falla de
Make. Guarda la transición (`history_id` de → a, hilos tocados, error), **no el
payload**.

### Lo que NO se crea, y por qué

| tabla | por qué no |
|---|---|
| **`email_messages`** | Ver H. Es la decisión más discutible y va explicada aparte |
| **`email_contacts`** | `customers` y `customer_contacts` ya son los maestros. Los participantes van en el índice del hilo |
| **`email_attachments` permanente** | El binario es de Gmail. Ver O |
| **tokens de OAuth** | Con DWD **no hay ningún token por buzón**. Ver R |
| **eventos crudos de Pub/Sub** | El payload es `{emailAddress, historyId}`: no hay nada que guardar. `email_sync_log` registra la transición, que es lo único informativo |

---

## H · Por qué NO hay tabla de mensajes

Es la pregunta del punto 42 y merece una respuesta honesta, porque la respuesta
fácil era crearla.

Para dibujar **la bandeja** hacen falta: asunto, remitente, extracto, fecha,
etiquetas, si tiene adjuntos y cuántos mensajes. Todo eso es **del hilo**, y va
denormalizado en `email_threads`.

Para dibujar **un hilo abierto** hacen falta todos sus mensajes. Pero como el
cuerpo se trae bajo demanda, **ya vamos a llamar a Gmail igual**: un solo
`threads.get` (40 unidades) devuelve el hilo entero con todos sus mensajes y su
metadata. Una tabla local de mensajes **no ahorraría esa llamada**.

Entonces quedaría sólo como caché. Y una caché que no ahorra la llamada no es
una caché: es una segunda copia que hay que invalidar.

> **Se descarta para la v1.** Si más adelante aparece un caso real que la
> necesite —buscar por remitente sin ir a Gmail, o listar adjuntos de todos los
> hilos— se agrega entonces, con ese caso a la vista.

---

## I · Cuerpo bajo demanda

El listado **no trae cuerpos**. `email_threads` guarda como mucho:

`gmail_thread_id · subject · snippet · participants · last_message_at ·
gmail_labels · message_count · has_attachments · size_estimate`

Al abrir: `gmail-fetch` llama a `threads.get`, sanitiza y devuelve. **El cuerpo
no se guarda en Postgres.**

**¿Caché de cuerpo?** No en la v1. Un hilo abierto se queda en memoria del
cliente mientras está abierto; volver a abrirlo cuesta una llamada de 40
unidades sobre un presupuesto de 6.000 por minuto. Agregar una caché con TTL es
agregar invalidación a cambio de nada medible.

**El número que justifica todo esto:** el legacy tenía 68 MB de `body_html` para
5 semanas. A un año, ~700 MB de correo que Gmail ya guarda mejor. La metadata de
los mismos 976 mails entra en **~1,5 MB**: una relación de **45 a 1**.

---

## J · Snippet

Gmail **sí** entrega `snippet` (*«A short part of the message text»*). El legacy
lo mapeaba y llegaba vacío en las 976 filas —el módulo de Gmail de Make no lo
daba—, y por eso alguien metió `body_text` en el listado: **716 de los 766 kB de
cada request eran ese arreglo**.

Con la API oficial, `snippet` viene de fábrica. **El arreglo del legacy no se
repite.**

---

## K · Hilos e identidad

- La identidad del hilo es **`gmail_thread_id`**, con
  `unique (account_id, gmail_thread_id)`. Nunca el asunto.
- Los mensajes se identifican por el **id real de Gmail**.
- Los **UID de IMAP del legacy no se usan para nada**: 797 de 976 filas los
  tienen y no sirven contra la API.
- El header `Message-ID` se guarda **sólo cuando se envía**, porque hace falta
  para armar `References` e `In-Reply-To` en la respuesta siguiente.

El orden del hilo usa **`internalDate`**, que la documentación describe como
*«more reliable than the `Date` header»*.

---

## L · Estado interno del ERP

El legacy tenía seis estados. Tres de ellos **no son workflow**:

| legacy | qué es en realidad | destino |
|---|---|---|
| `spam` | una etiqueta de Gmail, y en el legacy era **por remitente** | **Gmail** |
| `archivado` | una etiqueta de Gmail | **Gmail** |
| `enviado` | una propiedad del mensaje, no del hilo | **se deriva** |
| `sin_responder` | workflow | ✅ |
| `en_proceso` | workflow | ✅ |
| `resuelto` | workflow | ✅ |

> **Enum mínimo: `pendiente` · `en_proceso` · `resuelto`.**

Un hilo **sin fila de estado es `pendiente`**: no hace falta escribir nada para
el caso normal, y la tabla sólo crece con los hilos que alguien tocó. De los 976
mails del legacy, sólo 91 tenían estado — el 9 %.

---

## M · Asignación

`assigned_to uuid` **nullable**, FK a `profiles`.

Asignan **admin y employee**, entre usuarios internos. **Se mantiene**, porque
repartir el trabajo entre quienes sí usan el módulo es útil por sí solo.

Lo que **cambió** respecto de la versión 1: en la v1 `assigned_to` **no es una
llave de autorización**. Nadie ve más ni menos según a quién esté asignado un
hilo — admin y employee ven toda la bandeja de su empresa. **No se construye
RLS por `assigned_to`.**

Si alguna vez el área comercial usa Emails, ahí se agrega la rama de la policy,
como en WhatsApp. Hoy sería una vía de autorización que nadie ejercita.

**Sin colas, sin round-robin, sin reglas automáticas.** El legacy tenía tabla,
ABM y pantalla de reglas de auto-asignación, con **0 filas** en producción.

Se asigna por RPC, **no por `UPDATE` directo** — no por el salesperson, que no
existe acá, sino por la razón general: la asignación y el estado son lo único
que no se puede reconstruir desde Gmail, y no se dejan a merced de un `PATCH`
suelto desde el navegador.


---

## N · Multiempresa y multicuenta

`email_accounts.company_id` desde el día uno. Una empresa, N cuentas.

**Nada de `info@` escrito fijo.** En Make, `p_to_email` es un literal en el
escenario; acá sale de la fila de la cuenta.

El selector de buzón **no se programa** en la v1 —hay una sola cuenta—, pero el
schema lo soporta sin cambios: todo cuelga de `account_id`.

---

## Ñ · Envío, borradores y MIME

**Nada de esto entra en la entrega 1.** Se diseña para no cerrarse puertas.

### Mantener el hilo

Los tres requisitos de Google, ya citados en B: `threadId` en el mensaje, el
`Subject` igual, y `References`/`In-Reply-To` según RFC 2822. **Se cumplen los
tres o el mensaje abre un hilo nuevo** — que es el bug que el legacy tiene hoy,
por otra vía.

### Borradores

> **DECIDIDO: Gmail Drafts reales.** Sin tabla local, sin borrador duplicado
> en Supabase.

No por elegancia: porque un borrador local sería **una segunda fuente de verdad
para algo que Gmail ya tiene**, y el módulo entero está construido sobre no
hacer eso. Además un borrador escrito en el ERP aparece en el Gmail de la
persona, y al revés.

El costo es real y hay que decirlo: `drafts.create` cuesta 10 unidades, así que
el autoguardado tiene que ir con *debounce* y no en cada tecla.

### MIME

El mensaje se arma **server-side** como RFC 2822 y se manda base64url en `raw`.
CC, BCC y adjuntos son partes MIME. **Nada de esto se arma en el navegador**, y
ningún token de Gmail llega a React.

---

## O · Adjuntos

**Fuente de verdad: Gmail.** Se bajan por `attachments.get` (20 unidades) a
través de `gmail-fetch`, que los devuelve al navegador. **No se replican.**

> **Dato para no confiarse:** la documentación **no dice** si el `attachmentId`
> es estable. Se clasifica como **NO DETERMINADO** y se diseña en consecuencia:
> siempre se pide con `messageId` + `attachmentId` juntos, y el `attachmentId`
> nunca se guarda como clave durable.

### Caché — no en la v1

Un adjunto abierto dos veces cuesta dos llamadas de 20 unidades. No justifica
una caché con TTL, con su bucket y su invalidación.

**Si alguna vez se cachea**: bucket **privado**, TTL corto, metadata mínima.
Nunca un bucket público — que es exactamente lo que la entrega 0.5 encontró: 479
adjuntos de clientes accesibles por URL.

### «Guardar en el ERP» — futuro, y explícito

Un adjunto de Gmail **no entra** en la tabla `attachments` del ERP por el hecho
de existir. Esa tabla es para documentos propios.

Pero `attachments` **ya es polimórfica** (`entity_type` / `entity_id`), así que
una acción explícita —«guardar esta factura en el cliente»— copia el archivo al
bucket privado y crea la fila. **REUTILIZABLE, sin tocarla.**

---

## P · HTML, XSS e imágenes remotas

**Dos capas, no una.** El legacy tenía sólo el sandbox; alcanzaba, pero por poco.

1. **Sanitización server-side** en `gmail-fetch`, antes de que el HTML llegue al
   navegador.
2. **`<iframe sandbox>` sin `allow-scripts`** y —a diferencia del legacy—
   **sin `allow-same-origin`**: las dos juntas ponen el iframe en el mismo
   origen que la app.

> **`dangerouslySetInnerHTML` no se usa para cuerpos de email. Nunca.**

La evidencia de que esto no es teórico: **4 cuerpos guardados en el legacy
contienen `<script>`**. Hoy son inertes por el sandbox. Un render descuidado en
React los ejecuta.

### Imágenes remotas

Medido: **590 de 755** cuerpos cargan imágenes remotas; **275** tienen algo de
1 píxel. Abrir un mail le avisa al remitente.

> **DECIDIDO para la v1: bloqueadas por defecto**, con una barra discreta
> arriba del cuerpo: «Este mensaje contiene imágenes remotas.
> [Cargar imágenes]». **Sin proxy en la v1.**

Es lo que hace Gmail, la gente ya lo conoce, y no requiere construir un proxy.
El proxy (opción B) queda para después: resuelve la privacidad del lado del
servidor pero pone a nuestro backend a bajar contenido arbitrario de terceros,
que es un problema nuevo.

---

## Q · Qué acciones entran en la v1

El legacy era, en los hechos, **leer y responder**. Conviene no inflar la v1
sólo porque la API lo permite.

| acción | v1 | por qué |
|---|---|---|
| Bandeja y lectura de hilos | ✅ | es el módulo |
| Ver y bajar adjuntos | ✅ | 271 de 976 mails los traen |
| **Responder** | ✅ | es lo único que el legacy hacía además de leer |
| **Responder a todos** | ✅ | no existe hoy y se pide solo; el costo sobre «responder» es el armado de destinatarios |
| **Reenviar** | ✅ | no existe hoy; es el mismo camino MIME |
| **Componer** | ✅ | ya existe en el legacy |
| Asignar y cambiar estado | ✅ | es el valor propio del ERP |
| Vincular cliente | ✅ | ver S |
| No leído **por usuario** | ✅ | decisión 6 |
| **Borradores de Gmail** | ✅ | decidido: borradores reales, sin copia local |
| Archivar · spam · papelera · restaurar | ❌ | **decidido fuera de la v1**: son mutaciones del buzón real, y el legacy nunca las tuvo de verdad — su «spam» era una lista local de remitentes |
| Marcar leído **en Gmail** | ❌ | **decidido**: abrir un hilo en el ERP no toca el no-leído de Gmail |
| Gestión de etiquetas de Gmail | ❌ | **decidido fuera de la v1**: se muestran, no se editan |
| IA | ❌ | decisión 10 |

**Por qué archivar/spam/papelera quedan afuera:** son mutaciones del buzón real
y no resuelven ningún problema que el equipo tenga hoy. Agregarlas es agregar
superficie de error sobre la casilla de la empresa. Se suman cuando alguien las
pida por un motivo concreto.

**La v1 no modifica Gmail más que para enviar y para guardar borradores.** Todo
lo demás que el ERP hace —asignar, cambiar estado, vincular un cliente, marcar
leído— ocurre sólo de este lado.

---

## R · Leído: los dos conceptos, separados

| | quién lo cambia | efecto |
|---|---|---|
| **Unread del ERP** | abrir el hilo en el ERP | **sólo para ese usuario** |
| **Unread de Gmail** | Gmail, o una acción explícita | el buzón entero |

**Abrir un hilo en el ERP no toca Gmail.** Juan abre, y para Facundo sigue sin
leer — que es lo contrario de hoy, donde el legacy tiene un `is_read` por fila
compartido por todos (y por eso hay **873 de 976 sin leer**: nadie puede bajar
ese número).

Si alguna vez se agrega **«marcar como leído en Gmail»**, es un botón aparte,
explícito, y no se mezcla con el no leído del ERP.

---

## S · Vínculo con el CRM

`customer_id` y `customer_contact_id` **nullable** en el estado del hilo, con un
campo que dice **de dónde salió el vínculo**.

| estado | qué es | ¿auto? |
|---|---|---|
| `exacto` | la dirección coincide con un cliente o contacto, y con **uno solo** | **sí** |
| `sugerido_dominio` | el dominio pertenece a **un solo** cliente | **no** — se sugiere |
| `ambiguo` | el dominio lo comparten varios clientes | **no** |
| `manual` | lo puso una persona | — |
| *(sin fila)* | no hay candidato | — |

Medido en la entrega 0, sobre 651 mails externos de 171 remitentes:

| clase | remitentes | emails | % |
|---|---|---|---|
| **EXACT** | 17 | **135** | **20,7 %** |
| DOMAIN UNIQUE | 25 | 57 | 8,8 % |
| AMBIGUOUS | 8 | 30 | 4,6 % |
| NO MATCH | 120 | 428 | 65,7 % |

**Sólo `exacto` se auto-vincula**, y sólo si apunta a un único cliente: hay
**1 remitente** cuya dirección exacta matchea más de uno, y ése no se toca.
**El dominio nunca auto-vincula**: 8 remitentes tienen dominio compartido, y un
dominio genérico apuntaría a cualquiera.

Es poco —1 de cada 5— y es lo que hay. Forzarlo al 30 % con el dominio
significaría vincular mal a alguien, que es peor que no vincular.

---

## T · RLS

**v1: ADMIN y EMPLOYEE. Todos los demás, cero.** Sin excepciones y sin ramas.

| tabla | ADMIN | EMPLOYEE | SALESPERSON | TECHNICIAN | CUSTOMER | DISTRIBUTOR | ANON |
|---|---|---|---|---|---|---|---|
| `email_accounts` | ✅ empresa | ✅ empresa | ❌ | ❌ | ❌ | ❌ | ❌ |
| `email_threads` | ✅ empresa | ✅ empresa | ❌ | ❌ | ❌ | ❌ | ❌ |
| `email_thread_state` | ✅ empresa | ✅ empresa | ❌ | ❌ | ❌ | ❌ | ❌ |
| `email_thread_reads` | ✅ **propias** | ✅ **propias** | ❌ | ❌ | ❌ | ❌ | ❌ |
| `email_events` | ✅ empresa | ✅ empresa | ❌ | ❌ | ❌ | ❌ | ❌ |
| `email_sync_log` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

**No hay ninguna policy que mire `assigned_to`.** Es la diferencia con WhatsApp
y es deliberada: allá el salesperson entra y necesita una regla por asignación;
acá no entra, así que esa rama sería código muerto — una vía de autorización que
nadie ejercita y que igual hay que mantener y probar.

Cuando el área comercial use Emails, se agrega. Es un `or` en una policy.

**Ninguna columna de `UPDATE`, `INSERT` ni `DELETE` para nadie**, salvo la
propia marca de leído. Todo lo demás va por RPC.

`email_sync_log` no lleva ninguna policy: con RLS activa y sin policies queda
denegada por defecto para todo rol de aplicación. Sólo la toca el backend.

### Un helper propio, no el de WhatsApp

`app.current_email_company_ids()` → admin + employee. Hoy devuelve exactamente
lo mismo que `app.current_whatsapp_admin_ids()`, y aun así se crea aparte.

El motivo no es estilístico: si se compartiera, **cambiar el modelo de roles de
WhatsApp cambiaría en silencio quién lee el correo de la empresa**. Son dos
reglas que coinciden hoy, no una sola regla con dos usos.


---

## U · Búsqueda y paginación

**Búsqueda partida en dos, cada mitad donde corresponde:**

| qué se busca | dónde | por qué |
|---|---|---|
| Contenido, remitente, asunto | **Gmail** (`messages.list` con `q=`) | no guardamos cuerpos: no hay nada local que indexar |
| Cliente, asignado, estado | **Supabase** | no existe en Gmail |

Nada de full-text local: sería un índice sobre datos que decidimos no guardar.

Y no se repite lo del legacy, donde la búsqueda decía *«Buscar en todos los
hilos…»* y filtraba con `display:none` las filas ya dibujadas — como mucho 200
mails de los últimos días.

**Paginación:** hilos con cursor server-side; mensajes dentro del hilo, todos en
el `threads.get`. Nunca traer la bandeja entera.

**Objetivo de payload:** el listado en **decenas de KB**. Hoy son 766 kB.

---

## V · Sincronización, sin pérdida silenciosa

```
users.watch (una vez por día)  →  Pub/Sub  →  gmail-push
   ↓ {emailAddress, historyId}
gmail-sync:  history.list(startHistoryId = last_history_id)
   ├─ 200 → aplicar cambios, guardar el nuevo history_id
   └─ 404 → el historial venció → RESYNC COMPLETO, y registrarlo
```

Los tres modos de falla, y qué hace cada uno:

| falla | qué dice Google | qué hacemos |
|---|---|---|
| `historyId` vencido | HTTP 404, *«your client must perform a full sync»* | resync completo, anotado en `email_sync_log` |
| Notificación perdida | *«might be delayed or dropped»* | el **cron diario** que renueva el `watch` compara `historyId` y sincroniza si hay diferencia |
| Más de un evento por segundo | *«notifications … are dropped»* | no importa: el payload sólo trae el `historyId` más reciente, y `history.list` trae todo lo que falte |

**El `watch` se renueva por cron diario**, no a mano. Google exige cada 7 días y
recomienda diario; diario deja seis días de margen ante un cron caído.

**Fallback:** un botón «Sincronizar ahora» para admin. **Nunca polling
permanente.** El legacy consultaba cada 60 s para pintar un número.

La diferencia con Make, que es lo que se viene a arreglar:

| | Make | propuesto |
|---|---|---|
| Frecuencia | 3 veces por día, 1 minuto | **push, al instante** |
| Tope | 25 mails por corrida | ninguno |
| Cursor | **ninguno** | `historyId` |
| Pérdida al desbordar | **silenciosa** | imposible: el historial no se saltea |
| Adjuntos | **sólo los 2 primeros** | todos |

---

## W · Los 91 estados legacy — clasificados

Ejecutado sobre el export real de la entrega 0.5
(`estados-de-trabajo.json`, sha256 `3776919c17122b36…`). **La unidad es el
hilo**, no el mensaje, porque 86 de los 91 tienen un UID de IMAP inútil pero un
`thread_id` de Gmail válido.

| clase | filas | qué son |
|---|---|---|
| **AUTO** | **20** | 14 `sin_responder`+JUAN · 5 `en_proceso` · 1 `resuelto` |
| **REVIEW** | **67** | todos `spam` |
| **UNRESOLVED** | **4** | los salientes: 2 sin `thread_id`, 2 que no decodifican |

**82 hilos distintos, 0 conflictos**: ningún hilo trae dos estados que se
contradigan.

**Por qué los 67 de spam son REVIEW y no AUTO.** En el legacy, «spam» era una
**lista de remitentes bloqueados** en localStorage; el `status` de cada mail era
el efecto. Aplicarlos como estado de hilo cambiaría su significado — y el hilo
correcto para eso es **un filtro de Gmail o una lista de remitentes**, no el
workflow del ERP. Son 67 filas que representan bastante menos de 67 remitentes.

**Se migran 20 filas.** Y **sólo metadata**: ni cuerpos, ni asuntos, ni
remitentes, ni binarios.

Esto **no se ejecuta ahora**: la verificación de que cada `thread_id` siga
existiendo en Gmail necesita la API andando, o sea la entrega 3.

---

## X · Secretos

| secreto | dónde | nunca |
|---|---|---|
| Clave del service account (o refresh token) | **secreto de la Edge Function** | `VITE_*`, localStorage, Git, JS del navegador |
| ID del proyecto y del tópico de Pub/Sub | secreto de la función | — |
| Token de verificación del webhook | secreto de la función | — |

Nombres conceptuales: `GMAIL_SA_KEY`, `GMAIL_DELEGATED_SUBJECT`,
`GMAIL_PUBSUB_TOPIC`, `GMAIL_PUSH_VERIFY_TOKEN`.

**Ninguna tabla de tokens.** Con DWD **no hay un token por buzón**: el service
account impersona cada dirección. Es, además de lo más seguro, lo que hace
desaparecer el problema del almacenamiento cifrado para N buzones.

Si se eligiera OAuth-usuario con varios buzones, ahí **sí** haría falta guardar
N refresh tokens cifrados server-side — y ésa es otra razón para preferir DWD.

**Y no se repite nada de lo que encontramos**: ni un secreto en el bundle, ni
una URL de webhook que sea la credencial, ni un token publicado que valide una
policy.

---

## Y · Riesgos

| riesgo | mitigación |
|---|---|
| **DWD da acceso a todos los buzones del dominio** | sólo `gmail.modify`, y lista blanca de direcciones en el backend |
| No hay Super Admin disponible | opción A, *Internal*, asumiendo el riesgo del cambio de contraseña |
| El `historyId` vence y se pierde el hilo de cambios | resync completo automático, con registro |
| El push se cae en silencio | cron diario que compara `historyId` |
| **Cuerpos con `<script>`** | sanitización server-side **+** sandbox sin `allow-scripts` ni `allow-same-origin` |
| Tracking al abrir | imágenes remotas bloqueadas por defecto |
| Auto-vincular mal a un cliente | sólo `exacto` y sólo si es único |
| Dos personas responden lo mismo | lo mitiga la asignación; **no se resuelve del todo en la v1** |
| El SPF no incluye `_spf.google.com` | **verificar antes de la entrega de envío** |
| Que el módulo nuevo herede el egress del viejo | metadata only; objetivo de decenas de KB |

---

## Z · Plan de entregas

| entrega | qué | qué NO |
|---|---|---|
| **1** *(ésta)* | arquitectura, schema, RLS — **propuesta** | nada se ejecuta |
| **2** | Google Cloud, service account + DWD (o OAuth), Pub/Sub, `users.watch`, las tres Edge Functions, sync incremental | sin UI |
| **3** | ejecutar el schema, bandeja **de sólo lectura** en React, Realtime, y migrar los **20** estados AUTO | sin envío |
| **4** | hilo abierto, cuerpo bajo demanda, sanitización, imágenes bloqueadas, adjuntos | sin envío |
| **5** | componer, responder, responder a todos, reenviar, borradores | — |
| **6** | CRM, workflow, mobile, matriz de equivalencia, cierre | — |

La entrega 2 va **antes** de crear las tablas a propósito: recién con la API
andando se puede verificar que los `thread_id` legacy sigan existiendo, y sería
raro crear el schema y descubrir después que la autenticación no se podía
resolver.

---

## Legacy

```
MAKE EMAIL INGESTION = DEPRECATED / DISABLED
```

**Los tres escenarios de Emails quedaron apagados en esta entrega**, por
decisión aprobada. Se **deshabilitaron, no se borraron**: el blueprint queda
disponible por si hace falta mirarlo.

| id | escenario | estado |
|---|---|---|
| 5856917 | `ERP \| Gmail info@ → Supabase` | **APAGADO** |
| 5856923 | `ERP \| Reply Webhook → Gmail + Supabase` | **APAGADO** |
| 6036490 | `AT-BACKFILL \| Mails 14-24 ago → Supabase (temporal)` | **APAGADO** |

Verificado después de apagarlos: los tres figuran inactivos.

**Lo que NO se tocó, y por qué.** Hay otros escenarios que también leen `info@`
o mandan por Gmail, y **siguen activos a propósito** porque no son del módulo de
Emails:

| id | escenario | por qué sigue |
|---|---|---|
| 6060632 | `ERP \| Enviar Cotización/Pedido → Gmail` | es de **Ventas**: webhook → PDF → Gmail. **No toca Supabase** y no fallaba con 401 |
| 4804789 | `AT-COTIZADOR \| Mails info@ → Firebase` | otra automatización, fuera del alcance de esta fase |
| 4741405 | `AT-MAILS \| Carga automatica mails clientes` | ídem |

Se leyó el blueprint de 6060632 antes de decidir, justamente para no apagar una
función de Ventas que está en uso.

**No se les dio `service_role` a ninguno. No se reactiva ninguno.**

```
ERP_EMAILS = CONGELADA / SÓLO RESPALDO
```

Sin acceso para `anon` ni `authenticated`, sin policies, bucket privado. **No se
borra** hasta terminar la migración. Las 976 filas y los 479 adjuntos siguen
intactos, con respaldo verificado por sha256 fuera del repositorio, más los 91
estados exportados aparte.


---

## Decisiones: tomadas

| # | decisión | resuelto |
|---|---|---|
| 1 | Autenticación | **DWD + app *Internal* + `gmail.modify`**, sin `mail.google.com/` |
| 2 | Borradores | **reales de Gmail**, sin tabla local |
| 3 | Imágenes remotas | **bloqueadas por defecto**, botón «Cargar imágenes», sin proxy |
| 4 | Acciones sobre Gmail | sólo **leer, componer, responder, responder a todos, reenviar, borradores y adjuntos** |
| 5 | Salesperson | **0 acceso**, y **sin RLS por `assigned_to`** |
| 6 | Asignación | se mantiene, entre admin y employee |
| 7 | Make | **apagado** (hecho en esta entrega), no borrado |
| 8 | Legacy | congelado, sin reabrir, sin borrar |
| 9 | SPF | **backlog**, sin tocar DNS |
| 10 | Separación índice / estado | se mantiene, es lo crítico |
| 11 | 91 estados | AUTO 20 · REVIEW 67 · UNRESOLVED 4 — **no se migran todavía** |
| 12 | Fuente de verdad | Gmail para el correo, Supabase para el trabajo |
| 13 | Cuerpos | **nunca persistentes**; bajo demanda |

### Lo único que queda abierto, y bloquea la entrega 2

```
GATE:  ¿hay acceso a un SUPER ADMIN de Google Workspace?
```

No es una decisión de diseño: es un dato que no puedo averiguar desde acá. El
dominio **es** Workspace —eso está probado por el MX—, pero si existe alguien
con el rol de Super Admin dispuesto a autorizar la delegación, no.

- **Sí** → DWD, como quedó decidido.
- **No** → **detenerse** y pasar al plan B: OAuth con app *Internal* y refresh
  token del buzón, asumiendo que un cambio de contraseña de `info@` corta la
  bandeja hasta reconsentir.

**El resto de la arquitectura no cambia en ninguno de los dos casos.**

---

## Cambios respecto de la versión 1

| # | qué cambió | por qué |
|---|---|---|
| 1 | La autenticación pasó de **recomendación** a **decisión**, con el *gate* del Super Admin y el plan B escritos | decisión 1 |
| 2 | Se fijó el scope en **`gmail.modify`** y se descartó `mail.google.com/` explícitamente | decisión 1 |
| 3 | **`assigned_to` dejó de ser llave de autorización**: en la v1 sólo reparte trabajo | decisión 5 |
| 4 | **Se sacó toda rama de RLS por `assigned_to`**: sería código muerto sin salesperson | decisión 5 |
| 5 | Se reescribió la justificación del helper propio: ya no es «hay una decisión abierta» sino que compartirlo acoplaría dos módulos | decisión 5 |
| 6 | Borradores e imágenes remotas pasaron de recomendación a **decidido** | decisiones 2 y 3 |
| 7 | La tabla de acciones de la v1 quedó cerrada, con el motivo de cada exclusión | decisión 4 |
| 8 | **Make: de «recomiendo apagarlos» a apagados**, con verificación y con la lista de los que NO se tocaron | decisión 7 |
| 9 | El SPF pasó de «verificar» a **backlog explícito**, y se amplió a DKIM y DMARC | decisión 9 |
| 10 | La sección de decisiones abiertas quedó reducida a **una sola**, que es un dato y no una preferencia | — |

Lo que **no** cambió: las seis tablas, la separación entre índice y estado, el
cuerpo bajo demanda, la ausencia de tabla de mensajes, el matching por email
exacto, el plan de entregas y la fuente de verdad.


---

# ESTA ENTREGA NO EJECUTÓ NADA
