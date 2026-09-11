# Fase 8 · WhatsApp — Entrega 0.5: contención de seguridad del legacy

Cierra los riesgos inmediatos del WhatsApp legacy. **No migra nada, no rediseña
nada, no enciende Baileys y no manda ningún mensaje.**

Ningún valor de token aparece en este informe.

---

## Resumen

| | antes | después |
|---|---|---|
| leer conversaciones con la clave pública | **8 filas** | **HTTP 401** |
| leer mensajes | **150 filas** | **HTTP 401** |
| leer media (base64) | **legible** | **HTTP 401** |
| leer estado y QR | **legible** | **HTTP 401** |
| leer credenciales de Baileys | tabla accesible | **HTTP 401** |
| escribir / borrar | abierto con el token público | **HTTP 401** |
| `suite_wa_ping` | revelaba los conteos | **HTTP 401** |
| Realtime anónimo | canal con las tablas publicadas | **0 filas entregadas** |
| egress con la bandeja abierta | 20,7 MB/hora | **1,1 MB/hora** de respuestas 401 |
| histórico | 8 · 150 · 56 | **8 · 150 · 56, intacto** |

El único criterio que no dependía de mí —invalidar el secreto del worker de
IA— **se completó después**, rotándolo a mano en Cloudflare. Está en **L**.

---

## A · Backup

Hecho **antes** de tocar nada, de sólo lectura, y **fuera del repositorio**:

```
C:\Users\janog\backups-legacy\whatsapp-2026-09-11\
```

| tabla | filas | bytes | sha256 (12) |
|---|---|---|---|
| `suite_wa_conversaciones` | 8 | 4.614 | `1b997bb0af1d…` |
| `suite_wa_mensajes` | 150 | 109.418 | `5ba3e4c0de0e…` |
| `suite_wa_estado` | 1 | 7.306 | `dab600d1cde8…` |
| `suite_wa_reglas` | 0 | 2 | `4f53cda18c2b…` |
| `suite_wa_media` (metadata) | 56 | 14.182 | `dda01fd6e78a…` |
| `suite_wa_media` (archivos) | 56 | **23.214.696** | un `.b64` por fila |
| `suite_wa_sesion` | 0 | — | **no se respalda** |

`INDICE.json` registra cada archivo con su sha256 y el sello de tiempo.

Dos decisiones del respaldo:

- **El base64 va en archivos aparte**, uno por fila, para que el JSON de
  metadata siga siendo legible. Los 23,2 MB confirman la estimación de la
  entrega 0: los 16,6 MB declarados, inflados ~33 % por base64.
- **`suite_wa_sesion` no se respalda.** Son las credenciales de Baileys, y un
  backup de un secreto es otro lugar del que se puede filtrar. Se anota que
  tenía 0 filas.

El respaldo se hizo con la clave publicable del bundle, que en ese momento leía
todo. **Ese mismo script ya no funciona**, y esa es una prueba más de que el
cierre funcionó.

---

## B · Superficie real

La entrega 0 auditó 6 tablas. **Había más.** Buscando por nombre en todo el
esquema aparecieron ocho de WhatsApp, no seis:

| tabla | filas | ¿la usa el bundle actual? |
|---|---|---|
| `suite_wa_conversaciones` | 8 | sí |
| `suite_wa_mensajes` | 150 | sí |
| `suite_wa_media` | 56 | sí |
| `suite_wa_estado` | 1 | sí |
| `suite_wa_sesion` | 0 | sí (logout) |
| `suite_wa_reglas` | 0 | sí |
| **`erp_wa_config`** | **1** | **0 referencias** — resto de un intento anterior |
| **`erp_whatsapp_messages`** | **0** | **0 referencias** — íd. |

Y tres que **no** son de WhatsApp y quedan fuera de alcance a propósito:

| tabla | filas | por qué no se toca |
|---|---|---|
| `erp_ai_conversations` | **218** | 6 referencias vivas en el ERP: cerrarla rompe una función en uso |
| `erp_clone_conversations` | 16 | 5 referencias vivas |
| `conversations` / `messages` | 0 / 0 | de otro sistema, con RLS propia por `org_id` y `auth.uid()` |

No hay buckets de Storage involucrados: la media vive en una columna.

---

## C · RLS y grants, antes

El diagnóstico exacto, que no es el que suponía la entrega 0.

**Cada tabla de datos tenía DOS policies:**

