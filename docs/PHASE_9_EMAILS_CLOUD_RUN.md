# Backend de Emails · Cloud Run

Documentación operativa del servicio. El diseño y su justificación están en
[`PHASE_9_EMAILS_ENTREGA_2B_BACKEND_AUTH.md`](PHASE_9_EMAILS_ENTREGA_2B_BACKEND_AUTH.md).

> **Estado: DESPLEGADO y en producción** desde la entrega 3.
> `users.watch` activo sobre `info@buscatools.com.ar`. Los recursos reales están
> en «Recursos desplegados», al final. Este documento no contiene secretos.

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
| `POST` | `/gmail/sync` | recuperación manual · body `{account_id, ventana?, max?}` | OIDC de la SA del scheduler |
| `POST` | `/gmail/perfil` | diagnóstico de DWD · sólo `users.getProfile` | OIDC de la SA del scheduler |
| `GET` | `/salud` | diagnóstico | la de IAM del servicio; no devuelve nada sensible |

**Ninguna ruta es anónima**: el servicio corre con `--no-allow-unauthenticated`
y un request sin token recibe 403 de Cloud Run antes de llegar al código. Y la validación OIDC se hace en el
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
| `SYNC_VENTANA` | env | `newer_than:7d` — ventana del resync, sintaxis de búsqueda de Gmail |
| `SYNC_MAX_HILOS` | env | `200` — tope de hilos por corrida de resync |
| `SUPABASE_SERVICE_KEY` | **Secret Manager** (`supabase-service-key`) | — |

El único secreto real es la service key de Supabase. No es una key descargable
de Google y no habilita DWD: es la credencial de nuestra propia base.

El scope **no** es configurable: está fijo en `gmail.modify` en el código.
`https://mail.google.com/` no se pide nunca — lo único que agrega es el borrado
permanente.

---

## IAM — matriz exacta

| principal | rol | sobre qué | para qué |
|---|---|---|---|
| `buscatools-erp-email@…` (runtime **y** SA de Gmail) | `roles/iam.serviceAccountTokenCreator` | **sobre sí misma** | firmar la aserción DWD |
| `buscatools-erp-email@…` | `roles/secretmanager.secretAccessor` | **sólo `supabase-service-key`** | leer la service key |
| `gmail-api-push@system.gserviceaccount.com` | `roles/pubsub.publisher` | **sólo el topic** | que Gmail publique |
| `service-545134968830@gcp-sa-pubsub.iam.gserviceaccount.com` | `roles/iam.serviceAccountTokenCreator` | proyecto | que Pub/Sub firme el OIDC del push |
| `buscatools-email-pubsub-push@…` | `roles/run.invoker` | **sólo este servicio** | invocar `/gmail/push` |
| `buscatools-email-scheduler@…` | `roles/run.invoker` | **sólo este servicio** | invocar `/gmail/watch`, `/gmail/sync`, `/gmail/perfil` |
| `buscatools-email-build@…` | `roles/cloudbuild.builds.builder` | proyecto | compilar la imagen en el deploy desde source |

**Nada de Owner, Editor ni Service Account Admin.** El token creator de la SA de
runtime se otorga *sobre la service account de destino*, que es la diferencia
entre mínimo privilegio y no tenerlo. **0 keys `USER_MANAGED`** en todas las SAs.

La SA de build existe porque Cloud Build usa por defecto la SA de Compute, que
es compartida por todo el proyecto: darle el rol de builder a ésa habría sido
ampliar privilegios de todo lo demás. Se pasa con `--build-service-account`.

APIs habilitadas a propósito: `run`, `iamcredentials`, `secretmanager`,
`cloudscheduler`. Habilitadas **automáticamente** por el deploy desde source:
`cloudbuild`, `artifactregistry`. Gmail y Pub/Sub ya estaban.

---

## Configuración del servicio

| opción | valor | por qué |
|---|---|---|
| `--min-instances` | **0** | no pagar una instancia ociosa. Con 1 se irían 2,6 M de vCPU-s/mes contra 180.000 de free tier |
| `--max-instances` | **3** | a ~28 mails/día no hacen falta más, y acota cualquier gasto descontrolado |
| `--concurrency` | 20 | el lease protege el buzón; la concurrencia sólo afecta al proceso |
| `--no-allow-unauthenticated` | sí | IAM primero, validación OIDC después |
| `--memory` | 256Mi | no hay dependencias ni procesamiento pesado |
| `--timeout` | 300s | el ack de Pub/Sub es de 60 s; el margen es para el resync manual, que con 200 hilos tardó 30 s |

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

