# Fase 9 · Emails — Entrega 3: schema y backend

> ## ENTREGA 3 = **NO CERRADA**
>
> El schema está ejecutado y probado, y el backend está escrito y probado. Pero
> **el servicio no está desplegado**, y por lo tanto no hay subscription de
> Pub/Sub, no se probó DWD contra Gmail y no se inició `users.watch`.
>
> El motivo es concreto y está en **R**: en esta máquina **no está instalado
> `gcloud`**, y `gcloud auth login` necesita a una persona. No es algo que pueda
> resolver desde acá.
>
> Lo que sí se hizo está abajo, y lo que falta está en **T**, con los comandos
> exactos.

**Gmail no se tocó ni una vez.** No se leyó, no se envió, no se marcó nada, no
se creó ningún watch.

---

## A · Auditoría previa

Antes de crear nada, medido contra la base real:

| qué | estado |
|---|---|
| Tablas `email_%` | **0** |
| Funciones `app.*email*` | **0** |
| `app.touch_updated_at` | existe |
| Tablas de WhatsApp | 6, intactas |
| `companies` · `customers` · `customer_contacts` · `profiles` | 2 · 1010 · 87 · 7 |

**Nada cambió respecto de la propuesta de la entrega 1.** Se ejecutó tal cual,
más los tres campos que agregó la 2B (`auth_mode`, `sync_error`, el lease).

---

## B · Schema ejecutado

Cuatro migraciones: `tablas`, `integridad`, `rls`, `rpc`.

| tabla | cols | índices | checks | policies | `authenticated` |
|---|---|---|---|---|---|
| `email_accounts` | 18 | 5 | 2 | 1 | `r` |
| `email_threads` | 15 | 7 | 3 | 1 | `r` |
| `email_thread_state` | 12 | 5 | 4 | 1 | `r` |
| `email_thread_reads` | 4 | 2 | 0 | 3 | `a r w` |
| `email_events` | 8 | 3 | 1 | 1 | `r` |
| `email_sync_log` | 10 | 3 | 1 | **0** | **—** |

`anon` no aparece en ningún ACL. `email_sync_log` con 0 policies es el diseño:
RLS activa sin policies es denegación total para todo rol de aplicación.

**No se creó ninguna tabla de más.** La suite verifica que `email_messages`,
`email_contacts`, `email_attachments` y `email_drafts` **no** existan.

---

## C · La separación que sostiene todo

`email_threads` es descartable; `email_thread_state` no. Está probado con el
peor caso real:

```
estado inicial:  thread-a → en_proceso, asignado al admin
DELETE de TODO el índice de la cuenta
  → el índice queda en 0
  → el estado sigue ahí, con workflow_status y assigned_to intactos
se reconstruye el índice
  → el estado sigue ahí
```

Es la lección de las 91 filas del legacy: de 65 MB, lo único irrecuperable eran
91 estados. Acá el índice se puede tirar entero y rehacer desde Gmail; el estado
no se puede reconstruir desde ningún lado.

Por eso las dos tablas se atan por `(account_id, gmail_thread_id)` y **no hay FK
entre ellas**: el estado puede existir antes que el índice, que es justo lo que
va a hacer falta al importar los 20 estados legacy.

---

## D · RLS

**ADMIN y EMPLOYEE. Todos los demás, cero.** Medido por id exacto, con siete
identidades temporales creadas y borradas por la suite.

| | ADMIN | EMPLOYEE | SALESPERSON | TECHNICIAN | CUSTOMER | DISTRIBUTOR | ANON |
|---|---|---|---|---|---|---|---|
| hilos de su empresa | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| hilos de otra empresa | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `email_sync_log` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

**Ninguna policy mira `assigned_to`.** Sin salesperson esa rama sería código
muerto. Se agrega el día que el área comercial use Emails.

El anónimo se mide por el **error**, no por una lista vacía: un array vacío
puede venir de una consulta que falló, y sería un PASS por la razón equivocada.

---

## E · Escrituras

Nada directo desde el cliente salvo la propia marca de leído. Probado:

| intento | resultado |
|---|---|
| el admin inserta un hilo | **42501** |
| el admin cambia el estado por `UPDATE` | **42501** |
| el admin inserta una cuenta | **42501** |
| el admin borra un hilo | **42501** |
| el admin escribe en el log de sync | **42501** |
| el vendedor asigna por RPC | rechazado |
| el admin de otra empresa asigna acá | rechazado |
| el admin llama al lease del backend | rechazado |
| el admin avanza el cursor a mano | rechazado |

