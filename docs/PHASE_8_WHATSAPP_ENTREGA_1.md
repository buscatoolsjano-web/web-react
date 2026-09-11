# Fase 8 · WhatsApp — Entrega 1: la base estructural

**Estado: CERRADA.** El schema, la RLS, los privilegios, el bucket y Realtime
están aplicados y probados. Lo que **no** existe todavía: app de Meta, número
registrado, token, webhook, Edge Functions, bandeja React y envío de mensajes.

> **WhatsApp NO está funcionando.** Esto es el piso sobre el que se construye,
> no el módulo. Las seis tablas tienen 0 filas y no hay nada conectado del otro
> lado.

Arquitectura aprobada en la versión 2 de
[`PHASE_8_WHATSAPP_ENTREGA_1_ARQUITECTURA.md`](PHASE_8_WHATSAPP_ENTREGA_1_ARQUITECTURA.md)
(commit `df3b538`). SQL final en
[`database/PHASE_8_WHATSAPP.sql`](database/PHASE_8_WHATSAPP.sql); la propuesta
previa queda como histórica en `database/PHASE_8_WHATSAPP_PROPOSAL.sql`.

---

## A · Las seis tablas

Exactamente las seis aprobadas, ni una más. La suite verifica también que
`whatsapp_outbox`, `whatsapp_templates` y `whatsapp_contacts` **no** existan.

| tabla | columnas | índices | checks | policies | para qué |
|---|---|---|---|---|---|
| `whatsapp_accounts` | 10 | 3 | 1 | 1 | un número de una empresa |
| `whatsapp_conversations` | 17 | 6 | 4 | 1 | la unidad de la bandeja |
| `whatsapp_messages` | 29 | 7 | 5 | 1 | el hilo **y** la cola |
| `whatsapp_media` | 17 | 5 | 4 | 1 | metadata; el archivo en Storage |
| `whatsapp_conversation_reads` | 3 | 2 | 0 | 3 | no leído por usuario |
| `whatsapp_webhook_events` | 9 | 4 | 1 | **0** | crudo, sólo backend |

`whatsapp_webhook_events` con 0 policies es deliberado: RLS habilitada **sin**
policies es denegación total para todo rol de aplicación.

**Ningún secreto en la base.** `whatsapp_accounts` guarda `waba_id`,
`phone_number_id` y el número visible. El access token, el app secret y el
verify token van a los secretos de las Edge Functions y a ningún otro lado.

## B · Constraints

Cada una probada con un intento real, midiendo el efecto además del código.

| regla | por qué |
|---|---|
| `chk_wa_msg_estado` | un entrante NUNCA entra en la cola de salida; un saliente siempre nace en ella |
| `chk_wa_msg_idem` | saliente exige `client_request_id`; entrante lo prohíbe |
| `chk_wa_msg_entrante_sellado` | un entrante siempre trae `provider_timestamp` |
| `chk_wa_conv_vinculo` | si hay cliente, hay que saber de dónde salió el vínculo |
| `chk_wa_conv_contacto_con_cliente` | un contacto no cuelga de la nada |
| `chk_wa_media_ruta` | una media «descargada» sin ruta es un archivo que nadie abre |
| `chk_wa_event_tamano` | 256 KB: nadie vuelca base64 en el jsonb de depuración |
| `uq_wa_conv_contacto` | la identidad es `(account_id, provider_contact_id)` |
| `uq_wa_msg_provider` | idempotencia entrante, **por cuenta** |
| `uq_wa_msg_cliente` | idempotencia saliente, **por cuenta** |

Los dos únicos son **índices únicos parciales**, no constraints: se aplican sólo
cuando la columna no es nula, que es la forma correcta de decir «único cuando
existe».

## C · Índices

27 en total. Los que sostienen algo concreto:

- `idx_wa_conv_bandeja (company_id, last_message_at desc) where archived_at is null` — la bandeja
- `idx_wa_conv_asignada (assigned_to)` — **la RLS del salesperson**, se consulta en cada fila
- `idx_wa_msg_hilo (conversation_id, ordenado_en desc, id desc)` — el hilo
- `idx_wa_msg_cola (next_attempt_at) where status='pending'` — la cola, que siempre es un puñado de filas
- `idx_wa_msg_trabados (claimed_at) where status='sending'` — el reaper
- `idx_wa_reads_usuario (user_id)` — la policy de lecturas filtra por ahí y la PK `(conversation_id, user_id)` no lo cubre

