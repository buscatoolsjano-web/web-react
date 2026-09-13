# Fase 9 · Emails — Entrega 4: bandeja React read-only + hilo bajo demanda

> ## ENTREGA 4 — cierre
>
> Bandeja React sobre el índice, hilo y adjuntos bajo demanda desde Gmail a
> través de un **servicio público aparte** que autoriza con el JWT de Supabase,
> HTML aislado en tres capas, Realtime sin polling, y el recorrido completo
> probado con **un correo real**: Gmail → Pub/Sub → Cloud Run → índice →
> Realtime → bandeja en **~25 s**, sin tocar el no leído de Gmail.
>
> Tres autorizaciones tuyas lo destrabaron: el deploy del servicio público, la
> sesión en el navegador y el correo de prueba. Y en el camino aparecieron
> **cuatro bugs reales** que quedaron corregidos con test (ver T).

---

## A · Rutas y menú

| ruta | pantalla |
|---|---|
| `#/emails` | la bandeja |
| `#/emails/:threadId` | un hilo — el id es el **uuid de `email_threads`**, no el de Gmail: un `gmail_thread_id` sólo es único dentro de su cuenta |

- **Emails** sale de «Próximamente» y entra al menú para `admin` y `employee`.
- La regla vive en **un solo lugar** del frontend, `modules/emails/lib/permisos.ts`
  (`ROLES_EMAILS`), y la usan el menú y las dos páginas.
- No es el control de acceso: eso es la RLS y el JWT validado en Cloud Run. Un
  vendedor que escriba la URL a mano ve «tu rol no tiene acceso» y, debajo, la
  base le devolvería cero filas igual.

## B · Listado

Sale de `email_threads` por la RPC **`listar_bandeja_email`** (SECURITY INVOKER:
decide la RLS). **Nunca de Gmail. Nunca un cuerpo**: la tabla no tiene dónde
guardarlo, y la suite verifica que ninguna columna devuelta se llame
`body`/`html`/`raw`/`text`.

Por qué una RPC y no un select con embed: estado y lectura se atan al índice
por `(account_id, gmail_thread_id)` **sin FK** —a propósito, para que el estado
sobreviva a un resync— y los filtros «sin leer», «sin asignar» y «sin cliente»
son sobre la **ausencia** de fila. Paginar bien exige resolverlos en el servidor.

- Página de **25** (25/50/100), `offset` en la URL.
- Orden `last_message_at desc`, **desempate por `id`**: probado con dos hilos del
  mismo instante.
- Límite acotado a 100 aunque pidan 5.000.
- Campos: remitente o destinatarios, asunto, extracto, fecha, **«Sin leer» como
  texto** (no sólo color), estado, asignado, cliente, 📎 con `aria-label`.
- **Lista de enlaces, no tabla de 8 columnas**: en 390 px una tabla así es
  ilegible, y en escritorio la fila de dos líneas se lee mejor.

## C · Filtros

En la URL: `q`, `noleidos`, `estado`, `asignado` (`yo` · `nadie` · uuid),
`cliente` (`con` · `sin`), `adjuntos`, `cuenta`, `page`, `per`.

Un valor inventado (`estado=spam`, `asignado=robert;drop`) se descarta al leer
la URL y no llega al servidor. El selector de cuenta **sólo aparece con más de
una**; nada en los componentes dice `info@`.

## D · Búsqueda

Sobre metadata local: asunto, extracto, remitente, participantes y **nombre del
cliente vinculado**. `%` y `_` se escapan: buscar «100%» no es un comodín.
Búsqueda de contenido en Gmail (`q=`): **backlog**.

## E · No leído ERP

`email_thread_reads`, por usuario. Se **deriva** (`last_message_at >
last_read_at`); no hay contador guardado.

**Juan abre, Facundo sigue sin leer** — probado con JWT reales, incluido el
total por usuario (Juan 10, Facundo 11) y que un mensaje nuevo lo vuelve a poner
sin leer. `marcar_hilo_leido_email` ahora **sólo escribe si el hilo es visible
en el índice**: el vendedor, el admin de otra empresa o un id inventado no dejan
fila.

**No toca Gmail.** Ver O.

## F · Realtime

`email_threads`, `email_thread_state` y `email_thread_reads` agregadas a
`supabase_realtime`. **Sin polling.**