Y el camino legítimo funciona: el employee asigna, queda asignado, el estado por
defecto es `pendiente` y **queda auditado en `email_events`**. Cambiar el estado
después **no pisa la asignación**.

---

## F · Multiempresa

Siete intentos cruzados, todos rechazados con `check_violation`: hilo con
`company_id` ajeno, estado con `company_id` ajeno, cliente de otra empresa,
contacto que no es de su cliente, asignar a un usuario de otra empresa, asignar
a un salesperson —que no puede usar Emails—, y evento con `company_id` ajeno.

Es la lección de O1: **una fila hija no se valida por el `company_id` que manda
el cliente**, sino contra el de su padre.

---

## G · Lease

```sql
update email_accounts
   set sync_lock_until = now() + interval '5 minutes', sync_lock_owner = …
 where id = … and (sync_lock_until is null or sync_lock_until < now())
returning *;
```

| prueba | resultado |
|---|---|
| el primero toma el lease | ✅ |
| el segundo no | ✅ |
| nadie suelta un lease ajeno | ✅ |
| tras soltarlo, el segundo sí entra | ✅ |
| un lease **vencido** lo toma otro: se auto-cura | ✅ |
| **ocho intentos simultáneos → UN solo ganador** | ✅ |

> Vence solo, y acá eso es seguro —a diferencia de la cola de WhatsApp, donde un
> mensaje trabado **no** se reintenta porque reenviar duplicaría el mensaje al
> cliente—. Un sync es idempotente: el `upsert` da el mismo resultado y el
> cursor sólo avanza.

---

## H · El cursor nunca retrocede

| operación | resultado |
|---|---|
| avanzar a 5000 | 5000 |
| avanzar a 4000 | **5000** |
| avanzar a 5000 otra vez | 5000 |
| avanzar a **900** | **5000** — compara como número, no como texto |
| avanzar a 60000 | 60000 |

El caso del 900 es el que importa: como texto `'900' > '5000'`, y ese bug haría
retroceder el cursor y reprocesar —o saltear— cambios.

---

## I · No leído, por usuario

```
admin: sin leer      employee: sin leer
admin marca leído →  admin: leído       employee: SIGUE sin leer
```

El employee no puede marcar en nombre del admin (42501), el vendedor no puede
marcar un hilo que no ve (42501), y **el intento de pisar la marca del admin se
verificó midiendo el valor**, no el código de estado: no cambió.

Nadie tiene `DELETE`, ni sobre su propia marca.

---

## J · Backend

`backend/emails/`, Node 22, **sin dependencias de runtime** — usa sólo la
librería estándar.

| módulo | qué hace |
|---|---|
| `config.ts` | allowlist de buzones, variables |
| `google/auth.ts` | **DWD sin private key**: metadata → `signJwt` → jwt-bearer |
| `google/gmail.ts` | cliente + interfaz, `format=metadata` durante el sync |
| `sync.ts` | el algoritmo |
| `oidc.ts` | validación del push |
| `almacen.ts` | Supabase detrás de una interfaz |
| `server.ts` | las rutas |
| `pruebas/dobles.ts` | Gmail falso y almacén en memoria |

**Ninguna private key en ningún lado**: ni en el repo, ni en la imagen, ni en
Secret Manager. El `Dockerfile` no copia ninguna credencial.

Detalle del sync: durante la sincronización **no se piden cuerpos**. Se usa
`format=metadata` con seis headers. Es la diferencia entre traer 766 kB por
request —lo que hacía el legacy— y traer unos pocos KB.

---

## K · Tests del backend

**42 tests, 0 fallos, y ninguno toca `info@`.**

| bloque | qué cubre |
|---|---|
| claims de DWD | `iss`/`sub`/`scope`/`aud`/`iat`/`exp`, el tope de una hora, y que **nunca** se pida `https://mail.google.com/` |
| caché de tokens | no pide de más, renueva antes del filo, cachea por buzón, `invalidar` fuerza renovación |
| allowlist | acepta el configurado, ignora mayúsculas, **rechaza otro buzón del mismo dominio** |
| cuerpo del push | decodifica, normaliza a minúsculas, devuelve null ante basura |
| OIDC | rechaza tres partes mal, `alg` distinto de RS256, `kid` desconocido, firma inválida, `iss`, `aud`, `email`, **`email_verified`** y vencimiento |
| sync | trae hilos y avanza cursor, idempotencia, no retroceso, lease tomado, lease soltado, hilo borrado |
| historial vencido | 404 → resync, primer sync sin cursor, y que el `historyId` se tome **antes** de listar |
| **resync ↛ borrado de estado** | conserva `assigned_to` y `workflow_status`, incluso de un hilo que ya no existe en Gmail |