```
wa_conv_select      SELECT  {anon,authenticated}  USING (true)     ← el agujero
wa_conv_write       ALL     {anon,authenticated}  USING erp_valid_token()
```

**Las policies se combinan con OR.** La permisiva ganaba siempre, así que la de
token nunca llegaba a importar para leer. Eso explica exactamente por qué en la
entrega 0 las consultas funcionaban sin el header.

**Los grants eran totales:**

```
anon = arwdDxtm    ← INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
authenticated = arwdDxtm
```

**Y `erp_valid_token()` no es una frontera:**

```sql
CREATE FUNCTION public.erp_valid_token() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT current_setting('request.headers')::json ->> 'x-erp-token' = '<literal>'
      OR current_setting('request.headers')::json ->> 'x-suite-key' = '<literal>'
$$;
```

Compara un header contra **un literal escrito en el cuerpo de la función**, y
ese literal está publicado en el bundle. Es `SECURITY DEFINER`, **sin
`search_path` fijo**, y ejecutable por `PUBLIC`.

**Dato que decide todo lo demás: `auth.users` tiene 0 filas.** El ERP legacy
**no usa autenticación de Supabase**. Manda `Authorization: Bearer <clave
publicable>`, o sea que todo su tráfico es `anon`. No hay ningún usuario real
que preservar, y no hay ninguna sesión existente que se pueda aprovechar.

---

## D · Accesos confirmados antes del fix

Separando lo medido de lo inferido, como se pidió.

| acceso | estado |
|---|---|
| leer conversaciones sin ningún header | **CONFIRMADO** — 8 filas |
| leer mensajes sin ningún header | **CONFIRMADO** — 150 filas |
| leer metadata de media sin header | **CONFIRMADO** — 56 filas |
| **descargar el binario de un archivo** | **CONFIRMADO** — 94.168 caracteres base64 de una fila |
| leer estado y QR | **CONFIRMADO** |
| escribir / borrar | **CONFIRMADO POR CONSTRUCCIÓN** |

Sobre el último: en la entrega 0 lo marqué **INFERIDO** porque no lo probé. Al
leer `erp_valid_token()` dejó de ser inferencia: la escritura estaba protegida
por una comparación de texto contra un valor que está publicado. **No hice la
prueba destructiva sobre producción** —no hacía falta y habría sido
irresponsable—, pero el mecanismo está a la vista.

---

## E · Cambios aplicados

Dos migraciones sobre el proyecto legacy `hnyngsejohkmlaccpkux`. **Ni una fila
borrada.**

### 1 · `fase8_entrega05_cerrar_lectura_publica_whatsapp`

```sql
-- Las policies permisivas de lectura: son las que abrían todo.
drop policy wa_conv_select     on suite_wa_conversaciones;
drop policy wa_mensajes_select on suite_wa_mensajes;
drop policy wa_media_select    on suite_wa_media;
drop policy wa_estado_select   on suite_wa_estado;

-- Las policies basadas en el token comprometido.
drop policy wa_conv_write, wa_mensajes_write, wa_media_write, wa_estado_write,
            wa_sesion_token_only, wa_reglas_token, wa_config_token,
            erp_wa_messages_token;

-- Los privilegios.
revoke all privileges on table <las 8> from anon, authenticated, public;

-- RLS, explícita en las ocho.
```

Las policies de token **no se conservaron como segunda capa**, y es a propósito:
un candado cuya llave está publicada no es una segunda capa, es una puerta con
cartel. Sin ninguna policy y con RLS habilitada, la tabla queda **denegada por
defecto**, que es el lado correcto donde fallar.

### 2 · `fase8_entrega05_cerrar_rpc_y_realtime_whatsapp`

Esta salió de la suite de ataques: el cierre de tablas **no alcanzaba**.

```sql
revoke execute on function suite_wa_ping() from public, anon, authenticated;

alter publication supabase_realtime drop table suite_wa_conversaciones;
alter publication supabase_realtime drop table suite_wa_mensajes;
alter publication supabase_realtime drop table suite_wa_reglas;
```

Quitarle los privilegios a una tabla no sirve si hay una función
`SECURITY DEFINER` que la lee por vos, ni si Realtime la publica.

### Estado final