## D · Funciones y RPC

| función | seguridad | quién ejecuta |
|---|---|---|
| `app.normalizar_telefono(text)` | invoker, immutable | authenticated, service_role |
| `app.cola_telefono(text)` | invoker, immutable | authenticated, service_role |
| `app.current_whatsapp_admin_ids()` | **definer**, stable | authenticated, service_role |
| `app.current_whatsapp_company_ids()` | **definer**, stable | authenticated, service_role |
| `app.puede_ver_conversacion_wa(uuid)` | **definer**, stable | authenticated, service_role |
| `app.tiene_conversacion_en_cuenta_wa(uuid)` | **definer**, stable | authenticated, service_role |
| `app.uuid_o_null(text)` | invoker, immutable | authenticated, service_role |
| `app.coherencia_empresa_whatsapp()` | **definer**, trigger | nadie (revocada) |
| `app.coherencia_lectura_whatsapp()` | **definer**, trigger | nadie (revocada) |
| `app.vencimiento_media_whatsapp()` | invoker, trigger | nadie (revocada) |
| `public.asignar_conversacion_whatsapp(uuid, uuid)` | **definer** | authenticated, service_role |
| `public.marcar_conversacion_leida_whatsapp(uuid)` | invoker | authenticated, service_role |
| `public.no_leidos_whatsapp(uuid[])` | invoker, stable | authenticated, service_role |
| `public.tomar_mensajes_whatsapp(int)` | invoker | **sólo service_role** |
| `public.reciclar_mensajes_whatsapp(interval)` | invoker | **sólo service_role** |

Ninguna tiene `EXECUTE` para `anon` ni para `PUBLIC`. Las de la cola son
`INVOKER` a propósito: si alguien ampliara el grant por error, seguirían sin
poder escribir, porque `authenticated` no tiene `UPDATE` sobre la tabla.

`asignar_conversacion_whatsapp` es la única `DEFINER` que un usuario puede
llamar, y valida al actor adentro. Es la puerta, y por eso es la única.

## E · RLS

**Una regla, en un solo lugar.** `app.puede_ver_conversacion_wa()` la define y
la usan las policies de `messages`, `media`, `reads` y del bucket de Storage.

```
admin / employee  → toda la empresa
salesperson       → sólo assigned_to = auth.uid()
technician        → 0
customer          → 0
distributor       → 0
anon              → 0, por privilegio, antes de llegar a ninguna policy
```

Los hijos **siguen al padre**, no su propio `company_id`. Con el salesperson
adentro esto deja de ser prolijidad: si `whatsapp_messages` mirara su propio
`company_id`, un vendedor leería los mensajes de conversaciones que no puede
abrir.

`app.puede_ver_conversacion_wa()` es `SECURITY DEFINER` para que, llamada desde
la policy de `messages`, lea `conversations` sin volver a entrar en su RLS —que
sería recursión—. La policy de `conversations` **no** la llama: repite la
condición en línea, justamente para no morderse la cola.

**La cartera del vendedor quedó descartada y comentada, no implementada.**
Medido sobre la base real: **1 de 1010** clientes tiene `salesperson_id`
cargado. Sería una vía de autorización que casi nunca se cumple, que hay que
mantener y que nadie ejercita.

## F · Privilegios

Privilegio **y** policy, no una de las dos. ACL real:

| tabla | `authenticated` | `anon` | `public` |
|---|---|---|---|
| `whatsapp_accounts` | `r` | — | — |
| `whatsapp_conversations` | `r` | — | — |
| `whatsapp_messages` | `r` | — | — |
| `whatsapp_media` | `r` | — | — |
| `whatsapp_conversation_reads` | `a r w` | — | — |
| `whatsapp_webhook_events` | — | — | — |

`a`=INSERT, `r`=SELECT, `w`=UPDATE. **Ni un `UPDATE` sobre `conversations`
para nadie**: si lo hubiera, un salesperson se apropiaría de cualquier chat
poniéndose en `assigned_to` y a partir de ahí la policy de lectura lo dejaría
pasar. Tampoco `DELETE` en ninguna tabla, ni sobre la propia marca de leído.

