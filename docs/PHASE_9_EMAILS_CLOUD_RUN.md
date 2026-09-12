# Backend de Emails · Cloud Run

Documentación operativa del servicio. El diseño y su justificación están en
[`PHASE_9_EMAILS_ENTREGA_2B_BACKEND_AUTH.md`](PHASE_9_EMAILS_ENTREGA_2B_BACKEND_AUTH.md).

> **Estado: el código existe y está probado; el servicio NO está desplegado.**
> Ver «Lo que falta» al final: hace falta `gcloud`, que no está instalado en la
> máquina de desarrollo.

---

## Qué es

Un servicio HTTP en Node 22, sin dependencias de runtime —usa sólo la librería
estándar—, que hace de puente entre Gmail y Supabase.

```
backend/emails/
  Dockerfile
  package.json · tsconfig.json · vitest.config.ts
  src/
    config.ts            allowlist de buzones y variables
    almacen.ts           Supabase, detrás de una interfaz
    sync.ts              el algoritmo de sincronización
    oidc.ts              validación del push de Pub/Sub
    server.ts            las rutas HTTP
    google/
      auth.ts            DWD sin private key
      gmail.ts           cliente de Gmail + interfaz
    pruebas/dobles.ts    Gmail falso y almacén en memoria
```

**No lleva ninguna credencial de Google.** La identidad la da la service account
adjunta al servicio, que el metadata server expone en runtime.

---

## Rutas

| método | ruta | quién la llama | autenticación |
|---|---|---|---|
| `POST` | `/gmail/push` | Pub/Sub | OIDC de la SA de push |
| `POST` | `/gmail/watch` | Cloud Scheduler | OIDC de la SA del scheduler |
| `POST` | `/gmail/sync` | recuperación manual | OIDC de la SA del scheduler |
| `GET` | `/salud` | Cloud Run | ninguna (no devuelve nada sensible) |

**Ninguna ruta es anónima salvo `/salud`.** Y la validación OIDC se hace en el
código además de en IAM: Cloud Run comprueba que quien llama puede invocar; el
código comprueba que es **la subscription que esperamos**, con nuestro audience.

`/gmail/thread` y `/gmail/attachment` llegan en la entrega 4, junto con la
bandeja. Exponerlos ahora sería superficie sin consumidor. El cliente de Gmail
ya tiene los métodos.

---

## Autenticación contra Gmail

```
service account ADJUNTA
   │ metadata server → token del runtime
   ▼
iamcredentials.signJwt
   │ payload = { iss: SA, sub: info@…, scope: gmail.modify,
   │             aud: https://oauth2.googleapis.com/token, iat, exp }
   ▼ JWT firmado con la clave que Google administra y NUNCA entrega
POST https://oauth2.googleapis.com/token
     grant_type = urn:ietf:params:oauth:grant-type:jwt-bearer
   ▼
access token  (≤ 1 h, cacheado en memoria con 2 min de margen)
```

**No existe ningún archivo de private key.** Ni en el repo, ni en la imagen, ni
en Secret Manager.

`generateAccessToken` **no sirve** para esto: da un token *de la service
account* y no acepta ningún campo de usuario. Sólo `signJwt` con `sub` hace
delegación de un usuario del dominio.

### Si algo falla acá

| síntoma | causa probable |
|---|---|
| `signJwt: HTTP 403` | falta `roles/iam.serviceAccountTokenCreator` sobre la SA de Gmail |
| `token endpoint: HTTP 400 unauthorized_client` | **la delegación no está autorizada** en la consola de Admin para ese Client ID y ese scope |
| `token endpoint: HTTP 400 invalid_scope` | el scope autorizado en la consola no coincide con `gmail.modify` |
| Gmail `401` | el token venció o se revocó. El proveedor lo invalida y renueva |
| Gmail `403` | falta scope, o la delegación se quitó |

---

## El allowlist, y por qué son dos barreras

```
ALLOWED_GMAIL_MAILBOXES = info@buscatools.com.ar
```

El `sub` del JWT es literalmente «de qué buzón quiero leer el correo». Si eso
viniera del cliente, DWD dejaría de ser una delegación acotada y sería una llave
del dominio entero.

