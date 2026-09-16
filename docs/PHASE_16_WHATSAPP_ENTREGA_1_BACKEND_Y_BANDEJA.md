# FASE 16 · WHATSAPP CLOUD API — ENTREGA 1: BACKEND Y BANDEJA

> Integración **oficial** con WhatsApp Business Platform de Meta. Sin WhatsApp Web, sin Baileys,
> sin WappFly, sin BSP, sin el puente legacy y sin scraping.
>
> **Estado: el código está completo y probado; la integración NO está en marcha.** Faltan tres
> secretos, publicar la app de Meta y desplegar las dos Edge Functions. Nada de eso se hizo desde
> acá. 2026-09-16.

---

## 1. Lo primero: la Fase 8 ya había hecho la mitad

Antes de escribir una línea se auditó el repositorio. El hallazgo cambia el alcance de esta
entrega:

**El modelo de datos ya existe, está aplicado en producción y está vacío.** La Fase 8 lo diseñó
para Cloud API —seis tablas, RLS, privilegios, bucket privado y Realtime— y lo dejó probado con
148 aserciones. Lo que explícitamente no hizo: app de Meta, número, token, webhook, Edge
Functions, bandeja y envío.

Así que E1 **no crea tablas**. Construye lo que faltaba encima.

| | veredicto | por qué |
|---|---|---|
| `whatsapp_accounts` · `_conversations` · `_messages` · `_media` · `_conversation_reads` · `_webhook_events` | **KEEP** | Es exactamente el modelo que pide esta fase |
| `app.normalizar_telefono` · `app.cola_telefono` | **KEEP** | La normalización ya estaba resuelta, y bien (§7) |
| `app.puede_ver_conversacion_wa` y las policies | **KEEP** | Una sola definición de visibilidad, usada por las cuatro tablas y por Storage |
| `asignar_conversacion_whatsapp` · `marcar_conversacion_leida_whatsapp` · `no_leidos_whatsapp` | **KEEP** | La asignación y los no leídos por usuario ya funcionan |
| `tomar_mensajes_whatsapp` · `reciclar_mensajes_whatsapp` | **KEEP** | La cola y el reciclador de salientes trabados |
| Bucket `whatsapp`, privado, 100 MB | **KEEP** | El nombre sugerido en el pedido era `whatsapp-media`; se conserva el que ya existe y tiene policy |
| `src/modules/whatsapp/` | vacío (sólo `.gitkeep`) | **NUEVO** en esta entrega |
| Menú «WhatsApp · próximamente» | **REPLACE** | Ahora es un destino real |
| Suite WhatsApp legacy, WappFly, Firebase, `erp_store`, el puente viejo, los números anteriores | **DO_NOT_TOUCH** | No se leyó ni se escribió nada de eso |
| Los 8 chats, 150 mensajes y 56 media del legacy | **DO_NOT_TOUCH** | Siguen siendo `LEGACY WHATSAPP HISTORY = BACKUP ONLY`. No se migran |

Las tablas propuestas en el pedido que **no** se crearon, y qué ocupa su lugar:

| propuesta | qué hay | por qué no se duplica |
|---|---|---|
| `whatsapp_contacts` | `whatsapp_conversations` con `provider_contact_id`, `phone_e164`, `profile_name` | La identidad de WhatsApp es `(cuenta, wa_id)` y hay exactamente una conversación por contacto. Una tabla aparte sería una relación 1:1 |
| `whatsapp_message_status` | Columnas `sent_at` / `delivered_at` / `read_at` / `failed_at` + `estado_visible` generada | Meta puede mandar éxito **y** fallo del mismo mensaje. Con una columna por estado, un acuse atrasado no puede pisar a otro (§ 8) |
| `whatsapp_assignments` | `whatsapp_conversations.assigned_to` + su RPC | E1 no tiene routing ni historial de asignación (§39) |

---

## 2. Arquitectura