## G · Salesperson

El caso obligatorio, medido **por id exacto**, no por conteo:

| | ADMIN | EMPLOYEE | vend1 | vend2 | TECH | CUST | DIST | ANON |
|---|---|---|---|---|---|---|---|---|
| chat A (→ vend1) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| chat B (→ vend2) | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| chat C (sin asignar) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

Y los hijos: vend1 ve los 2 mensajes de A y el adjunto de A. Pidiendo **por id**
el mensaje de B obtiene 0 filas. No puede autoasignarse ni por `UPDATE` directo
(42501) ni por la RPC (`insufficient_privilege`), y después de los intentos el
chat C sigue sin asignar —el efecto, no sólo el código—.

## H · Asignación

Sólo admin y employee, por `asignar_conversacion_whatsapp`. Asigna, reasigna y
desasigna (`p_usuario` null). Rechaza: un salesperson, un admin de otra empresa,
el anónimo, asignar a un technician y asignar a alguien de otra empresa.

Cuando el employee asigna C a vend1, vend1 pasa a ver **dos** chats y **tres**
mensajes en el acto; al desasignar, vuelve a uno.

**Concurrencia:** dos admins asignando a la vez sobre la misma conversación
dejan un estado consistente con uno de los dos valores. El `select … for update`
adentro de la RPC los serializa.

## I · No leídos

Por usuario, con `last_read_at` y sin contador guardado. La secuencia probada:

```
vend1: 2 sin leer      admin: 2 sin leer
vend1 marca leída  →   vend1: 0            admin: 2   ← el de cada uno
llega uno nuevo    →   vend1: 1            admin: 3
admin marca leída  →   vend1: 1            admin: 0
```

vend1 no puede marcar leída una conversación que no ve, ni marcar en nombre del
admin, ni pisar la marca del admin. Esta última se probó **midiendo el valor**:
la policy esconde la fila del admin, así que PostgREST contesta 200 con cero
filas tocadas — creerle al código habría sido un PASS falso. Se intentó con una
fecha vieja, que es el ataque que importa: resucitarle los no leídos a otro.

## J · Idempotencia entrante

Meta reintenta durante 36 horas. El mismo `wamid` repetido → 23505. **Seis
webhooks simultáneos con el mismo `wamid` → 1 fila**, 5 rechazados.

El alcance es **por cuenta**: el mismo `wamid` en otra cuenta sí entra. La
documentación describe el wamid como «a unique ID» pero **no publica garantía
explícita de unicidad entre cuentas distintas**, así que acotarlo es correcto
bajo las dos lecturas y no cuesta nada.

## K · Idempotencia saliente

**Seis envíos simultáneos con el mismo `client_request_id` → 1 fila**, 5
rechazados. El `uuid` lo genera el front y es obligatorio para todo saliente.

## L · Claim concurrente

40 mensajes pendientes, **8 consumidores en paralelo** pidiendo 6 cada uno (48
cupos):

- ningún id apareció en dos lotes — **0 duplicados**
- 40 reclamados, 40 ids distintos
- los 40 en `sending`, `attempts = 1`, `claimed_at` completo
- de 5 nuevos pidiendo 2, se reclaman 2 y los otros 3 **siguen `pending` con
  `attempts = 0`**
- ni el admin ni el anónimo pueden ejecutar el claim (42501)

Una sola sentencia `update … where id in (select … for update skip locked)`
con `returning`. No hay un `SELECT` seguido de un `UPDATE` separado.

## M · Reaper

`sending` trabado → **`failed`**, nunca → `pending`. Timeout **5 minutos**,
parametrizable.

Probado: 3 trabados con `claimed_at` de hace 10 minutos pasan a `failed` con
`failed_at`; **ninguno vuelve a `pending`**; no se crea ninguna fila nueva; el
`client_request_id` no cambia; y los 39 reclamados recién **no se tocan**.

La razón de no volver a `pending`: **no existe en la documentación de Meta
ninguna clave de idempotencia para el envío** —nada como el `Idempotency-Key` de
Stripe—. Reintentar a ciegas un mensaje que quizá salió es mandárselo dos veces
al cliente. Es preferible uno trabado que una persona mira.

