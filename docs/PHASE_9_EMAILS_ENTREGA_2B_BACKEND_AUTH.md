# Fase 9 · Emails — Entrega 2B: backend de Gmail, DWD y Pub/Sub

> ## ESTA ENTREGA NO EJECUTA NADA
>
> No se creó backend, no se ejecutó SQL, no se creó la subscription, no se
> inició `users.watch`, no se leyó Gmail, no se crearon secretos y no se
> programó React. Tampoco se tocó el proyecto de Google: ni el scope de DWD, ni
> IAM del topic, ni el Super Admin, ni el Owner.
>
> Es diseño y validación técnica.

Documentación oficial consultada el **2026-09-12**.

---

## Respuesta corta

**La pregunta era: ¿se puede correr el backend de Gmail en Supabase Edge
Functions sin una private key JSON?**

> # No.

Google **sí** documenta un camino sin key, pero exige que el runtime tenga una
identidad que Google reconozca — *attached service account* o Workload Identity
Federation. **Supabase Edge Functions no documenta ninguna de las dos.** Lo
único que ofrece son secretos por `Deno.env.get`.

Así que en Supabase la única forma de hacer DWD es **guardar la private key JSON
en los secretos**. Eso funciona, pero **no es «keyless»** y no lo voy a llamar
así.

> # Recomendado: Cloud Run con service account adjunta.

Y hay un dato que cambia el cálculo de costo, porque yo mismo lo había pasado
por alto en la entrega 1: **Pub/Sub exige una cuenta de facturación**, y Pub/Sub
es obligatorio para el push de Gmail. O sea que **hay que vincular billing de
todos modos**, use el runtime que use. El argumento «quedarse en Supabase para
no meter billing en Google» no existe.

---

## A · Auditoría del runtime actual

Medido sobre el repo y sobre el proyecto, no supuesto.

| qué | estado |
|---|---|
| Carpeta `supabase/` en el repo | **no existe** |
| `config.toml` de Supabase CLI | **no existe** |
| Edge Functions en el repo | **ninguna** |
| Edge Functions desplegadas en el proyecto | **0** (consultado por API) |
| Proyecto Supabase | `uaxcfufvapzulqvynanp` · «WEB REACT» · **us-east-2** |
| Postgres | **17.6.1.166** |
| Deploy actual | `.github/workflows/deploy.yml` → **GitHub Pages**, sólo el front |
| Patrón existente de credenciales server-side | **ninguno** |

**Conclusión del audit: no hay nada que reutilizar.** No existe un backend, ni
un pipeline de despliegue de funciones, ni un patrón de secretos server-side. Lo
que se elija acá se construye desde cero — y por lo tanto **elegir Cloud Run no
significa abandonar una inversión previa**, porque no la hay.

Es un dato que conviene tener a la vista: en la entrega 1 recomendé Edge
Functions en parte por «una sola plataforma». Esa ventaja era menor de lo que
parecía, porque la plataforma de funciones todavía no se estrenó.

### Secretos en Supabase Edge Functions

Se leen con `Deno.env.get('NOMBRE')` y se cargan por CLI o dashboard. El
runtime expone por defecto `SUPABASE_URL`, `SUPABASE_DB_URL`,
`SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS` y `SUPABASE_JWKS`.

**La documentación no menciona ninguna workload identity, token OIDC de la
función ni identidad federada disponible en runtime.** Esa ausencia es la que
decide todo lo que sigue.

---

## B · Qué exige DWD, exactamente

De [Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account):

| claim | valor |
|---|---|
| `iss` | *«The email address of the service account»* |
| `sub` | *«The email address of the user for which the application is requesting delegated access»* |
| `scope` | *«A space-delimited list of the permissions that the application requests»* |
| `aud` | *«always `https://oauth2.googleapis.com/token`»* |
| `iat` / `exp` | segundos desde epoch; `exp` **máximo una hora** después de `iat` |

Y la firma:

> *«signed using SHA256withRSA … with the private key obtained from the Google
> API Console»*

Se intercambia en `https://oauth2.googleapis.com/token` con
`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`.

**`sub` es lo que convierte una impersonación de service account en DWD.** Sin
`sub` el token es de la SA; con `sub`, es del usuario.

---

## C · ¿Supabase Edge Functions puede? — **NO**