```
Cliente ──► Meta Cloud API ──► POST /functions/v1/whatsapp-webhook
                                    │ 1. cuerpo crudo
                                    │ 2. HMAC-SHA256 (X-Hub-Signature-256)
                                    │ 3. JSON.parse
                                    │ 4. RPC idempotente por evento
                                    ▼
                                Supabase ──► Realtime ──► React
                                    │
                                    └─ (después del 200) media ──► Storage privado

React ──► POST /functions/v1/whatsapp-send-message
              │ JWT → encolar_mensaje_whatsapp (la base valida al actor)
              │ → Graph API con el token del servidor
              │ → sellar_saliente_whatsapp
              ▼
          Meta ──► Cliente
```

El navegador **nunca** habla con Meta. No conoce el token, ni el `phone_number_id`, ni el
destinatario: manda `conversation_id` y texto, y el resto se resuelve del lado del servidor.

---

## 3. Identificadores de Meta (no son secretos)

| | valor |
|---|---|
| Portfolio | `1318202376406013` |
| App | Buscatools ERP · `978220921503345` |
| WABA canónica | `1499762661645319` |
| Phone Number ID productivo | `1267748423093872` |
| Número | +54 9 11 2186-6133 · E.164 `5491121866133` |
| System User | `61594265768371` |
| Graph API | `v23.0`, configurable por `META_GRAPH_VERSION` |

**El WABA no está hardcodeado en ninguna parte del código.** El webhook lo lee de `entry[].id` y
lo persiste tal como llegó; lo que decide si un evento nos corresponde es
`value.metadata.phone_number_id` contra `whatsapp_accounts`, no una constante.

El valor `27996680623359463`, que apareció en la consola con alcance de app, **no se usa como
canónico en ningún lado**. Aparece exactamente una vez en el repositorio, en
`webhook.test.ts`, como caso negativo: el test manda un evento con ESE WABA y verifica que el
webhook lo lea del evento en vez de suponer el otro.

---

## 4. Base de datos

`DB_CHANGES`: tres columnas, seis funciones. **Ninguna tabla nueva, ninguna policy modificada.**
Snapshot previo: las seis tablas de WhatsApp en **0 filas**.

SQL completo y rollback en
[`database/PHASE_16_WHATSAPP_ENTREGA_1.sql`](database/PHASE_16_WHATSAPP_ENTREGA_1.sql).

### Columnas

`whatsapp_conversations` + `last_inbound_at`, `last_outbound_at`, `service_window_expires_at`.

La última se intentó como **columna generada** y Postgres la rechaza: `timestamptz + interval` no
es inmutable. Quedó como columna común con un solo escritor —`registrar_entrante_whatsapp`—, que
es además la única función que mueve `last_inbound_at`.

### Funciones

| función | quién la ejecuta | qué hace |
|---|---|---|
| `app.vincular_telefono_whatsapp` | service_role | A qué cliente corresponde un número |
| `registrar_entrante_whatsapp` | service_role | Todo un entrante en una transacción, idempotente |
| `registrar_estado_whatsapp` | service_role | Un acuse, sin retroceder |
| `sellar_saliente_whatsapp` | service_role | El wamid después de que Meta aceptó |
| `sellar_media_whatsapp` | service_role | La ruta del archivo en Storage |
| `encolar_mensaje_whatsapp` | **authenticated** | Un saliente, validando al actor y la ventana |

### El hallazgo de privilegios

El proyecto tiene `ALTER DEFAULT PRIVILEGES` que otorga `EXECUTE` sobre toda función nueva de
`public` a `anon`, `authenticated` y `service_role`. Son grants **explícitos por rol**, así que
`revoke execute … from public` **no los saca**.

Con sólo ese revoke, cualquier persona con sesión —y el anónimo— podía llamar
`registrar_entrante_whatsapp` y **fabricar un mensaje entrante como si viniera de Meta**, o sellar
uno saliente. Lo encontró la suite, no la lectura del código: es exactamente el fallo que se lee
como éxito si uno mira el SQL y no el efecto. Corregido nombrando cada rol.

---

## 5. Webhook

`supabase/functions/whatsapp-webhook/` · `logica.ts` (pura, testeada) + `index.ts` (Deno).

### GET — verificación

Lee `hub.mode`, `hub.verify_token` y `hub.challenge`. Con `subscribe` y el token correcto responde
**200 con el challenge en `text/plain`, crudo**: sin JSON y sin comillas, o Meta rechaza la
configuración. Cualquier otra cosa, 403. El token se compara en tiempo constante y no se registra.