```
suite_wa_conversaciones   rls=true   policies=0   acl: postgres | service_role
suite_wa_mensajes         rls=true   policies=0   acl: postgres | service_role
suite_wa_media            rls=true   policies=0   acl: postgres | service_role
suite_wa_estado           rls=true   policies=0   acl: postgres | service_role
suite_wa_sesion           rls=true   policies=0   acl: postgres | service_role
suite_wa_reglas           rls=true   policies=0   acl: postgres | service_role
erp_wa_config             rls=true   policies=0   acl: postgres | service_role
erp_whatsapp_messages     rls=true   policies=0   acl: postgres | service_role
```

`service_role` y `postgres` tienen `BYPASSRLS`: el respaldo, la eventual
migración y cualquier recuperación siguen siendo posibles desde el backend.

---

## F · Conversaciones · G · Mensajes · H · Media · I · Estado y QR

Las cuatro categorías quedaron cerradas de la misma forma y se probaron por
separado. Ver la matriz completa en **P**.

- **Conversaciones**: 8 filas intactas, ilegibles desde el exterior.
- **Mensajes**: 150 intactos, ilegibles.
- **Media**: 56 archivos y ~22 MB de base64 intactos en la tabla. **No se
  movieron**: pasarlos a Storage es trabajo de la fase de migración, no de una
  contención.
- **Estado y QR**: el QR de 6.906 caracteres ya no se sirve a nadie. La fila
  sigue ahí.

---

## J · Mutaciones

Probadas de verdad contra producción, con filas marcadas `ZZ-SEC` y sin tocar
ni una fila real:

| operación | sin token | con el token del bundle |
|---|---|---|
| `INSERT` en `suite_wa_conversaciones` | **401** | **401** |
| `UPDATE` | **401** | **401** |
| `DELETE` | **401** | **401** |

El `DELETE` de la prueba iba acotado por `chat_id` a la marca de prueba: **no
había forma de que tocara datos reales**.

---

## K · Funciones

| función | antes | después |
|---|---|---|
| `suite_wa_ping()` | `SECURITY DEFINER`, `PUBLIC EXECUTE`, devolvía conteos a cualquiera | **`revoke execute`** de `public`, `anon` y `authenticated` |
| `erp_valid_token()` | `SECURITY DEFINER`, **sin `search_path`**, `PUBLIC EXECUTE`, token literal en el cuerpo | **no se tocó** — ver **R** |

`suite_wa_ping` era un caso de manual: la tabla ya estaba cerrada y la función,
por ser `DEFINER`, seguía contestando *«150 mensajes, 0 pendientes»* a cualquiera.
No es contenido, pero es información del negocio y era una puerta abierta.

---

## L · El secreto del worker de IA — **rotado**

### Terminología, corregida

En la entrega 0 y en la primera versión de este informe llamé a esto
`AI_WORKER_TOKEN`. Ese es el nombre de **la constante del bundle legacy** que
guardaba el valor. **La variable real del lado de Cloudflare se llama
`WORKER_SECRET`**, y el worker la valida así:

```
header  X-Worker-Token   ===   env.WORKER_SECRET
```

Es la **única** validación del worker y **no tiene fallback**. O sea: el valor
que estaba publicado en el bundle era el que correspondía a este mismo
mecanismo. Un nombre y el otro son el mismo secreto visto desde las dos puntas.

### Qué se encontró

| | |
|---|---|
| servicio | Cloudflare Worker `buscatools-ai` |
| producción | `https://buscatools-ai.buscatools-jano.workers.dev/` |
| ¿seguía activo? | **sí** — un `GET` sin credenciales devolvía `401 {"error":"No autorizado."}` |
| qué puede hacer | reenviar a **OpenAI** (`gpt-4o-mini`) |
| ¿estaba expuesto? | **sí**, en el bundle público |

La comprobación de vida fue un `GET` sin token: el worker espera `POST`, así
que **no pudo disparar ninguna completion ni generar gasto**.

### La rotación

Hecha a mano desde una sesión autenticada de Cloudflare, fuera de esta
conversación.

| | |
|---|---|
| `WORKER_SECRET` | **ROTATED** |
| almacenamiento | estaba como *Secret*, sigue como *Secret* |
| valor nuevo | 48 bytes aleatorios · 384 bits |
| dónde vive | **SERVER-SIDE ONLY** — únicamente en Cloudflare |
| ¿se copió a chat, archivo, Git o frontend? | **no** |
| valor expuesto en el legacy | **INVALIDATED** |
| deployment | OK · versión **8656441a** · 100 % del tráfico |
| worker | **OPERATIONAL** |
| sin token | HTTP 401 |
| credencial arbitraria incorrecta | HTTP 401 |
| `OPTIONS` | 204 · CORS intacto |
| SPA React (`app.buscatools.com`) | **NO DEPENDENCY** — no consume este worker |
| completions generadas durante la prueba | **0** |