- `threads.list` **acotado** por `SYNC_VENTANA` y `SYNC_MAX_HILOS` → `upsert` en
  `email_threads`. El buzón tiene 26.833 mensajes: sin acotar, el resync no entra
  ni en el timeout ni en la cuota. Lo que excede el tope queda reportado como
  recortado
- `has_attachments` sale de **una** búsqueda `has:attachment` por corrida:
  `format=metadata` no trae `payload.parts`, así que no se puede deducir del hilo
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

**48 tests, y ninguno toca `info@`.** El algoritmo entero corre contra un Gmail
falso y un almacén en memoria: 404 de historial, eventos fuera de orden, evento
repetido, lease tomado, lease vencido, resync que conserva el estado.

Los fixtures son inventados. Ninguno sale de correo real.

---

## Recursos desplegados

| recurso | valor |
|---|---|
| Proyecto | `buscatools-erp-email` · 545134968830 |
| Servicio | `buscatools-erp-email` · **us-east1** |
| URL | `https://buscatools-erp-email-545134968830.us-east1.run.app` |
| Revisión en servicio | `buscatools-erp-email-00004-lbv` |
| Runtime SA | `buscatools-erp-email@buscatools-erp-email.iam.gserviceaccount.com` |
| Escalado | min 0 · max 3 · concurrency 20 · 256 MiB · timeout 300 s |
| Secreto | `supabase-service-key` — el único |
| Topic | `projects/buscatools-erp-email/topics/gmail-buscatools-events` |
| Subscription | `gmail-buscatools-events-push` → `…/gmail/push` · OIDC `buscatools-email-pubsub-push@…` · audience = URL · ack 60 s · retry 10–600 s |
| Scheduler | `gmail-watch-renewal` · `0 6 * * *` America/Argentina/Buenos_Aires → `…/gmail/watch` · OIDC `buscatools-email-scheduler@…` |
| Cuenta en la base | `email_accounts` `053b871c-a451-497c-bd4a-c7678f7b697b` · `info@buscatools.com.ar` · `dwd` |
| `users.watch` | activo · `labelIds: INBOX` · se renueva a diario |

### Cómo se desplegó

```bash
gcloud run deploy buscatools-erp-email \
  --source backend/emails \
  --project buscatools-erp-email --region us-east1 \
  --service-account buscatools-erp-email@buscatools-erp-email.iam.gserviceaccount.com \
  --build-service-account projects/buscatools-erp-email/serviceAccounts/buscatools-email-build@buscatools-erp-email.iam.gserviceaccount.com \
  --no-allow-unauthenticated \
  --min-instances 0 --max-instances 3 --concurrency 20 --memory 256Mi --timeout 300s \
  --set-env-vars GOOGLE_PROJECT_ID=…,GMAIL_SERVICE_ACCOUNT_EMAIL=…,GMAIL_PUBSUB_TOPIC=…,ALLOWED_GMAIL_MAILBOXES=info@buscatools.com.ar,SUPABASE_URL=…,PUBSUB_PUSH_SA_EMAIL=…,PUBSUB_PUSH_AUDIENCE=<URL>,SCHEDULER_SA_EMAIL=…,SYNC_VENTANA=newer_than:7d,SYNC_MAX_HILOS=200 \
  --set-secrets SUPABASE_SERVICE_KEY=supabase-service-key:latest
```

Un redeploy con el mismo comando conserva subscription, scheduler, IAM y watch:
ninguno depende de la revisión.

### Operación

| necesidad | cómo |
|---|---|
| ¿DWD sigue andando? | `POST /gmail/perfil` con OIDC de la SA del scheduler |
| forzar renovación del watch | `gcloud scheduler jobs run gmail-watch-renewal --location us-east1` |
| recuperar un hueco | `POST /gmail/sync` `{account_id}` con OIDC de la SA del scheduler |
| agregar un buzón | fila en `email_accounts` **y** redeploy con el allowlist ampliado |

### Deuda conocida

Ninguna bloquea la operación:

1. **Retry/backoff ante 429/5xx de Gmail.** Los errores están clasificados y el
   push no ackea lo reintentable, pero el cliente no reintenta por sí mismo.
2. **Throttling del resync completo.** 200 hilos consumen ~8.000 unidades en
   30 s, por encima de las 6.000/min por usuario. No dio 429; subir
   `SYNC_MAX_HILOS` exige resolver esto antes.
3. **Retención de `email_sync_log`.** El cron de 30 días no existe.