### POST — firma

```
rawBody = await req.text()      ← el cuerpo que llegó, byte por byte
verificarFirma(rawBody, …)      ← HMAC-SHA256 contra ese cuerpo
JSON.parse(rawBody)             ← recién ahora
```

El orden no es negociable. Calcular el HMAC sobre un JSON reserializado falla siempre —
`JSON.stringify(JSON.parse(x))` cambia el espaciado— y de ahí a «desactivemos la validación» hay
un paso. Hay un test que lo demuestra.

La comparación es de bytes, con acumulación XOR sobre longitud fija: no corta en el primer byte
distinto. La longitud sí se compara de entrada, porque la de un SHA-256 es pública.

**Sin `META_WHATSAPP_APP_SECRET` cargado, el webhook rechaza todo.** No hay modo permisivo.

Se rechaza: sin header, sin prefijo `sha256=`, hexadecimal inválido, largo distinto de 32 bytes, y
firma de otro secreto. En ninguno de esos casos se parsea el cuerpo.

### Procesamiento

`entry[]`, `changes[]`, `messages[]` y `statuses[]` son arrays **y Meta agrupa**: un POST puede
traer mensajes de varias conversaciones y acuses mezclados. Se iteran todos; suponer «uno de cada»
es el bug que hace perder mensajes justo bajo carga.

Cada evento es una RPC. La respuesta sale apenas terminan, y **la media se baja después** con
`EdgeRuntime.waitUntil`: bajar 90 MB antes del 200 es garantía de timeout y de reintento.

Si **todos** los eventos fallan se devuelve 500 para que Meta reintente —casi siempre es la base
momentáneamente caída—. Si falla sólo una parte, se devuelve 200 y el fallo queda en la bitácora:
reintentar el lote entero no arregla un evento permanentemente malo, y los que entraron ya están
protegidos por la idempotencia.

**No hay cola.** Supabase Edge Functions no tiene uno apropiado y no se finge tenerlo: el
procesamiento es acotado y rápido, y la única tarea diferida es la descarga de media.

---

## 6. Idempotencia

| caso | qué lo garantiza | probado |
|---|---|---|
| Meta reenvía el mismo mensaje | índice único parcial `(account_id, provider_message_id)` | mismo wamid ×2 → **1 fila**; seis webhooks simultáneos → **1 fila** |
| Doble clic en Enviar | índice único parcial `(account_id, client_request_id)` | cinco envíos con el mismo id → **1 fila**, y los cinco devuelven el mismo mensaje |
| Acuse repetido | cada estado tiene su columna | no cambia nada |
| Acuse fuera de orden | `least()` sobre la marca existente | `read` no vuelve a `sent` |

Los dos únicos son **parciales** (`where … is not null`), así que el `ON CONFLICT` tiene que
repetir el predicado. Sin eso Postgres contesta *«there is no unique or exclusion constraint
matching»* — lo encontró la suite en la primera corrida.

---

## 7. Precedencia de estados

`whatsapp_messages.status` es la **cola de salida** (`pending` → `sending` → `sent` / `failed`).
Lo que ve la persona es `estado_visible`, una columna generada por la Fase 8:

```
in → received
read_at      → read
delivered_at → delivered
failed_at    → failed
sent_at      → sent
sending      → sending
resto        → pending
```

Un mensaje entregado que después falla en otro dispositivo **sigue diciendo «entregado»**: llegó.
El error queda registrado igual, con su código.

---

## 8. Media

El binario **nunca** toca Postgres. El sistema anterior guardaba 16,6 MB de base64 adentro de la
base y los servía enteros a cualquiera.

```
webhook → fila en whatsapp_media (pendiente, sin archivo)
        → 200 a Meta
        → GET /{media_id} → url temporal → descarga con el token → Storage privado
        → sellar_media_whatsapp (ruta, tamaño, mime)
```

- Bucket `whatsapp`, **privado**. La policy se ata a `puede_ver_conversacion_wa()`: **la ruta no
  es la seguridad**.
