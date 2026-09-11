# Fase 8 · WhatsApp — Entrega 0: auditoría

**Sólo auditoría.** No se programó nada, no se creó ninguna tabla, no se
ejecutó ninguna migración, no se tocó RLS, no se tocó el legacy, no se cambió
ningún token ni la configuración del proveedor, y no se hizo deploy.

Contra el Supabase legacy se hicieron **exclusivamente peticiones `GET`**. No
se llamó ninguna RPC —una RPC puede escribir— ni se abrió el ERP legacy en el
navegador, para no disparar su polling ni su sincronización.

| fuente | qué se hizo |
|---|---|
| `app.js` del legacy (5.288.337 bytes, 45.345 líneas) | leído como texto |
| Supabase **legacy** `hnyngsejohkmlaccpkux` | sólo `GET` a PostgREST |
| Supabase **nuevo** `uaxcfufvapzulqvynanp` | `SELECT` de sólo lectura |
| ERP legacy en el navegador | **no se abrió** |

Ningún valor de token aparece en este informe.

---

## A · Resumen ejecutivo

Cinco cosas que cambian el planteo de la migración.

**1 · WappFly ya no existe.** Las tres funciones que lo usaban
(`_wappflyStartPolling`, `_wappflyStopPolling`, `_wappflyPoll`) son **stubs
vacíos**, con el comentario «Legacy stubs (called from old WA code paths)». El
nombre `erp_wappfly_token` no aparece en ningún lado del bundle actual.

**2 · No hay proveedor de API.** Hay un **puente local**: un script
`BuscaTools-WA.vbs` que corre en una PC de la oficina, usa **Baileys** (la
librería no oficial de WhatsApp Web) y escribe directo en Supabase. El
navegador **nunca habla con WhatsApp**: escribe una fila con
`estado: 'pendiente'` y el puente la manda.

**3 · Está apagado.** El último latido del puente es del **2026-08-24 15:52**,
hace más de dos semanas, y `conectado = false`. Todos los datos —8
conversaciones, 150 mensajes, 56 archivos— son de **un solo día**, entre las
12:09 y las 14:53 del 24 de agosto. Es una prueba de tres horas, no un
histórico.

**4 · Toda la conversación es pública.** Las tablas `suite_wa_*` se leen
**sin ningún header de aplicación**, con la sola clave publicable que está en
el bundle de un sitio público de GitHub Pages. Se verificó: mensajes, teléfonos,
nombres y los 16,6 MB de imágenes y audios en base64 son accesibles para
cualquiera que abra el JavaScript del sitio. **SECURITY PRIORITY — CRITICAL.**

**5 · No hay nada que enlazar con el CRM.** De las 8 conversaciones, **5 no
tienen teléfono** (son identificadores `@lid` de WhatsApp sin resolver) y las 3
que sí tienen **no coinciden con ningún cliente ni contacto** del sistema
nuevo — entre otras cosas porque de 1010 clientes sólo **3** tienen teléfono
cargado.

La conclusión práctica: **esto no es una migración de datos, es una migración
de arquitectura**, y hay una decisión de producto previa —seguir con un puente
Baileys en una PC o pasar a la API oficial— que conviene tomar antes de
diseñar ninguna tabla.

---

## B · Arquitectura legacy

```
   ┌──────────────────┐         ┌──────────────────────────┐
   │  WhatsApp        │◄───────►│  BuscaTools-WA.vbs       │
   │  (teléfono real) │ Baileys │  puente, PC de oficina   │
   └──────────────────┘         └────────────┬─────────────┘
                                             │ escribe/lee
                                             ▼
                                ┌──────────────────────────┐
                                │  Supabase legacy         │
                                │  suite_wa_conversaciones │
                                │  suite_wa_mensajes       │
                                │  suite_wa_media          │
                                │  suite_wa_estado         │
                                │  suite_wa_sesion         │
                                │  suite_wa_reglas         │
                                └────────────┬─────────────┘
                                             │ PostgREST + WebSocket
                                             ▼
                                ┌──────────────────────────┐
                                │  ERP legacy (navegador)  │
                                │  módulo «Mocciaro Suite» │
                                │  + shim de BuscaTools    │
                                └──────────────────────────┘
```

**La base de datos es la cola de envío.** El navegador no tiene credenciales de
WhatsApp ni habla con ningún proveedor: inserta un mensaje `pendiente` y el
puente lo toma. Es una arquitectura sensata —desacopla el navegador del
teléfono— y es lo único que hay que conservar del diseño.

El módulo es **código de terceros adaptado**: `app.js:42056` dice «WHATSAPP
SECTION — Mocciaro Suite module + BuscaTools shim». Son **1.765 líneas**: 156
de shim de compatibilidad y **1.609 del módulo**, con 71 funciones y 41
acciones registradas.

---

## C · Proveedor

| pregunta | respuesta | evidencia |
|---|---|---|
| ¿WappFly? | **NO** | las tres funciones son `{}` vacías (`app.js:43868-43870`) |
| ¿API oficial de Meta? | **NO** | ningún endpoint de `graph.facebook.com` ni plantillas HSM |
| ¿Twilio / 360dialog / otro? | **NO** | ningún dominio de proveedor en todo el bundle |
| ¿Qué hay entonces? | **Baileys**, en un puente local | `esLidSinResolver()`: «Baileys nunca resolvió el número real»; el logout borra las «credenciales de Baileys» |
| ¿Dónde corre? | `BuscaTools-WA.vbs` | instrucciones al usuario: «Reiniciá BuscaTools-WA.vbs y escaneá el QR» |
| ¿Cómo se vincula? | **QR**, publicado por el puente en `suite_wa_estado.qr` | el navegador lo relee cada 4 s mientras el modal está abierto |

Consecuencia que hay que decir en voz alta: **Baileys es una librería no
oficial**. Usarla implica el riesgo de que WhatsApp cierre el número, y depende
de que una PC de la oficina esté prendida. Hoy no lo está.

**No se llamó ningún endpoint del proveedor.**

---

## D · Credenciales

Ninguna se transcribe. Las cinco están **en el bundle público** del sitio
legacy, que se sirve desde GitHub Pages y está commiteado en un repo público.

