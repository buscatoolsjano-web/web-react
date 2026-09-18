# Fase 18 · WhatsApp interno · Entrega 0 — Listener de grupos existentes

Fecha: 2026-09-18. Proyecto: `uaxcfufvapzulqvynanp`.
Código: [`backend/whatsapp-listener/`](../backend/whatsapp-listener).
SQL **propuesto y no aplicado**: [`docs/database/PHASE_18_WHATSAPP_INTERNO_E0_PROPUESTA.sql`](database/PHASE_18_WHATSAPP_INTERNO_E0_PROPUESTA.sql).

> **Qué NO se hizo, y es lo primero que hay que leer.**
> No se tocó el número **+54 9 11 2186-6133**. No se escaneó ningún QR. No se instaló Baileys.
> No se aplicó ninguna migración. No se modificó nada en Meta, en la WABA, en el webhook oficial
> ni en la app de WhatsApp Business. No se mandó un solo mensaje. No se llamó a OpenAI.
> No se tocó Ventas, Clientes ni STEL.
>
> Lo que hay es **arquitectura y un prototipo que corre entero contra un transporte de mentira**,
> con 46 tests en verde.

---

## 1 · La decisión que cambió, y por qué hay que decirlo

La [auditoría de la Groups API](PHASE_16_WHATSAPP_GROUPS_API_READINESS.md) del 2026-09-17 cerró
con `GROUPS_READY = BLOCKED_BY_META` y con una frase explícita: «no se evaluó —ni se va a
evaluar— ninguna alternativa no oficial (Baileys, whatsapp-web.js, …)».

Esta entrega evalúa exactamente eso. El cambio de criterio no es un olvido: es una decisión con
tres datos nuevos sobre la mesa.

1. La vía oficial **no sirve para el caso de uso**. La Groups API crea grupos nuevos, por
   invitación, de hasta 8 participantes. Los grupos que a Buscatools le interesan **ya existen**
   en el teléfono, tienen la gente que tienen, y la documentación de Meta no describe ninguna
   forma de conectar un grupo existente. Aun con el OBA aprobado mañana, no se leería ni uno.
2. El bloqueo es de Meta y no tiene fecha. Esperar el OBA no es un plan, es una espera.
3. El alcance ahora es **interno**. No son conversaciones con clientes: son grupos de trabajo de
   la propia empresa, donde todos los participantes son de la casa.

Eso no hace que la vía no oficial sea buena. La hace **la única**, y con un riesgo que hay que
aceptar a ojos abiertos.

### 1.1 El riesgo, sin maquillar

`RIESGO = ALTO Y NO MITIGABLE DEL TODO`

- **Baileys no está autorizado por WhatsApp.** Usar un cliente no oficial viola los términos de
  servicio. La consecuencia documentada por la comunidad es el **baneo del número**, a veces sin
  aviso y a veces definitivo.
- El protocolo es privado y cambia. Cuando cambia, el cliente se rompe y hay que actualizar la
  librería. No hay SLA, no hay soporte, no hay changelog oficial.
- La versión actual de `baileys` en npm es **`7.0.0-rc14`**: una release candidate. La última
  estable, `6.7.24`, está publicada bajo el tag `legacy`. El paquete viejo `@adiwajshing/baileys`
  está deprecado. Nada de esto es señal de un cimiento estable.

**Conclusión operativa: esto no va sobre +54 9 11 2186-6133.** Ese número es la cuenta productiva
de Cloud API; si se banea, se cae el canal con clientes, la bandeja, los envíos y los informes.
La cuenta que se vincule tiene que ser **un número descartable**, agregado a los grupos como un
participante más. Si lo banean, se pierde el listener y nada más.

---

## 2 · Auditoría: qué ya estaba

La Fase 16 dejó casi todo el modelo de grupos hecho. Lo verificado contra producción, de sólo
lectura, el 2026-09-18:

