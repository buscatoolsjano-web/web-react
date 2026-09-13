# Fase 9 · Emails — Entrega 5: redactar, responder, reenviar y borradores

> ## ENTREGA 5 — cierre
>
> El ERP manda correo **con Gmail como fuente de verdad**: borradores reales de
> Gmail (sin tabla propia), mail nuevo, responder, responder a todos y reenviar,
> con adjuntos. Cada envío pasa por un registro **idempotente y firmado** en
> Supabase; un doble click, dos pestañas o diez requests simultáneos son **un**
> correo.
>
> Dos envíos reales autorizados, a una cuenta externa controlada, sobre el hilo de
> prueba. El primero probó el camino completo (hilo, cabeceras, adjunto con el
> mismo hash, push, no leído intacto) y destapó que **Gmail reemplaza el
> Message-ID**: la reconciliación de un envío incierto, tal como estaba, no podía
> funcionar en producción. Se rehízo con una cabecera propia, `X-BT-Request-Id`, y
> el segundo envío probó en Gmail real que la cabecera sobrevive y que la
> reconciliación cierra el envío **sin mandarlo de nuevo**.

---

## A · Alcance

| flujo | estado | probado en Gmail real |
|---|---|---|
| responder | ✅ | **sí** — 2 envíos |
| adjunto saliente | ✅ | **sí** — 1 PNG, mismo nombre, tamaño y SHA-256 |
| mail nuevo | ✅ | no — Gmail falso + unit/integración/API |
| responder a todos | ✅ | no — Gmail falso + unit/integración/API |
| reenviar | ✅ | no — Gmail falso + unit/integración/API |
| borradores (crear, autoguardar, retomar, descartar) | ✅ | **no**, por decisión: no crear efectos productivos innecesarios |

Fuera de alcance, como se pidió: migrar los 91 estados, archivar / spam /
papelera, WhatsApp, Informes.

## B · Arquitectura

```
navegador ──JWT──▶ buscatools-erp-email-api (Cloud Run, público por diseño)
                     │  valida forma → autoriza con el JWT (RLS) → allowlist
                     ├─▶ Supabase: RPC firmadas (HMAC) de email_send_requests
                     └─▶ Gmail (DWD, sin private key): drafts.* / messages.send
Gmail ──push──▶ buscatools-erp-email (privado) ──▶ email_threads ──Realtime──▶ bandeja
```

| ruta (servicio público) | qué hace |
|---|---|
| `GET /gmail/drafts` | borradores del buzón, o de un hilo |
| `GET /gmail/draft` | un borrador, listo para seguir editando |
| `POST /gmail/draft` | crear o actualizar (`drafts.create` / `drafts.update`) |
| `DELETE /gmail/draft` | descartar (`drafts.delete`, definitivo) + evento |
| `POST /gmail/send` | enviar, idempotente por `client_request_id` |

Lo que el cliente **no decide nunca**: el From (sale de la cuenta autorizada), el
HTML (el servidor lo arma escapando el texto), el hilo, `In-Reply-To` y
`References` de una respuesta (salen del mensaje original leído de Gmail y
validado contra el hilo autorizado), el asunto de una respuesta.

Nada de esto persiste cuerpo, destinatarios, MIME ni adjuntos en Supabase.

## C · Redactar, responder, responder a todos, reenviar

- **Destinatarios iniciales** (`lib/destinatarios.ts`): responder va a `Reply-To`
  si existe, si no al remitente; si el mensaje es propio, a sus destinatarios.
  Responder a todos agrega To + Cc **sin la dirección propia ni duplicados**.
- **Asunto**: en una respuesta es de sólo lectura (`Re: …`, calculado en el
  servidor): Gmail sólo mantiene el hilo si coincide. En un reenvío, `Fwd: …`.