| nombre | dónde vive | quién la lee | expuesta al browser | clasificación | riesgo |
|---|---|---|---|---|---|
| `SUPA_URL` | `app.js:1177`, literal | todo el ERP | **sí** | PUBLICABLE | ninguno |
| `SUPA_KEY` | `app.js:1178`, literal, prefijo `sb_p…` | todo el ERP | **sí** | PUBLICABLE por diseño | **alto en la práctica**: con RLS abierta equivale a acceso total (ver **AA**) |
| `SUPA_APP_TOKEN` | `app.js:1182`, literal, prefijo `bter…` | header `x-suite-key` y `x-erp-token` | **sí** | SENSITIVE | la RLS de `erp_store` lo exige; la de `suite_wa_*` **no** — o sea que ahí no protege nada |
| `AI_WORKER_URL` | `app.js:5790` | el puente de IA | **sí** | SENSITIVE | expone el worker |
| `AI_WORKER_TOKEN` | `app.js:5791`, literal, prefijo `btai…` | header `X-Worker-Token` | **sí** | **SECRET** | autoriza llamadas a un worker con OpenAI detrás: **gasto facturable de cualquiera que lea el bundle** |
| credenciales de Baileys | tabla `suite_wa_sesion` | el puente | no directamente | **SECRET** | la tabla **se lee con la clave pública**; hoy está vacía porque el puente está deslogueado |

Nada de esto se rota ni se toca en esta entrega, como se pidió.

> **Nota posterior · terminología y estado.** `AI_WORKER_TOKEN` es el nombre de
> la constante **del bundle legacy**. La variable del lado de Cloudflare se
> llama **`WORKER_SECRET`**, y el worker valida el header `X-Worker-Token`
> contra ella, sin fallback: son el mismo secreto visto desde las dos puntas.
> **Fue rotado en la entrega 0.5**, así que el valor que sigue publicado en el
> bundle ya no sirve. Ver `docs/PHASE_8_WHATSAPP_ENTREGA_05_SECURITY.md`.

---

## E · Pantallas

**Una sola pantalla** (`#whatsapp`) con tres paneles, más dos vistas internas.
No hay 13 pantallas como en Mantenimiento: es una bandeja.

| panel / vista | existe | qué tiene |
|---|---|---|
| Lista de conversaciones | **sí** | avatar con iniciales, nombre, preview, hora, contador de no leídos, chips (pendiente, asignado, IA sola, etiquetas), menú «⋮» |
| Conversación | **sí** | burbujas in/out, separador por día, ticks de estado, media embebida, reintento de fallidos |
| Ficha del cliente | **sí, pero inerte** | ver **L**: el shim le pasa listas vacías |
| Configuración | **sí** | estado del puente, QR, línea, reglas de asignación, atajos, prueba de servidor, logout |
| Vista móvil | **sí** | `MOVIL_VISTA` alterna `lista`/`chat` |
| Buscador y filtros | **sí** | busca texto; filtros `todas` / `nuevos` / `mías` / `pendientes` / `archivadas` |
| Contactos | **NO** | no existe agenda |
| Plantillas / HSM | **NO** | hay «atajos» de texto local, no plantillas del proveedor |
| Asignación | **sí** | a un usuario del equipo, desde la lista o desde la ficha |

---

## F · Funciones

71 funciones y 41 acciones. Las que importan, clasificadas:

| función | qué hace | lee | escribe | Supabase | localStorage | estado |
|---|---|---|---|---|---|---|
| `traerChats()` | trae hasta **300** conversaciones | — | — | `suite_wa_conversaciones` | — | **REAL** |
| `traerMsgs(chatId)` | trae los últimos **120** mensajes | — | — | `suite_wa_mensajes` | — | **REAL** |
| `traerPuente()` | estado del puente y líneas | — | `settings.wa_linea` | `suite_wa_estado` | *(intento fallido, ver **M**)* | **REAL** |
| `refrescar()` | las tres anteriores, en cadena | — | — | 3 tablas | — | **REAL** |
| `encolar(texto, media)` | pone el mensaje en la cola | — | mensaje + conversación | `suite_wa_mensajes`, `suite_wa_conversaciones` | — | **REAL** |
| `subirYEnviarAdjunto()` | sube base64 y encola | archivo local | fila de media | `suite_wa_media` | — | **REAL** |
| `cambiarConv(cambios)` | asignar, estado, etiquetas, notas, IA | — | conversación | `suite_wa_conversaciones` | — | **REAL** |
| `wa-sel` | abre el chat y **marca leído** | — | `no_leidos = 0` | `suite_wa_conversaciones` | — | **REAL** |
| `wa-reintentar` | vuelve a poner `pendiente` | — | mensaje | `suite_wa_mensajes` | — | **REAL** |
| `wa-borr-enviar` | firma el borrador de la IA | — | mensaje | `suite_wa_mensajes` | — | **REAL** |
| `wa-qr` + `qrSeguir()` | muestra el QR y lo refresca cada 4 s | — | — | `suite_wa_estado` | — | **REAL** |
| `wa-logout` | **borra las credenciales de Baileys** | — | `DELETE` | `suite_wa_sesion` | `wa_loggedout` | **REAL** · destructivo |
| `wa-probar` | cuenta filas | — | — | RPC `suite_wa_ping` | — | **REAL** |
| `wa-regla-add/del` | reglas de asignación automática | — | regla | `suite_wa_reglas` | — | **REAL**, 0 filas |
| `wa-ia-pedir` + `pedidoParaElAgente()` | «Juan Digital» escribe una respuesta | conversación | — | — | — | **CÓDIGO MUERTO** (ver **AG**) |
| `wa-cot` | «crear cotización» | — | — | — | — | **PLACEHOLDER**: navega y muestra un toast, no pasa datos |
| `wa-tarea` | crea una tarea | — | `state.bandeja` | — | **no persiste** (`App.save` es `{}`) | **PLACEHOLDER** |
| `saldoDe(cliRef)` | facturas pendientes del cliente | `App.state.documentos` = `[]` | — | — | — | **CÓDIGO MUERTO** en este deploy |
| `_wappflyStartPolling/Stop/Poll` | — | — | — | — | — | **CÓDIGO MUERTO**, `{}` vacías |

---

## G · Datos

Medido con `GET` sobre el Supabase legacy el 2026-09-11.