| evento | qué hace la UI |
|---|---|
| hilo nuevo, borrado, o mensaje nuevo (cambia el orden) | vuelve a pedir **esa página**, una vez por ráfaga (400 ms) |
| hilo actualizado sin cambio de orden | **parche en caché**, 0 requests |
| cambio de estado | parche; si cambió asignado o cliente (el nombre no viene en el evento) o la vista filtra por trabajo, refetch |
| lectura propia | parche `sinLeer: false` |
| canal caído | aviso «la actualización en vivo se desconectó» + **Reconectar** |

**Autorización, medida:** el admin recibe INSERT, UPDATE y el cambio de estado;
**el vendedor, 0 eventos**. La RLS se evalúa del lado de Realtime con el JWT de
cada suscriptor.

**Intermitencia, anotada y no escondida:** la primera corrida no entregó nada
(con `setAuth` manual y cuatro joins en paralelo: problema del arnés), y en 1 de
las 4 siguientes el admin no recibió los eventos del índice en 8 s (sí los de
estado). La sonda
aparte —dos canales en un cliente, como la app, 15 escrituras espaciadas— dio
**15/15**. La suite ahora espera 3 s tras suscribirse y, si el primer intento no
llega, lo registra como `INFO` y reintenta una vez; las dos corridas siguientes
no lo necesitaron. Latencia medida: **211–623 ms**. Si Realtime pierde un evento
en producción, la bandeja lo muestra con el botón «Actualizar».

## G · Hilo bajo demanda — desplegado y red-teameado

```
React  →  GET /gmail/thread (JWT de Supabase)  →  buscatools-erp-email-api
       →  PostgREST con ESE JWT: ¿la RLS le devuelve el hilo y su cuenta?
       →  allowlist del buzón
       →  Gmail threads.get?format=full  →  payload en memoria, no-store
```

- **Servicio aparte** del que recibe el push. Si las rutas vivieran en
  `buscatools-erp-email`, habría que abrirlo sin IAM y `/gmail/push`,
  `/gmail/watch` y `/gmail/sync` perderían su primera barrera.
- **Autoriza con la RLS, no con una copia de la regla.** Pide
  `email_threads?account_id=…&gmail_thread_id=…` con el JWT de la persona. Cero
  filas → **404** (no confirma que exista). JWT vencido → **401**.
- **No tiene la service key de Supabase**: no la necesita. Sólo la clave
  publicable, que ya viaja en el bundle.
- SA propia `buscatools-email-api`. **IAM auditado:** ningún rol de proyecto; su
  único permiso es `serviceAccountTokenCreator` sobre la SA de Gmail. Sin
  secretos, 0 keys `USER_MANAGED` en las 5 SAs, sin Owner, Editor, Pub/Sub Admin
  ni Cloud Run Admin.
- Servicio `buscatools-erp-email-api` · revisión **`00002-s7t`** · `--no-invoker-iam-check`
  por diseño · min 0 / max 3 · 256 MiB · variables: `MODO`, SA de Gmail,
  allowlist, URL y clave publicable de Supabase, orígenes CORS. **Nada más.**
- Las rutas `/gmail/push`, `/gmail/watch`, `/gmail/sync` y `/gmail/perfil` **no
  existen** en él: 404 medido.
- Un `gmail_thread_id` que no está en el índice de **esa** cuenta no se va a
  buscar a Gmail. Ids con forma inválida no llegan ni a la base.
- CORS sólo para `https://app.buscatools.com` y `http://localhost:5173`.
- Límite de 120 pedidos por minuto por persona: corta un loop del frontend.
- Errores traducidos: 401, 404, 429 con `Retry-After`, 502 `gmail_no_autorizado`,
  502/503 «no disponible». **Nunca el texto crudo de Google.**
- La UI: sin reintentos automáticos (salvo uno ante corte de red), botón
  «Reintentar» sólo si el error puede cambiar.

**Tests nuevos del backend:** 38 (86 en total), entre ellos: sin token no se toca
Gmail; un hilo que la RLS no devuelve no se toca Gmail; allowlist; las rutas del
servicio privado no existen en éste; Gmail 429/403/404; límite por persona;
charset; watch sin filtro; renovación del watch.

### Red team del servicio público — `scripts/fase9-emails-entrega4-api-redteam.mjs`

33 comprobaciones por corrida, 3 corridas. Cada caso mide **si sale contenido**,
no sólo el status.