### Sobre la prueba que no se hizo

No se probó el token viejo contra el worker, porque no se conservó. **Eso no
bloquea el cierre**: el worker tiene una sola comparación, contra el
`WORKER_SECRET` actual, sin ningún camino alternativo, y ese valor fue
reemplazado por uno aleatorio nuevo. Cualquier valor anterior deja de
satisfacer la comparación por construcción.

**No se buscó ni se publicó el valor viejo sólo para repetir la prueba.**
Recuperar un secreto filtrado para volver a usarlo sería exactamente lo
contrario de lo que esta entrega vino a hacer.

### El secreto nuevo no se guardó en ningún lado

No se intentó recuperarlo y no está en `.env`, `.env.local`, GitHub,
Supabase, el frontend, esta documentación ni ningún script. **Hoy ningún
consumidor legítimo necesita conocerlo**: la aplicación nueva no llama a este
worker, y las llamadas de IA del legacy quedan con el secreto viejo, que ya no
sirve.

Cuando la fase de migración necesite IA, el secreto tiene que viajar de un
backend a otro, nunca por el navegador.

### Métricas de Cloudflare · últimos 30 días

| métrica | valor |
|---|---|
| invocaciones | 401 |
| subrequests | 240 |
| a OpenAI | 228 |
| a Supabase | 11 |
| errores | 0 |
| concentración | principalmente entre el **15 y el 25 de agosto** |

**NO HAY EVIDENCIA SUFICIENTE PARA DETERMINAR ABUSO.** No se afirma que lo
hubo ni que no lo hubo: los números son compatibles tanto con el uso propio del
ERP en esas fechas como con un tercero, y no hay registro por origen que
permita distinguirlos. La ventana de actividad coincide con la del puente de
WhatsApp (24 de agosto), lo que **sugiere** uso propio, pero sugerir no es
demostrar.

Lo que sí es un hecho: el valor expuesto ya no sirve.

## M · Credenciales del puente

| credencial | dónde | estado |
|---|---|---|
| sesión de Baileys | tabla `suite_wa_sesion` | **0 filas** — el puente está deslogueado desde el 2026-08-24 |
| token de aplicación (`x-suite-key` / `x-erp-token`) | bundle público **y** cuerpo de `erp_valid_token()` | **COMPROMETIDO** |
| clave publicable de Supabase | bundle público | publicable por diseño; hoy ya no abre WhatsApp |

**No se invalidó ninguna credencial del puente** y no se borró
`suite_wa_sesion`: la tabla está vacía, así que no hay nada que revocar, y
destruir el camino de recuperación antes de documentarlo habría sido al revés
de lo que se pidió.

**El puente no se encendió.** Si alguna vez se enciende, lo hará con
`service_role`, que conserva sus privilegios.

---

## N · Realtime

Acá hubo un matiz que casi reporto mal.

La primera corrida de la suite marcó **FAIL**: el canal aceptaba el `phx_join`
anónimo. Pero **aceptar el join no es entregar filas**. Lo verifiqué con las dos
puntas: un suscriptor anónimo escuchando `suite_wa_mensajes` y
`suite_wa_reglas`, y un `INSERT` y un `UPDATE` disparados desde `postgres`
mientras escuchaba.

```
respuesta al join: ok · bindings aceptados: [suite_wa_reglas, suite_wa_mensajes]
eventos postgres_changes recibidos por el anónimo: 0
```

**Cero.** El canal acepta la suscripción y no transmite nada, porque las tablas
salieron de la publicación `supabase_realtime`.

Corregí la aserción de la suite: ahora el join se reporta como **informativo** y
lo que se comprueba es la **entrega**. Afirmar un PASS sobre la señal
equivocada habría sido peor que el FAIL original.

La fila de prueba en `suite_wa_reglas` se borró: la tabla volvió a 0 filas.

---

## O · Bundle

Auditado **el archivo publicado en vivo**, no mi copia descargada
(`https://buscatoolsjano-web.github.io/Buscatools/app.js`, 5.261.141 bytes):