---

## L · Bugs encontrados

**Dos, los dos míos, los dos en los tests.**

**1 · El helper de test usaba `??` y nunca probaba el primer sync.**
`opciones.historyIdInicial ?? '1000'` convierte `null` en `'1000'`, así que el
caso «cuenta sin cursor» —el primer sync de todos— **nunca se ejercitaba**. Los
dos tests que lo cubrían fallaron y así apareció. Se corrigió preguntando si la
clave vino, no si el valor es nulo.

**2 · Una expectativa desactualizada en la suite de schema.** El test de
constraints inserta un segundo hilo en la cuenta ajena para comprobar que la
unicidad es por cuenta; la matriz de RLS de más abajo esperaba que el admin de
esa empresa viera uno solo. **La RLS estaba bien**: veía sus dos. Se corrigió la
expectativa, no el producto.

Y tres errores de modo estricto en el backend, corregidos en el código y no
aflojando la configuración: `exactOptionalPropertyTypes` en `sizeEstimate`, un
`Uint8Array<ArrayBufferLike>` que `crypto.subtle` no acepta, y un
`noUncheckedIndexedAccess` en el parseo de direcciones.

---

## M · Advisors

Cuatro hallazgos nuevos, los cuatro intencionales:

| nivel | hallazgo | por qué queda |
|---|---|---|
| INFO | `email_sync_log` con RLS y sin policies | **es el diseño**: denegación total |
| WARN | `asignar_hilo_email` DEFINER ejecutable por `authenticated` | es la puerta; valida al actor adentro |
| WARN | `cambiar_estado_email` ídem | ídem |
| WARN | `vincular_cliente_email` ídem | ídem |

**Ningún ERROR nuevo.** Los preexistentes no los tocó esta entrega.

---

## N · Regresión

Todo en serie. **Ningún módulo cerrado se rompió.**

| suite | resultado |
|---|---|
| `fase9-emails-entrega3-tests` | **95 PASS, 0 FAIL** |
| backend (`npm run backend:check`) | **42 PASS**, typecheck limpio |
| `fase9-emails-seguridad-tests` (legacy) | **0 accesos abiertos** |
| `fix-rls-tautologicas` · `fix-rls-delivery-serials` · `security-o4` | 0 fallos |
| `fase8-whatsapp-entrega1` | 0 fallos |
| `stage1-ventas` · `stage3-pedidos` · `stage3-entregas` · `stage3-cierre` | 0 fallos |
| `fase5-clientes` · `fase5-cierre` | 0 fallos |
| `fase6-compras-schema` · `fase6-cierre` | 0 fallos |
| `fase7-mantenimiento-schema` · `fase7-mantenimiento-entrega5` | 0 fallos |
| `lint` · `typecheck` · `test` (550) · `test:isolated` (550) · `build` | limpio |

### Un fallo intermitente, investigado y descartado

`stage3-cotizaciones-tests` falló una vez en el test de numeración concurrente:
3 de 30 llamadas paralelas sin responder. **No lo di por «flake»**: lo reproduje
mostrando el error real en vez de contarlo.

```
TypeError: fetch failed
Caused by: ConnectTimeoutError: Connect Timeout Error
  (attempted addresses: 104.18.38.10:443, 172.64.149.246:443, timeout: 10000ms)
```

Es un **timeout de conexión TCP del cliente** contra los IPs de Cloudflare que
sirven a Supabase. El request nunca llegó a la base, así que
`next_document_number` ni siquiera se ejecutó. No tiene relación con el schema
de Emails. En tres vueltas seguidas: 30/30, 30/30, 28/30. Es la red local
abriendo 30 conexiones HTTPS a la vez.

**Queda anotado como fragilidad del entorno de test, no como regresión.**

---

## O · Lo que NO se hizo, y era el plan

| punto del pedido | estado |
|---|---|
| Ejecutar el schema | **hecho** |
| Implementar DWD sin key | **hecho** (código y tests) |
| Implementar sync de metadata | **hecho** |
| Implementar renovación del watch | **hecho** (código) |
| Crear Cloud Run | **NO** — falta `gcloud` |
| Configurar IAM | **NO** — falta `gcloud` |
| Crear la subscription de Pub/Sub | **NO** — falta `gcloud` |
| Probar DWD contra Gmail | **NO** — depende del despliegue |
| Iniciar `users.watch` | **NO** — va último por diseño |
| Reconciliar los 91 estados | **NO** — requiere el primer sync real |