- **Cita**: se arma desde el mensaje original **leído de Gmail**, convertido a
  texto y escapado — nunca se reinyecta HTML entrante. Respuesta:
  «El {fecha}, {de} escribió:» + líneas `> `. Reenvío: bloque «Mensaje reenviado»
  con De, Fecha, Asunto, Para y Cc.
- **Hilo**: responder y responder a todos mandan `threadId`, `In-Reply-To` y
  `References` (sin duplicados, tope 20). Un reenvío abre un hilo nuevo.
- **HTML saliente**: el cliente manda **sólo texto**; el servidor genera
  `multipart/alternative` con texto y HTML escapado, con enlaces sólo `http/https`.
- **Adjuntos**: nuevos (base64), del borrador (por `partId`) o del original (sólo
  del mensaje referenciado y de ese hilo). Con adjuntos, `multipart/mixed`, nombre
  con `filename` + `filename*=UTF-8''`; un tipo MIME raro viaja como
  `application/octet-stream`.

## D · Validación de entrada — antes de la base y de Gmail

`leerEntrada()` rechaza con **422** y el campo, sin tocar Supabase ni Gmail:

- dirección inválida, con CR/LF, coma o `<>` (intento de colar destinatarios);
- sin destinatarios **al enviar** (un borrador sí puede no tenerlos, como en Gmail);
- **controles en el asunto** (CR, LF, NUL…) → `asunto`;
- **cualquier campo fuera de la lista**: `from`, `de`, `reply_to`, `headers`,
  `raw`… → `campo_desconocido` (antes se ignoraban en silencio; ahora el cliente se
  entera). Lo mismo dentro de cada adjunto;
- `client_request_id` que no sea uuid, `account_id` mal formado, modo inventado,
  respuesta sin `thread_id` / `ref_message_id`;
- adjunto con base64 inválido, tipo inventado, id mal formado, más de 20.

Límites v1: 10 MB de adjuntos en total, 20 archivos, 100 destinatarios, 100.000
caracteres de texto propio, asunto 500, cuerpo JSON 15 MB. El MIME además aplana
controles en nombres visibles y nombres de archivo, y sólo acepta cabeceras extra
`X-BT-*`.

## E · Borradores — el draftId es la identidad

- **Sin tabla de borradores.** Viven en Gmail; si alguien crea uno desde Gmail,
  aparece en `#/emails/borradores`.
- **Identidad: el `draftId` que devuelve Gmail.** Guardar, actualizar, leer,
  enviar y descartar van siempre por `draftId`. Un borrador borrado fuera del ERP
  se recrea con lo escrito y se avisa (`recreado`).
- **`X-BT-Compose`** (`v1; modo; ref; thread`) es **metadata secundaria** para
  retomarlo con su modo y su mensaje de referencia. **No verificado contra Gmail
  real** (no se creó ningún borrador productivo). Por eso retomar no depende de
  ella:

| origen del modo (`modo_origen`) | cuándo |
|---|---|
| `cabecera` | `X-BT-Compose` presente |
| `in_reply_to` | sin cabecera: el `In-Reply-To` del borrador coincide **exacto** con el Message-ID de **un** mensaje de su hilo (Gmail conserva `In-Reply-To`: medido en los dos envíos reales) |
| `contexto` | sin nada de lo anterior: la pantalla desde donde se abrió (hilo + mensaje), **validada** contra la RLS y Gmail |
| `sin_datos` | se retoma como mail nuevo, con el contenido intacto |

Una inferencia que no valida no se usa. Un reenvío retomado vuelve con el hilo
**del original** (ver S: estaba mal).

- **Autoguardado**: 2,5 s después de dejar de escribir, un guardado a la vez con
  cola; no genera eventos. Estados visibles: «Guardando…», «Borrador guardado»,
  «Cambios sin guardar», «Borrador no guardado» + reintentar. `beforeunload`
  avisa si hay cambios sin guardar o un envío en curso.
- **Retomar**: desde el hilo se ofrece «Seguir el borrador» (sólo borradores del
  mismo modo) o «Empezar uno nuevo». La cita se separa del texto propio.