La pregunta concreta era si una Edge Function tiene una identidad de workload
que Google pueda federar. La respuesta, con la evidencia disponible:

| pregunta | respuesta |
|---|---|
| ¿Expone una identidad OIDC de la *función*, usable para WIF? | **No documentado** |
| ¿Se puede configurar WIF contra ese issuer? | no hay issuer de workload que apuntar |
| ¿Se puede llamar a `signJwt` sin una key de SA? | **no**: haría falta primero una credencial de Google, que la función no tiene |
| ¿Hay identidad estable por proyecto/función? | no documentada |
| ¿Está soportado oficialmente? | **no** |

### El atajo que existe, y por qué lo descarto

Supabase **sí** puede actuar como proveedor OIDC — pero de **usuarios**, no de
la función. Expone `SUPABASE_JWKS`, y WIF acepta cualquier issuer OIDC con JWKS.
Se podría configurar un pool de WIF que confíe en el issuer de Supabase Auth.

**No hay que hacerlo, y no es una cuestión de gusto.** Los tokens que ese issuer
emite son de **usuario**: los obtiene cualquiera que pueda iniciar sesión en el
proyecto. Federando eso, **cualquier usuario autenticado del ERP podría acuñar
un token que termina impersonando `info@buscatools.com.ar`**. Se podría acotar
con condiciones de atributo a un usuario de servicio específico, pero entonces
hay que guardar las credenciales de ese usuario en algún lado — es decir, se
vuelve a un secreto, y a uno peor que la key.

> **Es técnicamente construible y es estrictamente menos seguro que una private
> key.** Queda descartado por el punto 35: no se construyen soluciones caseras
> sobre capacidades que nadie documenta.

### Entonces, en Supabase

**Habría que guardar la private key JSON de la service account en los secretos
de Supabase.** Funciona. Pero eso es exactamente lo que se quería evitar, y
llamarlo «keyless» sería mentir.

---

## D · Workload Identity Federation — dónde sí aplica

WIF es el mecanismo correcto **cuando el runtime tiene una identidad federable**.
Google la nombra explícitamente entre los caminos válidos para DWD sin key (ver
E). Los que aplican:

| runtime | identidad |
|---|---|
| Cloud Run / Cloud Functions / GCE | **service account adjunta** — ni siquiera hace falta WIF |
| GKE | WIF for GKE |
| GitHub Actions, y otros con OIDC de workload | WIF general |
| **Supabase Edge Functions** | **ninguna documentada** |

---

## E · IAM Credentials — el camino sin key, citado