- URL firmada de **5 minutos** para ver. Una URL pública es una URL que se reenvía.
- Un `media_id` ya descargado **no se vuelve a pedir**.
- Techo de 100 MB, verificado antes y después de la descarga.
- Un reintento de Meta que llega como duplicado **borra la fila de media que acababa de crear**:
  si no, cada reintento dejaría un huérfano.
- `media_expires_at` a 180 días ya venía de la Fase 8. **El proceso que borra no existe todavía**
  (§ 12).

---

## 9. Vínculo con el cliente

El problema real: WhatsApp manda `5491133334444` y en la base el mismo teléfono puede estar como
`+54 11 3333-4444`, `11 3333 4444`, `011…` o `15…`.

**No se reescribe el número.** Sacar el 9 o agregar el 15 es destructivo y se equivoca con otras
provincias. Se compara la **cola de 8 dígitos** (`app.cola_telefono`), que sobrevive a todas esas
variantes, y se prefiere la igualdad exacta del E.164 cuando existe.

Con **más de un candidato no se vincula ninguno**: una conversación atada al cliente equivocado es
peor que una sin vincular. Queda «Sin vincular» para revisión humana.

Un vínculo hecho a mano **no se pisa** con el automático.

---

## 10. Ventana de 24 horas

`service_window_expires_at` = último entrante + 24 h, escrita por la RPC del entrante.

- La UI lo dice: «Respuesta libre hasta mañana a las 14:10», y avisa cuando faltan menos de 2 h.
- El **backend la vuelve a validar**: `encolar_mensaje_whatsapp` levanta `TEMPLATE_REQUIRED` si
  está cerrada. Si el navegador tiene la hora mal o alguien llama la función a mano, el que corta
  es el servidor.
- Sin ningún entrante **no se puede iniciar** la conversación desde el ERP.

El texto nombra el día: sin eso, una ventana que cierra mañana a las 14:10 se lee «hasta las
14:10» a las 14:22 de hoy, o sea como vencida. Lo vio la revisión en el navegador.

---

## 11. RLS

Sin cambios respecto de la Fase 8. Medido por id exacto, no por conteo:

| | admin | employee | vend. asignado | vend. no asignado | technician | customer | admin otra empresa | anónimo |
|---|---|---|---|---|---|---|---|---|
| ver la conversación | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| ver sus mensajes | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| enviar | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| asignar | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

Y lo que **nadie** puede hacer desde el navegador: insertar un mensaje entrante, autoasignarse una
conversación (ni por `UPDATE` ni por la RPC), llamar las funciones del backend, o leer la bitácora
de webhooks. Después de los intentos se verifica **el efecto**: la conversación sigue asignada a
quien estaba.

---

## 12. Realtime, egreso y paginación

**Cero polling.** Ni un `setInterval` en todo el módulo. Dos tablas suscriptas
(`whatsapp_messages`, `whatsapp_conversations`), filtradas por empresa —el filtro acota tráfico,
**no autoriza**: `postgres_changes` evalúa la RLS de cada suscriptor con su JWT—.

Al llegar un evento se **invalida** la consulta que corresponde en vez de fabricar la fila con el
payload: el evento no pasa por los embeds y armarla a mano deja la pantalla diciendo algo que la
base no dice. El hilo sólo se refresca si es el que está abierto.

- **Listado:** columnas contadas, con el preview de 160 caracteres que ya calculó la base. Nunca
  `select *`, nunca el cuerpo de los mensajes.
- **Hilo:** cursor sobre `ordenado_en`, 40 por página, del más nuevo al más viejo.
- **No leídos:** por usuario, con una RPC. El contador del sistema anterior era global: si alguien
  abría un chat, se apagaba para todos.
- **Adjuntos:** sólo se consultan al abrir la pestaña; la media no dispara eventos de Realtime.

---

## 13. Bandeja

`Comunicación → WhatsApp`, en `/whatsapp`. Tres paneles en escritorio, dos en tablet y uno por vez
en el teléfono.

- **Lista:** nombre (cliente > perfil > número), último mensaje, hora, no leídos, asignado,
  «Sin vincular», «Ventana cerrada». Filtros: Todos · No leídos · Sin asignar · Míos.
- **Chat:** burbujas, separadores de día, estado del saliente **con palabra** (nunca sólo color ni
  ícono), contexto de respuesta, media básica, y el motivo del fallo cuando lo hay.