| Pieza | Cómo está | ¿Alcanza? |
|---|---|---|
| `whatsapp_conversations.conversation_type` | `'individual'` / `'group'`, con `provider_group_id` y `group_name`. `chk_wa_conv_tipo` obliga a que el contacto de un grupo sea `'group:' \|\| provider_group_id`. | **Sí.** |
| `whatsapp_messages.sender_wa_id` / `sender_name` | Existen, nullable. Es lo que distingue a siete personas dentro de un mismo hilo. | **Sí.** |
| Idempotencia | `uq_wa_msg_provider (account_id, provider_message_id) where provider_message_id is not null`. | **Sí**, y es la pieza clave: un reconnect reemite mensajes ya vistos. |
| Respuestas | `reply_to_provider_id`. | **Sí.** |
| Adjuntos | `whatsapp_media`, con `provider_media_id`, `status`, `media_expires_at`. | **Sí**, con matices (§ 7). |
| Orden del hilo | `ordenado_en` es columna **generada**: `coalesce(provider_timestamp, created_at)`. | **Sí.** No hay que setearla. |
| RLS | Las policies de conversaciones y mensajes son por empresa; un grupo entra por el mismo camino. | **Sí.** |
| `whatsapp_accounts.provider` | `check (provider = 'meta_cloud')`, con `waba_id` y `phone_number_id` **NOT NULL**. | **No.** Una cuenta por QR no tiene ninguno de los dos. |
| `chk_wa_msg_idem` | Todo `out` exige `client_request_id`. | **No.** Un mensaje que la propia cuenta escribió se *observa*, nunca tuvo `client_request_id`. |
| Ediciones / borrados | No hay `edited_at` ni `deleted_at`. | **No.** |
| Allowlist de grupos | No existe. | **No.** |
| Identidad de empleados | No hay forma de saber que un `wa_id` es Facundo. | **No.** |
| `app.encolar_analisis_whatsapp` | `if v_tipo is distinct from 'individual' … return null`. | **No.** La IA no vería un solo mensaje de grupo. |

Los seis «no» son exactamente el contenido de la propuesta SQL, y ninguno se aplicó.

---

## 3 · La arquitectura

```
  WhatsApp (grupos existentes)
        │   cliente NO oficial, cuenta descartable
        ▼
  ┌───────────────┐
  │  Transporte   │  ← la ÚNICA pieza que sabe de Baileys
  └───────┬───────┘
          │  Evento { mensaje | edicion | borrado | grupo }
          ▼
  ┌───────────────┐
  │   Política    │  ← función pura: kill switch, nunca privados, allowlist
  └───────┬───────┘
          │  Decision { admitido, iaHabilitada }
          ▼
  ┌───────────────┐
  │    Ingesta    │  ← decide, guarda, cuenta. No habla con la red.
  └───────┬───────┘
          │
          ▼
  ┌───────────────┐
  │  Repositorio  │  ← en memoria (tests) | Supabase RPC (propuesto)
  └───────┬───────┘
          │
          ▼
   whatsapp_messages ──trigger──▶ cola de análisis ──▶ worker IA (Fase 16)
```

Dos decisiones cargan casi todo el peso.

**La librería vive detrás de una sola frontera.** `Transporte` es una interfaz de cinco métodos.
Todo lo que Baileys tiene de frágil —el protocolo que cambia, la sesión que se cae, la API que se
rompe entre RC y RC— queda de ese lado. El resto del listener recibe `Evento` y no sabe de dónde
salió. El día que exista una API oficial que sirva, se escribe otro transporte y no se toca nada
más. En esta entrega la única implementación es `TransporteMock`.

**El listener no llama a la IA.** Guarda el mensaje; el trigger que ya existe encola el análisis,
con el mismo debounce, los mismos topes de costo y el mismo worker de la Fase 16. Si el listener
llamara al modelo habría **dos caminos al gasto y sólo uno con límites**.

### 3.1 Los archivos