| tabla | filas |
|---|---|
| `suite_wa_conversaciones` | **8** |
| `suite_wa_mensajes` | **150** |
| `suite_wa_media` | **56** |
| `suite_wa_estado` | **1** |
| `suite_wa_sesion` | **0** |
| `suite_wa_reglas` | **0** |

No existen `suite_wa_contactos`, `suite_wa_plantillas` ni `suite_wa_etiquetas`.

**Todo es de un solo día.**

| | |
|---|---|
| mensaje más viejo | 2026-08-24 **12:09** |
| mensaje más nuevo | 2026-08-24 **14:53** |
| último latido del puente | 2026-08-24 **15:52** |
| estado del puente | **`conectado = false`** |

Son **2 horas 44 minutos** de actividad, hace más de dos semanas.

**Clasificación**: es imposible afirmar que sean datos de producción o de
prueba mirando sólo su forma —son conversaciones con teléfonos argentinos
reales y contenido que no se leyó—, pero **su volumen y su ventana de tiempo
son los de una prueba de puesta en marcha**: 8 chats, 3 horas, y nunca más. Lo
honesto es **NO DETERMINADO**, con la observación de que no constituyen un
histórico en ningún sentido útil.

---

## H · Chats

La identidad es el **JID de WhatsApp**, no el teléfono.

```
suite_wa_conversaciones.chat_id  →  «<identificador>@<dominio>»
```

| dominio | cuántos | qué es |
|---|---|---|
| `@lid` | **5** | *Linked ID*: el identificador de privacidad de WhatsApp. **No es un teléfono.** |
| `@s.whatsapp.net` | **3** | chat individual con teléfono real |
| `@g.us` | **0** | no hay grupos (`es_grupo` = false en las 8) |

Columnas: `chat_id`, `linea`, `telefono`, `nombre`, `cli_ref`, `cli_nombre`,
`cli_tipo`, `estado`, `ia_modo`, `asignado`, `etiquetas`, `notas`, `no_leidos`,
`ult_ts`, `ult_texto`, `ult_dir`, `created_at`, `updated_at`, `empresa_id`,
`es_grupo`.

- `empresa_id` existe y está **en null en las 8**. La columna está, el concepto no se usa.
- `linea` = `'default'` en las 8: **una sola línea**.
- El código reconoce el problema del LID: `esLidSinResolver()` detecta cuando
  `telefono` es igual a la parte local del JID, o sea cuando Baileys nunca
  resolvió el número. **Las 5 conversaciones `@lid` están en ese estado.**
- Nada impide que el mismo teléfono aparezca en dos chats (uno `@lid` y otro
  `@s.whatsapp.net`): no hay unicidad por teléfono.

---

## I · Mensajes

Columnas reales de `suite_wa_mensajes`:

```
id · chat_id · linea · dir · texto · media_id · media_nombre · ts · leido ·
estado · error · autor_id · autor_nombre · created_at · wa_id · tipo ·
autor · media_mime · meta
```

| medición | valor |
|---|---|
| entrantes (`dir = in`) | **66** |
| salientes (`dir = out`) | **84** |
| con media | **27** |
| con error | **1** |
| escritos por la IA (`autor = ia`) | **0** |
| **escritos desde el celular** (`autor = celular`) | **78** |
| `wa_id` distintos | **149** de 150 (1 null) → **0 duplicados** |
| `leido` | **`false` en los 150** — columna muerta |
| `meta` no nulo | **148**, con la clave `key` (el *message key* de Baileys) |

**Sólo unos 6 de los 84 mensajes salientes se escribieron desde el ERP.** Los
otros 78 los mandó alguien desde el teléfono y el puente los espejó. O sea: la
bandeja se usó casi enteramente como **visor**, no como herramienta de trabajo.

Valores reales de `tipo`: `texto` 123 · `imagen` 15 · `sticker` 7 · `audio` 5.
No hay `video` ni `doc` en los datos, aunque el código los contempla.

---

## J · Contactos

**No existe entidad de contacto.** Lo que hay es el campo `nombre` de la
conversación —el *pushname* que publica WhatsApp— presente en las 8. No hay
agenda, ni deduplicación, ni histórico de nombres.

---

## K · Teléfonos

**No hay una función central de normalización.** Hay tres tratamientos
distintos, y conviene verlos juntos porque es el punto que más va a doler:

| lugar | qué hace |
|---|---|
| `tel(c)` | antepone `'+'` al valor guardado, salvo si es un LID sin resolver |
| alta de chat nuevo | `.replace(/\D+/g,'')` sobre lo que escribe el usuario |
| búsqueda de cliente | compara los **últimos 8 dígitos** (`endsWith(tel.slice(-8))`) |

`telefono` se guarda **sin `+`** y, en las 8 conversaciones, **es idéntico a la
parte local del JID**. O sea: no es un teléfono normalizado, es lo que venga
del JID.

Formas medidas (sólo la forma; ningún número se transcribe):

| dígitos | cuántos | dominio | lectura |
|---|---|---|---|
| 13 | 3 | `@s.whatsapp.net` | teléfono argentino real (`54…`) |
| 14–15 | 5 | `@lid` | **no son teléfonos**: empiezan en 11, 15, 19, 25, 58 |

El criterio de «últimos 8 dígitos» que ya usa el legacy es razonable para
Argentina —absorbe `+54 9 11`, `011`, `11`— y es el que habría que formalizar,
pero **hoy no está aplicado en ningún lado que funcione**.

---

## L · Clientes

El modelo **sí** prevé el vínculo: `cli_ref` (texto), `cli_nombre`, `cli_tipo`
(`cliente` | `proveedor`). Se asigna a mano desde la ficha, o el puente lo
adivina por teléfono («el puente adivina el cliente por el teléfono y a veces le
pega mal», dice el propio código).

**No es una FK**: es una referencia de texto al `ref` del cliente legacy.

**Y está inerte en BuscaTools.** El shim declara:

```js
get clientes()   { return []; },
get documentos() { return []; },
```

Así que el buscador de vinculación no tiene sobre qué buscar, `saldoDe()`
siempre da cero y la lista de últimos documentos siempre está vacía. **La
tercera columna de la pantalla —la ficha del cliente— no puede funcionar en
este deploy.**

Lo confirma el dato: **`cli_ref` es null en las 8 conversaciones.**