| caso | resultado |
|---|---|
| A · sin JWT | 401 · 27 B · sin contenido |
| B · firma alterada · basura · `alg=none` con `role=service_role` | 401 · sin contenido |
| C · la clave publicable como Bearer (anon) | 401 · sin contenido |
| D–G · salesperson · technician · customer · distributor (temporales en Buscatools) | 404 · sin contenido |
| H · admin | 200 · el hilo · `no-store` |
| I · employee (temporal en Buscatools) | 200 · el hilo |
| J · admin de empresa ajena, con su cuenta o con la nuestra | 404 |
| K · id inexistente · path traversal · account_id inválido | 404 |
| L · adjunto: admin 48.703 B = metadata · rol sin acceso, empresa ajena, sin JWT, mensaje de otro hilo, parte inexistente o malformada, `attachment_id` inyectado | 404 / 401 · sin bytes |

**Un fallo, en la primera corrida:** el salesperson recibió **503** en vez de
404. Log: `PostgREST 504` en la primera consulta autenticada de la corrida —el
mismo transitorio que ya vimos en la entrega 3—. Falló **cerrado**: 32 B, sin
contenido. Las dos corridas siguientes, 0 fallos; la de la regresión final, ver U.

## H · HTML seguro — probado en un navegador real

Tres capas; **cada una alcanza sola** para lo que cubre:

1. **DOMPurify** en el navegador (perfil HTML: sin SVG ni MathML; sin `form`,
   `iframe`, `object`, `meta`, `base`, `link`; links con `target=_blank` y
   `rel=noopener noreferrer`).
2. **`<iframe sandbox="allow-popups allow-popups-to-escape-sandbox">`** — **sin**
   `allow-scripts`, **sin** `allow-same-origin`, sin `allow-forms`.
3. **CSP propia en el `<head>` del documento**: `default-src 'none'`,
   `script-src 'none'`, `img-src data:` (+ `https: http:` sólo si la persona lo
   pide), `form-action 'none'`, `base-uri 'none'`.

`dangerouslySetInnerHTML` **no se usa** para cuerpos.

**Por qué no hay sanitización server-side**, a diferencia de lo que decía la
arquitectura: en Node no hay DOM, y un sanitizador con expresiones regulares es
exactamente el tipo de código que se saltea. Sanitizar donde hay un DOM de
verdad, más sandbox, más CSP, es más fuerte que regex en el servidor más sandbox.

**Prueba en el navegador del dev server** (Chromium), con detección por
`postMessage`, que funciona aunque el iframe tenga origen opaco:

| iframe | vectores (script, onerror, svg, body onload, ontoggle, iframe anidado, javascript:, formaction, meta refresh) | ejecutados |
|---|---|---|
| **control positivo** (`sandbox="allow-scripts"`) | los 9 | **6** — la detección funciona |
| **camino de la app** | los 9 | **0** |
| **sólo el sandbox**, HTML crudo sin DOMPurify ni CSP | los 9 | **0** |

Y el padre no puede leer el DOM del iframe (`contentDocument` es `null`).

**42 tests unitarios** del módulo (jsdom), con el fixture hostil completo.

## H2 · Imágenes remotas — probado con un tracker real

Bloqueadas por defecto, con la barra «Este mensaje tiene imágenes remotas.
Están bloqueadas para que el remitente no sepa que lo abriste. **[Cargar
imágenes remotas]**». El permiso es por mensaje y recrea el iframe (una CSP no se
afloja en un documento ya cargado).

Con el src remoto quitado del DOM **además** de la CSP: no depende de que el
preload scanner del navegador honre la CSP.

Tracker HTTP local que anota cada hit. Seis vectores: `<img src>`, `style`
inline, `<style>`, `srcset`, `background`, URL sin protocolo.

| caso | hits en el tracker |
|---|---|
| **camino de la app, remotas bloqueadas** | **0** |
| **sólo CSP**, HTML crudo sin sanitizar | **0** |
| **control positivo**, remotas permitidas | **6 de 6** |

> Para poder mirar adentro del iframe, este arnés —y sólo éste— le agregó
> `allow-same-origin`: sin eso Chrome bloquea por Private Network Access
> cualquier pedido de un origen opaco a `localhost`, y el control positivo daba
> 0, o sea que la prueba no discriminaba. Los scripts siguieron prohibidos. La
> app **no** usa `allow-same-origin`.

## I · Imágenes inline (`cid:`)

No son seguimiento: son parte del mensaje. Se piden al backend **sólo las que el
HTML referencia**, hasta 10 por mensaje y 3 MB cada una, sólo `image/png|jpeg|
gif|webp|bmp`, y entran como `data:` (el iframe de origen opaco no puede leer un
`blob:` de la app). **No encienden la barra de remotas.** Probado en unit tests.
Ninguno de los hilos reales abiertos traía una imagen `cid:`, así que contra
correo real **no quedó ejercitado** — lo digo para no darlo por visto.