- **Descartar**: confirmación, `drafts.delete`, y un evento sólo si existía.
- **Compartidos**: los borradores son del buzón; cualquier admin/employee de la
  empresa los ve.

## F · Envío — `email_send_requests`

Una fila por intento lógico de envío, con `unique (account_id, client_request_id)`:

| columna | |
|---|---|
| `operation` | `nuevo` · `responder` · `responder_todos` · `reenviar` |
| `status` | `reservado` · `enviado` · `fallido` · `incierto` |
| `gmail_message_id`, `gmail_thread_id` | los que devuelve Gmail; `enviado` ⇔ hay message id (check) |
| `error_code` | ≤ 60 caracteres, sin el error crudo |
| `intentos` | sube al re-reservar un `fallido` |
| `created_at` | creación de la fila |
| `attempted_at` | **último intento**: se fija al reservar y al re-reservar |
| `completed_at` | al cerrar `enviado` o `fallido` |

Transiciones: `reservado → enviado | fallido | incierto` · `incierto → enviado |
incierto` · `fallido → reservado` (reintento) · `enviado` es final.

**Nadie toca la tabla desde el cliente**: RLS sin policies y sin privilegios. Sólo
las RPC `reservar_envio_email`, `completar_envio_email` y
`registrar_descarte_borrador_email`, que además del JWT exigen una **firma
HMAC-SHA256** que sólo producen la base y el servicio público: el navegador, con el
mismo JWT, no puede marcar un envío como hecho ni fabricar un evento.

Límites de seguridad en la base: 30 envíos por persona por hora y 400 por cuenta
por día (los `fallido` no cuentan) → 429 con `Retry-After`.

## G · Idempotencia

1. El frontend genera el `client_request_id` **una vez** y lo deja en la URL
   (`envio=`): un refresh a mitad de envío verifica, no manda otro.
2. El servidor valida y autoriza **antes** de reservar: un rol sin acceso no deja
   ni una fila.
3. `INSERT … ON CONFLICT DO NOTHING`: de N requests simultáneos con el mismo id,
   **uno** es dueño del envío; el resto recibe `en_curso` o el resultado.
4. Un id ya `enviado` devuelve el mismo resultado (`repetido: true`) sin volver a
   Gmail. El mismo id usado por otra persona u otra operación → rechazado.
5. `en_curso` en la pantalla se re-verifica cada 3 s, hasta 10 veces, **con el
   mismo id**.

Medido: 10 requests simultáneos → 1 fila, 1 llamada a Gmail, 1 evento (en memoria,
y contra la **base real** con Gmail falso); en el navegador, triple click → 1
envío.

## H · Resultado incierto y reconciliación

**Hallazgo del primer envío real:** Gmail **reemplaza el Message-ID** que manda el
servicio por uno propio (`<…@mail.gmail.com>`) y reescribe `Date`. La primera
versión reconciliaba buscando `rfc822msgid:` con un Message-ID determinístico:
en producción **nunca lo habría encontrado**. No podía duplicar (un incierto nunca
se reenvía), pero tampoco confirmar.

**Ahora:**

- El Message-ID es aleatorio y válido, y **no es una clave**.
- Cada envío lleva `X-BT-Request-Id: <client_request_id>` (los borradores no).
- Un intento **incierto** (5xx, red o timeout de un método no idempotente), o una
  reserva abandonada (> 120 s desde `attempted_at` sin cerrar), se reconcilia al
  reintentar **con el mismo id**:
  1. `messages.list` en **SENT (incluida la papelera)** con
     `after:` / `before:` = **[attempted_at − 5 min, attempted_at + 15 min]**,
     paginado, tope **100** mensajes;
  2. de cada uno, **sólo** la cabecera `X-BT-Request-Id` (`format=metadata`);
  3. coincidencia **exacta** con el `client_request_id`.