1. **El `sub` nunca viene del request.** El cliente manda un `account_id`; el
   backend busca la fila en `email_accounts` y de ahí sale la dirección.
2. **Esa dirección se compara contra el allowlist** antes de firmar nada.

La segunda existe porque la primera no alcanza: si alguien lograra insertar una
fila con `contabilidad@buscatools.com.ar`, sin el allowlist ya tendría lectura
de ese buzón. **Por eso el allowlist vive en la configuración del servicio y no
en la base: comprometer la base no debe alcanzar para leer correo ajeno.**

Agregar un buzón exige las dos cosas —fila y allowlist—, a propósito: obliga a
un despliegue consciente.

---

## Variables

**Ninguna es una private key de Google.**

| variable | tipo | ejemplo |
|---|---|---|
| `GOOGLE_PROJECT_ID` | env | `buscatools-erp-email` |
| `GMAIL_SERVICE_ACCOUNT_EMAIL` | env | `buscatools-erp-email@buscatools-erp-email.iam.gserviceaccount.com` |
| `GMAIL_PUBSUB_TOPIC` | env | `projects/buscatools-erp-email/topics/gmail-buscatools-events` |
| `ALLOWED_GMAIL_MAILBOXES` | env | `info@buscatools.com.ar` |
| `PUBSUB_PUSH_SA_EMAIL` | env | la SA de push |
| `PUBSUB_PUSH_AUDIENCE` | env | la URL del servicio |
| `SCHEDULER_SA_EMAIL` | env | la SA del scheduler |
| `SUPABASE_URL` | env | `https://uaxcfufvapzulqvynanp.supabase.co` |
| `SUPABASE_SERVICE_KEY` | **Secret Manager** | — |

El único secreto real es la service key de Supabase. No es una key descargable
de Google y no habilita DWD: es la credencial de nuestra propia base.

El scope **no** es configurable: está fijo en `gmail.modify` en el código.
`https://mail.google.com/` no se pide nunca — lo único que agrega es el borrado
permanente.

---

## IAM — matriz exacta

| principal | rol | sobre qué | para qué |
|---|---|---|---|
| SA de runtime de Cloud Run | `roles/iam.serviceAccountTokenCreator` | **sobre la SA de Gmail** | firmar la aserción DWD |
| `gmail-api-push@system.gserviceaccount.com` | `roles/pubsub.publisher` | **sólo el topic** | que Gmail publique |
| `service-545134968830@gcp-sa-pubsub.iam.gserviceaccount.com` | `roles/iam.serviceAccountTokenCreator` | sobre la SA de push | que Pub/Sub firme el OIDC |
| SA de push | `roles/run.invoker` | **sólo este servicio** | invocar `/gmail/push` |
| SA del scheduler | `roles/run.invoker` | **sólo este servicio** | invocar `/gmail/watch` |

**Ningún rol a nivel de proyecto. Nada de Owner ni Editor.** El token creator se
otorga *sobre la service account de destino*, que es la diferencia entre mínimo
privilegio y no tenerlo.

Si la SA de runtime y la de Gmail son la misma, necesita
`serviceAccountTokenCreator` **sobre sí misma**. Son menos móviles y sigue sin
haber key descargable.

APIs a habilitar: `iamcredentials.googleapis.com`, `run.googleapis.com`,
`cloudscheduler.googleapis.com`. Gmail y Pub/Sub ya están.

---

## Configuración del servicio

| opción | valor | por qué |
|---|---|---|
| `--min-instances` | **0** | no pagar una instancia ociosa. Con 1 se irían 2,6 M de vCPU-s/mes contra 180.000 de free tier |
| `--max-instances` | **3** | a ~28 mails/día no hacen falta más, y acota cualquier gasto descontrolado |
| `--concurrency` | 20 | el lease protege el buzón; la concurrencia sólo afecta al proceso |
| `--no-allow-unauthenticated` | sí | IAM primero, validación OIDC después |
| `--memory` | 256Mi | no hay dependencias ni procesamiento pesado |
| `--timeout` | 120s | el ack de Pub/Sub es de 60 s; el margen es para el resync manual |