---

## M · localStorage

**Dos claves**, las dos chicas y ninguna con conversaciones:

| key | tipo | propósito | sync |
|---|---|---|---|
| `bt_wa_settings` | JSON | `wa_linea`, `wa_atajos`, `agente_nombre` | **local only** |
| `wa_loggedout` | `'1'` | recordar el logout entre recargas | **local only** |

**No hay cache de mensajes en el navegador.** `CHATS`, `MSGS` y `MEDIA_CACHE`
viven en memoria y mueren con la pestaña.

### Un defecto del shim que conviene no arrastrar

```js
get settings() { return JSON.parse(localStorage.getItem('bt_wa_settings') || '{}'); },
set settings(v) {},                          // ← no-op
saveSettings: () => localStorage.setItem('bt_wa_settings', JSON.stringify(App.state.settings)),
```

El *getter* devuelve un objeto nuevo en cada lectura y el *setter* no hace nada.
Entonces `App.state.settings.wa_linea = x; App.saveSettings();` **muta un objeto
descartable y después guarda otra lectura limpia**: el cambio de línea nunca
persiste. Lo mismo con `App.save()`, que es `() => {}`: la «tarea» que crea
`wa-tarea` no se guarda en ningún lado.

---

## N · Supabase legacy

Seis tablas, todas en el esquema `public` del proyecto `hnyngsejohkmlaccpkux`.

| tabla | filas | para qué |
|---|---|---|
| `suite_wa_conversaciones` | 8 | la bandeja |
| `suite_wa_mensajes` | 150 | los mensajes **y la cola de salida** |
| `suite_wa_media` | 56 | los archivos, **en base64 dentro de Postgres** |
| `suite_wa_estado` | 1 | estado del puente: `conectado`, `numero`, `qr`, `ult_latido`, `version`, `detalle`, `qr_ts`, `enviados_hoy`, `dia`, `logout_requested` |
| `suite_wa_sesion` | 0 | **credenciales de Baileys** |
| `suite_wa_reglas` | 0 | reglas de asignación automática |

Más una RPC, `suite_wa_ping`, que devuelve `{conversaciones, mensajes,
pendientes}`. **No se llamó**, porque una RPC puede escribir.

No se pudo leer `pg_policies` del legacy —haría falta la clave de servicio, que
no tengo y que no corresponde pedir para una auditoría—, así que la RLS se
midió **por comportamiento**: ver **AA**.

---

## O · erp_store

**WhatsApp no pasa por `erp_store`.** La lista `SUPA_SYNC_KEYS` (`app.js:1183`)
tiene 25 claves —cotizaciones, pedidos, clientes, mantenimiento, compras…— y
**ninguna de WhatsApp**. Las dos claves de localStorage del módulo tampoco están.

Es la decisión correcta y hay que conservarla: los mensajes viven en tablas
propias, no en un blob JSON sincronizado. **Sin riesgo de duplicación ni de
loop por esa vía.**

---

## P · Polling

```js
const POLL_ABIERTO = 2000;   /* mirando la bandeja */
const POLL_FONDO   = 45000;  /* en otra pantalla, sólo para el contador */
```

| pregunta | respuesta |
|---|---|
| ¿qué consulta? | las **tres** de `refrescar()`: conversaciones (300), estado del puente, y mensajes del chat abierto (120) |
| ¿cada cuánto? | **2 s** en la pantalla · **45 s** fuera de ella |
| ¿cuándo arranca? | en `boot`, **siempre**, y otra vez en `onEnter` |
| ¿cuándo se detiene? | **nunca**: `programar()` se reencola a sí mismo sin condición de salida |
| ¿depende de la pestaña? | **sólo a medias**: la condición es `enPantalla() \|\| visibilityState === 'visible'`. Si el usuario dejó la pestaña **en la pantalla de WhatsApp** y se fue a otra aplicación, **sigue pidiendo cada 2 segundos** |
| ¿incremental? | **no**: ningún filtro por fecha, ningún cursor, ningún `If-None-Match` |

Además, `wireWhatsapp()` crea un `setInterval(…, 10000)` para el badge **sin
`clearInterval` y sin guarda**: cada vez que se entra a la sección se agrega
otro intervalo. Es barato (sólo toca el DOM) pero se acumula durante toda la
sesión.

---

## Q · Realtime

Convive con el polling y **no lo reemplaza**.

```
wss://<proyecto>.supabase.co/realtime/v1/websocket?apikey=<clave en la URL>
topic: realtime:buscatools-wa
  INSERT public.suite_wa_mensajes
  INSERT public.suite_wa_conversaciones
  UPDATE public.suite_wa_conversaciones
```

- Se conecta en **`boot`**, sin condición: aunque el usuario nunca entre a
  WhatsApp, y **aunque esté en otra empresa**.
- Al recibir cualquier evento **no usa el payload**: llama a `refrescar(false)`,
  o sea vuelve a bajar las tres consultas enteras.
- Reconecta cada 5 s al cerrarse; *heartbeat* cada 25 s.
- El guard `CARGANDO` evita la estampida, pero también **descarta** los eventos
  que llegan durante un refresco (los levanta el siguiente ciclo, ≤2 s).
- La clave viaja **en la query string** de la URL del WebSocket.

O sea: Realtime hoy sirve de **disparador**, no de transporte. El polling de 2 s
existe como respaldo del respaldo.

---

## R · Recepción

| vía | ¿existe? |
|---|---|
| webhook propio | **NO ENCONTRADO** — los únicos webhooks del ERP son de **Emails**, a Make.com |
| polling al proveedor | **NO** — el navegador no habla con WhatsApp |
| Supabase (polling + Realtime) | **SÍ**, es la única |

El puente recibe de WhatsApp por Baileys e **inserta la fila**. El navegador se
entera por Realtime o por el poll de 2 s.

---

## S · Envío

Sin ejecutar ningún envío, el flujo completo leído del código:

```
textarea → wa-send → enviarTexto()
   ├─ si hay archivo: leerArchivo() → base64
   │     └─ POST suite_wa_media {chat_id, mime, nombre, bytes, datos}
   ├─ si el puente no late (>90 s): pide confirmación y encola igual
   └─ encolar()
         ├─ POST suite_wa_mensajes {dir:'out', estado:'pendiente', autor, media_*}
         ├─ PATCH suite_wa_conversaciones {ult_ts, ult_texto, ult_dir}
         ├─ ordena CHATS en memoria
         └─ traerMsgs()  ← otra bajada completa de 120 mensajes
```