### H3 · Revalidado sobre correo real, después del deploy

Un newsletter real de MercadoLibre, abierto desde la bandeja:

| | |
|---|---|
| iframe | `sandbox="allow-popups allow-popups-to-escape-sandbox"` · `contentDocument` = `null` |
| CSP | `default-src 'none'; img-src data:; … script-src 'none'` |
| imágenes remotas | **13 neutralizadas, 0 `src` remotos** en el documento |
| barra | «Este mensaje tiene imágenes remotas…» + **Cargar imágenes remotas** (44 px) |
| click de mouse real en el botón | la barra se va · `img-src data: https: http:` · 13 `src` restaurados |

## J · Adjuntos — probado con un PDF real

- Metadata en el payload: nombre, mime, tamaño. Las inline no se listan.
- **«Descargar»** por adjunto: nada automático, nada por adelantado, nada a
  Storage.
- La ruta valida las **cuatro piezas relacionadas**: cuenta y hilo por RLS; que
  el mensaje sea **de ese hilo**; que la parte exista **en ese mensaje**.
- **Se identifica por `partId`, no por `attachmentId`**: el `attachmentId` sale
  de Gmail en el momento, nunca del request.
- Un HTML o SVG adjunto se entrega como `application/octet-stream` con
  `Content-Security-Policy: sandbox`.

**El correo de prueba no traía adjunto** (Gmail lo confirma: 0 partes adjuntas, y
por eso `has_attachments = false` es correcto). No pedí otro envío; se probó con
el PDF real que ya estaba en el índice, **desde el navegador**, por el mismo
servicio que usa el botón:

| | |
|---|---|
| archivo | `DHL_0280A01701443.pdf` · metadata `application/pdf` · 48.703 B |
| bajado | **48.703 B** · empieza con `%PDF-` · SHA-256 `79ceb8d16a9eaae6…`, igual al del red team |
| destino del pedido | sólo `buscatools-erp-email-api…run.app` — **nunca** una URL de Gmail |
| token de Gmail en la respuesta | **ninguno** |
| objetos nuevos en Storage | **0** |
| tiempo | 776 ms |

El botón «Descargar DHL_0280A01701443.pdf» se ve en 390/430/768/1440 con 44 px.
No guardé el archivo en disco.

## K · Asignación

RPC `asignar_hilo_email`, sin UPDATE libre. `usuarios_asignables_email` es nueva:
la policy de `company_memberships` no deja a un **employee** ver a sus
compañeros, así que no podía armar la lista.

**Probado, con el caso que importa:** el vendedor con un hilo asignado **sigue
viendo 0 hilos**, ni por id exacto. `assigned_to` no cambia la RLS.

## L · Workflow

Enum real: `pendiente` · `en_proceso` · `resuelto`. Un hilo sin fila es
`pendiente`. Estado inventado → rechazado.

**`email_events`** registra sólo acciones humanas: `asignado` (con
`desasignado` y `anterior` en el detalle), `estado_cambiado` (con `anterior`),
`cliente_vinculado`, `cliente_desvinculado`. **Nuevo:** una acción que no cambia
nada **no deja evento**. Listar, leer y marcar leído no dejan ninguno.

## M · CRM

`sugerencias_cliente_email` **devuelve, no escribe**.

| clase | regla |
|---|---|
| exacto | la dirección está en `customers.emails` o en un contacto, de **un** cliente |
| sugerido_dominio | el dominio está en `email_domains` de **un** cliente |
| ambiguo | varios clientes |

Excluidos: el propio buzón, **su dominio** (colegas) y los proveedores públicos
(`gmail.com`, `hotmail.com`…).

**Auto-vínculo: NO implementado.** La arquitectura aprobó auto-vincular el
exacto, pero hacerlo en el sync rompería la invariante probada de la entrega 3
—«el sync nunca toca `email_thread_state`»—. En la UI el exacto único aparece
**recomendado (★) con un click**. Queda como propuesta: si lo querés automático,
el lugar es una RPC aparte, no el sync.

Sobre los **203 hilos reales**: 77 con exacto, 7 con dominio único, 37 sólo
ambiguos, 82 sin nada.

Vincular un cliente de otra empresa, o un contacto de otro cliente: **rechazado**.