| patrón | estado |
|---|---|
| `SUPA_URL` | PRESENTE |
| `SUPA_KEY` (publicable) | PRESENTE |
| `SUPA_APP_TOKEN` | **PRESENTE** |
| `AI_WORKER_URL` | PRESENTE |
| `AI_WORKER_TOKEN` | **PRESENTE** |
| `service_role` | **ausente** |
| JWT (`eyJ…`) | **ausente** — las dos coincidencias son imágenes JPEG en base64 |
| `erp_wappfly_token` | **ausente** — confirma que WappFly se fue del todo |

El bundle **no se modificó**: el legacy sigue siendo de sólo lectura para mí, y
cambiarlo no habría servido de nada. Lo que hace que el token de aplicación ya
no importe para WhatsApp es que **ninguna policy lo consulta más**.

Para el secreto del worker, en cambio, sacarlo del bundle **no alcanzaría**:
está en el historial de Git y en todas las copias ya servidas. **Sólo rotarlo
lo invalida** — y eso ya se hizo (**L**).

Así que la fila `AI_WORKER_TOKEN: PRESENTE` de la tabla de arriba sigue siendo
cierta y **ya no importa**: lo que está publicado es un valor que el worker
rechaza. El bundle guarda una llave que no abre nada.

---

## P · Tests post-fix

`scripts/fase8-whatsapp-seguridad-tests.mjs`, con las credenciales del bundle
público — la misma puerta que usaba cualquier visitante.

```
1 · LECTURA ANÓNIMA · sólo con la clave publicable
    PASS  suite_wa_conversaciones: rechazado — HTTP 401
    PASS  suite_wa_mensajes: rechazado — HTTP 401
    PASS  suite_wa_media: rechazado — HTTP 401
    PASS  suite_wa_estado: rechazado — HTTP 401
    PASS  suite_wa_sesion: rechazado — HTTP 401
    PASS  suite_wa_reglas: rechazado — HTTP 401
    PASS  erp_wa_config: rechazado — HTTP 401
    PASS  erp_whatsapp_messages: rechazado — HTTP 401

2 · LECTURA CON EL TOKEN DEL BUNDLE · x-suite-key y x-erp-token
    PASS  las 8 combinaciones: rechazadas — HTTP 401

3 · MEDIA · el binario en base64
    PASS  sin token: rechazado — HTTP 401
    PASS  con token: rechazado — HTTP 401

4 · ESCRITURA · insertar, modificar y borrar
    PASS  INSERT / UPDATE / DELETE rechazados, con y sin token — HTTP 401

5 · RPC · suite_wa_ping
    PASS  sin token: rechazada — HTTP 401
    PASS  con token: rechazada — HTTP 401

6 · REALTIME
    ····  el canal acepta el join (informativo): ok
    PASS  ninguna fila entregada al suscriptor anónimo

RESULTADO: 0 acceso(s) abierto(s)
```

Las respuestas de error **no filtran datos**: son el `401` estándar de
PostgREST, de ~200 bytes, sin nombres de tabla ni detalles del esquema.

**No hay usuario interno con acceso**, porque no existe el modelo: `auth.users`
está en 0. Si algún día hace falta que alguien lea esto desde el legacy, será
con autenticación real, no con un secreto en JavaScript.

---

## Q · Egress

| | antes | después |
|---|---|---|
| ciclo de refresco | 12.048 bytes | **620 bytes** (tres respuestas 401) |
| con la bandeja abierta (poll 2 s) | **20,7 MB/hora** | **1,1 MB/hora** |
| requests/min | 90 | **90** |

**Las peticiones no bajan.** `programar()` se reencola pase lo que pase, así que
si alguien deja la pestaña abierta en WhatsApp, el legacy va a seguir pidiendo
cada 2 segundos y recibiendo 401 para siempre. Baja el volumen —94 % menos—
pero no el ruido.

No se optimizó el polling, como se pidió. Queda anotado: **es otra razón para
dar la bandeja legacy por terminada** en vez de dejarla girando en vacío.

---

## R · Lo que deliberadamente NO se tocó

| qué | por qué |
|---|---|
| **Los datos** | 8 conversaciones, 150 mensajes, 56 archivos: **intactos**. Todavía no decidimos si se migran |
| **La media** | sigue en base64 en la tabla. Moverla es trabajo de la migración |
| `suite_wa_sesion` | vacía; borrarla no aporta y destruye el camino de recuperación |
| **El bundle legacy** | no se modificó: es de sólo lectura, y cambiarlo no invalida nada |
| `erp_valid_token()` | la usan **19 tablas**. Tocarla acá rompería el ERP entero — ver abajo |
| `erp_ai_conversations` (218) y `erp_clone_conversations` (16) | están vivas en el ERP; cerrarlas rompe una función en uso |
| **El polling** | optimizarlo no es contención |
| **Baileys** | no se encendió |
| **El worker de IA** | no se llamó, salvo un `GET` sin credenciales para comprobar que está vivo |