- **No hay UI optimista**: la burbuja aparece recién después del round-trip.
- **No hay reintento automático**: el reintento es un botón (`wa-reintentar`)
  que vuelve a poner `estado: 'pendiente'` y limpia `error`.
- **No hay `reply_to`**: el modelo no tiene campo de respuesta a un mensaje.
- El límite de adjunto es **8 MB**, sólo del lado del cliente.

---

## T · Estados

Los valores **reales** encontrados en los datos, no los del diseño:

| `estado` | filas | quién lo pone |
|---|---|---|
| `recibido` | 66 | el puente, al entrar un mensaje |
| `enviado` | 51 | el puente, al despachar |
| `entregado` | 22 | el puente, con el ACK de WhatsApp |
| `leido` | 10 | el puente |
| `error` | 1 | el puente |
| `pendiente` | 0 hoy | **el navegador**, al encolar |
| `borrador` | 0 hoy | el puente (borrador de IA) |

`pendiente` y `borrador` no aparecen en los datos actuales pero el código los
usa: el primero es la cola de salida, el segundo el borrador que espera firma.

Los ticks que muestra la UI: `pendiente`/`enviando` 🕓 · `enviado` ✓ ·
`entregado`/`leido` ✓✓ · `error` ⚠.

---

## U · No leídos

- El contador es **`suite_wa_conversaciones.no_leidos`**, un entero que mantiene
  **el puente**.
- El total del badge se calcula en el navegador sumando las no archivadas.
- **Abrir un chat lo pone en 0** con un `PATCH` a Supabase. **No llama al
  proveedor**: el teléfono sigue mostrando el chat como no leído.
- «Marcar como no leído» escribe exactamente `1`, no el número real.
- La columna `suite_wa_mensajes.leido` existe y está en `false` en los 150:
  **no se usa**.

---

## V · Multimedia

| medición | valor |
|---|---|
| archivos | **56** |
| suma de `bytes` declarados | **17.410.974 B = 16,60 MB** |
| archivo más grande | 1.893.169 B = **1,81 MB** |
| por familia | **imagen 51** · **audio 5** |
| ¿video, documento, sticker? | **no hay archivos**; sí hay 7 mensajes de tipo `sticker` |

**El contenido está en Postgres, en base64.** La columna `datos` se lee sin
problema: una sola fila devolvió **94.168 caracteres** de base64. Base64 infla
~33 %, así que los 16,6 MB declarados ocupan alrededor de **22 MB** en la
tabla — consistente con los ~23 MB que se recordaban.

No hay Storage, ni bucket, ni URLs del proveedor: **todo el archivo vive en una
columna de texto**.

Validaciones al enviar: sólo el tamaño (8 MB). **No hay lista blanca de mime**,
y lo que no se reconoce entra como `application/octet-stream`. Al mostrar, el
tipo se decide con una regex sobre `media_mime` y se inyecta en un `<img>`,
`<audio>`, `<video>` o un `<a>`.

---

## W · Performance y egress

Medido con `GET` reales contra el legacy, con la bandeja actual (8
conversaciones, 150 mensajes):

| consulta | bytes | tiempo |
|---|---|---|
| `suite_wa_conversaciones` (limit 300) | 3.623 | 703 ms |
| `suite_wa_estado` | **7.226** | 611 ms |
| `suite_wa_mensajes` (limit 120) | 1.199 | 788 ms |
| **ciclo completo** | **12.048** | — |

| régimen | requests/min | bytes/min | por hora |
|---|---|---|---|
| bandeja abierta (poll 2 s) | **90** | 361 kB | **20,7 MB** |
| segundo plano (poll 45 s) | 4 | 14 kB | 0,83 MB |

**165 MB por jornada de 8 horas y por usuario**, con ocho conversaciones. Con
las 300 que el código permite, el ciclo crecería proporcionalmente.

Tres cosas saltan a la vista:

1. **`suite_wa_estado` pesa 7,2 kB para una sola fila** porque incluye el **QR
   entero** (6.906 caracteres de data URI). Se vuelve a bajar **cada 2
   segundos**, esté o no abierto el modal del QR.
2. **No hay consulta incremental.** Cada ciclo baja la bandeja completa y la
   conversación completa, cambien o no.
3. **Realtime no ahorra nada**: su evento dispara exactamente el mismo refresco
   completo.

No es un N+1 clásico —son tres consultas fijas— sino **descarga completa
repetida**, que es peor a medida que crece la bandeja.

---

## X · Multiusuario

Hay **más colaboración de la que esperaba**, y es lo mejor del módulo:

| función | cómo funciona | compartido |
|---|---|---|
| asignar a un usuario | `asignado` en la conversación | **sí**, todos lo ven |
| estado de la conversación | `estado` | **sí** |
| etiquetas | `etiquetas` (array) | **sí** |
| notas | `notas` | **sí** |
| no leídos | `no_leidos` | **sí, y ahí está el problema** |
| firma del mensaje | `autor` / `autor_nombre` | **sí** |
| color por usuario | derivado del id | sí |

**El contador de no leídos es global.** Si Juan abre un chat, se pone en cero
para todos: no hay «leído por Juan». Y no hay *drafts* compartidos, ni
indicador de «alguien está escribiendo», ni bloqueo: **dos personas pueden
contestar lo mismo al mismo tiempo** y las dos respuestas se encolan.

`App.state.usuarios` sale de `TEAM_LABELS` —una lista fija del ERP—, no de
`profiles`.

---

## Y · Multiempresa

**No hay concepto de empresa que funcione.**

- `suite_wa_conversaciones.empresa_id` existe y está **null en las 8**.
- `linea` es `'default'` en las 8: una sola línea de WhatsApp.
- El ERP **esconde** la sección para cualquier empresa que no sea la default:
  «hoy sólo existe la línea de WhatsApp de Buscatools».