---

## P · Lo que no se tocó

- **Gmail**: no se leyó, no se envió, no se marcó, no se archivó, no se
  etiquetó, no se creó ningún watch.
- **Los 91 estados legacy**: siguen sin migrar. AUTO 20 · REVIEW 67 ·
  UNRESOLVED 4, y se vuelven a medir contra Gmail real antes de aplicar nada.
- **Cuerpos legacy**: **0 `body_html`, 0 `body_text`, 0 adjuntos** copiados. Las
  seis tablas terminaron la suite con 0 filas.
- **`erp_emails`**: congelada, sin reabrir, sin borrar.
- **Make**: los tres escenarios siguen apagados.
- **WhatsApp**: nada. Sus 6 tablas siguen vacías.
- **El proyecto de Google**: ni scope de DWD, ni IAM del topic, ni Super Admin,
  ni Owner, ni billing.

---

## Q · Criterios de cierre

| criterio | estado |
|---|---|
| schema ejecutado | ✅ |
| 6 tablas correctas | ✅ |
| index/state separados | ✅ **probado con borrado total del índice** |
| no JSON key | ✅ |
| mailbox allowlist activa | ✅ (código + tests) |
| lease concurrente probado | ✅ 8 en paralelo, 1 ganador |
| history sync implementado | ✅ |
| 404 resync implementado | ✅ |
| 0 body persistido | ✅ |
| 0 Gmail mutado | ✅ |
| security PASS | ✅ |
| invariantes PASS | ✅ |
| CI PASS | ✅ |
| **Cloud Run deployado** | ❌ |
| **DWD signJwt probado contra Gmail** | ❌ |
| **Pub/Sub subscription** | ❌ |
| **watch iniciado** | ❌ |
| **watch renewal configurado** | ❌ |

**Cinco de dieciocho sin cumplir, todos por la misma causa.**

---

## R · El bloqueo, exactamente

```
gcloud   → NO instalado
docker   → NO instalado
```

Verificado en el `PATH` y en las tres ubicaciones estándar de Windows. Hay
`winget`, así que el SDK se podría instalar — pero **`gcloud auth login` abre un
navegador y necesita que una persona se autentique**. No puedo hacerlo por vos,
y tampoco voy a instalar ~150 MB en tu máquina sin preguntarte.

Docker **no** hace falta: `gcloud run deploy --source` compila con Cloud Build.

Hay dos caminos y la decisión es tuya:

| opción | qué implica |
|---|---|
| **A · instalar el SDK acá** | `winget install Google.CloudSDK`, después `gcloud auth login` —lo hacés vos— y yo sigo con los comandos de T |
| **B · lo ejecutás vos** | los comandos están en [`PHASE_9_EMAILS_CLOUD_RUN.md`](PHASE_9_EMAILS_CLOUD_RUN.md), en orden y listos para copiar |

---

## S · Costo

No se creó ningún recurso, así que **el gasto de esta entrega es cero**. El
presupuesto de USD 5/mes con alertas 50/90/100 y sin tope duro sigue como
estaba.

Cuando se despliegue: Cloud Run con `min-instances 0` y `max-instances 3`, a
~28 mails/día, queda muy dentro del free tier.

---

## T · Lo que sigue

1. **Decidir A o B** de la sección R.
2. Desplegar Cloud Run, IAM y la subscription — comandos en
   [`PHASE_9_EMAILS_CLOUD_RUN.md`](PHASE_9_EMAILS_CLOUD_RUN.md).
3. **Probar DWD con `users.getProfile` y nada más**: sin `threads.list`, sin
   `messages.list`, sin cuerpos, sin adjuntos.
4. Crear la fila de `email_accounts` para `info@buscatools.com.ar`.
5. Cloud Scheduler para la renovación diaria.
6. **`users.watch`, al final**, cuando todo lo anterior esté verde.
7. Recién entonces: dry run de la reconciliación de los 91 estados, y reportar
   AUTO / REVIEW / UNRESOLVED medidos contra Gmail real antes de aplicar nada.

---

# ENTREGA 3 = NO CERRADA

El schema está ejecutado y probado; el backend está escrito y probado. Falta
desplegarlo, y eso necesita `gcloud` y una autenticación que tenés que hacer
vos.