| resultado de la búsqueda | qué pasa | motivo |
|---|---|---|
| **exactamente 1** | cierra `enviado` con el message id y el thread id de Gmail; **1** evento | — |
| **0** | sigue `incierto` | `sin_coincidencia` |
| **más de 1** | sigue `incierto`, **no elige ninguno**, `error_code = conflicto_request_id:N`, log de error | `conflicto` |
| la ventana superó el tope | sigue `incierto` (no prueba que no haya otro) | `busqueda_incompleta` |
| Gmail no respondió | sigue `incierto`, la fila no se toca | `busqueda_fallida` |

**Nunca** se cierra por hilo + destinatario + hora + asunto: eso no prueba que sea
este envío. **Nunca** se reenvía solo un incierto. `created_at` no sirve de centro
de la ventana: un `fallido` re-reservado horas después lo conserva — por eso
`attempted_at`.

La pantalla muestra un aviso distinto por motivo, siempre con «No lo reenvíes» y
un botón «Verificar» que usa el **mismo** id.

## I · Reintentos contra Gmail

| política | métodos | reintenta |
|---|---|---|
| `lectura` | gets y lists | 429, 5xx, red |
| `idempotente` | `drafts.update`, `drafts.delete`, watch | 429, 5xx, red |
| `no_idempotente` | `drafts.create`, `messages.send`, `drafts.send` | **sólo 429**; 5xx/red/timeout → `ResultadoIncierto` |

Backoff exponencial con jitter completo, 4 intentos, base 400 ms, tope 8 s,
respeta `Retry-After`. Esto salda la deuda de reintentos 429/5xx de la entrega 3.

## J · Eventos

`email_enviado` · `respuesta_enviada` · `respuesta_a_todos_enviada` ·
`reenvio_enviado` · `borrador_descartado`. **Uno** por envío cerrado (lo inserta
`completar_envio_email`), con `gmail_message_id`, `client_request_id` e `intentos`
— nada de cuerpo ni destinatarios. El autoguardado **no** deja eventos.

Enviar **no cambia el workflow** del hilo (no se copia el `respondido` automático
del legacy). Cuando el sync indexa la respuesta, el hilo queda leído en el ERP
**sólo para quien respondió**. Gmail no se toca: ni no leído ni etiquetas.

## K · Autocompletar destinatarios

`autocompletar_destinatarios_email(p_company, p_q)` (SECURITY INVOKER, ≥ 2
caracteres, 10 resultados): contactos del CRM, emails de clientes e historial del
índice, con el cliente y **en cuántos clientes figura** una dirección. Sin tabla
`email_contacts`. Un vendedor no recibe direcciones del historial; otra empresa,
nada.

## L · Pantalla

- Rutas: `#/emails/redactar` (nuevo o `?borrador=`), `#/emails/borradores`, y el
  composer dentro del hilo (`?componer=&mensaje=&borrador=&envio=`).
- Botones Responder / Responder a todos / Reenviar en cada mensaje; «Nuevo email»
  y «Borradores» en la bandeja.
- Destinatarios como chips, con error por dirección inválida que bloquea enviar.
- Medido con Gmail falso y sesión real en 390, 430, 768 y 1440 px: sin scroll
  horizontal; en puntero táctil, todos los controles ≥ 44 px y los campos con
  letra ≥ 16 px.
- Los avisos por motivo de incierto (H) no se revisaron visualmente al final: la
  sesión del navegador había expirado y no se ingresan contraseñas. Están
  cubiertos por typecheck, lint y tests.

## M · GCP — clave HMAC en Secret Manager