Pero ese corte es de interfaz, no de datos: `iniciarRealtime()` y `programar()`
arrancan en `boot` **sin mirar la empresa**. Con Torquetools activa, el
navegador sigue conectado al WebSocket y sigue pidiendo la bandeja de
Buscatools cada 45 segundos; lo único que se apaga es el badge.

---

## Z · Permisos

| capa | qué hace |
|---|---|
| **UI** | `whatsapp` es una de las 14 `PERM_SECCIONES`; `navigateTo()` chequea el permiso y ADMIN siempre pasa |
| **RLS** | **ninguna restricción efectiva** — ver **AA** |

O sea: **esconder el menú es todo lo que hay**. Quien conozca la URL del
proyecto y la clave publicable —que está en el bundle— lee y escribe todo, sin
sesión y sin rol.

---

## AA · Seguridad

### El hallazgo principal

Se comparó la misma consulta **con y sin** el header `x-suite-key`:

| tabla | con `x-suite-key` | **sin** el header |
|---|---|---|
| `suite_wa_conversaciones` | 8 filas | **8 filas** |
| `suite_wa_mensajes` | 150 filas | **150 filas** |
| `suite_wa_media` | 56 filas | **56 filas** |
| `suite_wa_estado` | 1 fila | **1 fila** |
| `suite_wa_sesion` | 0 filas | **HTTP 200** |
| `suite_wa_reglas` | 0 filas | **HTTP 200** |

**El token de aplicación no protege nada en estas tablas.** Basta la clave
publicable, que está escrita en un archivo JavaScript servido públicamente desde
GitHub Pages y commiteado en un repositorio público.

Consecuencia medida: **cualquiera puede leer las conversaciones completas, los
teléfonos, los nombres y los 16,6 MB de imágenes y audios.** Se verificó
descargando el campo `datos` de un archivo.

**Y por construcción también puede escribir**: el propio módulo hace `POST`,
`PATCH` y `DELETE` contra estas tablas con exactamente esas credenciales desde
el navegador —por ejemplo «Vaciar mensajes» (`DELETE suite_wa_mensajes`) y
«Cerrar sesión» (`DELETE suite_wa_sesion`)—. **Esto último es inferencia del
código, no una escritura probada**: no se intentó, porque la auditoría es de
sólo lectura.

Si esa inferencia es correcta, un tercero podría **borrar todas las
conversaciones** y **desconectar el WhatsApp de la empresa**.

`suite_wa_sesion` merece un párrafo propio: guarda las **credenciales de
Baileys**. Hoy está vacía porque el puente está deslogueado. Con el puente
conectado, esa fila sería legible con la clave pública.

### Otros puntos

| punto | estado |
|---|---|
| token en localStorage | **no** — los tokens están en el JS, que es peor: son públicos |
| `service_role` en el browser | **no** |
| endpoints sin auth | PostgREST con la clave pública: auth «pasa», RLS no filtra |
| bucket público | no aplica: no hay Storage |
| URLs permanentes | no aplica |
| `SECURITY DEFINER` / `PUBLIC EXECUTE` | no verificable sin clave de servicio del legacy |
| clave en la URL del WebSocket | **sí**, en la query string |
| token de IA expuesto | **sí** (`AI_WORKER_TOKEN`): gasto facturable |

---

## AB · XSS

**Revisado, y está bien resuelto.** Todo lo que viene de WhatsApp pasa por
`App.esc` → `escapeHtml`, que escapa `& < > " '`:

```js
return (m.texto ? App.esc(m.texto).replace(/\n/g, '<br>') : '') + media;
```

Se revisaron los cuatro lugares donde entra contenido ajeno: cuerpo del mensaje,
nombre del archivo, item de la lista (nombre, preview, etiquetas) y la cabecera.
**Los cuatro escapan.** El `<br>` se agrega **después** de escapar, que es el
orden correcto.

Dos observaciones menores, ninguna explotable hoy:

- `c.no_leidos` se interpola sin escapar; es una columna entera.
- El **prompt de la IA** concatena el texto del cliente sin ninguna barrera
  (`'CLIENTE: ' + m.texto`). No es XSS, es **superficie de inyección de
  prompt** — y el agente que lo consumiría tiene acceso a stock y cuenta
  corriente. Está dormido (ver **AG**), pero hay que tenerlo presente antes de
  encenderlo.

**No es SECURITY PRIORITY por XSS.**

---

## AC · Errores y reintentos

| situación | qué hace |
|---|---|
| sin internet / servidor caído | mensaje propio, se muestra en la barra de estado |
| timeout | `AbortController` a **25 s**, con mensaje propio |
| clave rechazada (401/403) | «El servidor rechazó la clave» |
| clave publicable dada de baja | mensaje específico con la instrucción de reemplazarla |
| faltan las tablas (404) | «falta correr 06-whatsapp.sql» |
| puente caído | **avisa antes de encolar** y pide confirmación |
| mensaje fallido | queda con `estado='error'` y su texto; botón **Reintentar** |
| media fallida | toast, y el mensaje no se encola |
| rate limit | **no se maneja**; hay un contador `enviados_hoy` en el puente, que el navegador no mira |

**No hay backoff, no hay cola de reintentos, no hay reenvío automático.** Y eso
es bueno: **nada puede provocar un envío duplicado desde el navegador**. El
único bucle sin freno es el polling.

---

## AD · Deduplicación

`suite_wa_mensajes.wa_id` guarda el id del mensaje del proveedor:
**149 distintos sobre 150 filas, 1 null, 0 duplicados.**

La deduplicación la hace **el puente** al insertar. El navegador no deduplica
—no le hace falta: reemplaza el array entero en cada refresco—. No se pudo
verificar si hay un índice único sobre `wa_id` (haría falta leer el esquema del
legacy), pero **en los datos no hay ni un duplicado**.

---

## AE · Cache y orden

- **No hay cache persistente.** Al abrir WhatsApp no se muestra nada viejo:
  descarga y reemplaza. `MSGS = todos.filter(...)` sustituye el array completo;
  no hay *merge*.
- **Sin sincronización bidireccional**: el navegador sólo escribe cuando el
  usuario hace algo.
- `MEDIA_CACHE` guarda los base64 ya bajados **en memoria**, por id.
- **Orden**: los mensajes por `ts` descendente en la consulta y se invierten en
  el cliente; las conversaciones por `ult_ts desc nullslast`.