| Archivo | Qué hace |
|---|---|
| `src/tipos.ts` | El vocabulario. No menciona Baileys en ninguna línea. |
| `src/politica.ts` | Qué se ingiere. Función pura, sin red ni base. |
| `src/ingesta.ts` | Decidir, guardar, contar. |
| `src/repositorio.ts` | La frontera con la base + `RepositorioEnMemoria`. |
| `src/supabase.ts` | El repositorio real. **Inerte**: llama RPC que todavía no existen. |
| `src/transporte.ts` | La frontera con la librería + `TransporteMock`. |
| `src/reconexion.ts` | Backoff exponencial con tope y ruido; cuándo **no** reintentar. |
| `src/registro.ts` | Logs sin contenido. |
| `src/config.ts` | Config server-side. Nace apagada. |
| `src/salud.ts` | `GET /health`. |
| `src/listener.ts` | El cableado y el ciclo de reconexión. |
| `src/index.ts` | El proceso. Arranca con el transporte de mentira. |

Sin dependencias de runtime, igual que `backend/emails`: `fetch` y `node:http` alcanzan.

---

## 4 · La política: qué entra y qué no

Tres reglas, en orden, y el default es **NO**:

1. **Kill switch.** Con `LISTENER_ENABLED != true` no entra nada. Apagado **no** desconecta la
   sesión: volver a encenderlo no debería pedir vincular el teléfono de nuevo.
2. **Los chats privados no se ingieren nunca.** Ni siquiera con una allowlist que los incluya:
   el tipo de chat se mira antes que cualquier lista. Este sistema es para grupos de trabajo, no
   para leerle los mensajes a nadie.
3. **Un grupo entra sólo si alguien lo habilitó.** Que la cuenta sea miembro no alcanza. Si
   mañana meten a la cuenta en un grupo nuevo, no se guarda un solo mensaje hasta que una persona
   lo agregue a la allowlist.

Se descarta además lo que no aporta: un mensaje sin texto y sin adjunto —una reacción, un cambio
de asunto, un evento de sistema— se cuenta y se tira. Guardarlo sería ruido en el hilo y, peor,
ruido en el prompt.

`enabled` y `ai_enabled` son **permisos distintos**: un grupo se puede guardar sin mandarlo al
modelo. Eso permite mirar qué entra antes de gastar un peso en tokens.

En el prototipo la allowlist sale de `WHATSAPP_GROUPS_ALLOWLIST`; en la entrega siguiente sale de
`whatsapp_group_allowlist` y se refresca sola, para poder habilitar un grupo sin reiniciar.

---

## 5 · El estado de sesión

Vincular por QR deja en disco un juego de claves. **No es configuración: son credenciales.** Quien
tenga esa carpeta puede hablar por la cuenta y leer sus grupos.

- Vive en `WHATSAPP_AUTH_DIR`, por defecto `.whatsapp-auth/`.
- Está en `.gitignore` **dos veces**: en la raíz (`**/.whatsapp-auth/`) y en el paquete.
  Verificado con `git check-ignore`.
- No va en una variable de entorno. Son varios archivos y cambian solos mientras el proceso
  corre.
- El volumen donde viva tiene que ser persistente. Si se pierde, la sesión se cae y hay que
  volver a escanear a mano.
- El QR **no se loguea**. Un QR en un log es una sesión regalada a quien lea el log.

---

## 6 · Cuando se cae

Se cae seguido: es un cliente no oficial contra un servidor que no lo quiere.

**Backoff exponencial con tope y ruido**: 5 s, 10 s, 20 s, 40 s… hasta 5 minutos, ±20 %. El ruido
separa a dos instancias que se cayeron juntas. Es lento a propósito: reintentar agresivamente
contra un servidor que ya está rechazando la conexión es la forma más rápida de que marquen al
número.

Y una distinción que es el error clásico de estos procesos: **hay dos clases de caída**.

- Una red que se cortó (`ECONNRESET`, `timeout`, `restart required`) se arregla sola reintentando.
- Una sesión cerrada desde el teléfono (`loggedOut`, `401`, cuenta baneada) **no se arregla nunca**
  reintentando. Ahí el listener para, queda en `requiere_autenticacion` y espera a una persona.

Un test cubre esto explícitamente: ante `loggedOut`, **cero reintentos**. El mismo test encontró
un bug real mientras se escribía —el detector miraba `logged_out` pero Baileys escribe
`loggedOut`—, así que la comparación ahora normaliza guiones bajos y espacios.

---

## 7 · Privacidad

Esto graba conversaciones internas entre empleados. Las reglas no son opcionales.