Se acepta el cold start de ~1 s: el sync es asíncrono y nadie espera.

---

## Sincronización

```
push validado
 ├─ ¿historyId del evento ≤ last_history_id?  → 200, nada que hacer
 ├─ TOMAR LEASE                               → si no, 200 (otro sincroniza)
 ├─ history.list(startHistoryId)
 │    ├─ 200 → hilos tocados → threads.get(metadata) → upsert
 │    └─ 404 → RESYNC COMPLETO
 ├─ avanzar el cursor  ← AL FINAL, después de aplicar
 ├─ registrar en email_sync_log
 └─ soltar el lease → 200
```

Tres propiedades, todas probadas:

1. **Idempotente.** El mismo evento repetido da el mismo resultado.
2. **No retrocede.** Un `historyId` menor o repetido no mueve el cursor.
3. **Un resync no borra `email_thread_state`.**

El cursor se mueve **al final**. Si el proceso muere en el medio, la próxima
corrida relee desde el cursor viejo: se repite trabajo, que es idempotente, en
vez de saltear cambios, que sería pérdida.

**Por qué perder una notificación no pierde correo:** el push no trae los
cambios, trae el cursor. `history.list` devuelve todo lo ocurrido desde
`last_history_id`. Es lo contrario de Make, que tomaba «los 25 más recientes».

### El lease

```sql
update email_accounts
   set sync_lock_until = now() + interval '5 minutes', sync_lock_owner = …
 where id = … and (sync_lock_until is null or sync_lock_until < now())
returning *;
```

Una sentencia. Si devuelve fila, es tuyo. Vence solo a los 5 minutos.

> **Por qué acá el vencimiento es seguro y en la cola de WhatsApp no.** Allá un
> mensaje trabado **no** se reintenta: reenviar un mensaje que quizá salió se lo
> manda dos veces al cliente. Acá reintentar un sync es idempotente. Son dos
> operaciones distintas y merecen dos políticas distintas.

### Resync completo

Se dispara con un 404 de historial, o en el primer sync de una cuenta.

- `threads.list` paginado → `upsert` en `email_threads`
- **`email_thread_state` y `email_thread_reads` no se tocan**
- **`upsert`, nunca `delete`.** Un hilo que ya no aparezca queda con `synced_at`
  viejo. Borrar filas durante una recuperación de error es cómo se pierde lo que
  se quería salvar.
- El `historyId` se toma **antes** de listar: al revés, lo que entrara durante el
  listado quedaría por debajo del cursor y se perdería.

---

## Errores y reintentos

| error | clase | qué hace el servicio |
|---|---|---|
| Gmail `401` | permanente | registra, **ackea**, no reintenta en loop |
| Gmail `403` | permanente | ídem: falta scope o delegación |
| Gmail `404` en `history.list` | esperado | resync completo |
| Gmail `404` en un hilo | esperado | lo saltea |
| Gmail `429` / `5xx` | reintentable | **no ackea**: 500, y Pub/Sub reintenta |
| Cuerpo del push inválido | permanente | ackea: reintentarlo da lo mismo |
| Cuenta desconocida o fuera del allowlist | permanente | ackea y registra |
| Supabase caído | reintentable | **no ackea** |

**Un error reintentable no se ackea.** Ackear lo que no se pudo procesar es
perder el evento en silencio — el defecto que toda esta fase corrige.

---

## Logs

Estructurados, una línea JSON con `severity`.

**Nunca:** cuerpos, asuntos, remitentes, adjuntos, access tokens, aserciones
JWT, headers de autorización, la service key.

**Sí:** `account_id`, `gmail_thread_id`, `history_id`, tipo de evento, duración,
código de error. Un `gmail_thread_id` es opaco: no dice quién escribió ni sobre
qué.

---

## Pruebas

```bash
npm run backend:check     # typecheck + tests, desde la raíz del repo
```

**42 tests, y ninguno toca `info@`.** El algoritmo entero corre contra un Gmail
falso y un almacén en memoria: 404 de historial, eventos fuera de orden, evento
repetido, lease tomado, lease vencido, resync que conserva el estado.