- `ts` lo pone el puente. El mensaje que se encola desde el ERP **no lleva `ts`**
  (lo pondrá el default de la tabla), y el `ult_ts` de la conversación lo escribe
  el navegador con **su propio reloj** (`new Date().toISOString()`). **Ahí puede
  haber desorden**: dos relojes distintos ordenando la misma lista.

---

## AF · Integraciones con otros módulos

| acción | qué hace de verdad | clase |
|---|---|---|
| «Abrir ficha» | navega a Clientes/Proveedores con la ref | **REAL**, pero inalcanzable: `cli_ref` siempre null |
| «Crear cotización» | navega a Cotizaciones y muestra un toast con el nombre | **PLACEHOLDER**: no pasa cliente ni contexto |
| «Ir al documento» | `App.openDoc` → `() => {}` | **CÓDIGO MUERTO** |
| «Crear tarea» | empuja a `state.bandeja` y llama `App.save()`, que es `{}` | **PLACEHOLDER**: no persiste |
| adjuntar la conversación a algo | — | **NO EXISTE** |

**Ninguna integración funciona hoy de punta a punta.**

---

## AG · IA

Hay **dos** caminos de IA, y los dos están apagados:

**1 · El borrador del puente.** El puente escribe un mensaje con
`estado = 'borrador'` y el navegador lo muestra aparte, con cuatro botones:
enviar (lo firma con tu nombre), editar, tirar, mejorar. Con `ia_modo = 'auto'`
contestaría solo, detrás de una confirmación que advierte que nunca lo hará si
el mensaje habla de plata, plazos, garantías o es un reclamo.
**Medido: `ia_modo = 'auto'` en 0 conversaciones; `autor = 'ia'` en 0 mensajes.**

**2 · «Juan Digital», el agente con manos.** Correría dentro del ERP y podría
mirar stock, cuenta corriente y pedidos antes de escribir. Usa
`App.ia.complete()` → un worker propio (`AI_WORKER_URL`) con
`X-Worker-Token`, `provider: 'openai'`, `model: 'gpt-4o-mini'`.
**Pero el shim declara `agente: null`**, así que `agenteListo()` devuelve
siempre `false`: **es código muerto en BuscaTools**.

**No se llamó ninguna API de IA.**

---

## AH · Notificaciones

El ERP tiene Firebase, *service worker* y `Notification.` (≈línea 36272 en
adelante), pero **el módulo de WhatsApp tiene cero referencias a nada de eso**.

Lo único que hace al llegar un mensaje estando en otra pantalla es un **toast**:
«💬 N mensaje(s) nuevo(s) de WhatsApp», más el badge del menú, que se refresca
cada 10 s.

**Sin push, sin sonido, sin badge del sistema operativo.**

---

## AI · Fuente de verdad

| entidad | fuente de verdad | comentario |
|---|---|---|
| **CHAT** | **el proveedor**, vía el puente | el `chat_id` es el JID; Supabase es su espejo |
| **MESSAGE (entrante)** | **el proveedor** | `wa_id` es la identidad real |
| **MESSAGE (saliente)** | **Supabase** | nace acá como `pendiente`: la tabla es la cola |
| **CONTACT** | **el proveedor** (`nombre` = pushname) | no hay entidad propia |
| **MEDIA** | **Supabase** | el binario vive en la tabla, no en el proveedor |
| **UNREAD** | **derivado**, lo mantiene el puente | no se sincroniza con el teléfono |
| **STATUS** | **el proveedor**, vía el puente | salvo `pendiente`, que lo pone el navegador |
| **Vínculo con el cliente** | **Supabase** (`cli_ref`) | decisión humana, hoy sin usar |

---

## AJ · Histórico migrable

| clase | qué | volumen | veredicto |
|---|---|---|---|
| **A · histórico real migrable** | — | — | **nada**: 3 horas de un día no son un histórico |
| **B · cache reconstruible** | conversaciones y mensajes | 8 + 150 | el teléfono los tiene; el puente los vuelve a bajar |
| **C · metadata temporal** | `suite_wa_estado` (QR, latido, `enviados_hoy`) | 1 fila | se regenera sola |
| **D · configuración** | `suite_wa_reglas`, `bt_wa_settings` | 0 filas | nada que migrar |
| **E · secreto** | `suite_wa_sesion` | 0 filas | **nunca se migra**; se genera con un QR nuevo |
| **F · test** | probablemente las 8 conversaciones | — | **NO DETERMINADO**, ver **G** |
| **G · basura** | `suite_wa_mensajes.leido`, `empresa_id`, los stubs de WappFly | — | no arrastrar |

**Mi lectura: no hay nada que valga la pena migrar como dato.** Los 16,6 MB de
media son de esa misma tarde. Lo que hay que migrar es la **arquitectura**, y
lo que hay que decidir antes es el proveedor.

---

## AK · Qué migrar y qué no

| | qué | por qué |
|---|---|---|
| **MIGRAR 1:1** | la cola en la base: escribir `pendiente` y que un proceso externo despache | desacopla el navegador del teléfono y funciona |
| **MIGRAR 1:1** | el modelo de conversación: asignado, estado, etiquetas, notas | es colaboración de verdad, y es lo mejor que tiene |
| **MIGRAR 1:1** | `wa_id` como identidad del proveedor | 0 duplicados en 150 mensajes lo avalan |
| **MIGRAR MEJORADO** | la bandeja | con consulta incremental y paginación, no 300 filas cada 2 s |
| **MIGRAR MEJORADO** | Realtime | usando el payload, no como disparador de un refresco completo |
| **MIGRAR MEJORADO** | multimedia | a **Storage privado con URL firmada**, no base64 en una columna |
| **MIGRAR MEJORADO** | no leídos | por usuario, no un contador global |
| **MIGRAR MEJORADO** | teléfonos | con una función central de normalización — el criterio de «últimos 8 dígitos» ya está pensado, falta aplicarlo |
| **MIGRAR MEJORADO** | vínculo con el cliente | FK real a `customers` / `customer_contacts`, no una ref de texto |
| **NO MIGRAR** | los stubs de WappFly | código muerto |
| **NO MIGRAR** | `suite_wa_mensajes.leido` y `empresa_id` | columnas muertas |
| **NO MIGRAR** | el shim y sus *getters* vacíos | ver **M** y **L** |
| **NO MIGRAR** | tokens en el bundle | jamás |
| **NO MIGRAR** | el polling de 2 s | es el problema, no la solución |
| **FUTURO** | IA (borrador y agente) | decisión de producto; hoy apagada |
| **FUTURO** | plantillas, grupos, notificaciones push | no existen |