- **Composer:** texto, Enter manda, Shift+Enter salta de línea. Deshabilitado con la ventana
  cerrada, explicando por qué.
- **Contexto:** contacto, cliente, CUIT, origen del vínculo, y **navegación** a cliente,
  cotizaciones y pedidos. No crea documentos: emitir una cotización tiene sus propios guardrails
  —la autoridad de numeración, hoy en STEL— y un atajo desde WhatsApp sería la forma de
  saltárselos.
- **Asignación:** «Asignarme» y «Quitar asignación», sólo para admin y employee.

Sin IA, sin plantillas, sin campañas, sin automatización, sin transcripción y sin notas internas.

Probado en el navegador a 1440, 1024, 768 y 390 con un fixture zz: **cero scroll horizontal**.

---

## 14. Seguridad

- **Ningún secreto en el frontend.** No hay `VITE_WHATSAPP_*` ni nada parecido; el bundle no
  contiene token, App Secret ni verify token. Nada en `localStorage`.
- Los secretos viven sólo en los Edge Function Secrets.
- El webhook no lleva `verify_jwt` —lo llama Meta, que no tiene JWT—: lo que lo protege es la
  firma, sin vía de escape.
- El envío sólo acepta `conversation_id`, `texto` y `client_request_id`. **Cualquier otro campo se
  rechaza**, incluidos `phone_number_id`, `waba_id`, `to` y `access_token`.
- Los errores de Meta se sanean: se guarda status, `code`, `error_subcode` y un detalle de 500
  caracteres. Nunca el cuerpo crudo, que trae `fbtrace_id` y a veces repite el teléfono.
- **Logs estructurados sin contenido:** id de pedido, tipo de evento, wamid truncado, cuenta,
  resultado y duración. Nunca el cuerpo del mensaje, la firma recibida o esperada, el token ni
  ningún header de autorización.
- `whatsapp_webhook_events` **no es un espejo de Meta**: se escribe sólo cuando algo sale mal, con
  el evento normalizado y recortado, sin el texto del cliente. Guardar cada payload para siempre es
  lo que infló la base antes.

---

## 15. Qué falta para que funcione

### Secretos — los carga Jano, nunca por chat

> **Por qué no los cargó el asistente.** Se intentó. El CLI de Supabase está
> instalado pero **sin sesión** (`supabase login` es interactivo y no hay
> `SUPABASE_ACCESS_TOKEN` en el entorno), y el canal MCP del proyecto expone
> desplegar y listar funciones pero **no tiene ninguna herramienta de
> secretos**. Así que no hay forma de cargarlos sin que el valor pase por el
> asistente, que es justamente lo que no queremos.
>
> Los tres comandos de abajo los corre Jano en su máquina, después de
> `supabase login`.

```bash
supabase secrets set META_WHATSAPP_ACCESS_TOKEN --project-ref uaxcfufvapzulqvynanp
```

```bash
supabase secrets set META_WHATSAPP_APP_SECRET --project-ref uaxcfufvapzulqvynanp
```

```bash
supabase secrets set META_WHATSAPP_VERIFY_TOKEN --project-ref uaxcfufvapzulqvynanp
```

También se pueden cargar en **Dashboard → Project Settings → Edge Functions → Secrets**.

- `META_WHATSAPP_ACCESS_TOKEN` — del System User `Buscatools ERP Integracion`, con
  `whatsapp_business_messaging` y `whatsapp_business_management`. **No uses uno temporal de 24 h
  como solución productiva.**
- `META_WHATSAPP_APP_SECRET` — App Dashboard → Configuración → Básica. Sin esto el webhook rechaza
  todo.
- `META_WHATSAPP_VERIFY_TOKEN` — lo elegís vos; el mismo valor va en el panel de Meta. Un token
  aleatorio fuerte se genera localmente así, **y el valor no queda en ningún log ni documento**:

  ```bash
  openssl rand -hex 32
  ```

  Supabase **no permite volver a leer** un secreto ya cargado. Guardalo en el gestor de
  contraseñas antes de cargarlo, o cambialo por uno nuevo en los dos lados cuando haga falta.

