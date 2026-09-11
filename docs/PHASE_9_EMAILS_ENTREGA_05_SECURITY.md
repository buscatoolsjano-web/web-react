# Fase 9 · Emails — Entrega 0.5: contención de seguridad del legacy

**Estado: CERRADA.** La superficie pública de Emails del Supabase legacy está
cerrada. Los 976 emails, los 479 adjuntos y los 91 estados de trabajo están
intactos. **No se tocó Gmail** ni una sola vez.

```
LEGACY EMAIL INBOX = INTENCIONALMENTE FUERA DE SERVICIO
LEGACY EMAIL INGESTION / MAKE = DEPRECATED
GMAIL = SOURCE OF TRUTH
ERP_EMAILS = CACHE / INDEX LEGACY + 91 METADATA-ONLY BUSINESS STATES
```

La bandeja legacy dejó de funcionar. **Es la consecuencia buscada**, no un
efecto colateral: la única forma de mantenerla andando era dejar abierta una
puerta por la que cualquiera podía escribir en la bandeja sin autenticarse.

---

## A · Backup

Verificado de nuevo antes de tocar nada: los sha256 recalculados coinciden con
los registrados. Está **fuera del repositorio**, en
`C:\Users\janog\backups-legacy\emails-2026-09-11\`.

| archivo | filas | bytes | sha256 |
|---|---|---|---|
| `erp_emails.json` | **976** | 75.948.720 | `7ad6587eac854f1e…` |
| `erp_email_rules.json` | 0 | 2 | `4f53cda18c2baa0c…` |
| `email-attachments-inventario.json` | 344 | 49.882 | `3b86fcf94a4fac63…` |
| **`estados-de-trabajo.json`** *(nuevo, ver M)* | **91** | 60.608 | `3776919c17122b36…` |

Contenido comprobado dentro del respaldo, no sólo el hash: 976 filas, 755 con
`body_html`, 271 con adjuntos, 186 con estado propio, rango
2026-08-03 → 2026-09-07.

**Ningún secreto en el respaldo, y ninguno en Git.**

---

## B · Superficie exacta, antes

Capturada del catálogo antes de la primera modificación.

| objeto | estado inicial |
|---|---|
| `erp_emails` | RLS activa · 976 filas · 65 MB |
| `erp_email_rules` | RLS activa · **0 filas** |
| bucket `email-attachments` | **`public = true`** · 479 objetos · 89 MB |
| `insert_email(…13 args)` | **DEFINER**, `search_path=public`, **EXECUTE a PUBLIC** |
| `reset_email_attachments(text)` | **DEFINER**, **EXECUTE a PUBLIC** |
| `update_email_attachments(…)` × 2 sobrecargas | **DEFINER**, **EXECUTE a PUBLIC** |
| `erp_valid_token()` | **DEFINER**, **`search_path` NO fijado**, EXECUTE a PUBLIC |
| `erp_emails_set_updated_at()` | trigger, EXECUTE a PUBLIC |
| Realtime | la publicación `supabase_realtime` lleva **sólo `erp_store`** — `erp_emails` nunca estuvo publicada |
| FKs hacia `erp_emails` | **ninguna** |
| Triggers propios | `trg_erp_emails_updated_at` |

---

## C · Grants, antes

```
erp_emails       postgres=arwdDxtm | anon=arwdDxtm | authenticated=arwdDxtm | service_role=arwdDxtm
erp_email_rules  postgres=arwdDxtm | anon=arwdDxtm | authenticated=arwdDxtm | service_role=arwdDxtm
```

`anon` tenía las ocho letras: `a`=INSERT, `r`=SELECT, `w`=UPDATE, `d`=DELETE,
**`D`=TRUNCATE**, `x`=REFERENCES, `t`=TRIGGER, `m`=MAINTAIN.

---

## D · RLS, antes

```sql
-- erp_emails
erp_app_token   ALL     roles=PUBLIC  using=erp_valid_token()  check=erp_valid_token()
make_insert     INSERT  roles=PUBLIC  using=—                  check=true       ← el agujero

-- erp_email_rules
erp_token_email_rules  ALL  roles=anon,authenticated  using/check=erp_valid_token()