Panel lateral: cliente, link a la ficha, hasta 5 contactos, desvincular.

## N · RLS

Con JWT reales de 8 identidades más el anónimo:

| | bandeja | cuentas · estados · lecturas · eventos | hilo por id exacto |
|---|---|---|---|
| ADMIN / EMPLOYEE | su empresa (11 de 11) | su empresa | ✅ |
| SALESPERSON · TECHNICIAN · CUSTOMER · DISTRIBUTOR | **0** | **0 · 0 · 0 · 0** | **0** |
| ADMIN de otra empresa | 0 de ésta, 1 de la suya | 0 | 0 |
| ANON | **error** | error | error |

## Ñ · Push real — el correo controlado

Enviado por vos a las **00:31 ART (03:31 UTC)**, asunto «Mail de prueba», a
`info@`, sin responder.

| tramo | hora (UTC) | medido |
|---|---|---|
| Gmail recibe (`internalDate`) | 03:31:11 | — |
| Gmail → Pub/Sub → push OIDC llega a Cloud Run | 03:31:32.67 | **~21,7 s** (no separable: Pub/Sub no expone la hora de publicación en nuestros logs) |
| arranque en frío de la instancia | 03:31:33.17 | 0,5 s |
| `history.list` + `threads.get` + upsert en `email_threads` | 03:31:35.14 | ~2 s |
| Realtime → la bandeja vuelve a pedir la página | 03:31:35.87 | **0,7 s** |
| página dibujada | ~03:31:36.5 | 0,67 s |
| **total Gmail → bandeja** | | **~25 s** |

- `POST /gmail/push` 200 · `history 5422624 → 5422786` · 1 hilo · 1,75 s de sync.
- En el índice: asunto, remitente `buscatools.jano@gmail.com`, extracto «Ignorar,
  estoy probando», `in`, `[UNREAD, INBOX]`, 1 mensaje, sin adjuntos — todo
  correcto.
- **En la UI, sin tocar «Actualizar»:** apareció primero, con «Sin leer», y el
  total pasó a 205 hilos. El único pedido de la bandeja después de 03:26 fue el
  que disparó Realtime.

Y antes, sin correo controlado, dos pushes reales más: 02:03 UTC (6 hilos) y el
cron de reparación de 03:10 (ver T).

### Watch sin filtro INBOX

**Cambiado por decisión tuya.** El cuerpo de `users.watch` ahora es sólo
`{ topicName }`, sin `labelIds` ni `labelFilterBehavior`; hay un test que
intercepta el request real y falla si vuelve a aparecer.

- El Scheduler no manda cuerpo: la configuración vive en el código, así que la
  renovación diaria **usa la nueva**. Verificado leyendo el job.
- Renovado con **ese mismo job**: vence **2026-09-20 03:10:40 UTC**; `historyId`,
  vencimiento y topic guardados en `email_accounts`.
- **El caso que lo motivó** —un mail que un filtro saca del INBOX, o una respuesta
  enviada desde Gmail— no se fabricó: no toqué reglas ni mandé más correo. Sin
  `labelIds`, Gmail notifica cualquier cambio del buzón; la dependencia del label
  INBOX desaparece por construcción.
- **Volumen:** desde el cambio hasta el cierre de la prueba, **1 push** (el del
  correo de prueba). No se optimiza nada sin evidencia.

Hallazgo previo, que motivó el cambio: tres mails de la noche del 12 (23:25, 23:29
y 01:37 UTC) no tenían INBOX —filtros los mandaban a etiquetas propias o a
CATEGORY_SOCIAL— y entraron recién con el cambio de INBOX siguiente.

## O · Gmail unread intacto — medido

Con el correo de prueba, contra la **Gmail API** (`threads.get`):

| | Gmail `UNREAD` | lecturas ERP del hilo |
|---|---|---|
| antes de abrirlo (03:32:51) | **true** | 0 |
| abierto en la bandeja con click real (03:33:04) | — | — |
| después | **true** | **1, la del usuario que lo abrió** |

`gmail_labels` del índice sigue `[UNREAD, INBOX]`; abrirlo no generó push (no
hubo cambio en el buzón) y no dejó eventos.

## P · Cuerpos persistidos — medido

- **0 columnas** con `body`, `html`, `raw`, `mime`, `content` o `text` en las
  tablas `email_*`.
- Extracto máximo en el índice: 201 caracteres (el `snippet` de Gmail).
- **0 objetos nuevos en Storage** durante toda la entrega.
- El cuerpo vive en memoria: `gcTime: 0`, `Cache-Control: private, no-store`,
  nada en localStorage.