| | |
|---|---|
| secreto | `email-api-hmac`, versión 1 |
| quién lo lee | **sólo** `buscatools-email-api@…` (`secretAccessor` sobre ese secreto) |
| cómo llega al servicio | variable `EMAIL_API_HMAC` **por referencia** (`secretKeyRef`) |
| carga | base → memoria → stdin de gcloud; nunca impreso ni en disco; verificado igual byte a byte |
| exposición | **0** apariciones del valor en revision config, `services describe`, salida del deploy, build y logs de Cloud Run, build y Secret Manager |
| revisión productiva | `buscatools-erp-email-api-00004-t8k` · min 0 · max 3 · 256 MiB · 60 s · CORS sólo `app.buscatools.com` y `localhost:5173` |

SA del servicio público: **sin roles de proyecto**, 0 keys administradas por el
usuario; sólo `serviceAccountTokenCreator` sobre la SA de DWD y el acceso a
`email-api-hmac`. No puede leer `supabase-service-key`. El servicio privado
(push/watch/sync) no se tocó.

## N · Base de datos

Migraciones, en orden (texto completo en
`docs/database/PHASE_9_EMAILS_ENTREGA_5.sql`):

1. `fase9_emails_entrega5_envios` — `email_send_requests`, `app.email_api_secretos`, RPC firmadas
2. `fase9_emails_entrega5_eventos` — acciones nuevas en `email_events`
3. `fase9_emails_entrega5_autocompletar`
4. `fase9_emails_entrega5_exportar_clave_temporal` — temporal, borrada por la siguiente
5. `fase9_emails_entrega5_clave_servicio` — `clave_api_email_servicio`, sólo `service_role`
6. `fase9_emails_entrega5_attempted_at` — columna + versión definitiva de `reservar_envio_email`

Advisors: para lo de esta entrega sólo los avisos esperados (tablas con RLS y sin
policies — acceso nulo a propósito; RPC SECURITY DEFINER ejecutables por
`authenticated` que sin firma no hacen nada, probado). Sin EXECUTE público, sin
policies para `anon`.

## O · Red team — contra la API desplegada, sin enviar

`scripts/fase9-emails-entrega5-api-redteam.mjs`, **100 PASS / 0 FAIL** sobre
`00004-t8k`. Los ataques de identidad usan un cuerpo que pasa la validación de
forma pero se corta en el servidor **antes de Gmail**; si una identidad sin permiso
pasara la autorización por un bug, se vería como una reserva y la suite falla.

- sin JWT, JWT alterado, JWT basura, `alg=none` con `service_role`, la clave
  publicable como Bearer → 401/404 sin contenido, en las cinco rutas;
- salesperson, technician, customer, distributor → 404 en enviar, responder,
  crear / leer / listar / descartar borrador;
- empresa ajena, cuenta ajena, hilo fuera del índice, cuenta inexistente,
  `client_request_id` de otra persona → 404;
- admin y employee pasan la autorización (control positivo, 0 Gmail);
- 22 casos de validación → 422 con su campo y **0 filas**;
- CORS: sólo los dos orígenes; `evil.test` y `null` rechazados.

El red team de la entrega 4 sigue en verde sobre `00004-t8k` (33/0).

## P · Pruebas reales en Gmail — dos envíos autorizados

Destino: una cuenta externa controlada por el usuario. Hilo: el correo de prueba
de la entrega 4. Nada de terceros.

### Envío 1 — responder con adjunto

| verificación | resultado |
|---|---|
| mismo hilo en Gmail | ✅ |
| `In-Reply-To` y `References` = Message-ID del original | ✅ |
| From `"Buscatools · info@"`, asunto `Re: …` | ✅ |
| un solo mensaje enviado, una fila, **un** `respuesta_enviada` | ✅ |
| push → sync → índice, sin hilo duplicado | ✅ ~4,6 s después de que Gmail lo guardó |
| adjunto PNG: mismo nombre, tamaño y SHA-256, bajado por la API | ✅ |
| `UNREAD` del original intacto | ✅ |
| 0 cuerpo / MIME / adjunto en Supabase; 0 objetos en Storage | ✅ |
| logs de los dos servicios limpios | ✅ |
| **Message-ID** | ❌ **reemplazado por Gmail** → origen del cambio de H |