-- storage.objects
email_attachments_all     ALL     roles=PUBLIC  bucket_id='email-attachments'   ← sin mirar el rol
email_attachments_select  SELECT  roles=PUBLIC  bucket_id='email-attachments'
email_attachments_delete  DELETE  roles=PUBLIC  bucket_id='email-attachments'
```

---

## E · Make y el token — confirmado sin mostrar valores

El hallazgo central de la entrega 0 se confirma: **Make manda un `x-erp-token`
distinto del que espera `erp_valid_token()`**. Son dos valores diferentes, los
dos con prefijo `bterp_`. No se transcribe ninguno.

Lo nuevo de esta entrega es **por qué eso no rompía nada**, y qué camino usa
Make realmente. Se leyeron los tres escenarios activos:

| escenario | qué hace contra Supabase | camino |
|---|---|---|
| `ERP \| Gmail info@ → Supabase` (5856917) | inserta el mail y la metadata de adjuntos | **`rpc/insert_email`**, `rpc/reset_email_attachments`, `rpc/update_email_attachments` + subida a Storage |
| `AT-BACKFILL \| Mails 14-24 ago` (6036490) | lo mismo, on-demand | **`rpc/insert_email`** |
| `ERP \| Reply Webhook → Gmail + Supabase` (5856923) | `PATCH` directo sobre la tabla | **tabla**, y **ya estaba roto** |

**Make nunca hace un `INSERT` directo sobre `erp_emails`.** Usa exclusivamente
las RPC y Storage. Eso tiene dos consecuencias que importan:

1. **La policy `make_insert` no la necesitaba nadie.** Se llama así, pero Make
   no la usa. Era una puerta abierta sin ningún consumidor.
2. **Lo que la ingesta sí necesita es el `EXECUTE` público sobre las RPC.** Y
   como las RPC son `SECURITY DEFINER`, ese `EXECUTE` público *es* la vía de
   escritura anónima. No se pueden separar.

Y el `PATCH` del escenario de respuesta **ya fallaba antes de esta entrega**,
por partida doble: escribe `status='respondido'`, que no está en el CHECK, y
escribe `replied_at` y `replied_by`, **que no existen como columnas**. Lleva
`handleErrors: false`, así que fallaba en silencio después de que el webhook ya
había respondido 200. Cerrarlo no rompió nada que funcionara.

---

## F · Las RPC

Las tres son `SECURITY DEFINER` con `EXECUTE` a `PUBLIC`. Probado: llamadas
**sin ningún token**, con sólo la clave publicable, devolvían **204**.

`erp_valid_token()` **no se tocó**. La usan las policies de otras once tablas
del legacy; revocarla habría roto el ERP entero. Su `search_path` sin fijar
queda anotado en el issue global, fuera del alcance de esta entrega.

---

## G · Qué se cambió

Una sola migración: **`fase9_emails_entrega05_cerrar_superficie_publica`**.

```sql
-- 1 · erp_emails y erp_email_rules
drop policy make_insert            on public.erp_emails;
drop policy erp_app_token          on public.erp_emails;
drop policy erp_token_email_rules  on public.erp_email_rules;
revoke all privileges on public.erp_emails      from anon, authenticated, public;
revoke all privileges on public.erp_email_rules from anon, authenticated, public;

-- 2 · las RPC de ingesta
revoke execute on function public.insert_email(…)              from public, anon, authenticated;
revoke execute on function public.reset_email_attachments(…)   from public, anon, authenticated;
revoke execute on function public.update_email_attachments(…)  from public, anon, authenticated;  -- ×2 sobrecargas

