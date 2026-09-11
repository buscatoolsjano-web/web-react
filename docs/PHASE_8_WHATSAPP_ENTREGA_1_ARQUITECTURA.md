# Fase 8 · WhatsApp — Entrega 1: arquitectura, schema y RLS

**PROPUESTA. No se ejecutó nada.**

No se creó ninguna tabla, no se aplicó ninguna migración, no se tocó Meta, no se
registró ningún número, no se generó ningún token, no se creó ningún webhook, no
se creó ningún bucket, no se programó React, no se migró el histórico y no se
mandó ningún mensaje.

---

## A · Documentación oficial verificada

**Consultada el 11 de septiembre de 2026.** Todo lo que sigue sale de estas
páginas, no de memoria ni de tutoriales.

| tema | fuente |
|---|---|
| Alta y terminología | [Cloud API · Get Started](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started) |
| Webhooks: handshake y firma | [Graph API · Webhooks Getting Started](https://developers.facebook.com/docs/graph-api/webhooks/getting-started) |
| Componentes del webhook | [Cloud API · Webhooks Components](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components) |
| Ventana y tipos de mensaje | [Cloud API · Send Messages](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages) |
| Precios y categorías | [Pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) · [Pricing updates July 2025](https://developers.facebook.com/docs/whatsapp/pricing/updates-to-pricing/) |
| Media y límites | [Cloud API · Media Reference](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media) |
| Números de teléfono | [Business phone numbers](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers) |
| Coexistencia | [Onboard WhatsApp Business app users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users) |
| Estados y errores | [Status messages webhook reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status) |
| Secretos del backend | [Supabase · Edge Function Secrets](https://supabase.com/docs/guides/functions/secrets) · [Securing Edge Functions](https://supabase.com/docs/guides/functions/auth) |

### Lo que cambió respecto de lo que «se sabía»

Cuatro cosas que conviene no dar por sentadas:

1. **Ya no se llama Business Manager.** La entidad actual es **Meta Business
   Portfolio**.
2. **El precio ya no es por conversación.** Desde el **1 de julio de 2025** es
   **por mensaje**; el modelo por conversación está *deprecated*. Y Meta **no
   cobra** los mensajes de servicio ni las plantillas *utility* enviadas dentro
   de una ventana abierta.
3. **Un mismo mensaje puede disparar un webhook de éxito y otro de fallo.**
   Pasa cuando el usuario tiene WhatsApp en varios dispositivos. El estado **no
   es una progresión monótona**, y el diseño tiene que soportarlo.
4. **La lógica de errores va sobre `code` y `error_data.details`, no sobre los
   títulos**: Meta avisa que los títulos se van a deprecar.

---

## B · Qué hay que crear en Meta

Checklist con los nombres actuales. **No se hizo nada de esto.**

| # | paso | dónde | qué queda |
|---|---|---|---|
| 1 | Elegir o crear un **Meta Business Portfolio** | Meta Business Suite | la identidad de la empresa |
| 2 | Crear una **Meta App** con el caso de uso *«Connect with customers through WhatsApp»* | Meta App Dashboard | `app_id`, **`app_secret`** |
| 3 | Agregar el producto **WhatsApp** a la app | App Dashboard | — |
| 4 | Crear o conectar una **WhatsApp Business Account (WABA)** | panel *API Setup* | **`waba_id`** |
| 5 | Agregar el **business phone number** y verificarlo (SMS o llamada) | WhatsApp Manager | **`phone_number_id`**, `display_phone_number` |
| 6 | Llamar al endpoint **`register`** | API | el número queda *connected* |
| 7 | Crear un **System User** y su **access token** permanente | Business Settings | **token server-side** |
| 8 | Dar los tres permisos al token | Business Settings | ver abajo |
| 9 | Configurar el **webhook**: URL HTTPS pública + **verify token** | App Dashboard | — |
| 10 | Suscribir los campos `messages` de la WABA | App Dashboard | — |
| 11 | Crear **message templates** | WhatsApp Manager | sólo si hace falta salir de la ventana |

**Los tres permisos del token**, textuales de la documentación:

```
business_management
whatsapp_business_messaging
whatsapp_business_management
```

Un detalle que la documentación marca y es fácil saltear: agregar el número por
el panel **verifica la propiedad pero no completa el alta en Cloud API**. Hay
que llamar aparte al endpoint `register`.

---

## C · El número

Acá hay una decisión tuya, y las opciones no son las que uno supone.

| opción | ¿se puede? | qué implica |
|---|---|---|
| **Número nuevo** | sí | lo más limpio. Hay que difundirlo: nadie lo tiene agendado |
| **El número actual, si está en WhatsApp común (Messenger)** | **hay que borrarlo primero** | la documentación es explícita: *«Numbers already in use with WhatsApp cannot be registered unless they are deleted first»*. **Se pierde el historial del teléfono** |
| **El número actual, si está en la app WhatsApp Business** | **sí, con coexistencia** | se puede usar la app **y** Cloud API a la vez, y *«WhatsApp keeps messaging history between both apps in sync»* |
| Número en otra plataforma | migración | hay un flujo específico de migración de número |

### La distinción que importa

Las dos páginas oficiales parecen contradecirse y no lo hacen:

- **WhatsApp de consumidor (Messenger): NO hay coexistencia.** Hay que borrar
  el número de la app primero.
- **App WhatsApp Business: SÍ hay coexistencia.**

Dos salvedades sobre la coexistencia, medidas en la documentación:

- El *throughput* queda **fijo en 20 mensajes por segundo** mientras el número
  esté en los dos lados.
- Está documentada dentro del flujo de **Embedded Signup**, que es el camino de
  los *Solution / Tech Providers*. Para una empresa que se da de alta sola,
  **hay que confirmar si el camino directo la ofrece**. Es lo primero que
  averiguaría antes de tocar el número que usa el negocio.

**Recomendación:** empezar con un **número nuevo** para la entrega 1. Permite
construir y probar todo sin poner en riesgo el número que el negocio ya usa, y
la decisión de migrar o coexistir se toma después, con el sistema andando.

---

## D · Propiedad de la cuenta

Todo bajo una identidad de la empresa, no de una persona:

| activo | dueño propuesto |
|---|---|
| Meta Business Portfolio | **Buscatools** |
| Meta App | Buscatools |
| WABA | Buscatools |
| Número | Buscatools |
| Facturación | Buscatools |
| Token del System User | Buscatools · **sólo server-side** |
| Webhook | infraestructura de Buscatools |

El worker de IA ya dejó la lección: el proyecto se llama
`buscatools-jano.workers.dev`, o sea que vive bajo una cuenta personal. **No
repetir eso con WhatsApp**, que es infraestructura crítica: si mañana hay que
rotar un token o responder un incidente, no puede depender de una sola persona.

---

## E · Arquitectura

```
ENTRANTES
   WhatsApp Cloud API
        │ POST firmado (X-Hub-Signature-256)
        ▼
   Edge Function  wa-webhook          ← valida firma, responde 200 rápido
        │ inserta
        ▼
   Supabase (conversations, messages, media pendiente)
        │ Realtime
        ▼
   React

MEDIA ENTRANTE (asíncrono)
   Edge Function  wa-media-fetch
        │ GET /MEDIA_ID → URL (vence a los 5 min) → descarga con token
        ▼
   Storage privado  +  metadata en whatsapp_media

SALIENTES
   React
        │ RPC  enviar_mensaje_whatsapp(...)   ← valida permiso y ventana
        ▼
   fila en whatsapp_messages  status='pending'
        │
        ▼
   Edge Function  wa-send  (cron + disparo)
        │ POST a Cloud API
        ▼
   provider_message_id  →  status='sent'
        │
   webhook de estado → sent / delivered / read / failed
        ▼
   Supabase → Realtime → React
```

**Se conserva la buena idea del legacy: la base de datos es la cola y el estado
interno.** Lo que cambia es que ningún secreto vive en el navegador y que el
que despacha es un backend, no una PC con un `.vbs`.

---

## F · Backend: Edge Functions vs Cloudflare Worker

| criterio | Supabase Edge Functions | Cloudflare Worker |
|---|---|---|
| Secretos | `Deno.env.get()`, server-side, se setean por CLI o panel y **aplican sin redeploy** | `wrangler secret put`, también server-side |
| Webhook sin JWT | **sí**: `verify_jwt = false` en `config.toml` | sí, nativo |
| Acceso a Postgres | **mismo proyecto**, sin salto de red ni de proveedor | HTTP a Supabase desde otra nube |
| Cuerpo crudo para la firma | disponible | disponible |
| Latencia | región del proyecto (us-west-2) | *edge*, mejor |
| Logs | integrados con el proyecto | panel de Cloudflare |
| Costo | incluido en el plan | plan gratuito generoso |
| Mantenimiento | **un solo lugar** | **dos proveedores** |
| *Vendor lock-in* | Deno estándar, portable | Workers runtime, algo más atado |
| Desarrollo | `supabase functions serve` local | `wrangler dev` |

### Recomendación: **Supabase Edge Functions**

Tres razones, en orden de peso:

1. **El trabajo del webhook es escribir en Postgres.** Cada evento termina en
   una fila. Ponerlo en otra nube agrega un salto de red y una credencial de
   Supabase más que administrar, a cambio de unos milisegundos de latencia que
   a Meta no le importan.
2. **Un solo lugar donde viven los secretos.** Hoy ya hay dos proveedores y la
   entrega 0.5 mostró lo que cuesta rotar un secreto que vive lejos.
3. **`buscatools-ai` no debe ser el webhook de WhatsApp.** Es un worker de IA,
   con su propio secreto, su propio propósito y su propio historial de
   exposición. Mezclarlos sería juntar dos superficies de ataque que no tienen
   por qué tocarse. **Responsabilidades separadas** (punto 52).

Cloudflare seguiría siendo la opción si más adelante hiciera falta latencia de
*edge* o procesamiento antes de tocar la base. Hoy no hace falta.

### Las tres funciones

| función | `verify_jwt` | qué hace |
|---|---|---|
| `wa-webhook` | **false** | verifica el handshake, valida la firma, persiste el evento, responde 200. **Nada pesado antes de responder** |
| `wa-send` | true (o cron) | toma los `pending`, llama a Cloud API, guarda `provider_message_id` |
| `wa-media-fetch` | true (o cron) | baja la media entrante y la sube a Storage |

---

## G · Webhook

### Verificación inicial

`GET` con `hub.mode=subscribe`, `hub.challenge`, `hub.verify_token`. Se compara
el *verify token* contra el secreto y se devuelve el `hub.challenge`.

### Autenticidad de cada evento

`POST` firmado con **HMAC-SHA256** sobre el **cuerpo crudo**, usando el
**App Secret**, en el header:

```
X-Hub-Signature-256: sha256=<firma>
```

Tres cosas que hay que hacer bien y es fácil hacer mal:

- **Comparar en tiempo constante**, no con `===`.
- **Firmar sobre el cuerpo crudo**, antes de parsear el JSON: si se reserializa,
  la firma no coincide.
- **Rechazar si falta la firma.** Nunca un modo permisivo «por si acaso».

### Reintentos de Meta

La documentación es clara: si la entrega falla, Meta **reintenta durante 36
horas** con frecuencia decreciente, y **recomienda explícitamente implementar
deduplicación**. O sea que los eventos repetidos no son un caso raro: son parte
del contrato.

### Orden de trabajo dentro de la función

```
1. validar firma            → si falla, 401 y listo
2. persistir el evento crudo (whatsapp_webhook_events)
3. responder 200            ← acá termina lo que Meta espera
4. procesar (mismo invoke o cron): upsert de conversación, mensaje, estado
```

**No hacer lógica pesada antes de responder.** Bajar media, resolver clientes o
cualquier cosa que pueda tardar va después del 200.

---

## H · Seguridad de credenciales

| secreto | dónde vive | quién lo lee |
|---|---|---|
| Access token del System User | **Edge Function secret** | sólo `wa-send` y `wa-media-fetch` |
| App Secret (firma) | **Edge Function secret** | sólo `wa-webhook` |
| Verify token del webhook | **Edge Function secret** | sólo `wa-webhook` |
| `service_role` de Supabase | ya disponible dentro de la función | nunca el navegador |

**Nunca**: en React, en `VITE_*`, en `localStorage`, en Git, en una tabla, ni en
el bundle. **`whatsapp_accounts` no guarda ningún token** — sólo los
identificadores públicos.

Y **no se reutiliza `WORKER_SECRET`**: WhatsApp tiene sus propios secretos.

---

## I · Fuente de verdad

| entidad | fuente de verdad | por qué |
|---|---|---|
| **Conversación** | **Supabase** | es un concepto nuestro: asignación, etiquetas, vínculo con el cliente. Meta no tiene «conversación» en ese sentido |
| **Mensaje entrante** | **Meta**, espejado en Supabase | `wamid` es la identidad; nosotros guardamos la copia |
| **Mensaje saliente** | **Supabase** | nace acá como `pending`: la tabla **es** la cola |
| **Estado de entrega** | **Meta** | sólo Meta sabe si llegó. Nosotros lo registramos |
| **Media** | **Supabase Storage** | el ID de Meta vence: a los 7 días si vino de un webhook, 30 si lo subimos nosotros. **El archivo tiene que ser nuestro** |
| **No leído** | **derivado** | por usuario, calculado; ver **L** |
| **Contacto** | **el CRM** (`customers`, `customer_contacts`) | WhatsApp aporta metadata del contacto, no el maestro |

**Meta no se consulta por polling.** Lo que llega, llega por webhook.

---

## J · Identidad, teléfonos y `@lid`

### La buena noticia

El problema de `@lid` que rompía el legacy **es un artefacto de Baileys**. Cloud
API entrega en `from` un **`wa_id`, que es un número de teléfono**, y en
`contacts[].profile.name` el nombre. Los 5 de 8 chats sin teléfono usable no se
repiten con la API oficial.

### Aun así, el diseño no ata la identidad al teléfono

```
provider_contact_id   text    NOT NULL   ← el wa_id que entrega Meta
phone_e164            text    NULL       ← normalizado, cuando se puede
phone_raw             text    NULL       ← tal como vino
```

La clave de la conversación es **`(account_id, provider_contact_id)`**, nunca el
teléfono. Si Meta entrega alguna vez un identificador que no es un teléfono, se
guarda igual y `phone_e164` queda en `NULL`. **No se inventa un E.164.**

### Normalización: una sola función

```sql
app.normalizar_telefono(p_crudo text) returns text
```

Una sola, server-side, usada por el webhook, por el matching y por la búsqueda.
El legacy tenía **tres** tratamientos distintos y por eso nada cruzaba.

Reglas propuestas:

- Quitar todo lo que no sea dígito.
- Si ya viene con código de país (Cloud API lo entrega así), anteponer `+`.
- Si no se puede determinar el país, **devolver `NULL`**. No asumir Argentina.

Se conservan **las dos**: la cruda y la normalizada.

---

## K · Vínculo con el CRM

`customer_id` y `customer_contact_id` son **NULLABLE**, y no es un detalle: hoy
sólo **3 de 1010** clientes tienen teléfono cargado, y **0 de 8** conversaciones
legacy cruzaban. **Se puede conversar sin cliente asociado.**

El matching se propone así, y **sólo la primera clase vincula sola**:

| clase | criterio | acción |
|---|---|---|
| **EXACT UNIQUE** | un único `phone_e164` idéntico | vincula automático |
| **NORMALIZED UNIQUE** | un único match por la regla documentada | **sugiere**, no vincula |
| **AMBIGUOUS** | más de un candidato | muestra los candidatos |
| **NO MATCH** | ninguno | ofrece buscar o crear |

**Nunca se cruza por nombre.** Es la regla que viene de Clientes y de Compras, y
acá vale igual.

La regla normalizada para Argentina es la que el legacy ya tenía pensada —los
**últimos 8 dígitos**, que absorbe `+54 9 11`, `011` y `11`— pero documentada en
un solo lugar en vez de escrita tres veces.

**Crear un cliente desde el chat no entra en la v1.** Queda el punto de
extensión: un chat sin vincular ofrece «Buscar cliente» y, más adelante, «Crear
cliente». **Nunca automático**: un mensaje de alguien preguntando un precio no
es un cliente.

---

## L · No leídos

El legacy tenía un contador **global**: si Juan abría un chat, se apagaba para
todos. Con varios empleados atendiendo, eso es un error de diseño.

**Propuesta: `whatsapp_conversation_reads`.**

```
conversation_id   → whatsapp_conversations
user_id           → profiles
last_read_at      timestamptz
PRIMARY KEY (conversation_id, user_id)
```

El no leído **no se guarda**: se calcula.

```
no_leidos(conversación, usuario) =
  mensajes entrantes con provider_timestamp > coalesce(last_read_at, '-infinity')
```

| opción | por qué no |
|---|---|
| contador persistido por usuario | hay que mantenerlo con triggers y deriva con el tiempo |
| booleano global | es exactamente el problema del legacy |

Es la misma decisión que se tomó con los indicadores de torque: **lo derivado no
se guarda**, porque guardarlo crea la posibilidad de que el número guardado y el
real dejen de coincidir.

Para el rendimiento: **una sola consulta agrupada** para la página visible de
conversaciones, no una por fila.

---

## M · Mensajes salientes e idempotencia

```
React
  → RPC enviar_mensaje_whatsapp(conversación, texto | plantilla, client_request_id)
      · verifica permiso y empresa
      · verifica la ventana (ver N) — SERVER-SIDE
      · inserta status='pending' con client_request_id
  → wa-send toma los pending
      · POST a Cloud API
      · guarda provider_message_id, status='sent'
  → webhook de estado
```

**Dos clics, un mensaje.** La garantía es un `UNIQUE (account_id,
client_request_id)`: el segundo intento choca contra el índice y no crea nada. El
`client_request_id` lo genera el navegador (`crypto.randomUUID()`) **una vez por
acción**, no por clic.

Y del lado del despacho, `wa-send` toma las filas con `FOR UPDATE SKIP LOCKED`,
que es lo que evita que dos ejecuciones manden el mismo mensaje. Es el mismo
patrón del `for update` que ya usan `confirmar_entrega()` y
`cerrar_orden_mantenimiento()`.

---

## N · Ventana de conversación

Verificado hoy: la **customer service window** es de **24 horas** desde que el
usuario escribe o llama, y **se reinicia** con cada mensaje del usuario. Dentro
de la ventana se puede mandar texto libre; fuera, hace falta una **plantilla
aprobada**.

**La decisión es server-side, siempre.** El frontend puede mostrar el estado,
pero quien decide es la RPC:

```
ventana_abierta(conversación) =
  existe un mensaje entrante con provider_timestamp > now() - interval '24 hours'
```

Si está cerrada, la RPC **rechaza** el texto libre y exige plantilla. Esconder el
botón no alcanza — es la misma regla que venimos aplicando en todo el ERP.

---

## O · Plantillas

Las cuatro categorías actuales: **marketing**, **utility**, **authentication** y
**service**. Con el precio por mensaje desde julio de 2025, Meta **no cobra** los
mensajes de servicio ni las *utility* enviadas dentro de una ventana abierta.

**No se propone `whatsapp_templates` en la v1.** Razón: las plantillas viven en
Meta y su estado cambia allá —aprobada, rechazada, pausada—. Una tabla local
sería una copia que se desactualiza sin avisar. En la v1 se leen de Meta en el
momento de usarlas.

Si más adelante hace falta un selector de plantillas en la UI, se agrega una
**caché con TTL corto**, no un maestro.

---

## P · Media

**No se repite el error del legacy**: nada de base64 en Postgres.

```
Storage privado, bucket nuevo «whatsapp»
  <company_id>/<account_id>/<conversation_id>/<message_id>-<uuid>.<ext>
```

Un bucket nuevo y no el `ventas` existente, por una razón concreta: la media de
WhatsApp va a tener **política de retención propia** (ver **V**), y mezclarla con
los adjuntos de Ventas obligaría a distinguirlos por prefijo para poder
aplicarla.

La tabla guarda **sólo metadata**:

```
provider_media_id · mime_type · file_name · size_bytes · sha256
storage_path · caption · status (pendiente|descargada|fallida) · expires_at
```

### Entrante

El webhook trae un **media id**, no el archivo:

```
webhook → media_id → wa-media-fetch
   GET /MEDIA_ID          → devuelve una URL
   la URL vence a los 5 MINUTOS
   descargar CON el token  ← «If you omit your token, the request will fail»
   → Storage privado → metadata
```

**Urgente de verdad**: el media id de un webhook **vence a los 7 días**. Si no se
baja, se pierde. Por eso la descarga es un trabajo con reintentos, no un
«mejor esfuerzo».

### Saliente

```
React → Storage privado (subida directa, con RLS)
      → wa-send: POST /PHONE_NUMBER_ID/media → media id (vale 30 días)
      → enviar el mensaje referenciando ese id
```

**El token de Meta nunca toca el navegador**, ni para subir ni para bajar.

### Límites oficiales

Verificados hoy. **Validar server-side, no sólo en el navegador**:

| tipo | formatos | máximo |
|---|---|---|
| Imagen | JPEG, PNG | **5 MB** |
| Audio | AAC, AMR, MP3, M4A, OGG | **16 MB** |
| Video | 3GP, MP4 | **16 MB** |
| Documento | TXT, XLS(X), DOC(X), PPT(X), PDF | **100 MB** |
| Sticker | WebP estático / animado | **100 KB / 500 KB** |

El legacy validaba 8 MB para todo, en el cliente, y sin lista de tipos.

---

## Q · Tipos de mensaje

| tipo | v1 | comentario |
|---|---|---|
| `text` | **V1** | el 82 % del legacy |
| `image` | **V1** | |
| `audio` | **V1** | notas de voz |
| `document` | **V1** | presupuestos, fichas técnicas |
| `video` | **V1** | |
| `sticker` | **V1 recibir**, futuro enviar | 7 en el legacy |
| `reaction` | **V1 recibir** | mostrarla; enviarla después |
| `location` | **V1 recibir** | mostrar el mapa; enviar después |
| `contacts` | recibir y mostrar | |
| `interactive` (botones, listas, Flows) | **FUTURO** | necesita diseño de producto |
| `template` | **V1 enviar** | obligatorio fuera de la ventana |
| `unsupported` | **V1** | guardar y mostrar «tipo no soportado», nunca perder el mensaje |

La regla: **todo lo que llega se guarda**, aunque no se sepa dibujar. Un mensaje
que el sistema no entiende y descarta es un mensaje que el cliente cree que
leímos.

---

## R · Estados

Los oficiales verificados: **`sent`**, **`delivered`**, **`read`**, **`failed`**.
Más el nuestro, **`pending`**, que sólo existe mientras la fila está en la cola.

```
pending → sent → delivered → read
   └──────────→ failed
```

**Pero no se asume esa progresión.** La documentación dice que un mismo mensaje
puede disparar **éxito y fallo a la vez** con varios dispositivos. Propuesta:

- Guardar el estado **con su timestamp**: `sent_at`, `delivered_at`, `read_at`,
  `failed_at`. Cada webhook llena su columna.
- El `status` visible es **derivado por precedencia**, no por último en llegar:
  `read > delivered > sent > failed > pending`.
- Guardar **`provider_status` crudo** para depurar.
- Un estado repetido es **idempotente**: llena una columna que ya tenía valor.

Los errores se guardan como **`error_code` + `error_details`**, siguiendo la
recomendación de Meta de no construir lógica sobre los títulos.

---

## S · Reintentos y dead letter

| clase de error | qué hacer |
|---|---|
| red / timeout | reintentar con backoff |
| **rate limit** | reintentar respetando el backoff, sin acelerar |
| 5xx de Meta | reintentar con backoff |
| destinatario inválido | **permanente**, no reintentar |
| plantilla rechazada | **permanente** |
| token inválido | **permanente** y **alertar**: es un problema de configuración |
| fuera de ventana | **permanente**: hay que mandar plantilla |

```
attempts        int         default 0
next_attempt_at timestamptz
last_error      text
```

Backoff exponencial, **máximo 5 intentos**, y después `status='failed'` con su
`error_code`. **Nunca reintento infinito** — la lección del polling de 2
segundos.

**El mensaje fallido no desaparece**: queda en el hilo, marcado, con el motivo y
un botón de reintentar, como ya hacía el legacy. No hace falta una tabla de
*dead letter*: el estado `failed` con `attempts = 5` **es** la dead letter, y
está donde el usuario la ve.

---

## T · Idempotencia entrante

| caso | garantía |
|---|---|
| webhook repetido con el mismo mensaje | `UNIQUE (account_id, provider_message_id)` |
| status repetido | llena una columna que ya tenía valor: sin efecto |
| evento repetido | `UNIQUE (provider_event_id)` en `whatsapp_webhook_events` |

El legacy tenía **0 duplicados en 150 mensajes** con `wa_id`, o sea que el
enfoque ya estaba probado. Acá se formaliza con un índice en vez de confiar en
que el puente lo haga bien.

---

## U · Orden temporal

Tres marcas de tiempo, y cada una responde algo distinto:

| columna | qué es |
|---|---|
| `provider_timestamp` | cuándo ocurrió, según Meta |
| `received_at` | cuándo lo recibió nuestro webhook |
| `created_at` | cuándo se escribió la fila |

**El hilo se ordena por `provider_timestamp`**, con desempate por `id`. Un
webhook demorado se acomoda en su lugar, no al final. El legacy ordenaba
mezclando el reloj del puente con el del navegador, y por eso podía desordenarse.

---

## V · Retención

Propuestas, **no aplicadas**:

| dato | retención | por qué |
|---|---|---|
| `whatsapp_messages` | **indefinida** | es el histórico comercial |
| `whatsapp_media` (archivos) | **a definir — decisión tuya** | crece rápido: 56 archivos = 22 MB en una tarde |
| `whatsapp_webhook_events` | **30 días** | es para depurar, no es fuente de verdad |
| `whatsapp_conversation_reads` | mientras exista la conversación | una fila por usuario y chat |

El punto 58 marcaba lo importante: **los payloads crudos no pueden crecer para
siempre**. Por eso `whatsapp_webhook_events` nace con retención, no se la agrega
después.

---

## W · Borrado

**No hay borrado físico desde la UI.** Es explícito porque el legacy tenía dos
botones —«Vaciar mensajes» y «Eliminar conversación»— que hacían `DELETE` de
verdad contra la base, desde el navegador.

En su lugar: **`archived_at`**. La conversación se archiva, sale de la bandeja y
sigue estando. Y hay una razón técnica además de la comercial: **Meta puede
seguir mandando estados de un mensaje borrado**, y un webhook que busca una fila
que ya no existe es un error que no se puede resolver.

---

## X · Multiempresa y varios números

```
companies 1 ──── N whatsapp_accounts 1 ──── N whatsapp_conversations
```

Una empresa puede tener **N números**. La v1 usa uno, pero el schema no lo
supone: no hay ningún `phone_number_id` global ni nada atado a Buscatools. Es la
lección de Mantenimiento, donde el legacy tenía una sola línea cableada.

Cada conversación pertenece a una cuenta, y cada cuenta a una empresa. El
`company_id` se desnormaliza en `conversations` y `messages` **para que la RLS no
tenga que hacer un join en cada fila** — y con la regla que ya conocemos: **la
fila hija no se autoriza por su propio `company_id`**, se valida contra el de su
padre con un trigger de coherencia, igual que en Mantenimiento.

---

## Y · Las tablas propuestas

**Seis.** Justificadas una por una, no por simetría.

### 1 · `whatsapp_accounts` — **SÍ**

Sin ella no hay multiempresa ni varios números. Guarda `waba_id`,
`phone_number_id`, `display_phone_number`, `company_id`, `active`.
**Ningún token.**

### 2 · `whatsapp_conversations` — **SÍ**

La unidad de la bandeja y donde vive lo nuestro: asignación, vínculo con el
cliente, archivado, último mensaje. Identidad
`(account_id, provider_contact_id)`.

### 3 · `whatsapp_messages` — **SÍ**

El hilo **y la cola de salida**. Ver el punto siguiente.

### 4 · `whatsapp_media` — **SÍ**, y es la que más dudé

El argumento para no tenerla: un mensaje de Cloud API tiene como mucho un
archivo, así que podrían ser columnas en `messages`.

El argumento que gana: **la media existe antes y después del mensaje**. Entrante,
llega un id y el archivo se baja después —con su propio estado y sus reintentos—
mientras el mensaje ya se muestra. Saliente, el archivo se sube **antes** de que
exista el mensaje. Meterle ese ciclo de vida a `messages` sería darle a la fila
del mensaje dos estados que avanzan por separado.

### 5 · `whatsapp_conversation_reads` — **SÍ**

Es la única forma de que el no leído sea por usuario. Ver **L**.

### 6 · `whatsapp_webhook_events` — **SÍ, con retención de 30 días**

Depurar un webhook que no se puede reproducir es casi imposible sin el payload.
Nace con retención para que no sea otro `audit_logs` infinito.

### Las que **NO** se proponen

| tabla | por qué no |
|---|---|
| **`whatsapp_outbox`** | **la cola es `whatsapp_messages` con `status='pending'`**. Una tabla aparte agrega un join para dibujar el hilo y un momento en que el mensaje existe en un lado y no en el otro. El legacy lo hizo así y funcionó. Un outbox separado se justifica con muchos productores y ruteo complejo: no es el caso |
| **`whatsapp_templates`** | viven en Meta y su estado cambia allá; una copia local se desactualiza en silencio. Ver **O** |
| **`whatsapp_contacts`** | **`customers` y `customer_contacts` ya son el maestro**. La metadata externa del contacto —el *pushname*— va en la conversación. Son dos conceptos distintos y crear un tercer maestro sería empezar a duplicar clientes |

---

## Z · RLS

### El helper que falta

Los roles reales del ERP son siete y hay cinco en uso. Los helpers existentes
no sirven tal cual:

| helper | incluye |
|---|---|
| `app.current_writer_company_ids()` | admin, employee |
| `app.current_internal_company_ids()` | admin, employee, salesperson, **technician** |

La política que proponés —admin, employee y salesperson **sí**, technician
**no**— no coincide con ninguno. **Hace falta un helper propio:**

```sql
app.current_whatsapp_company_ids()  →  admin, employee, salesperson
```

Uno nuevo y no reutilizar `current_internal_company_ids()`, porque el día que se
agregue un technician de verdad no queremos que herede WhatsApp por accidente.

### La matriz

| tabla | rol | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|---|
| **`whatsapp_accounts`** | admin | ✅ | ❌ | ❌ | ❌ |
| | employee · salesperson | ✅ | ❌ | ❌ | ❌ |
| | technician · customer · distributor · anon | ❌ | ❌ | ❌ | ❌ |
| | backend | ✅ | ✅ | ✅ | ❌ |
| **`whatsapp_conversations`** | admin · employee · salesperson | ✅ | ❌ | ⚠️ | ❌ |
| | technician · customer · distributor · anon | ❌ | ❌ | ❌ | ❌ |
| | backend | ✅ | ✅ | ✅ | ❌ |
| **`whatsapp_messages`** | admin · employee · salesperson | ✅ | ❌ | ❌ | ❌ |
| | technician · customer · distributor · anon | ❌ | ❌ | ❌ | ❌ |
| | backend | ✅ | ✅ | ✅ | ❌ |
| **`whatsapp_media`** | admin · employee · salesperson | ✅ | ❌ | ❌ | ❌ |
| | technician · customer · distributor · anon | ❌ | ❌ | ❌ | ❌ |
| | backend | ✅ | ✅ | ✅ | ❌ |
| **`whatsapp_conversation_reads`** | admin · employee · salesperson | ⚠️ propias | ⚠️ propias | ⚠️ propias | ❌ |
| | el resto · anon | ❌ | ❌ | ❌ | ❌ |
| | backend | ✅ | ✅ | ✅ | ❌ |
| **`whatsapp_webhook_events`** | **todos los roles de aplicación** | ❌ | ❌ | ❌ | ❌ |
| | backend | ✅ | ✅ | ✅ | ✅ |

⚠️ = acotado. En conversaciones, el `UPDATE` sólo alcanza a los campos de
trabajo —`assigned_to`, `archived_at`, `customer_id`— y **no** a los del
proveedor. Se hace con una RPC, no con un `UPDATE` libre.

### Las dos reglas que vienen de las fases anteriores

1. **`whatsapp_messages` no acepta `INSERT` desde el cliente.** Ni siquiera para
   mandar: para eso está la RPC, que valida permiso, empresa y ventana. Es
   exactamente la lección de O4 — que la capa de privilegios impida la escritura
   directa aunque mañana alguien escriba mal una policy.
2. **Ninguna policy sin `TO`.** `create policy` sin `TO` queda en `TO PUBLIC`.
   Todas van `TO authenticated`.

### Storage

Bucket **privado** `whatsapp`. La policy de lectura se ata a **poder ver la
conversación**, no a conocer la ruta — que es justo lo que la entrega 0.5
encontró mal resuelto en el legacy. URLs firmadas **cortas** (5 minutos, como en
Mantenimiento). Nunca una URL pública permanente.

---

## AA · Realtime

| tabla | eventos | para qué |
|---|---|---|
| `whatsapp_messages` | INSERT, UPDATE | mensajes nuevos y cambios de estado |
| `whatsapp_conversations` | INSERT, UPDATE | orden de la bandeja, asignación |

**Y se usa el payload**, no como el legacy, que ante cualquier evento volvía a
bajar todo. Un `INSERT` agrega una burbuja; un `UPDATE` de estado cambia un tick.

**Objetivo: 0 polling continuo.** Nada de `setInterval` de 2 segundos. Lo que sí
hay:

- una carga inicial,
- paginación al subir,
- **reconexión** con un `fetch` de lo perdido desde el último `provider_timestamp`
  conocido,
- refresco manual.

Meta: pasar de **90 requests/min y 20,7 MB/hora** a un WebSocket y unas pocas
consultas por sesión.

### Paginación

- **Conversaciones**: server-side, ordenadas por `last_message_at desc`, con
  cursor.
- **Mensajes**: cursor por `(provider_timestamp, id)`, no `offset` — con
  `offset` una fila nueva desplaza la página y se repiten o se saltean mensajes.
- **Media**: perezosa, y **nunca en el listado de conversaciones**.

### Búsqueda en la v1

Por **nombre**, **teléfono** (cuando existe) y **cliente vinculado**. El
*full-text* sobre el cuerpo de los mensajes queda para después: no se crean
índices caros sin necesidad.

---

## AB · Datos legacy

8 conversaciones, 150 mensajes, 56 archivos, de una sola tarde del 24 de agosto.
Respaldados fuera del repo con sha256.

| opción | costo | valor |
|---|---|---|
| **A · No migrar, sólo backup** | cero | el respaldo ya existe y es consultable |
| **B · Migrar como archivo de sólo lectura** | medio: una tabla aparte y una pantalla | ver 3 horas de conversaciones de hace un mes |
| **C · Migrar al modelo nuevo sin vínculo de cliente** | alto: los `@lid` no son teléfonos, así que 5 de 8 conversaciones no tendrían identidad válida en el modelo nuevo | contamina el modelo nuevo con datos que no encajan |

**Recomendación: A.** No por pereza: los datos **no encajan** en el modelo nuevo.
Cinco de las ocho conversaciones tienen un identificador de Baileys que Cloud API
nunca va a volver a emitir, así que entrarían como filas que no se pueden
continuar ni vincular. El respaldo ya está hecho y verificado; si alguna vez hace
falta leer esas tres horas, está el JSON.

Es la misma conclusión que en Mantenimiento con los 4 registros de prueba, y por
la misma razón: **no migrar cache como si fuera histórico**.

---

## AC · IA (futuro, no en la v1)

No se implementa nada de IA en esta entrega. Lo que sí conviene dejar decidido
para no cerrarse puertas:

- **La IA no recibe la conversación automáticamente.** Tiene que haber una
  acción humana. El legacy tenía un modo «responde sola» y, aunque estaba
  apagado, no es el punto de partida.
- **No se reutiliza `WORKER_SECRET`.** WhatsApp y la IA son superficies
  distintas; juntarlas es repetir lo que la entrega 0.5 vino a separar.
- El contenido del cliente que va a un prompt es **superficie de inyección**. Ya
  lo anoté en la entrega 0 y vale más todavía si el agente tiene acceso a stock
  y cuenta corriente.
- Casos que valen la pena después: **sugerir respuesta**, **resumir la
  conversación**, **buscar el producto o el cliente**.

---

## Frontend (tentativo, sin implementar)

```
#/whatsapp                     bandeja
#/whatsapp/:conversationId     conversación abierta
```

| componente | qué hace |
|---|---|
| `Inbox` | el contenedor de tres paneles |
| `ConversationList` | lista paginada, con búsqueda y filtros |
| `MessageThread` | hilo con scroll infinito hacia arriba |
| `Composer` | texto, adjunto, y **el estado de la ventana** |
| `MediaViewer` | imagen, audio, video, documento, con URL firmada |
| `CustomerSidebar` | cliente vinculado, o el buscador para vincularlo |

La diferencia con el legacy: la ficha del cliente **va a tener datos**, porque
lee el CRM real en vez de un array vacío.

---

## Riesgos

| # | riesgo | mitigación propuesta |
|---|---|---|
| **R1** | El número que usa el negocio hoy está en WhatsApp de consumidor: pasarlo **borra el historial del teléfono** | empezar con un número nuevo; decidir la migración después |
| **R2** | La coexistencia está documentada en el flujo de *Tech Provider*: puede no estar disponible para un alta directa | confirmarlo **antes** de prometerla |
| **R3** | El media id del webhook **vence a los 7 días** | la descarga es un trabajo con reintentos, no «mejor esfuerzo» |
| **R4** | La URL de media vence a los **5 minutos** | pedirla justo antes de descargar, nunca guardarla |
| **R5** | Un mensaje puede recibir estado de éxito **y** de fallo | estado derivado por precedencia, no por último evento |
| **R6** | Meta reintenta 36 horas: los duplicados son parte del contrato | unicidad por `provider_message_id` y por evento |
| **R7** | Aprobación de plantillas: no es inmediata | no depender de plantillas para la v1 más allá de lo imprescindible |
| **R8** | Costo por mensaje desde julio 2025 | el servicio y las *utility* dentro de ventana no se cobran; medir antes de escalar |
| **R9** | Calidad del número y límites de mensajería | no importar contactos ni mandar en masa al principio |
| **R10** | Sin teléfonos en el CRM (3 de 1010), el vínculo automático casi no va a disparar | asumirlo: `customer_id` nullable y vínculo manual cómodo |

---

## Decisiones que necesito de vos

Cinco. El resto lo resuelvo con evidencia.

**1 · El número.**
¿Número nuevo, o el que usa el negocio hoy? Si es el actual: ¿está en WhatsApp
común o en la app WhatsApp Business? La respuesta cambia si se puede conservar
el historial o hay que borrarlo del teléfono.
*Mi recomendación: número nuevo para la v1.*

**2 · ¿Salesperson ve WhatsApp?**
La matriz de arriba dice que sí. Si preferís que sea sólo admin y employee —como
Mantenimiento y Compras—, se simplifica y no hace falta un helper nuevo.

**3 · Los 150 mensajes del legacy.**
¿Sólo el backup (**A**), o querés poder leerlos desde la aplicación nueva (**B**)?
*Mi recomendación: A.*

**4 · Retención de la media.**
¿Cuánto tiempo se guardan las imágenes y audios? Son 22 MB en una tarde de
prueba. Opciones razonables: para siempre, 2 años, o 1 año con las adjuntas a un
documento conservadas aparte.

**5 · ¿Asignación de conversaciones en la v1?**
Es barato (`assigned_to` nullable) y el legacy ya lo tenía. Pero si nadie lo va a
usar, es una columna y una UI de más.

---

## Plan de las siguientes entregas

| entrega | qué | depende de |
|---|---|---|
| **1.5 · Alta en Meta** | portfolio, app, WABA, número, token de System User, webhook | decisión **1** |
| **2 · Schema y RLS** | las 6 tablas, el helper, la normalización, el bucket, la matriz probada con JWT reales | decisiones **2** y **5** |
| **3 · Webhook entrante** | `wa-webhook`, firma, idempotencia, conversaciones y mensajes entrantes |  |
| **4 · Bandeja de sólo lectura** | listar, abrir, leer, buscar, paginar, Realtime con payload |  |
| **5 · Envío** | RPC, cola, `wa-send`, estados, reintentos, ventana |  |
| **6 · Media** | `wa-media-fetch`, Storage, subida saliente, límites |  |
| **7 · Cierre** | E2E, RLS final, mobile, egress medido, regresión |  |

**No hay entrega de migración de datos**, por lo de **AB**.

---

# ESTA ENTREGA NO EJECUTÓ NADA

El SQL propuesto está en
[`docs/database/PHASE_8_WHATSAPP_PROPOSAL.sql`](database/PHASE_8_WHATSAPP_PROPOSAL.sql),
**sin aplicar**.