## Q · Performance y egress

Sesión real de un admin sobre los hilos reales, mediana de 5:

| operación | ms | kB |
|---|---|---|
| bandeja, página de 25 | **187** | **20,7** |
| bandeja, página de 50 | 208 | 41,7 |
| sólo sin leer · con adjuntos · pendiente+sin asignar | 192–199 | 20,2–20,7 |
| búsqueda «factura» · «gmail.com» | 192 · 195 | 4,2 · 20,7 |
| cuentas · asignables · índice del hilo · estado | 185–203 | < 0,5 |
| sugerencias CRM | 350 | 0,4 |
| marcar leído · cambiar estado · asignar · vincular | 183–204 | — |

**Piso de red: ~185 ms** (una lectura trivial de `cuentas`). Todo está en el piso.

**No lo estuvo al principio**: la primera versión de la RPC tardaba **650–880
ms**. Hacía LEFT JOIN contra los 1.010 clientes, cuya policy llama a
`app.current_role()` por fila. La versión vigente resuelve los nombres sólo para
las 25 filas de la página y busca por cliente sólo en hilos que tienen uno.

**Egress:** abrir la bandeja son **20,9 kB una vez**; después, Realtime. El
legacy: **766 kB por request, cada 60 s, por usuario**. Contra **un solo minuto**
del legacy, **37 a 1**; contra una hora, del orden de 2.000 a 1.

**Abrir un hilo** (servicio público, `threads.get` real): **1,1–1,8 s** en
caliente; **3–5 s** con la instancia en frío (`min-instances 0`). Es el costo de
no pagar una instancia ociosa; queda como dato, no como deuda.

Chunks: `EmailsPage` 7,9 kB · `EmailHiloPage` 40,4 kB (incluye DOMPurify, que no
se descarga para ver la bandeja).

## R · Mobile — medido con sesión real

Cuatro pantallas en cada ancho: **bandeja**, **bandeja con cuatro filtros**,
**hilo de texto con adjunto** y **hilo HTML** (estas dos incluyen workflow, panel
de cliente y adjuntos). Medido en la página: `scrollWidth` vs `clientWidth`,
elementos fuera del viewport, controles < 44 px y campos < 16 px con
`pointer: coarse`.

| ancho | puntero | `scrollWidth` / `clientWidth` | fuera del viewport | < 44 px | < 16 px |
|---|---|---|---|---|---|
| 390 | grueso | 390 / 390 · las 4 | 0 | **0** | **0** |
| 430 | grueso | 430 / 430 · las 4 | 0 | **0** | **0** |
| 768 | fino (el panel no emula táctil desde 768) | 753 / 753 · las 4 | 0 | 0 | 14 px de escritorio; la regla `@media (pointer: coarse)` que los lleva a 16 px **existe** en la hoja cargada |
| 1440 | fino | 1425 / 1425 · las 4 | 0 | 0 | 14 px de escritorio |

- Hilo: debajo de 1024, trabajo y cliente **arriba** de los mensajes; en 1440,
  **al costado** (300 px).
- Iframe siempre dentro de su caja: 333/357 px en 390, 373/397 en 430, 439/463 en
  768, 795/819 en 1440. Un newsletter de ancho fijo scrollea **dentro** del iframe.
- Estado vacío con filtros («Ningún hilo coincide…» + Limpiar filtros) medido en 390.
- Botón de adjunto: 44 px en los cuatro anchos.
- **Bug encontrado y corregido:** el buscador «Vincular a mano» medía ~240 px de
  alto en 390 (su `flex-basis` se volvía alto dentro del campo en columna). Ahora 44.
- **Sobre la herramienta:** con emulación táctil, el click sintético del panel no
  llegó al botón «Cargar imágenes remotas» aunque apuntaba a su centro exacto
  (`elementFromPoint` devolvía el botón). Con click por DOM en 390 y con mouse
  real en 1440 funciona. Lo anoto como límite de la medición, no de la app.

## S · Dry run de los 91 estados

Sobre el export real (`estados-de-trabajo.json`). **No se aplicó nada**: 0
estados productivos antes y después.

| | |
|---|---|
| clasificación | **AUTO 20 · REVIEW 67 · UNRESOLVED 4** — igual a la arquitectura |
| hilos distintos | 81 · AUTO: 16 |
| AUTO presentes en el índice real | **0 de 16** |
| cualquier clase presente en el índice | 0 de 81 |
| fechas de los estados legacy | 2026-08-05 → 2026-09-07 |
| ventana del índice real | 2026-09-08 → 2026-09-13 |