### El hallazgo que excede esta entrega

**19 tablas** del proyecto legacy tienen policies que dependen de
`erp_valid_token()`, o sea del mismo token publicado. Esta entrega cerró **8**
—las de WhatsApp—. Las otras **11 siguen abiertas**, y entre ellas está
`erp_store`, por donde sincroniza **todo** el ERP legacy: clientes,
cotizaciones, pedidos, compras, mantenimiento.

No lo toqué porque estaba explícitamente fuera de alcance y porque **cerrarlo
apagaría el ERP legacy completo**. Pero es la misma clase de agujero, con
mucho más adentro, y merece su propia decisión.

---

## S · CI y deploy

**No aplica.** El cambio es exclusivamente de privilegios y policies en el
Supabase legacy. No se tocó una línea del repositorio React, no hay build ni
deploy, y la aplicación nueva (`app.buscatools.com`) no usa ninguna de estas
tablas.

Lo que sí se commitea: el script de respaldo, la suite de ataques y este
informe.

---

## Revalidación posterior a la rotación

La suite de ataques se volvió a correr **después** de rotar el secreto del
worker, para confirmar que nada se movió mientras tanto.

```
1 · LECTURA ANÓNIMA          8 tablas · todas HTTP 401
2 · LECTURA CON EL TOKEN     8 combinaciones · todas HTTP 401
3 · MEDIA (base64)           sin token y con token · HTTP 401
4 · ESCRITURA                INSERT / UPDATE / DELETE · HTTP 401
5 · RPC suite_wa_ping        sin token y con token · HTTP 401
6 · REALTIME                 0 filas entregadas al suscriptor anónimo

RESULTADO: 0 acceso(s) abierto(s)
```

Y el histórico, medido directo contra la base:

| | |
|---|---|
| conversaciones | **8** |
| mensajes | **150** |
| media | **56** |
| estado | 1 |
| reglas · sesión | 0 · 0 |
| rango de los mensajes | 2026-08-24 → 2026-08-24 |
| policies sobre `suite_wa_*` | **0** |
| tablas `suite_wa_*` publicadas en Realtime | **0** |

**Intacto.**

---

## Estado de la bandeja legacy

**LEGACY WHATSAPP BANDEJA = INTENCIONALMENTE FUERA DE SERVICIO.**

No se va a arreglar, no se vuelve a habilitar `anon` y no se enciende Baileys.
Es la consecuencia buscada de la contención, no un efecto colateral: con
`auth.users` en 0, no existe ninguna forma de que esa bandeja lea los datos
sin volver a abrir el acceso público.

---

## Issue global separado

```
LEGACY PUBLIC TOKEN SURFACE
SECURITY PRIORITY — HIGH
```

**11 tablas** del proyecto legacy siguen dependiendo del mismo patrón de token
público, `erp_valid_token()`. Entre ellas está **`erp_store`**, por donde
sincroniza todo el ERP legacy.

**No se tocan**: cerrarlas puede afectar al ERP legacy completo, y eso necesita
su propia decisión y su propia ventana.

Queda documentado y **no bloquea** el cierre de la contención específica de
WhatsApp, que es lo que esta entrega se propuso.

---

## Criterio de cierre

| criterio | estado |
|---|---|
| anon no lee chats | **cumplido** |
| anon no lee mensajes | **cumplido** |
| anon no lee media | **cumplido** |
| anon no lee QR/estado sensible | **cumplido** |
| no hay mutaciones públicas | **cumplido** |
| `suite_wa_ping` bloqueada | **cumplido** |
| Realtime anónimo sin entrega | **cumplido** |
| **secreto del worker invalidado** | **cumplido** — `WORKER_SECRET` **ROTATED**, valor expuesto **INVALIDATED** |
| no aparecen secretos nuevos en el frontend | **cumplido**: no se agregó ninguno, y el nuevo es *server-side only* |
| histórico intacto | **cumplido**: 8 · 150 · 56 |
| backup verificado | **cumplido**, con sha256 |

Los once.

---

# PHASE 8 — WHATSAPP · ENTREGA 0.5 = CLOSED