**Por el log no sale contenido.** Ni el texto, ni el número completo, ni el nombre del grupo, ni
el QR, ni las claves de sesión, ni un pedazo de un adjunto. Sale qué pasó, cuántas veces y cuánto
tardó. Un log con el texto de los mensajes es una segunda copia de la conversación, sin permisos,
en un archivo que nadie audita. Los ids se ofuscan (`id:1203…0001`) para poder correlacionar sin
poder leer. Los errores de la librería —que suelen traer el payload crudo adentro— se cortan a
200 caracteres y se les sacan las cosas con forma de número largo o de token.

**`/health` tampoco cuenta nada.** Estado de la conexión, desde cuándo, cuándo fue el último
evento y contadores. Ni un nombre de grupo. Hay un test que lo verifica.

**Los adjuntos no se descargan en E0.** Se guarda la referencia —tipo, mime, tamaño, id del
proveedor, nombre— y nada más. Descargar media es decidir dónde se guarda, cuánto vive y quién
la ve, y eso es una entrega en sí misma. `whatsapp_media` ya tiene `media_expires_at` a 180 días
para cuando llegue.

**Los borrados se marcan, no se borran.** El contenido se oculta en la pantalla; que el mensaje
existió es parte de la historia. Borrar la fila sería perder el «esto se dijo y después se
retiró», que en un grupo de trabajo es justo lo que a veces importa.

Falta —y es una decisión de la empresa, no técnica— **avisarle a la gente que el grupo se está
grabando y analizando**. Ninguna línea de código resuelve eso.

---

## 8 · Quién escribió

Un grupo no tiene «un contacto»: tiene ocho. `whatsapp_conversations` sólo puede guardar uno, así
que los participantes van en `whatsapp_conversation_participants` (propuesta).

La identidad es `wa_id`. **El nombre visible no es identidad**: lo cambia cualquiera desde el
teléfono. Para que la IA pueda decir «Facundo se comprometió a mandar la cotización el jueves» y
no «alguien», hace falta el mapeo `wa_id → profile_id`, y ese mapeo se **carga a mano** en
`employee_external_identities`. No se infiere del nombre, no se adivina por el número.

Quien se va del grupo se marca con `left_at`; no se borra. Los mensajes que escribió siguen ahí y
hay que poder nombrarlo.

---

## 9 · La base

Las cuatro RPC de la propuesta —`ingresar_mensaje_grupo_whatsapp`, `editar_…`, `borrar_…`,
`registrar_grupo_whatsapp`— son el único camino de escritura.

Por qué RPC y no `insert` directo con service role: la validación —cuenta, empresa, allowlist,
idempotencia, forma de la conversación de grupo— queda del lado del servidor, donde no la puede
saltear un proceso mal configurado ni un `.env` con el id equivocado. Es lo mismo que ya hace el
webhook oficial con `registrar_entrante_whatsapp`.

**La empresa nunca viene del evento.** Un mensaje de WhatsApp es un dato de afuera; si el
`company_id` viniera adentro, cualquiera que pudiera inyectar un evento escribiría en la empresa
que quisiera. Sale de `whatsapp_accounts`, a partir del `account_id` de la config.

El service role **nunca llega al navegador**: vive en el proceso del listener y en ningún lado
más. Las RPC tienen `revoke … from public, anon, authenticated` y `grant … to service_role`: un
token de usuario no puede inventar mensajes en un grupo.

Y una aclaración sobre la idempotencia: es del **índice**, no de un `select` previo. Un reconnect
reemite mensajes ya vistos, a veces en paralelo con el anterior; un «¿existe? entonces no lo
inserto» se pierde esa carrera. `on conflict do nothing` no.

---

## 10 · La IA que ya existe

No se escribe una nueva. El mensaje entra a `whatsapp_messages`, el trigger `trg_wa_msg_encolar_ia`
lo encola, y el worker de la Fase 16 lo analiza con el mismo debounce, los mismos topes y los
mismos informes.