**Cero coincidencias, y no por un error de decodificación**: el índice empieza
el 8 de septiembre (resync de 7 días) y el último estado legacy es del 7. Para
reconciliar hace falta indexar esos hilos puntuales —16 `threads.get` de
metadata— antes de aplicar; no lo hice porque exigía una ruta nueva en el
servicio privado.

## T · Bugs y hallazgos

1. **La RPC de la bandeja estaba 4× por encima del piso de red.** Medido,
   diagnosticado (RLS de `customers` por fila), reescrita, medida de nuevo.
2. **Las RPC del ERP aceptaban un `gmail_thread_id` cualquiera** y creaban una
   fila de estado para un hilo inexistente. Endurecidas.
3. **Una acción sin cambio dejaba evento.** Corregido.
4. **Un employee no podía listar a quién asignar.** Nueva `usuarios_asignables_email`.
5. **BUG DE LA ENTREGA 3: la red para notificaciones perdidas se anulaba sola.**
   Al renovar el watch, `guardarWatch` guardaba el `historyId` del watch como
   cursor ANTES de comparar; el sync posterior encontraba el cursor adelante y no
   hacía nada. El propio comentario del código decía que eso saltearía cambios.
   - **Encontrado en producción** al renovar el watch sin filtro: el cursor saltó
     de 5422417 a 5422621 sin sincronizar.
   - **Corregido:** `renovarWatch` en `sync.ts`; el cursor sólo lo mueve
     `sincronizar`, al final. Test de regresión que **falla con el bug
     reintroducido** (verificado) y pasa sin él.
   - **Reparado:** cursor vuelto al último valor realmente sincronizado (5422417,
     leído de `email_sync_log`, con guarda de que no hubiera cambiado); el mismo job
     del Scheduler sincronizó `5422417 → 5422624`, 1 hilo. Índice 204.
6. **Acentos rotos en cuerpos reales.** Un newsletter mostraba «OpinÃ¡» veinte
   veces: bytes UTF-8 decodificados con el charset del header, que `TextDecoder`
   resolvía como windows-1252. Confirmado con el payload real (re-interpretarlo
   eliminaba las 20 secuencias). Ahora UTF-8 estricto primero; revalidado: 0.
7. **`TextDecoder('windows-1252')` de Node 22 decodifica ISO-8859-1 puro**:
   «“hola”» salía con caracteres de control. Lo destapó el test del punto 6.
   Tabla 0x80–0x9F a mano.
8. **Buscador de 240 px de alto en mobile.** Ver R.
9. **Mis pruebas, tres veces sin discriminar, corregidas antes de contarlas:** el
   registrador de red no ve subframes; un iframe opaco no llega a `localhost`; el
   click sintético con emulación táctil no llega. En los tres casos rehíce la
   prueba con un control positivo que diera positivo.
10. **La suite 0.5 falló una vez por invocarla sin `--bundle`.** Error mío.
11. **Realtime intermitente en la suite** — ver F. **PostgREST 504 transitorio** —
    ver G.

**Sugerencias CRM con ruido real:** `buscatools@gmail.com` —una dirección propia
de la empresa— figura en `customers.emails` de dos clientes, y aparece como
«ambiguo» en muchos hilos. La regla hace lo correcto (no sugiere uno ni vincula);
limpiar ese dato del CRM es backlog, no un cambio de esta entrega.

## U · Regresión final — en serie, de a una, después de todos los deploys

| suite | resultado |
|---|---|
| `npm run lint` · `typecheck` · `build` | limpios |
| `npm test` · `npm run test:isolated` | 592 · 592 passed |
| `npm run backend:check` | **86** passed, typecheck limpio |
| `fase9-emails-seguridad-tests --bundle … --fase despues` (0.5, legacy) | **0 accesos abiertos** |
| `fase9-emails-entrega3-tests` | 0 fallos |
| `fase9-emails-entrega4-tests` (con `EMAILS_API_URL`) | **0 fallos · 124 comprobaciones** |
| `fase9-emails-entrega4-api-redteam` | **0 fallos · 33 comprobaciones** |
| `fase8-whatsapp-entrega1-tests` | 0 |
| `regresion-rls-roles` · `regresion-bugs-migracion` (Catálogo) | 0 · 0 |
| `stage3-cierre-tests` (Ventas) | 0 |
| `fase5-cierre-tests` (Clientes) | 0 |
| `fase6-cierre-tests` (Compras) | 0 |
| `fase7-mantenimiento-entrega5-tests` | 0 |
| `security-o4-stock-movements-tests` · `fix-rls-tautologicas-tests` | 0 hallazgos · 0 |