-- 3 · Storage
update storage.buckets set public = false where id = 'email-attachments';
drop policy email_attachments_all    on storage.objects;
drop policy email_attachments_select on storage.objects;
drop policy email_attachments_delete on storage.objects;
```

`erp_app_token` se dropea en vez de dejarse: su clave está publicada en el
bundle, así que no era una segunda capa sino una capa de mentira. Sin ninguna
policy y con RLS activa, la tabla queda denegada por defecto — y si mañana
alguien volviera a dar privilegios por error, **seguiría denegada**.

**No se borró ninguna fila ni ningún archivo.**

---

## H · `erp_emails`, después

```
postgres=arwdDxtm/postgres | service_role=arwdDxtm/postgres
```

`anon` y `authenticated` desaparecieron del ACL por completo, **TRUNCATE
incluido**. El privilegio de TRUNCATE se verificó en el catálogo, como se pidió:
**no se ejecutó ninguna operación destructiva para comprobarlo**.

Policies sobre `erp_emails`: **0**.

---

## I · Adjuntos — integridad

Medido antes y después de cerrar:

| | antes | después |
|---|---|---|
| Objetos en el bucket | **479** | **479** |
| Bytes | **89 MB** | **89 MB** |
| `public` | `true` | **`false`** |
| Policies sobre el bucket | 3 | **0** |

**Cerrar el bucket no borró nada.** No se bajaron los 479 archivos: se sondearon
unos pocos paths reales tomados del propio respaldo.

---

## J · Storage — ataques después del fix

Con un **path real y exacto**, sacado de la URL que Make había guardado:

| intento | resultado |
|---|---|
| Bajar un adjunto real por **URL pública** | **404 `Bucket not found`** — el bucket ya no es público |
| Bajar ese adjunto con la clave publicable | **404 `Object not found`** — la RLS lo esconde |
| Listar una carpeta real | **`200 []`** — 0 entradas |
| Subir un archivo | **403 `new row violates row-level security policy`** |
| **Borrar un adjunto real** | **`200 []`** — 0 objetos borrados, y el archivo sigue ahí |

El caso del borrado es el que había que medir con cuidado: Storage contesta
`200` con un array **vacío**. El código dice «éxito»; el efecto dice que no
borró nada. Se verificó contando: siguen siendo 479.

---

## K · Realtime

`erp_emails` **nunca estuvo** en la publicación `supabase_realtime`; la
publicación lleva sólo `erp_store`.

Comprobado igual del lado del que importa: un suscriptor anónimo se une al canal
—el canal **acepta** el join, que es la señal engañosa— y se cuenta **lo que
llega**: **0 filas**, antes y después.

---

## L · Polling y egress

**No hizo falta tocar ni una línea del legacy.** El bundle sigue llamando a
`_emailsFetchBadge()` cada 60 segundos, pero ahora la respuesta es un 401 de 190
bytes en vez de 200 filas con los cuerpos.

| | antes | después |
|---|---|---|
| Respuesta del badge | **~766 kB** | **190 bytes** |
| Por hora y por usuario | **~46 MB** | **~11 kB** |

Una reducción del **99,98 %**, como efecto colateral de la contención. Con cinco
personas ocho horas, se pasa de ~1,8 GB/día a ~0,4 MB/día.

El frontend legacy no se modificó porque **no se despliega desde este
repositorio**: el bundle auditado es una copia descargada del sitio en
producción. Queda anotado como deuda, con la aclaración de que ya no cuesta
egress.

---

## M · Los 91 estados de trabajo

Exportados aparte, **sólo metadata**: sin cuerpos, sin asuntos, sin remitentes y
sin adjuntos. Campos: `gmail_id`, `thread_id`, `status`, `assignee`, `is_read`,
`date`, `created_at`, `updated_at`.

`estados-de-trabajo.json` · 91 filas · 60.608 bytes · sha256 `3776919c17122b36…`

| status | filas | | assignee | filas |
|---|---|---|---|---|
| `spam` | 67 | | *(sin asignar)* | 68 |
| `sin_responder` *(con assignee)* | 14 | | JUAN | 16 |
| `en_proceso` | 5 | | ADMIN | 4 |
| `enviado` | 4 | | JANO | 2 |
| `resuelto` | 1 | | FACUNDO | 1 |

Se incluyen además, en el mismo archivo y en una sección aparte, las **95 filas
que sólo tienen `is_read`**: también son estado propio del ERP y no costaba nada
conservarlas.

### Un hallazgo nuevo que cambia cómo se reconcilia

Al exportar apareció algo que la entrega 0 no había visto: **`gmail_id` no es
una sola cosa.**

| forma | filas del total | filas de los 91 |
|---|---|---|
| 5 dígitos — **UID de IMAP** | 797 | **86** |
| 16 hex — id de Gmail API | 172 | 1 |
| nulo (salientes) | 4 | 4 |
| otra | 3 | 0 |

Un **UID de IMAP no es un identificador de Gmail**: es local a la carpeta y no
sirve para pedirle el mensaje a la Gmail API. O sea: **86 de los 91 estados no
se pueden re-atar a su mensaje por `gmail_id`.**

Lo que sí sirve: **los 86 tienen `thread_id`**, que es el `threadId` real de
Gmail guardado en base64. **La reconciliación futura va por hilo, no por
mensaje.** Para lo que hay que reconciliar —67 marcas de spam, que son por
remitente, y 24 de estado/asignación, que en la práctica son por conversación—
el hilo alcanza.

Queda escrito dentro del propio `INDICE.json` para que no dependa de que alguien
lea este documento.

---

## N · XSS e imágenes remotas

**No se cambió nada del render**, como se pidió: el módulo ya no es accesible,
así que el riesgo actual es cero.

Queda registrado para la arquitectura nueva:

- **4 cuerpos guardados contienen `<script>`.** Hoy inertes.
- El `sandbox` del iframe es `allow-same-origin allow-popups`, **sin
  `allow-scripts`** — esa ausencia es toda la defensa.
- **590 de 755** cuerpos cargan imágenes remotas; **275** tienen algo de 1 píxel.

> **Estos cuerpos NO se renderizan con `dangerouslySetInnerHTML` en React.**
> Sanitización con DOMPurify **más** sandbox, y las imágenes remotas bloqueadas
> por defecto detrás de una acción del usuario.

Durante toda la entrega **no se abrió ningún cuerpo ni se pidió ninguna imagen
remota**: ni un pixel de tracking se disparó por culpa de esta auditoría.

---

## O · IA

Auditado sin llamar a nada.

| | |
|---|---|
| Endpoint | el Worker `buscatools-ai` de Cloudflare |
| Token | **en el Worker**, nunca en el frontend |
| `WORKER_SECRET` | **ya rotado** en la entrega 0.5 de WhatsApp |
| Qué mandaba | hasta 10 cuerpos completos, 6.000 caracteres cada uno, **automáticamente** |
| Estado ahora | **no puede leer `erp_emails`**: el camino murió con la contención |

Decisión registrada:

```
EMAIL AI = EXPLICIT USER ACTION ONLY
```

Ningún cuerpo completo se manda a un tercero de forma automática. **No se llamó
a OpenAI en esta entrega.**

---

## P · Tests después del fix

`scripts/fase9-emails-seguridad-tests.mjs`, corrida en las dos fases con la
clave publicable y el `x-erp-token` del bundle, que es todo lo que tiene
cualquier visitante.

| ataque | antes | después |
|---|---|---|
| Leer emails (sin token) | 0 filas | **401** |
| Leer emails (con token) | **3 filas** | **401** |
| Leer `erp_email_rules` | 0 filas (vacía) | **401** |
| **INSERT sin token** | **201 — fila creada** | **401** |
| **INSERT con token** | **201 — fila creada** | **401** |
| **UPDATE** | **fila modificada** | ni se puede listar un id |
| **DELETE** | **204** | — |
| `rpc insert_email` sin token | **204** | **401** |
| `rpc reset_email_attachments` | **204** | **401** |
| `rpc update_email_attachments` | **204** | **401** |
| Subir al bucket | **200** | **403 RLS** |
| Bajar por URL pública | **200** | **404 bucket no público** |
| Borrar del bucket | **1 objeto borrado** | **0 objetos** |
| Listar el bucket | **3 entradas** | **0** |
| Realtime anónimo | 0 filas | **0 filas** |
| TRUNCATE | privilegio presente en el catálogo | **privilegio ausente** *(no se ejecutó)* |

**Resultado: 0 accesos abiertos.**

### Dos falsos negativos de mi propia suite, corregidos

Importa dejarlos escritos porque casi firman un PASS que no era:

**1 · El `INSERT` anónimo parecía cerrado y no lo estaba.** La primera versión
mandaba `Prefer: return=representation`; PostgREST necesita entonces `SELECT`
sobre la fila recién creada, la policy del token se lo negaba y abortaba la
transacción entera. Devolvía **401 y parecía denegado**. Con
`Prefer: return=minimal` devuelve **201**, y el efecto se confirmó repitiendo el
mismo `gmail_id` y viendo el **409** de la constraint UNIQUE.

**2 · El borrado en Storage parecía cerrado y no lo estaba.** Mandaba `DELETE`
al path con `Content-Type: application/json` y sin cuerpo, y Storage contestaba
**400 por request mal formada**. La forma correcta —`DELETE` sobre el bucket con
`{prefixes:[…]}`— **borró el objeto**.

La suite quedó corregida en los dos puntos, con el motivo escrito al lado.

---

## Q · Histórico intacto

| | antes | después |
|---|---|---|
| Filas en `erp_emails` | **976** | **976** |
| Tamaño de la tabla | 65 MB | **65 MB** |
| Estados de trabajo | **91** | **91** |
| Objetos en el bucket | **479** | **479** |
| Bytes de adjuntos | 89 MB | **89 MB** |
| Fixtures sueltos | — | **0** |

Los fixtures de la fase «antes» —5 filas y 1 objeto, todos con prefijo
`ZZ-E05`— se borraron y se verificó que no quedara ninguno.

**No se tocó Gmail.** Ni marcar leído, ni enviar, ni responder, ni archivar, ni
papelera, ni spam, ni borradores, ni etiquetas. El `markSeen: false` del
escenario sigue como estaba.

### Sin daño colateral

Comprobado después del cierre: **`erp_store` sigue respondiendo 200 a `anon`**.
El resto del ERP legacy —clientes, pedidos, cotizaciones, mantenimiento— no se
vio afectado. La contención se quedó donde tenía que quedarse.

---

## R · Lo que NO se tocó

- **Gmail**, en ninguna forma.
- Las **976 filas** y los **479 adjuntos**: ni uno borrado, ni uno movido.
- **`body_html` / `body_text`**: siguen donde estaban. El legacy queda como
  respaldo temporal hasta terminar la migración.
- **`erp_valid_token()`**: la comparten otras once tablas. Su `search_path` sin
  fijar queda en el issue global.
- **`erp_store`** y el resto del ERP legacy.
- **El frontend legacy**: no se despliega desde este repositorio.
- **Los escenarios de Make**: no se editó ni se apagó ninguno. Ver abajo.
- **Las credenciales**: no se rotó ninguna en esta entrega.
- **WhatsApp**: nada.

---

## Issue · Ingesta legacy

```
LEGACY EMAIL INGESTION / MAKE = DEPRECATED
```

Los escenarios **siguen encendidos y ahora fallan con 401**. No se apagaron a
propósito: apagarlos es un cambio en un sistema de terceros y es una decisión
del usuario, no mía. Fallan sin efecto y sin consumir nada más que sus propias
operaciones de Make.

Por qué no vuelve como arquitectura nueva:

| defecto | medido |
|---|---|
| El token que manda no coincide con el que valida la base | confirmado |
| Funcionaba sólo gracias a puertas públicas | confirmado: usa `rpc/insert_email` con `EXECUTE` a PUBLIC |
| Corre **3 veces por día**, un minuto cada vez | 09:00, 13:00, 17:00 |
| **Máximo 25 mails por corrida** | `maxResults: 25` |
| **Sin cursor**: toma los 25 más recientes | `criteria: ALL` sobre INBOX |
| Techo de **75 mails/día** contra un promedio de 28 | margen menor a 3× |
| **Pérdida silenciosa** al desbordar | no hay reintento ni registro |
| Sube **sólo los dos primeros adjuntos** | módulos 3 y 6; el tercero se pierde |
| El `PATCH` de respuesta está roto desde siempre | columnas inexistentes + CHECK |

La entrega 2 lo reemplaza por Gmail API server-side con `historyId` como cursor.

---

## Decisión pendiente · la ingesta durante la transición

Como pide el punto 5, **se propone y no se ejecuta**.

Hoy la ingesta está detenida. Si se quisiera mantenerla hasta que exista el
módulo nuevo, el único camino aceptable sería:

1. `grant execute` de las tres RPC **sólo a `service_role`**.
2. Cambiar en los tres escenarios de Make la clave publicable por la **clave de
   servicio**, y sacarles el `x-erp-token`.

Eso **no** pone un secreto nuevo en el frontend: Make es server-side y la clave
vive en su propia bóveda. Pero implica editar tres escenarios de un sistema de
terceros y poner ahí una credencial con todos los permisos del proyecto legacy.

**Mi recomendación es no hacerlo.** Gmail conserva todo, el respaldo está
verificado, los 91 estados están exportados, y el módulo nuevo va a releer desde
Gmail de todas formas. Mantener la ingesta sólo sirve para que la bandeja legacy
—que ya no se puede leer— siga llenándose.

---

## Criterio de cierre

| criterio | estado |
|---|---|
| `anon` no lee emails | **cumplido** — 401 |
| `anon` no escribe emails | **cumplido** — 401 |
| `anon` no borra emails | **cumplido** — privilegio retirado |
| `PUBLIC` no puede usar `insert_email` | **cumplido** — 401 |
| El bucket no es público | **cumplido** — `public = false` |
| Los adjuntos no son accesibles por path | **cumplido** — 404 con path real y exacto |
| Realtime anónimo no entrega filas | **cumplido** — 0, medido por entrega |
| Histórico intacto | **cumplido** — 976 · 479 · 89 MB |
| Backup intacto | **cumplido** — sha256 revalidados |
| 91 business states preservados | **cumplido** — en la base **y** exportados |
| No se tocó Gmail | **cumplido** |

Los once.

---

# PHASE 9 — EMAILS · ENTREGA 0.5 = CLOSED