El único cambio necesario es **una condición** en `app.encolar_analisis_whatsapp`: hoy descarta
todo lo que no sea `individual`. La propuesta la reemplaza por «si es grupo, tiene que estar en la
allowlist con `ai_enabled`». Todo lo demás del trigger queda igual, incluido el `raise warning`
que hace que un problema en la cola no rompa la inserción del mensaje.

Lo que sí va a hacer falta en la entrega siguiente es **el prompt**. El de la Fase 16 está escrito
para un 1:1 con un cliente: «el cliente pide», «nosotros respondemos». Un grupo interno de ocho
personas no se lee así, y usar el prompt de a dos para un grupo da resúmenes que suenan bien y
dicen cualquier cosa.

---

## 11 · Dónde correrlo

El proceso necesita tres cosas que una función serverless no da: estar **siempre prendido** (la
conexión es un socket largo), un **volumen persistente** para la sesión, y **reinicio automático**.
Eso descarta Edge Functions y cualquier cosa por request.

| Opción | Volumen persistente | Reinicio | Costo aprox. | Secretos | Logs |
|---|---|---|---|---|---|
| **VPS propio** (Hetzner, DigitalOcean) | Sí, el disco | systemd `Restart=always` | ~4-6 USD/mes | archivo `.env` con permisos 600 | journald |
| **Fly.io** | Sí, volumen montado | Sí, por máquina | ~2-5 USD/mes | `fly secrets` | `fly logs` |
| **Railway** | Sí, volumen | Sí | ~5 USD/mes + uso | variables del proyecto | panel |
| **Render** (background worker) | Sí, disco | Sí | ~7 USD/mes | variables del servicio | panel |

**Recomendación: VPS o Fly.io.** Un VPS es lo más barato y lo más predecible, y acá importa: un
proceso que se reinicia cuando la plataforma decide es un proceso que pierde la sesión. Fly.io es
la alternativa si no se quiere administrar una máquina; el volumen montado cumple.

Sea cual sea, lo que no puede pasar: que el contenedor arranque con un disco vacío. Ahí la sesión
se pierde y alguien tiene que ir a escanear un QR.

Hay un `Dockerfile` en `backend/emails` que sirve de molde. El de este servicio se escribe cuando
haya transporte real: hoy empaquetaría un proceso que no se conecta a nada.

---

## 12 · Cómo se corre esto hoy

```bash
cd backend/whatsapp-listener && npm install && npm test
```

46 tests, sin red, sin base y sin cuenta de WhatsApp. Cubren: la allowlist y el default NO, que un
privado no entra ni con allowlist, la idempotencia contra reemisión, respuestas y adjuntos,
ediciones y borrados, que el log no filtra texto ni ids completos, el backoff, que una sesión
cerrada no se reintenta, el kill switch, y que `/health` no cuenta de qué se habló.

`npm run build && npm start` levanta el proceso con el transporte de mentira: sirve para ver la
config, el healthcheck y el apagado limpio. **No se conecta a WhatsApp.**

---

## 13 · Qué falta para que esto sirva

En orden, y cada uno es una decisión antes que código:

1. **Conseguir un número descartable.** Sin eso no se avanza, y no es negociable: no se prueba
   sobre el número de producción.
2. **Aplicar la migración** de `PHASE_18_WHATSAPP_INTERNO_E0_PROPUESTA.sql`, contra una rama de
   Supabase primero.
3. **Escribir `TransporteBaileys`** e instalar la librería. Un solo archivo; el resto no cambia.
4. **Cargar la allowlist y las identidades** de los empleados.
5. **Un prompt para grupos**, distinto del de 1:1.
6. **Avisarle a la gente** que el grupo se graba.

---

## 14 · Rollback

Nada que revertir: no se aplicó ninguna migración, no se instaló ninguna dependencia, no se
modificó ningún archivo del ERP. El listener es un paquete nuevo en `backend/` que no importa
nadie y que ningún build del frontend toca.

Si en el futuro se aplica la propuesta y hay que volver atrás, el SQL trae su `ROLLBACK`
comentado al final — con una advertencia: sirve mientras no haya mensajes de grupo guardados.
Después, apagar es `LISTENER_ENABLED=false` y la allowlist en `enabled = false`, que deja de
ingerir sin perder nada.