Google lo documenta de forma directa en
[best practices for managing service account keys](https://docs.cloud.google.com/iam/docs/best-practices-for-managing-service-account-keys):

> *«When using domain-wide delegation, avoid service account keys and use the
> `signJwt` API instead»*

El procedimiento que describe:

1. Autenticar la service account mediante **attached service accounts**, WIF for
   GKE, o WIF general
2. Construir un JWT usando el claim **`sub`** con la dirección del usuario
3. Firmarlo con **`signJwt`**
4. Cambiar el JWT firmado por un access token

> *«resulting in a setup that can be secured more easily»*

`signJwt` firma *«using a service account's system-managed private key»*: la key
existe, pero **Google la guarda y nunca se descarga**.

### `generateAccessToken` NO sirve para esto

Es la confusión que el punto 11 pedía despejar, y es real:

| método | qué hace | ¿sirve para DWD? |
|---|---|---|
| `generateAccessToken` | token OAuth **de la service account** | **NO.** No acepta ningún campo de usuario/`subject` |
| `signJwt` | firma un JWT arbitrario **como** la SA, incluido `sub` | **SÍ** |

**Impersonar una service account** y **delegar en un usuario del dominio** son
dos cosas distintas. `generateAccessToken` hace la primera. Para la segunda hay
que firmar la aserción con `sub` y cambiarla en el endpoint de token.

### IAM necesario — mínimo privilegio

| principal | rol | sobre qué |
|---|---|---|
| SA de runtime de Cloud Run | `roles/iam.serviceAccountTokenCreator` | **sobre la SA de Gmail**, no sobre el proyecto |
| `service-545134968830@gcp-sa-pubsub.iam.gserviceaccount.com` | `roles/iam.serviceAccountTokenCreator` | sobre la SA de push |
| SA de push de Pub/Sub | `roles/run.invoker` | sobre el servicio de Cloud Run |

API a habilitar: **`iamcredentials.googleapis.com`**.

**Nada de Owner ni Editor.** El rol de token creator se otorga **sobre la
service account de destino**, no a nivel de proyecto: ésa es la diferencia entre
mínimo privilegio y no tenerlo.

Se puede simplificar usando **la misma SA** como identidad de runtime y como SA
de Gmail; entonces necesita `serviceAccountTokenCreator` **sobre sí misma**. Es
menos móviles, y sigue sin haber ninguna key descargable.

---

## F · Alternativas comparadas

| | **A · Supabase Edge Functions** | **B · Cloudflare Worker** | **C · Cloud Run** | **D · Cloud Functions** |
|---|---|---|---|---|
| **Private key JSON** | **SÍ, obligatoria** | **SÍ** (no hay identidad que Google federe desde el Worker) | **NO** | **NO** |
| Identidad para Google | ninguna | ninguna | **SA adjunta** | **SA adjunta** |
| Pub/Sub push con OIDC | sirve | sirve | **mismo proyecto, natural** | igual |
| Acceso a Supabase | directo | por HTTP | por HTTP con la service key | igual |
| Latencia | edge, sin cold start apreciable | edge, muy baja | **cold start ~1 s** con min-instances 0 | igual |
| Costo a nuestro volumen | $0 | $0 | **$0** (dentro de free tier) | $0 |
| Logs | consola de Supabase | consola de Cloudflare | Cloud Logging, **junto a Pub/Sub y Gmail** | ídem |
| Deploy | `supabase functions deploy` | `wrangler deploy` | `gcloud run deploy` / source deploy | ídem |
| Plataformas a operar | 1 | 2 | 2 | 2 |
| Complejidad | baja | media | **media** | media |

Cloud Run y Cloud Functions son hoy la misma plataforma; elijo **Cloud Run
(servicio)** porque es la forma general y no agrega nada encima.

---

## G · Costo

Volumen real medido en la entrega 0: **~28 emails/día**.

Estimación de requests mensuales: ~850 eventos de push + ~6.000 llamadas de UI
(abrir hilos, adjuntos) ≈ **7.000 requests/mes**.

| servicio | free tier | nuestro uso | costo |
|---|---|---|---|
| Pub/Sub | **10 GiB de mensajes/mes** | mensajes de ~100 bytes × 850 ≈ **85 kB** | **$0** |
| Cloud Run | **2.000.000 requests/mes**, 180.000 vCPU-s | ~7.000 requests | **$0** |
| Cloud Functions | 2.000.000 invocaciones/mes | ídem | $0 |
| Supabase Edge Functions | incluido en el plan actual | ídem | $0 |
| Cloudflare Worker | 100.000 requests/día en el plan free | ídem | $0 |

**Orden de magnitud: cero, en cualquiera de los cinco.** Puede haber centavos de
egress. No afirmo «gratis para siempre»: los free tiers cambian, y si el volumen
creciera 100× seguiría estando adentro, pero eso hay que revisarlo, no suponerlo.

> ### El dato que cambia la comparación
>
> De [Free Google Cloud features](https://docs.cloud.google.com/free/docs/free-cloud-features):
>
> > *«A Google Cloud billing account is required to access the Google Cloud Free
> > Tier.»*
>
> Y Pub/Sub es **obligatorio** para el push de Gmail. Conclusión: **hay que
> vincular una cuenta de facturación al proyecto igual**, se elija el runtime
> que se elija. Hoy el proyecto no la tiene, así que **eso bloquea la entrega 3**
> con independencia de esta decisión.
>
> Una vez vinculada, Cloud Run entra en el mismo free tier. El costo marginal de
> elegir Cloud Run en vez de Supabase es **$0**.

Con `min-instances = 0` no hay costo de reposo. Con `min-instances = 1` sí lo
habría —2,6 M de vCPU-segundos al mes contra 180.000 de free tier—, así que
**queda en 0** y se aceptan los cold starts.

---

## H · Backend elegido

```
RECOMENDADO           = Google Cloud Run (servicio único, región us-east1 o
                        la más cercana a Supabase us-east-2)
MOTIVO                = es el único runtime evaluado donde Google mismo
                        documenta DWD sin private key, vía service account
                        adjunta + signJwt. Y como Pub/Sub exige billing de
                        todas formas, el costo marginal es cero.
PRIVATE KEY REQUIRED  = NO
COSTO ESPERADO        = $0/mes dentro del free tier (±centavos de egress)
COMPLEJIDAD           = media: una plataforma más que operar, con un pipeline
                        de deploy propio y cold starts de ~1 s
```

### Lo que esto cambia respecto de la entrega 1

La entrega 1 decía «Supabase Edge Functions». **Cambia el runtime del backend de
Gmail, y nada más.** No cambian las seis tablas, ni la RLS, ni el cuerpo bajo
demanda, ni el índice, ni la UI.

Y conviene decir el costo real de cambiar, no sólo el beneficio:

| lo que se pierde | tamaño real |
|---|---|
| Una sola plataforma | pequeño: **no había ninguna Edge Function todavía** |
| Acceso directo a la base | Cloud Run escribe por HTTP con la service key |
| Latencia | cold start de ~1 s al abrir un hilo tras inactividad |

El sync no lo sufre: es asíncrono y nadie espera. Abrir un hilo sí, de vez en
cuando. Si molesta, se revisa con datos, no por adelantado.

### ¿Hacen falta Edge Functions además?

**No.** El front llama directo a Cloud Run, que valida el JWT de Supabase contra
`SUPABASE_JWKS`. Un solo backend. Meter Edge Functions como intermediario sería
un salto de red extra sin ninguna ganancia.

---

## I · Flujo de autenticación

```
Cloud Run  (service account adjunta, sin key en disco)
   │  1. credencial del metadata server
   ▼
iamcredentials.signJwt   name = …/serviceAccounts/buscatools-erp-email@…
   │     payload = { iss: SA,
   │                 sub: info@buscatools.com.ar,      ← el buzón, del allowlist
   │                 scope: "https://www.googleapis.com/auth/gmail.modify",
   │                 aud: "https://oauth2.googleapis.com/token",
   │                 iat, exp (≤ iat + 3600) }
   ▼  JWT firmado con la key que Google administra y nunca entrega
POST https://oauth2.googleapis.com/token
     grant_type = urn:ietf:params:oauth:grant-type:jwt-bearer
     assertion  = <JWT>
   ▼
access_token   (≤ 1 h)   →   Gmail API como info@buscatools.com.ar
```

**En ningún punto existe un archivo de private key.** La firma la hace Google
con la key administrada de la service account; el runtime sólo prueba, con la
credencial del metadata server, que tiene permiso para pedirla.

Los access tokens se cachean en memoria hasta unos minutos antes de `exp` y se
renuevan. **Nunca se persisten en la base.**

---

## J · Allowlist de buzones — obligatoria

El `sub` del JWT es literalmente «de qué buzón quiero leer el correo». Si eso
viniera del cliente, DWD dejaría de ser una delegación acotada y pasaría a ser
una llave del dominio entero.

```
ALLOWED_GMAIL_MAILBOXES = info@buscatools.com.ar        ← variable de entorno
```

Dos barreras, y hacen falta las dos:

1. **El `sub` nunca viene del request.** Se resuelve server-side: el cliente
   manda un `account_id`, el backend busca la fila en `email_accounts`, y de ahí
   sale la dirección.
2. **Esa dirección se compara contra el allowlist** antes de firmar nada. Si no
   está, se rechaza — aunque la fila exista en la base.

La segunda existe porque la primera no alcanza: si alguien lograra insertar una
fila en `email_accounts` con `user@otra-empresa.com`, sin el allowlist ya
tendría lectura de ese buzón. **El allowlist vive en la configuración del
backend, no en la base**, justamente para que comprometer la base no alcance.

**DWD puede técnicamente impersonar todo el dominio. El backend no debe
poder.**

### Multi-buzón futuro

Una empresa, N cuentas — el schema ya lo soporta. Agregar un buzón es agregar
una fila **y** agregarlo al allowlist. Que hagan falta las dos cosas es
deliberado: obliga a un despliegue consciente.

---

## K · Receptor de Pub/Sub

**Autenticado con OIDC.** Nada de un endpoint abierto porque «sólo Pub/Sub sabe
la URL», y nada de un secreto casero cuando Pub/Sub ofrece OIDC oficial.

De [authenticate push subscriptions](https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions),
el token llega en `Authorization: Bearer` y el endpoint **debe** validar:

| claim | valor esperado |
|---|---|
| firma | contra las claves públicas de Google |
| `iss` | `https://accounts.google.com` |
| `aud` | el audience configurado en la subscription |
| `email` | la SA de push configurada |
| `email_verified` | **`true`** |

Y el service agent `service-545134968830@gcp-sa-pubsub.iam.gserviceaccount.com`
necesita `roles/iam.serviceAccountTokenCreator` sobre la SA de push.

### Subscription propuesta — **no se crea todavía**

| | |
|---|---|
| Nombre | `gmail-buscatools-push` |
| Topic | `projects/buscatools-erp-email/topics/gmail-buscatools-events` |
| Tipo | push, **autenticado** |
| Endpoint | `https://<cloud-run>/gmail/push` |
| SA de push | una SA dedicada, con `roles/run.invoker` y nada más |
| Audience | la URL del servicio |
| Ack deadline | 60 s — el handler responde rápido y sincroniza aparte |
| Reintentos | backoff exponencial, 10 s → 600 s |
| Dead letter | **no en la v1**: reprocesar es idempotente y el `historyId` se recupera solo en la próxima notificación |

**El handler responde 200 apenas valida y persiste el evento.** Si sincronizara
antes de responder, un sync lento dispararía reintentos y tendríamos varios
syncs del mismo buzón compitiendo.

---

## L · Algoritmo de sincronización

```
push validado
   │
   ├─ ¿el mensaje trae emailAddress + historyId?   no → 200 y descartar
   ├─ resolver email_account por dirección          no está → 200 y registrar
   │
   ├─ TOMAR EL LEASE del buzón (ver O)              no se pudo → 200, otro está sincronizando
   │
   ├─ leer last_history_id
   ├─ si el historyId del evento <= last_history_id → nada que hacer, soltar y 200
   │
   ├─ history.list(startHistoryId = last_history_id)
   │     ├─ 200 → aplicar cambios página por página
   │     └─ 404 → RESYNC COMPLETO (ver M)
   │
   ├─ por cada hilo tocado: upsert en email_threads
   │     on conflict (account_id, gmail_thread_id) do update
   │
   ├─ persistir el historyId MÁS ALTO visto
   ├─ registrar en email_sync_log
   └─ soltar el lease  →  200
```

### Los casos raros, y qué hace cada uno

| caso | qué se hace |
|---|---|
| **Varios eventos juntos** | el lease serializa; el segundo ve el `historyId` ya avanzado y no hace nada |
| **Eventos fuera de orden** | se compara contra `last_history_id` y se descarta lo viejo. **Nunca se retrocede el cursor** |
| **`historyId` repetido** | idem: no hay trabajo pendiente, sale por 200 |
| **Gap** | no existe como problema: `history.list` devuelve *todo* lo ocurrido desde el cursor, no sólo lo del evento |
| **404** | resync completo |

**La notificación no trae los cambios, sólo el cursor.** Por eso perder
notificaciones —que Google admite: *«might be delayed or dropped»*— no pierde
correo: la próxima notificación arrastra todo lo anterior. Es exactamente lo
contrario de Make, que tomaba «los 25 más recientes» sin cursor.

---

## M · Historial vencido

Cuando `history.list` devuelve **404**, Google dice que hay que hacer un full
sync. Lo delicado es que un resync **no puede destruir estado del ERP**.

```
404
 ├─ registrar en email_sync_log con historial_vencido = true
 ├─ threads.list paginado → reconstruir email_threads (upsert)
 ├─ email_thread_state          NO SE TOCA
 ├─ email_thread_reads          NO SE TOCA
 └─ guardar el historyId nuevo
```

**Es exactamente para esto que las dos tablas están separadas**, y acá se ve el
valor de esa decisión: el índice se rehace, el estado sobrevive. Se reconcilian
solos porque las dos se atan por `(account_id, gmail_thread_id)`.

Regla dura, escrita para que no se relaje después:

> **El resync hace `upsert` sobre `email_threads`. Nunca `delete`.** Un hilo que
> ya no aparezca en Gmail queda marcado con `synced_at` viejo, y se decide
> aparte qué hacer. Borrar filas durante una recuperación de error es cómo se
> pierde lo que se quería salvar.

---

## N · Watch y su renovación

Google: *«You must call the watch at least once every 7 days»*, y recomienda
llamarlo **una vez por día**.

```
Cloud Scheduler  ·  diario
   └─ por cada email_account activa:
        users.watch(topicName = …/gmail-buscatools-events, labelIds = [INBOX])
        guardar  watch_expiration  e  history_id
```

Diario contra un vencimiento de 7 días deja **seis días de margen** si el cron
se cae.

Si falla: se registra en `email_sync_log`, se alerta, y **no se borra el watch
anterior** — mientras no venza, sigue sirviendo. Nada de loops agresivos: un
intento por corrida, y el backoff lo da la siguiente corrida.

Además, el mismo cron **compara el `historyId` de la respuesta contra
`last_history_id`**: si difieren, dispara un sync. Ésa es la red que atrapa las
notificaciones perdidas, sin volver a hacer polling.

`users.watch` cuesta 100 unidades; una vez por día es irrelevante contra 6.000
por minuto.

---

## O · Concurrencia — un lease, no un advisory lock

Dos eventos del mismo buzón no deben sincronizar en paralelo. Evalué tres
opciones y elijo una.

| opción | por qué no / por qué sí |
|---|---|
| `pg_advisory_xact_lock` | **no**: es de transacción, y el sync hace varias llamadas HTTP a Gmail. Habría que mantener una transacción abierta durante toda la sincronización |
| `pg_advisory_lock` de sesión | **no**: Cloud Run con conexiones pooleadas no garantiza la misma sesión, y un lock de sesión huérfano no se suelta solo |
| **lease en `email_accounts`** | **sí** |

```sql
update email_accounts
   set sync_lock_until = now() + interval '5 minutes',
       sync_lock_owner = p_owner
 where id = p_account
   and (sync_lock_until is null or sync_lock_until < now())
returning *;
```

**Una sola sentencia.** Si devuelve fila, el lease es tuyo; si no, otro está
sincronizando y se responde 200 sin hacer nada. Es el mismo patrón que ya
validamos con `FOR UPDATE SKIP LOCKED` en la cola de WhatsApp: **reclamar y
marcar en la misma operación**, nunca `SELECT` y después `UPDATE`.

Se auto-cura: si el proceso muere, el lease vence a los 5 minutos y el próximo
evento entra.

> **Por qué acá el vencimiento sí es seguro y en WhatsApp no.** En WhatsApp un
> mensaje trabado **no** se reintentaba, porque reenviar un mensaje que quizá
> salió se lo manda dos veces al cliente. Acá reintentar un sync es
> **idempotente**: el `upsert` por `(account_id, gmail_thread_id)` da el mismo
> resultado y el cursor sólo avanza. Son dos operaciones distintas y merecen dos
> políticas distintas.

---

## P · Secretos

**Ninguna private key de Google.**

| nombre | dónde | tipo |
|---|---|---|
| *(credencial de Google)* | **no existe** — SA adjunta vía metadata server | — |
| `SUPABASE_URL` | variable de entorno de Cloud Run | público |
| `SUPABASE_SERVICE_KEY` | **Secret Manager**, montado como secreto | **secreto** |
| `GOOGLE_PROJECT_ID` | env | público |
| `GMAIL_SERVICE_ACCOUNT_EMAIL` | env | público |
| `GMAIL_PUBSUB_TOPIC` | env | público |
| `ALLOWED_GMAIL_MAILBOXES` | env | no secreto, pero **crítico** |
| `PUBSUB_PUSH_SA_EMAIL` | env | público |
| `PUBSUB_PUSH_AUDIENCE` | env | público |

**No se crea ninguno en esta entrega.**

El único secreto real es la service key de Supabase. No es una key descargable
de Google y no habilita DWD: es la credencial de nuestra propia base, guardada
en Secret Manager en vez de en un archivo.

---

## Q · Errores y reintentos

| error | clase | qué hacer |
|---|---|---|
| Gmail **401** | **permanente hasta intervención** | el token o la delegación se rompieron. Registrar, alertar, **no reintentar en loop** |
| Gmail **403** `forbidden` | **permanente** | falta scope o falta la autorización de DWD. Alertar |
| Gmail **403** `rateLimitExceeded` | **reintentable** | backoff exponencial truncado, como recomienda Google |
| Gmail **404** en `history.list` | **esperado** | resync completo (ver M) |
| Gmail **404** en `messages.get` | **esperado** | el mensaje se borró entre el evento y la lectura. Saltear |
| Gmail **429** | **reintentable** | backoff |
| Gmail **5xx** | **reintentable** | backoff; si persiste, devolver != 200 y dejar que Pub/Sub reintente |
| Pub/Sub duplicado | **esperado** | idempotente por diseño; el cursor lo absorbe |
| Supabase caído | **reintentable** | **no** hacer ack: devolver 500 y que Pub/Sub reintente |

`min(((2^n)+random_number_milliseconds), maximum_backoff)`, máximo
*«typically 32 or 64 seconds»*, como indica Google.

La regla de fondo: **un error reintentable no se ackea**. Ackear un mensaje que
no se pudo procesar es perder el evento en silencio — que es el defecto que toda
esta fase viene a corregir.

---

## R · Logging

**Nunca se loguea:** cuerpos, asuntos, remitentes, contenido de adjuntos, access
tokens, aserciones JWT, headers de autorización, la service key.

**Sí se loguea:** `account_id`, `gmail_thread_id`, `history_id` de origen y
destino, cantidad de hilos tocados, código de error, duración.

Un `gmail_thread_id` es un identificador opaco: no dice quién escribió ni sobre
qué. Un asunto, sí — por eso no va.

---

## S · Cómo se prueba sin leer producción

**`info@` no se usa para tests.** Nunca.

| nivel | cómo |
|---|---|
| **Cliente Gmail falso** | una interfaz `GmailClient` con una implementación real y otra de mentira. El sync se prueba entero contra la falsa |
| **Fixtures** | respuestas grabadas de `history.list`, `threads.get` y `messages.get`, **anonimizadas a mano**. Ninguna sale de correo real |
| **Contract tests** | comprobar que las respuestas de mentira tienen la forma que documenta Google: `historyId` string, `internalDate` en epoch ms, `snippet` presente |
| **Casos que sí o sí** | 404 de historial, evento fuera de orden, evento repetido, dos eventos en paralelo, lease vencido, resync que **no** toca `email_thread_state` |
| **Buzón de prueba futuro** | una dirección aparte del dominio, agregada al allowlist sólo en el entorno de prueba |

El caso que más importa probar, porque es el que puede destruir datos: **un
resync completo conserva los estados del ERP**. Ése va con aserción sobre filas
concretas, no sobre conteos.

---

## T · `email_accounts` — ajustes al SQL propuesto

Revisado contra lo que este diseño necesita. Faltan tres columnas:

| columna | para qué |
|---|---|
| `auth_mode` | `dwd` o `oauth_user`, según cómo se haya resuelto el gate del Super Admin. El backend no debe adivinarlo |
| `sync_error` | el último error, para poder mostrar «esta cuenta dejó de sincronizar» sin leer los logs |
| `sync_lock_until` / `sync_lock_owner` | el lease de la sección O |

Ya están: `company_id`, `email_address`, `provider`, `active`,
`last_history_id`, `watch_expiration`, `last_synced_at`, `last_full_sync_at`.

**Y sigue sin guardar ningún secreto**, que es lo que no cambia.

`email_sync_log` sirve tal cual para `watch_renovado`, `push`, `cron`,
`manual`, `resync_completo` y errores: el `kind` ya contempla los cinco. **No se
loguea un mensaje por email**, sólo la transición.

El SQL propuesto se actualizó con estas columnas. **Sigue marcado PROPUESTA ·
NO EJECUTADO.**

---

## Autorización: backend contra Google ≠ usuario dentro del ERP

Son dos cosas distintas y se mantienen separadas.

```
A · backend ←→ Google      SA adjunta + signJwt + DWD
B · usuario ←→ ERP         sesión de Supabase, rol admin/employee, RLS
```

**Un admin autenticado en Supabase no recibe jamás un token de Gmail.** Pide un
hilo; el backend decide.

Al abrir un hilo, Cloud Run verifica **en este orden**:

1. el JWT de Supabase, contra `SUPABASE_JWKS`
2. que el usuario tenga rol `admin` o `employee` en la empresa de esa cuenta
3. que la cuenta pertenezca a esa empresa
4. que la dirección esté en el allowlist

Recién entonces firma la aserción y llama a Gmail.

### Cuándo el backend usa service key y cuándo no

| operación | credencial | por qué |
|---|---|---|
| Sync desde el push | **service key** | no hay usuario; es un proceso de servidor |
| Renovación del watch | **service key** | ídem |
| Abrir un hilo desde la UI | **el JWT del usuario**, para autorizar | la RLS decide si puede ver esa cuenta |
| Asignar, cambiar estado, vincular | **RPC**, con el JWT del usuario | queda auditado y respeta la RLS |

**No se usa service key para todo por comodidad.** El sync la necesita porque no
hay usuario detrás; la UI no, y ahí la autorización la da la RLS que ya está
diseñada.

---

## Riesgos

| riesgo | mitigación |
|---|---|
| **DWD alcanza a todo el dominio** | scope único `gmail.modify`, allowlist en configuración del backend, `sub` nunca del cliente |
| **Sin billing no hay Pub/Sub** | **bloquea la entrega 3**. Hay que vincular una cuenta de facturación |
| Cold start de ~1 s al abrir un hilo | aceptado; `min-instances=1` costaría dinero real |
| Una plataforma más que operar | asumido a cambio de no tener una key descargable |
| La service key de Supabase en Cloud Run | Secret Manager, no variable de entorno plana |
| Que un resync borre estado del ERP | tablas separadas + regla de `upsert`, nunca `delete` + test dedicado |
| Alguien «simplifica» metiendo la key JSON | queda escrito acá que eso deja de ser keyless |

---

## Decisión final

```
BACKEND RECOMENDADO   = Google Cloud Run, servicio único, con service account
                        adjunta

AUTH GOOGLE           = service account adjunta
                        → iamcredentials.signJwt (claim sub = buzón)
                        → grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
                        → access token con DWD

JSON PRIVATE KEY      = NO. Ninguna, en ningún momento.
                        La key la administra Google y nunca se descarga.

PUBSUB AUTH           = push autenticado con OIDC. Se valida firma, iss
                        (accounts.google.com), aud, email de la SA de push y
                        email_verified = true.

WATCH RENEWAL         = Cloud Scheduler diario (Google exige cada 7 días).
                        El mismo cron compara historyId y dispara sync si
                        difiere: red para notificaciones perdidas.

SYNC LOCK             = lease en email_accounts.sync_lock_until, reclamado con
                        UNA sentencia UPDATE … WHERE … RETURNING.
                        Vence a los 5 minutos y se auto-cura, porque el sync
                        es idempotente.

COSTO ESTIMADO        = $0/mes dentro del free tier, a ~28 emails/día.
                        Requiere cuenta de facturación vinculada, que Pub/Sub
                        exige de todos modos.

RIESGO PRINCIPAL      = DWD puede impersonar cualquier buzón del dominio.
                        Todo el diseño de J existe para que el backend no
                        pueda, aunque técnicamente podría.
```

---

## Qué hace falta antes de la entrega 3

Ninguna de estas la hago yo en esta entrega.

| # | acción | quién |
|---|---|---|
| 1 | **Vincular una cuenta de facturación** al proyecto `buscatools-erp-email` | vos — **bloquea todo lo demás** |
| 2 | Confirmar el gate de la entrega 1: ¿hay Super Admin para autorizar DWD? | vos |
| 3 | Habilitar `iamcredentials.googleapis.com` y `run.googleapis.com` | entrega 3 |
| 4 | Crear la SA de runtime y la de push, con los roles de E | entrega 3 |
| 5 | Desplegar Cloud Run y crear la subscription de K | entrega 3 |
| 6 | Ejecutar el SQL de las seis tablas | entrega 3 |
| 7 | `users.watch` — **lo último**, cuando todo lo demás esté probado | entrega 3 |

---

# ESTA ENTREGA NO EJECUTÓ NADA

No se creó backend. No se ejecutó SQL. No se creó la subscription. No se inició
`users.watch`. No se leyó Gmail. No se crearon secretos. No se programó React.
No se tocó el proyecto de Google.