Los fixtures son inventados. Ninguno sale de correo real.

---

## Lo que falta para que esto ande

**El código está escrito y probado; el servicio no existe todavía.** Falta
`gcloud`, que no está instalado en esta máquina, y `gcloud auth login` necesita
a una persona.

En orden, y **`users.watch` va último**:

```bash
# 1 · APIs
gcloud services enable iamcredentials.googleapis.com run.googleapis.com \
  cloudscheduler.googleapis.com --project buscatools-erp-email

# 2 · Desplegar (Cloud Build compila el Dockerfile; no hace falta Docker local)
gcloud run deploy buscatools-email-backend \
  --source backend/emails \
  --project buscatools-erp-email \
  --region us-east1 \
  --service-account buscatools-erp-email@buscatools-erp-email.iam.gserviceaccount.com \
  --no-allow-unauthenticated \
  --min-instances 0 --max-instances 3 --concurrency 20 --memory 256Mi --timeout 120s \
  --set-env-vars GOOGLE_PROJECT_ID=buscatools-erp-email,GMAIL_SERVICE_ACCOUNT_EMAIL=buscatools-erp-email@buscatools-erp-email.iam.gserviceaccount.com,GMAIL_PUBSUB_TOPIC=projects/buscatools-erp-email/topics/gmail-buscatools-events,ALLOWED_GMAIL_MAILBOXES=info@buscatools.com.ar,SUPABASE_URL=https://uaxcfufvapzulqvynanp.supabase.co \
  --set-secrets SUPABASE_SERVICE_KEY=supabase-service-key:latest

# 3 · La SA puede firmar como sí misma
gcloud iam service-accounts add-iam-policy-binding \
  buscatools-erp-email@buscatools-erp-email.iam.gserviceaccount.com \
  --member serviceAccount:buscatools-erp-email@buscatools-erp-email.iam.gserviceaccount.com \
  --role roles/iam.serviceAccountTokenCreator --project buscatools-erp-email

# 4 · SA de push, que sólo puede invocar este servicio
gcloud iam service-accounts create gmail-push-invoker --project buscatools-erp-email
gcloud run services add-iam-policy-binding buscatools-email-backend \
  --member serviceAccount:gmail-push-invoker@buscatools-erp-email.iam.gserviceaccount.com \
  --role roles/run.invoker --region us-east1 --project buscatools-erp-email
gcloud projects add-iam-policy-binding buscatools-erp-email \
  --member serviceAccount:service-545134968830@gcp-sa-pubsub.iam.gserviceaccount.com \
  --role roles/iam.serviceAccountTokenCreator

# 5 · Subscription push AUTENTICADA
gcloud pubsub subscriptions create gmail-buscatools-events-push \
  --topic gmail-buscatools-events \
  --push-endpoint "<URL_DEL_SERVICIO>/gmail/push" \
  --push-auth-service-account gmail-push-invoker@buscatools-erp-email.iam.gserviceaccount.com \
  --push-auth-token-audience "<URL_DEL_SERVICIO>" \
  --ack-deadline 60 --project buscatools-erp-email

# 6 · PRUEBA DE DWD — sólo metadata, no lee ni un mensaje
#     GET /salud primero; después users.getProfile desde el servicio.

# 7 · Scheduler diario
gcloud scheduler jobs create http gmail-watch-renewal \
  --schedule "0 6 * * *" --time-zone "America/Argentina/Buenos_Aires" \
  --uri "<URL_DEL_SERVICIO>/gmail/watch" --http-method POST \
  --oidc-service-account-email gmail-push-invoker@buscatools-erp-email.iam.gserviceaccount.com \
  --oidc-token-audience "<URL_DEL_SERVICIO>" --project buscatools-erp-email

# 8 · users.watch — AL FINAL, cuando todo lo demás esté verde
#     Lo dispara el propio endpoint /gmail/watch.
```

**Antes del paso 8** tiene que existir la fila en `email_accounts`. No se crea
en esta entrega: crearla sin backend desplegado dejaría una cuenta que nadie
sincroniza.