Las etiquetas `INBOX` y una de usuario sobre el enviado vienen de un **filtro
existente del buzón** (los enviados a esa dirección de agosto, anteriores al ERP,
las tienen igual); el código de envío no manda etiquetas.

### Envío 2 — reconciliación real

Responder, sin adjunto, sobre `00004-t8k`.

| verificación | resultado |
|---|---|
| Message-ID guardado por Gmail | **reemplazado** otra vez |
| `X-BT-Request-Id` guardado por Gmail | **presente** — **CUSTOM_HEADER_SURVIVES = YES** |
| valor = `client_request_id` | **idéntico**, carácter por carácter |
| hilo, `In-Reply-To`, `References` (cadena de 2) | ✅ |

Después del envío exitoso se forzó **sólo esa fila**, con guardas por id, request
id, estado y message id: `status → incierto`, `gmail_message_id → null`,
`gmail_thread_id → null`, `completed_at → null` (`updated_at` lo movió el trigger;
`error_code`, `intentos`, `created_at`, `attempted_at` intactos), y se borró **sólo
el evento de ese envío**. Gmail no se tocó.

Llamada a la API con el **mismo** `client_request_id` →
`enviado`, `repetido: true`, **mismo** message id y thread id, en 2,3 s.

| criterio | medido |
|---|---|
| mensajes de esta prueba en Gmail | **1** (el hilo tenía 3 antes y 3 después de reconciliar) |
| filas de este request | **1**, `enviado` |
| eventos finales de este request | **1** |
| segundo envío | **no** — Gmail sin mensaje nuevo, y ningún push durante la reconciliación |
| push del envío | 1, ~4 s, sin hilo duplicado |
| logs | 0 cuerpos, direcciones, JWT, tokens, secretos, MIME, `X-BT-*` o request ids |

Estado final: 2 envíos reales en total · 2 filas `enviado` · 2 `respuesta_enviada`
· 0 duplicados · 0 filas inciertas · 0 fixtures `zz-` · 0 objetos en Storage.

## Q · Sin prueba real, limitaciones y deuda

**No probado en Gmail real** (no presentarlo como tal):

- **mail nuevo, reenviar, responder a todos** — Gmail falso + unit, integración
  contra la base real y API;
- **borradores reales** — ni crear, ni actualizar, ni retomar, ni descartar;
- **`X-BT-Compose` en Gmail real** — no verificado. No bloquea: el `draftId` es la
  identidad y retomar tiene respaldo (E).

**Limitaciones conocidas:**

- Un incierto sin coincidencia única **queda incierto**: la persona revisa Enviados
  en Gmail. Es a propósito.
- Un borrador que se está guardando justo al recargar no queda en la URL; sigue en
  Gmail y aparece en Borradores (`beforeunload` avisa en un navegador real).
- Reenvío retomado **sin** `X-BT-Compose` ni pantalla de origen: vuelve como mail
  nuevo (contenido y adjuntos intactos; el evento sería `email_enviado`).
- Sin imágenes inline (`cid:`) al redactar; adjuntos hasta 10 MB en total.
- Sin firma configurable (la del legacy era sólo del cotizador de Make).
- Borradores compartidos por todos los admin/employee del buzón.

**Deuda, sin cambio en esta entrega:**

- throttling del resync completo (entrega 3) — sin cambios; no hubo volumen que lo pida;
- política de limpieza de Artifact Registry — propuesta, no aplicada (2 deploys más en esta entrega);
- retención de `email_sync_log` — sigue pendiente;
- workflow automático al responder — no se cambió; si se quiere, es una decisión aparte.

## R · Datos y logs

- Supabase: **0** columnas de cuerpo, HTML, MIME o adjuntos en `email_*`; el índice
  sólo guarda el snippet de Gmail (≤ 201 caracteres, diseño de las entregas 3/4).