`META_WHATSAPP_PHONE_NUMBER_ID` no hace falta como secreto: la cuenta sale de la base. Se puede
cargar `META_GRAPH_VERSION` para fijar otra versión de Graph; por defecto es `v23.0`.

### Desplegar las funciones — HECHO en E1.5 (2026-09-16)

Las dos están **ACTIVE**, versión 1:

| función | `verify_jwt` | por qué |
|---|---|---|
| `whatsapp-webhook` | **false** | La llama Meta, que no tiene JWT. La protege la firma |
| `whatsapp-send-message` | **true** | La llama una persona desde la aplicación |

**URL del webhook, la que va en el panel de Meta:**

```
https://uaxcfufvapzulqvynanp.supabase.co/functions/v1/whatsapp-webhook
```

Para volver a desplegar desde una máquina con el CLI autenticado:

```bash
supabase functions deploy whatsapp-webhook --no-verify-jwt --project-ref uaxcfufvapzulqvynanp
```

```bash
supabase functions deploy whatsapp-send-message --project-ref uaxcfufvapzulqvynanp
```

`--no-verify-jwt` **sólo** en el webhook.

#### Fail-closed verificado contra la función desplegada

Sin ningún secreto cargado, medido contra la URL productiva:

| prueba | resultado |
|---|---|
| `GET` con `hub.mode=subscribe` y cualquier verify token | **403 Forbidden** |
| `POST` sin `X-Hub-Signature-256` | **403** |
| `POST` con firma bien formada, calculada con otro secreto | **403** |
| `DELETE` | 405 |
| `whatsapp-send-message` sin `Authorization` | 401 |
| `whatsapp-send-message` con un JWT inválido | 401 |

Después de las seis pruebas, las seis tablas siguen en **0 filas** —incluida
`whatsapp_webhook_events`—: un POST rechazado no parsea, no guarda y no procesa.
**La ausencia de secretos no habilita ningún modo permisivo; la cierra entera.**

### Pasos manuales en Meta — los hace Jano

1. Publicar la Privacy Policy y cargarla en la app.
2. Publicar la app (hoy está en *development*).
3. Webhook → Callback URL:
   `https://uaxcfufvapzulqvynanp.supabase.co/functions/v1/whatsapp-webhook`, con el verify token.
4. Suscribir el campo **`messages`** de la WABA `1499762661645319`.

### La cuenta en la base

Una fila en `whatsapp_accounts` con `waba_id = 1499762661645319`,
`phone_number_id = 1267748423093872`, `display_phone_number = +54 9 11 2186-6133` y la empresa.
**Sin esa fila el webhook ignora todos los eventos** — es la validación del § 21 del pedido.

### Privacy policy — hay página, pero no sirve como está

Auditado el 2026-09-16 sobre el sitio público:

| URL | resultado |
|---|---|
| `buscatool.com/politica-de-privacidad/` | **200 — existe** |
| `buscatool.com/privacidad` · `/privacidad/` · `/privacy/` | 404 |

La página existe y **es la plantilla de WordPress sin completar**. Dice literalmente
«modifica los datos en negrita», «Tu Empresa o nombre», «CIF: B12345678»,
«cambiame@cambiame.com», arrastra shortcodes de Divi visibles como texto
(`[et_pb_section fb_built=»1″ …]`) y arranca con el aviso de que es un modelo a reemplazar.

Además invoca el **RGPD europeo, la LSSI-CE y la LOPDGDD** —normativa de España—, no la ley
argentina 25.326, y **no menciona WhatsApp en ninguna parte**.

Meta revisa esa URL al publicar la app. Una plantilla sin completar es un rechazo probable, así
que esto es bloqueante.

Lo que hay que resolver, sin inventar nada desde acá:

1. Completar responsable del tratamiento con los datos reales de la empresa.
2. Cambiar el marco normativo por el que corresponde en Argentina.
3. Agregar una sección de WhatsApp: qué datos se reciben (teléfono, nombre de perfil, contenido de
   los mensajes y sus adjuntos), para qué (atención comercial), cuánto se guardan (media 180 días;
   mensajes sin plazo definido, § 16) y cómo se piden la baja y el borrado.
4. Sacar los restos de shortcodes.