**Un fallo en la primera pasada, y era de la suite, no del producto:** la sección
del servicio público corrió por primera vez contra la URL real y usaba ids de
fixture (`e4a01`) sin formato de id de Gmail. El servicio los corta en la
validación de formato con 404 **antes** de consultar la base, así que los casos
de rol pasaban **por la razón equivocada**, y el «token basura» daba 404 en vez de
401. Ahora usa un hilo de fixture con id hexadecimal: cada pedido llega a
PostgREST y decide la RLS. Repetida sola: 0 fallos.

`security-o4` quedó 9 horas en su limpieza porque la máquina se suspendió;
terminó con 0 hallazgos. Esa noche sirvió de medición del watch (ver abajo).

### Nueve horas de watch sin filtro, con tráfico real

| | |
|---|---|
| pushes con cambios (03:10 → 12:50 UTC) | **3** · 1,6 s promedio · **0 errores** |
| hilo nuevo **sin INBOX** (CATEGORY_SOCIAL + etiqueta propia) | llegó 10:40:23 · indexado **10:40:33 · 10 s** |
| antes del cambio, tres mails así | esperaron **horas**, hasta el siguiente cambio de INBOX |
| el correo de prueba, resincronizado por otro push a las 03:37 | sigue `UNREAD` |

Es el caso que motivó el cambio, verificado con tráfico que ya existía, sin tocar
reglas ni mandar correo. Volumen: bajo; no hay nada que optimizar.

## V · CI / deploy

| | |
|---|---|
| Cloud Run privado | `buscatools-erp-email-00006-pm6` · IAM intacto · anónimo 403 |
| Cloud Run público | `buscatools-erp-email-api-00002-s7t` · invocación pública, auth en el código |
| watch | sin filtro · vence 2026-09-20 03:10:40 UTC · renovación diaria con la misma configuración |
| frontend | `VITE_EMAILS_API_URL` agregado al workflow (URL pública, no secreto) |
| migraciones | `fase9_emails_entrega4_bandeja`, `_crm`, `_asignables`, `_endurecer`, `_realtime`, `_bandeja_lateral` · SQL en [`database/PHASE_9_EMAILS_ENTREGA_4.sql`](database/PHASE_9_EMAILS_ENTREGA_4.sql) |
| reparación de datos | cursor de `info@` vuelto a 5422417 para recuperar el rango salteado por el bug de la entrega 3 (ver T.5) |

Advisors: sólo la advertencia conocida de SECURITY DEFINER, ahora también para
`usuarios_asignables_email` —intencional y acotada—.

Commit, push y CI: ver el informe de cierre en la conversación; el workflow corre
lint, typecheck, los dos test runners y build antes del deploy a Pages.

---

## Criterios de cierre

| criterio | estado |
|---|---|
| public API desplegada y red-teameada | ✅ 33 comprobaciones × 4 corridas |
| sólo admin/employee obtienen contenido | ✅ medido por contenido, no sólo status |
| watch sin filtro INBOX activo | ✅ |
| Scheduler renovará esa misma configuración | ✅ el job no manda cuerpo; renovado con él |
| push REAL de Gmail | ✅ correo controlado, ~25 s de Gmail a la bandeja |
| Realtime UI | ✅ apareció sin «Actualizar» |
| Gmail unread intacto | ✅ `UNREAD` antes y después, por Gmail API |
| body on-demand | ✅ |
| 0 body persistido | ✅ 0 columnas · 0 objetos en Storage |
| attachment on-demand | ✅ PDF real por el navegador, hash idéntico (el correo de prueba no traía adjunto) |
| HTML seguro | ✅ navegador real, antes y después del deploy |
| remote images bloqueadas | ✅ tracker real + newsletter real |
| mobile 390/430/768/1440 | ✅ medido; en 768 el puntero de la herramienta es fino |
| regresión | ✅ |
| CI/deploy | ver informe de cierre |

**Lo que queda escrito para no perderlo:** imágenes `cid:` no ejercitadas con
correo real; cleanup policy de Artifact Registry; `buscatools@gmail.com` en
`customers.emails` de dos clientes; primera apertura de un hilo de 3–5 s en frío.