- Logs del servicio público: `evento`, `ruta`, `metodo`, `estado`, `motivo`,
  status y milisegundos. Escaneados después de cada deploy y de cada envío real:
  0 JWT, Bearer, `ya29.`, clave publicable completa, clave HMAC, direcciones,
  cuerpos, MIME, base64 largo, `X-BT-*` o request ids.

## S · Bugs y hallazgos corregidos

1. **Gmail reemplaza el Message-ID** (producción) → reconciliación por
   `X-BT-Request-Id` + `attempted_at` (H).
2. **Carrera al re-reservar un `fallido`**: la reserva vencida se medía desde
   `created_at`; un doble click horas después marcaba incierto un envío en curso →
   `attempted_at`.
3. **Reenvío retomado con el hilo equivocado**: devolvía el hilo nuevo del borrador
   y enviarlo daba 404 → usa el hilo del original.
4. **Lo escrito se perdía en el primer autoguardado**: escribir `borrador=` en la
   URL remontaba el composer.
5. **Cambios de URL que se pisaban**: `setSearchParams(fn)` recibe los params del
   último render; el envío borraba el `borrador=` → `useParamsUrl`.
6. **El composer se escondía** si cambiaba la URL a mitad de edición → la consulta
   de borradores se hace una vez por apertura.
7. **Borrador sin destinatarios rechazado** → se permite al guardar, no al enviar.
8. **`from`, `headers`, CR/LF en el asunto** se ignoraban o aplanaban en vez de
   rechazarse → 422 (D).
9. Rol `listbox` incorrecto en las sugerencias.

## T · Pruebas

| suite | resultado |
|---|---|
| backend (`npm run backend:check`) | **152 PASS** + 4 de base real opt-in; typecheck incluyendo tests |
| base real con Gmail falso (`E5_DB_REAL=1`) | **4/4**: 10 simultáneos → 1; incierto reconciliado; incierto sin envío nunca reenvía; conflicto real |
| mutaciones | **9/9 atrapadas** (conflicto, cabecera, heurística débil, búsqueda incompleta, vencida desde creación, ventana, hilo del reenvío, `In-Reply-To`, pista sin validar) |
| búsqueda real de reconciliación (`fetch` interceptado) | 5/5: SENT + papelera, ventana, sólo la cabecera, match exacto, tope |
| frontend | **605 PASS** (Emails: 55) · lint · typecheck · build |
| `fase9-emails-entrega5-tests` con API | **0 fallos** |
| red team entrega 5 / entrega 4 | **100/0** · **33/0** |
| regresión en serie (13 suites: Emails 0.5/e3/e4/e5, WhatsApp, Catálogo ×2, Ventas, Clientes, Compras, Mantenimiento, seguridad ×2) | **0 fallos**, antes del fix de reconciliación; después cambió sólo `email_send_requests` y su RPC → se re-corrieron backend, frontend, la suite de la entrega 5 y el red team |

## U · Deploy

- Servicio público: `buscatools-erp-email-api-00004-t8k`, 100 % del tráfico.
- Servicio privado sin cambios en esta entrega.
- Frontend: GitHub Pages por CI al hacer push a `main`.

## Criterios de cierre

| | |
|---|---|
| borradores reales de Gmail sin tabla propia | ✅ |
| nuevo / responder / responder a todos / reenviar | ✅ (responder probado en real) |
| adjuntos salientes | ✅ probado en real |
| idempotencia (doble click, dos pestañas, concurrencia) | ✅ medido |
| resultado incierto sin reenvío ciego | ✅ reconciliación probada en real |
| hilo correcto (`threadId`, `In-Reply-To`, `References`, asunto) | ✅ probado en real |
| MIME RFC | ✅ |
| From del servidor; validación e inyección | ✅ |
| autocompletar CRM | ✅ |
| eventos, sin autoguardado, sin workflow automático | ✅ |
| clave en Secret Manager, IAM mínimo, sin exposición | ✅ |
| red team, regresión, logs limpios | ✅ |