## N · Media y Storage

Bucket **`whatsapp`, privado**, límite 100 MB (el techo de documento de Meta).
Ruta `company/account/conversation/message/archivo`.

**El path no es la seguridad** —eso es lo que la entrega 0.5 encontró mal
resuelto en el legacy—: la policy se ata a `puede_ver_conversacion_wa()`, la
misma función. Probado: vend1 baja el archivo de su conversación; el de la
ajena, no; el anónimo, tampoco; y nadie sube desde el navegador.

Sólo hay policy de `SELECT`. La media la sube y la borra el backend.

`media_expires_at` **180 días**, desde el primer archivo: nace con el default y
se recalcula desde `downloaded_at` cuando la descarga se completa. Probado en
los dos momentos. **El proceso que borra no se construyó** — sin la columna
desde el día 1, el día que se aplique la política no habría contra qué comparar.

## O · Realtime

Tres tablas publicadas: `whatsapp_conversations`, `whatsapp_messages`,
`whatsapp_media`. **No** `whatsapp_webhook_events` ni
`whatsapp_conversation_reads`.

La autorización se probó **midiendo lo que llega**, no que el canal acepte el
join —afirmar sobre la señal equivocada ya nos pasó en la entrega 0.5—:

- se inserta un mensaje en el chat B con vend1 suscripto → **0 eventos**
- el mismo mensaje con el admin suscripto → **1 evento**

Cero polling. El legacy consultaba cada 2 segundos.

## P · Multiempresa

Nueve intentos cruzados, todos rechazados con `check_violation`:

1. conversación cuyo `company_id` no es el de su cuenta
2. conversación vinculada a un cliente de otra empresa
3. conversación con un contacto que no es de su cliente
4. conversación asignada a un usuario de otra empresa
5. conversación asignada a un technician
6. mensaje con `company_id` distinto al de su conversación
7. mensaje con una cuenta que no es la de su conversación
8. adjunto con `company_id` distinto al de su conversación
9. adjunto colgado de un mensaje de otra conversación

Es la lección de O1: **una fila hija no se valida por el `company_id` que manda
el cliente**, sino contra el de su padre.

## Q · Security advisors

Dos hallazgos nuevos, los dos intencionales:

| nivel | hallazgo | por qué queda así |
|---|---|---|
| INFO | `whatsapp_webhook_events` con RLS y sin policies | **es el diseño**: denegación total para todo rol de aplicación |
| WARN | `asignar_conversacion_whatsapp` es DEFINER y `authenticated` la ejecuta | **es la puerta**: valida al actor adentro y es la única forma de asignar |

Ningún ERROR nuevo. Los preexistentes (`product_availability` como vista
DEFINER, otras 14 funciones DEFINER, protección de contraseñas filtradas) no los
tocó esta entrega.

**Performance:** el linter marcó `auth_rls_initplan` en cuatro policies mías
—`auth.uid()` re-evaluado por fila— y se corrigió envolviéndolo en un subselect.
De los 6 FKs sin índice se agregó **sólo uno**, el que la RLS consulta de
verdad; los otros cinco quedan sin cubrir a propósito, porque sólo pesarían en
un `DELETE` de la empresa o del perfil. Los 7 «índices sin usar» son esperables:
las tablas están vacías y el módulo no existe todavía.

## R · Bugs encontrados

Tres, todos míos, todos encontrados por la suite y no por inspección:

**1 · El trigger compartido no compilaba para tres tablas.**
`tg_table_name = 'whatsapp_media' and new.message_id is not null` en un solo
`if`: plpgsql compila la expresión **completa** antes de evaluarla y no
cortocircuita, así que intentaba resolver `new.message_id` también para una
conversación —que no tiene esa columna— y reventaba con
`record "new" has no field "message_id"`. Reventó en el primer fixture. Cada
referencia a una columna que no existe en las tres tablas tiene que quedar
**dentro** de la rama de su tabla.