**No se redactó ni se publicó texto legal.** Necesita autorización y, casi seguro, revisión de
alguien que sepa. Es una entrega aparte.

---

## 16. Retención

| qué | propuesta | estado |
|---|---|---|
| `whatsapp_webhook_events` | 30 días. Sólo se escriben errores, así que crece poco | **a definir**; hoy no hay proceso de borrado |
| Media | 180 días desde la descarga (`media_expires_at`, ya existe) | **el proceso que borra no está construido** |
| Mensajes y conversaciones | **no se borran** | — |

Ninguna conversación se borra arbitrariamente.

---

## 17. Verificación

| paso | resultado |
|---|---|
| `eslint .` · `tsc -b --noEmit` | limpio |
| `vitest run` y `vitest run --config vitest.aislado.config.ts` | verde |
| `vite build` | ok |
| `node scripts/fase16-whatsapp-e1-tests.mjs` | **0 fallos** |
| Security advisors | sin ERROR nuevo |
| Revisión en navegador (fixture zz) | 1440 · 1024 · 768 · 390, sin scroll horizontal |

**62 tests unitarios** sobre la lógica pura: handshake, firma (válida, ausente, sin secreto, mal
formada, de otro secreto, cuerpo alterado, reserializado), normalización (varios entry/change,
tipos desconocidos, media, contexto, acuses con error, fechas inválidas), validación del envío
(campos prohibidos, uuid, límites), errores de Meta y ventana de servicio.

**La suite contra la base** cubre lo que no se puede simular: idempotencia con seis webhooks
concurrentes, vínculo por cola de 8 dígitos y ambigüedad, ventana, acuses fuera de orden, y el
equipo rojo de RLS con ocho identidades.

### Lo que la revisión encontró y se corrigió

1. **Privilegios.** Las funciones del backend eran ejecutables por `anon` y `authenticated` (§ 4).
2. **`ON CONFLICT` sobre índices parciales** no matcheaba (§ 6).
3. **La ventana se leía como vencida** porque el texto no nombraba el día (§ 10).
4. **Un envío fallido se llevaba lo escrito**: el composer se limpiaba al apretar Enviar en vez de
   cuando el mensaje salía.

### Lo que NO se pudo probar

El camino completo contra Meta: no hay token, la app está sin publicar y las funciones no están
desplegadas. Lo que sí se probó es todo lo que está de este lado de la frontera, incluido que el
envío **falla de forma visible y sin romper la pantalla** cuando la integración no está lista.

---

## 18. Rollback

1. Menú y ruta: revertir el commit.
2. Edge Functions: `supabase functions delete whatsapp-webhook` (si se desplegaron).
3. Base: el bloque comentado al final de
   [`PHASE_16_WHATSAPP_ENTREGA_1.sql`](database/PHASE_16_WHATSAPP_ENTREGA_1.sql) borra las seis
   funciones y las tres columnas. Ninguna policy las llama, así que no deja la RLS rota.
4. Las seis tablas quedan como las dejó la Fase 8.

Desactivar sin revertir nada: `update whatsapp_accounts set active = false`. El webhook empieza a
ignorar todos los eventos y el envío responde `CUENTA_INACTIVA`.

---

## 19. Bloqueantes

| | |
|---|---|
| `NEEDS_META_ACCESS_TOKEN` | **YES** |
| `NEEDS_META_APP_SECRET` | **YES** |
| `NEEDS_META_VERIFY_TOKEN` | **YES** |
| `META_APP_PUBLICATION_REQUIRED` | **YES** |
| `PRIVACY_POLICY_REQUIRED` | **YES** — la página existe pero es la plantilla sin completar (§ 15) |
| `BILLING_REQUIRED_NOW` | **NO** — inbound y respuestas dentro de la ventana no se cobran |
| `EDGE_FUNCTIONS_DEPLOY_REQUIRED` | **YES** |
| `WHATSAPP_ACCOUNT_ROW_REQUIRED` | **YES** |
| `READY_FOR_META_WEBHOOK_CONFIGURATION` | **YES, con los secretos cargados y las funciones desplegadas** |

No se tocó Meta, no se generó ningún token, no se publicó la app, no se mandó ningún WhatsApp y no
se agregó facturación.