---

## AL · Riesgos

| # | riesgo | severidad |
|---|---|---|
| **R1** | **Las conversaciones son públicas**: se leen con la clave del bundle, sin token de aplicación | **CRÍTICA** |
| **R2** | Por la misma vía se podría **borrar** conversaciones y **desconectar** el WhatsApp (inferido del código, no probado) | **CRÍTICA** |
| **R3** | `AI_WORKER_TOKEN` público: gasto facturable de OpenAI para cualquiera | **ALTA** |
| **R4** | `suite_wa_sesion` guarda las credenciales de Baileys y es legible con la clave pública | **ALTA** (hoy vacía) |
| **R5** | **Baileys no es oficial**: WhatsApp puede cerrar el número | **ALTA**, de producto |
| **R6** | El puente es una PC de oficina: si se apaga, no hay WhatsApp. **Hoy está apagado.** | **ALTA**, operativa |
| **R7** | 20,7 MB/hora por usuario, y crece con la bandeja | **MEDIA** |
| **R8** | El no leído es global: lo que lee uno lo apaga para todos | **MEDIA**, de producto |
| **R9** | 5 de 8 chats sin teléfono usable (`@lid`) | **MEDIA**, de datos |
| **R10** | El CRM nuevo casi no tiene teléfonos: 3 de 1010 clientes | **MEDIA**, bloquea el vínculo |
| **R11** | Dos relojes distintos ordenan la misma lista | **BAJA** |
| **R12** | Fuga de `setInterval` del badge | **BAJA** |

---

## AM · Propuesta de siguientes entregas

No fuerzo seis entregas. Lo que encontré pide **una decisión antes que un
schema**, y una entrega de seguridad que no puede esperar a la migración.

### Entrega 0.5 — Contención de seguridad *(antes que nada)*

Independiente de cómo se migre, y aplicable **al legacy tal como está**:
cerrar la lectura pública de `suite_wa_*` y rotar el token del worker de IA. Es
el mismo tipo de trabajo que el fix de O4. **Esto no debería esperar al resto
de la fase.**

### Decisión previa — ¿Baileys o API oficial?

No es una entrega, es una conversación. Cambia todo lo que viene después:

| | puente Baileys (lo actual) | API oficial de Meta |
|---|---|---|
| costo | gratis | por conversación |
| riesgo de bloqueo | **real** | ninguno |
| infra | una PC prendida | ninguna |
| iniciar conversación | libre | sólo con plantillas aprobadas |
| histórico | el del teléfono | desde cero |

### Después de decidir

| entrega | qué |
|---|---|
| **1 · Schema y RLS** | conversaciones, mensajes, media en Storage privado, cola de salida, no leídos por usuario, vínculo real con `customers`. Con la RLS probada con JWT reales desde el primer día, como en Compras y Mantenimiento |
| **2 · Normalización de teléfonos** | la función central que hoy no existe, y el backfill de teléfonos del CRM: sin eso, el vínculo con el cliente no tiene con qué trabajar |
| **3 · Bandeja de sólo lectura** | listar, abrir, leer, buscar, filtrar. Con consulta incremental y Realtime usando el payload |
| **4 · Envío** | la cola, los estados, el reintento, los adjuntos |
| **5 · Colaboración** | asignación, etiquetas, notas, no leídos por usuario |
| **6 · Cierre** | E2E, RLS final, mobile, egress medido, regresión |

**No hay entrega de migración de datos**, y esa ausencia es el hallazgo: no hay
histórico que migrar.

---

## Métricas finales

Cada número con su fuente.

| métrica | valor | fuente |
|---|---|---|
| líneas del módulo (con shim) | **1.765** | `app.js:42056-43821` |
| funciones | **71** | conteo sobre el módulo |
| acciones registradas | **41** | `App.act(...)` |
| pantallas | **1** (3 paneles + config + vista móvil) | código |
| tablas en el legacy | **6** | `GET` a PostgREST |
| conversaciones | **8** | `GET` |
| mensajes | **150** (66 in / 84 out) | `GET` |
| mensajes escritos desde el ERP | **≈6** (84 − 78 `autor=celular`) | `GET` |
| media | **56** archivos · **16,60 MB** declarados | `GET` |
| teléfonos únicos usables | **3** (5 son `@lid`) | `GET` |
| duplicados por `wa_id` | **0** | `GET` |
| mensajes con error | **1** | `GET` |
| rango de fechas | **2026-08-24 12:09 → 14:53** | `GET` |
| último latido del puente | **2026-08-24 15:52** · `conectado=false` | `GET` |
| claves de localStorage | **2** | código |
| claves en `SUPA_SYNC_KEYS` con WhatsApp | **0** | `app.js:1183` |
| intervalos de polling | **2.000 ms** / **45.000 ms** | `app.js` (constantes) |
| requests/min en régimen | **90** | 3 GET × 30 ciclos |
| egress en régimen | **20,7 MB/hora** por usuario | medido con `GET` |
| tokens detectados en el bundle | **4** (+1 URL) | `app.js`, sin transcribir |
| tablas legibles sin token de aplicación | **6 de 6** | medido |
| conversaciones vinculables al CRM nuevo | **0 de 8** | cruce medido |
| clientes del CRM nuevo con teléfono | **3 de 1010** | `SELECT` |
| webhooks de WhatsApp | **0 · NO ENCONTRADO** | código |

---

## Lo que NO se hizo, a propósito

- No se abrió el ERP legacy en el navegador: habría disparado su polling y su
  sincronización.
- No se llamó ninguna RPC, ni siquiera `suite_wa_ping`: una RPC puede escribir.
- No se llamó ningún endpoint del proveedor ni de la IA.
- No se escribió, modificó ni borró una sola fila.
- No se transcribió ningún token ni una sola línea de conversación.
- No se creó schema, ni se diseñaron tablas definitivas, ni se tocó React.
- No se rotó ninguna credencial: se reporta cuáles habría que rotar.