**2 · `revoke execute … from public` dejó a `authenticated` sin las funciones.**
`authenticated` heredaba `EXECUTE` de `PUBLIC` y nunca tuvo grant propio; al
revocarlo de `PUBLIC` se lo saqué también. Como las policies **llaman** a esas
funciones, todas las consultas de la aplicación pasaron a morir con
`permission denied for function puede_ver_conversacion_wa`. Se manifestó como
**0 filas visibles para todos los roles, incluido el admin en su propia
bandeja**. Es exactamente el fallo que se lee como éxito: sin medir el efecto
—qué ids ve cada uno— se podía haber leído como «la RLS funciona, nadie ve
nada». Revocar de `PUBLIC` sigue siendo correcto; faltaba el grant explícito.

**3 · `provider_timestamp` no podía ser `NOT NULL`.** La propuesta ordenaba el
hilo por esa columna y la declaraba obligatoria, pero **un saliente todavía no
aceptado por Meta no tiene `provider_timestamp`** y aun así tiene que aparecer
en su lugar del hilo. Se corrigió con la columna derivada `ordenado_en`
(`coalesce(provider_timestamp, created_at)`), que es además contra la que se
comparan los no leídos.

Y un bug en el propio test, que vale la pena anotar porque es el más peligroso:
la aserción «vend1 no pisa la marca del admin» daba **falso positivo** —la
policy esconde la fila, PostgREST contesta 200 con cero filas y `rechaza()` lo
leía como permitido—. Se reescribió para medir el valor antes y después.

## S · Invariantes

Después de la limpieza: **0 filas en las seis tablas**, 0 objetos sueltos en el
bucket, las empresas y los clientes vuelven a su número exacto. Sin tocar nada
de los otros módulos: 21.772 productos de Buscatools, 142 proveedores, 16 puntos
de revisión de Mantenimiento, todos intactos.

**No se insertó nada del legacy.** Los 8 chats, 150 mensajes y 56 media siguen
siendo `LEGACY WHATSAPP HISTORY = BACKUP ONLY`: no se migran y el respaldo no se
borra.

La suite barre además los restos de una corrida anterior que se haya caído
**antes** de medir el baseline — si no, dos empresas huérfanas se cuentan como
propias y el PASS final es mentira.

## T · Regresión

Todas en serie; nunca dos suites de base a la vez, porque afirman invariantes
globales y se pisan.

| suite | resultado |
|---|---|
| `fase8-whatsapp-entrega1-tests` | **148 PASS, 0 FAIL** |
| `fix-rls-tautologicas-tests` | 0 fallos |
| `fix-rls-delivery-serials-tests` | 0 fallos |
| `security-o4-stock-movements-tests` | 0 hallazgos |
| `fase8-whatsapp-seguridad-tests` | 0 accesos abiertos |
| `stage1-ventas` · `stage3-cotizaciones` · `stage3-pedidos` · `stage3-entregas` · `stage3-cierre` | 0 fallos |
| `fase5-clientes` · `edicion` · `vendedor` · `memoria-precios` · `cierre` | 0 fallos |
| `fase6-proveedores` · `compras-schema` · `pedidos-compra` · `recepciones` · `facturas` · `cierre` | 0 fallos |
| `fase7-mantenimiento-schema` · `entrega2` · `entrega3` · `entrega4` · `entrega5` | 0 fallos |
| `lint` · `typecheck` · `test` · `test:isolated` · `build` | limpio |

## U · Tipos

`src/types/database.types.ts` regenerado con
`scripts/fase8-generar-tipos-whatsapp.mjs`, que deriva del esquema OpenAPI que
publica PostgREST —la misma fuente del generador oficial— en vez de escribirlos
a mano. Las seis tablas quedaron en orden alfabético; hubo que enseñarle a
insertar **al final** del bloque `Tables`, porque `whatsapp_*` va después de
todo lo que existía.

Las cinco funciones se agregaron a mano al bloque `Functions`, incluidas las dos
que sólo puede ejecutar `service_role`: PostgREST las publica y el archivo tiene
que describir el esquema real, no el que nos gustaría.

---

# LO QUE ESTA ENTREGA NO HIZO

No se creó la app de Meta. No se registró ningún número. No se generó ningún
token. No hay webhook. No hay Edge Functions. No hay bandeja en React. No se
envió ni un mensaje. No se migró nada del legacy. El número actual del negocio
**no se tocó**.
