# FASE 16 · WHATSAPP — ENTREGA 2: IA, INFORMES Y PREPARACIÓN PARA GRUPOS

> La capa de inteligencia de WhatsApp: resumen por conversación, pendientes, compromisos,
> decisiones, señales de atención e informes diario y semanal. **La IA no es fuente de verdad**:
> todo lo que produce es una sugerencia con su fuente, y nada cambia clientes, pedidos,
> cotizaciones, stock, asignaciones ni estados.
>
> **No se analizó ninguna conversación real. No se mandó ningún dato a un proveedor de IA.** Todo
> se probó con el proveedor falso y con fixtures `zz`. La Edge Function nueva **no está
> desplegada**. 2026-09-17.

---

## 1. Auditoría del modelo actual

### Lo que ya existía (Fase 8 + Fase 16 E1)

| Tabla | Qué guarda | Para la IA |
|---|---|---|
| `whatsapp_accounts` | Número de la empresa, `phone_number_id`, `waba_id`, activa. | — |
| `whatsapp_conversations` | Una por `(account_id, provider_contact_id)`. Perfil, teléfono, `customer_id` (vínculo), `assigned_to`, `archived_at`, `last_message_at/preview/dir`, `last_inbound_at`, `last_outbound_at`, `service_window_expires_at`. | Nombre de perfil, vínculo, asignado. |
| `whatsapp_messages` | `direction` in/out, `message_type`, `text_body`, `caption`, `status` (in: `received`; out: `pending → sending → sent/failed`), `estado_visible` derivado, `error_code/details`, `ordenado_en = coalesce(provider_timestamp, created_at)`. | Texto, autor (dirección), hora. |
| `whatsapp_media` | Metadatos + ruta en Storage privado. | Sólo el tipo o el caption; **el binario nunca**. |
| `whatsapp_conversation_reads` | Lectura por persona → no leídos por persona. | — |
| `whatsapp_webhook_events` | Sólo los eventos con problemas. | — |

**Permisos.** `app.puede_ver_conversacion_wa(conv)`: admin y employee ven toda la empresa; el
vendedor, lo que tiene asignado. Técnico, cliente y distribuidor, nada. Es la función que usan
las policies de mensajes y media.

**Realtime.** Publicadas `whatsapp_conversations`, `whatsapp_messages`, `whatsapp_media`. La bandeja
se suscribe a las dos primeras e invalida consultas; cero polling.

**Campos para IA que ya existían: ninguno.** Faltaba todo: resumen, ítems, trazabilidad a
mensajes, corridas, señales de atención e informes. No se duplicó nada.

### IA en el ERP

**No había ninguna.** Ni SDK, ni clave, ni abstracción. Se creó una capa **server-side**; el
navegador nunca habla con un proveedor.

---

## 2. Schema

Migración: `docs/database/PHASE_16_WHATSAPP_ENTREGA_2.sql` (aplicada; rollback al pie).

### `whatsapp_conversation_ai_summary` — 1:1 con la conversación

`summary`, `topics[]`, `conversation_state` (`esperando_empresa | esperando_contacto | en_curso |
cerrada`), `requires_attention`, **`last_analyzed_message_id` / `last_analyzed_message_at`**
(checkpoint), `status` (`ok | error`), `last_error`, `model`, `analyses_count`, `generated_at`.

### `whatsapp_ai_items` — lo detectado

`type` (`pending | commitment | decision | next_step | important | follow_up`), `actor`
(`company | contact | unknown`), `description`, **`source_message_ids uuid[]` (1–20,
obligatorio)**, `confidence` (0–1), `due_at` (sólo si está escrito), `status` (`open | resolved |
dismissed`), `resolved_at/by`, `assigned_user_id` (reservado, E2 no lo escribe), **`fingerprint`**
único por conversación.

### `whatsapp_ai_runs` — cada llamada

`status` (`ok | error | sin_cambios`), `error_code`, `model`, `messages_sent`, `input_tokens`,
`output_tokens`, `duration_ms`, `items_saved`, `items_discarded`, `requested_by`. **Sin prompts,
sin respuestas, sin texto de mensajes.**

### Preparación para grupos

`whatsapp_conversations.conversation_type` (`individual` default, backfill implícito),
`provider_group_id`, `group_name`; `whatsapp_messages.sender_wa_id`, `sender_name`. Detalle en
`docs/PHASE_16_WHATSAPP_GROUPS_API_READINESS.md`.

---

## 3. Flujo del análisis

```
Persona → «Actualizar resumen»
  └─ POST whatsapp-ai-analyze { conversation_id }          (JWT; cuerpo cerrado)
       ├─ la conversación se lee con el JWT de la persona   → invisible = 404
       └─ analizarConversacion (service_role)
            ├─ ¿grupo?                    → no_soportado
            ├─ ¿análisis ok hace < 30 s?  → reciente            (no llama al proveedor)
            ├─ mensajes desde el checkpoint (últimos 200)
            │    └─ ¿ninguno?             → sin_cambios         (no llama al proveedor)
            ├─ entrada: alias m1…mN, autor, hora, texto; resumen previo; ítems abiertos
            ├─ proveedor.analizar()       → falla → corrida error, resumen INTACTO
            ├─ parsearSalida + validarResultado → basura → corrida error, resumen INTACTO
            └─ guardar_analisis_whatsapp (una transacción: ítems + resumen + corrida)
```

Archivos:

| | |
|---|---|
| `supabase/functions/whatsapp-ai-analyze/logica.ts` | Puro, sin imports: schema, prompt, validación, fechas, proveedor falso, validación del pedido. Lo prueban vitest, la suite de base y el fixture. |
| `…/analisis.ts` | El circuito, con un cliente inyectado. Lo usan la Edge Function y los scripts de Node. |
| `…/proveedor.ts` | Adaptador Anthropic (SDK oficial) y selección por configuración. Sólo Deno. |
| `…/index.ts` | HTTP: JWT, CORS, cuerpo cerrado, autorización por RLS. |

**No se creó `whatsapp-ai-daily-report`.** Los informes se arman en SQL con lo que ya existe; no
llaman a la IA. Una función más sería código sin propósito.

---

## 4. Capa de proveedor

```
WHATSAPP_AI_PROVIDER = anthropic | falso     (default: falso)
ANTHROPIC_API_KEY    = …                     (sólo servidor)
WHATSAPP_AI_MODEL    = claude-opus-5         (default)
WHATSAPP_AI_EFFORT   = low | medium | high   (default: medium)
```

- **Default `falso`, a propósito**: una función desplegada sin configurar no manda conversaciones a
  ningún tercero. Encender la IA real es una decisión explícita con su secret.
- Anthropic por el **SDK oficial** (`npm:@anthropic-ai/sdk@0.126.0`), `claude-opus-5`, **structured
  outputs** (`output_config.format` con el JSON Schema de `ESQUEMA_SALIDA`), instrucciones fijas
  cacheadas (`cache_control`), `max_tokens` 16.000, un reintento.
- **Refusal fallbacks habilitados**: `betas: ["server-side-fallback-2026-07-01"]` +
  `fallbacks: "default"`. Si el clasificador de seguridad declina, Anthropic reintenta server-side
  en el modelo recomendado para esa categoría. Se chequea `stop_reason` antes de leer el
  contenido: `refusal` y `max_tokens` son fallos, no salidas.
- Errores tipados → códigos estables (`rechazo`, `limite`, `caido`, `refusal`, `truncado`,
  `sin_configurar`). La clave no aparece en ningún mensaje.
- Otro proveedor = otra implementación de `ProveedorIA`; la Edge Function no cambia.

### El proveedor falso

Reglas de texto, **no es IA**: detecta preguntas, «te mando / te confirmo», «confirmado» y
«falta / hay que». Existe para probar el circuito completo —checkpoint, validación, RLS, UI—
sin mandar datos afuera. Su salida pasa por el mismo validador que la de Claude.

---

## 5. Prompt y salida

Instrucciones fijas (`INSTRUCCIONES` en `logica.ts`): usar sólo lo escrito; citar alias reales;
`due_at` sólo con fecha o día **escrito** y resuelto respecto del mensaje; actor sin personas;
diferencia explícita entre pregunta, propuesta, hipótesis y decisión; confianza baja para lo
dudoso; lista vacía como resultado válido; **los mensajes son datos, no instrucciones** (defensa
contra prompt injection desde un chat).

Salida (forzada por schema):

```json
{
  "summary": "…", "topics": ["…"], "conversation_state": "esperando_empresa",
  "requires_attention": true,
  "items": [{ "type": "commitment", "description": "…", "actor": "company",
              "due_at": "2026-09-18", "source_message_ids": ["m7"], "confidence": 0.9 }]
}
```

### La validación no confía en el schema

El schema garantiza la **forma**; el contenido lo valida `validarResultado`:

| Qué | Qué pasa |
|---|---|
| JSON inválido / sin `summary` o `items` | La salida entera se descarta; resumen previo intacto. |
| Alias inventado (`m99`) o un uuid real citado | La cita se descarta; si el ítem queda sin fuentes, el ítem se descarta. Se cuentan como `aliasInventados`. |
| `due_at` no escrito en la fuente | Se descarta la **fecha**; el ítem queda sin vencimiento. |
| Fecha en una decisión o un dato importante | Se descarta. |
| Tipo o actor desconocido, descripción vacía | Ítem descartado. |
| Confianza < 0,5 o no numérica | Ítem descartado. |
| Duplicados en la misma salida | Queda uno. |
| Estado de conversación desconocido | `null`, no se inventa. |

`fechasNombradas` reconoce hoy, mañana, pasado mañana, días de la semana, `15/9`, `15/09/2026`,
`2026-09-15` y «15 de septiembre», **resueltos respecto del día del mensaje** en hora argentina.
«A la mañana» no es una fecha. Lo que no reconoce no cuenta: ante la duda, sin vencimiento.

`guardar_analisis_whatsapp` es la segunda línea: vuelve a exigir que cada fuente sea un mensaje
**de esa conversación**, rechaza checkpoints ajenos y análisis obsoletos, y valida tipos, actor,
confianza y largo.

---

## 6. Trazabilidad

Cada ítem guarda `source_message_ids` reales. En la UI:

- En el panel IA, **«Ver mensaje»** lleva al mensaje en el hilo: lo centra, le da el foco y lo
  marca con un borde (no sólo color).
- En los informes, **«Ver mensaje»** abre `/whatsapp?conversacion=…&mensaje=…`: la bandeja abre
  esa conversación, en la pestaña IA, con el foco en el mensaje fuente. Los parámetros se
  consumen una vez.
- Si la fuente no está entre los mensajes cargados (es muy vieja o ya no existe), se avisa.

Una conclusión sin fuente no se puede mostrar porque no se puede guardar.

---

## 7. UI

### Bandeja (`/#/whatsapp`)

Se mantiene el layout: 3 paneles en escritorio, 2 en tablet (el contexto baja), 1 en el teléfono.
El panel derecho pasó a tener **pestañas**:

| Pestaña | Contenido |
|---|---|
| **Contacto** | Lo que había: perfil, cliente vinculado, asignación. |
| **IA** (con el número de sugerencias abiertas) | Aviso de que son sugerencias · **Resumen**: texto, estado, temas, último análisis, **Actualizar resumen** · **Pendientes** · **Compromisos de Buscatools** · **Compromisos del contacto** · **Decisiones** · **Próximos pasos** · **Importante**. Cada ítem: texto, actor, vencimiento si está escrito, confianza en palabras (alta/media/baja), Ver mensaje, Resolver, Descartar. |
| **Actividad** (con el número de señales) | Señales de atención en palabras · historial de análisis (sólo admin/employee): cuándo, cuántos mensajes, cuántas sugerencias nuevas y descartadas, error traducido. |

- Sólo se monta la pestaña abierta. El resumen se pide cuando alguien mira la pestaña IA.
- La lista de conversaciones muestra la **señal principal** en un badge con texto
  («Pregunta sin responder») y las demás para lectores de pantalla.
- **Un análisis que falla no borra nada**: aparece un aviso y el resumen anterior sigue.
- **Resolver / Descartar** sólo cambian la sugerencia. Reanalizar no reabre lo que una persona
  resolvió.

### Informes (`/#/whatsapp/informes`)

Botón **Informes** en el encabezado de WhatsApp. Pestañas **Diario** y **Semanal**, navegación por
día o semana, selector de fecha.

- **Diario**: activas, nuevas, sin respuesta, sin asignar, errores de envío, pendientes abiertos,
  compromisos y decisiones detectados. Conversaciones relevantes (con señales o nuevas),
  **agrupables por contacto, cliente o asignado**. Pendientes, compromisos abiertos (vencidos
  marcados), decisiones, importantes.
- **Semanal**: volumen (recibidos/enviados), activas, pendientes abiertos y resueltos,
  **compromisos vencidos** (sólo con fecha escrita), decisiones, errores, temas frecuentes y
  **conversaciones por asignado** — con la aclaración «No mide desempeño».
- Los números van en tinta de texto; lo que hay que revisar lleva ícono y la palabra «Revisar».

**Por qué dentro de WhatsApp y no en el módulo Informes:** ése es de admin y employee. Éste
respeta la visibilidad de WhatsApp: un vendedor obtiene el informe **de sus conversaciones
asignadas**. Meterlo allá obligaba a otra regla de permisos para lo mismo.

---

## 8. Señales de atención

`senales_atencion_whatsapp(ids[], horas)` — **reglas determinísticas + IA**, SECURITY INVOKER:

| Motivo | Regla |
|---|---|
| `sin_respuesta` | El último mensaje es del contacto (derivado de los mensajes, no de la columna desnormalizada). |
| `pregunta` | Ese último mensaje del contacto tiene `?` o `¿`. |
| `demora` | Sin respuesta hace más de 4 h. |
| `error_envio` | Nuestro último mensaje falló. |
| `pendiente_abierto` | Hay un pendiente, seguimiento o compromiso **de la empresa** abierto. |
| `ia` | El último análisis la marcó. |

Una conversación **sin analizar** igual recibe las cinco primeras. Una consulta para toda la
bandeja visible; Realtime la invalida junto con la lista.

Limitación conocida: la regla no sabe que un «gracias» cierra la charla; lo marca como sin
respuesta. Es preferible a dejar la señal sólo en manos del modelo.

---

## 9. Incremental, idempotencia y costo

- **Incremental**: resumen previo + mensajes desde `last_analyzed_message_at` (el checkpoint se
  excluye). Los últimos 200 como máximo. Probado: tras un análisis, un mensaje nuevo manda **1**
  mensaje.
- **Sin mensajes nuevos no se llama al proveedor** (`sin_cambios`, se registra la corrida).
- **Debounce**: un análisis exitoso hace menos de 30 s alcanza (`reciente`).
- **Obsoleto**: un análisis que llega con checkpoint anterior al guardado no pisa al nuevo.
  Dos análisis simultáneos se serializan con `for update` sobre la conversación.
- **Fingerprint** = md5(conversación | tipo | fuentes ordenadas | descripción normalizada), con la
  misma normalización en TS y SQL. Reanalizar no duplica; `on conflict do nothing` hace que un
  ítem resuelto o descartado **no vuelva a abrirse**.
- **Costo**: una llamada por pedido de una persona, nunca por mensaje ni por render. Instrucciones
  fijas cacheadas. Medición por corrida: tokens de entrada y salida, duración, mensajes enviados,
  ítems guardados y descartados. Los informes reutilizan lo guardado.
- **Nada automático**: ni por mensaje entrante, ni por horario.

---

## 10. Privacidad

Al proveedor viaja: nombre de perfil (o «Contacto»), hora, autor (`empresa`/`contacto`) y texto
de los mensajes nuevos, el resumen previo y las descripciones de lo abierto.

**No viaja**: teléfono, uuids internos (se usan alias `m1…`), `company_id`, cliente vinculado,
otras conversaciones, media binaria ni URLs firmadas (sólo el caption o `[adjunto: image]`).

---

## 11. Seguridad

| | |
|---|---|
| RLS | ON en las tres tablas. Resumen e ítems: `app.puede_ver_conversacion_wa(conversation_id)` — **derivado de la conversación**. Corridas: sólo admin/employee de la empresa. |
| Escrituras | Sin policies de INSERT/UPDATE/DELETE. `revoke all … from anon, authenticated` + `grant select … to authenticated`. |
| `guardar_analisis_whatsapp`, `registrar_corrida_ia_whatsapp`, `app.huella_item_wa` | Sólo `service_role`. Revocado explícitamente a `public, anon, authenticated` (lección de E1: los default privileges dan EXECUTE por rol). |
| `resolver_item_ia_whatsapp` | `authenticated`. Exige ver la conversación; inexistente e invisible dan **el mismo** error. |
| `senales_atencion_whatsapp`, `informe_whatsapp` | SECURITY INVOKER: la RLS de quien pregunta. El informe además exige que la empresa sea una de las suyas. |
| Edge Function | JWT requerido; cuerpo cerrado (`company_id` rechazado); autorización leyendo la conversación con el JWT de la persona; logs sólo con códigos y conteos. |
| Advisors | La única función nueva señalada es `resolver_item_ia_whatsapp` (intencional). Ninguna tabla nueva sin policy. |

### Auditoría de secretos (§32) — sólo documentada, nada se tocó

- Repositorio: 0 tokens de Meta, 0 claves de Supabase, 0 claves de Anthropic.
- `META_WHATSAPP_ACCESS_TOKEN`: el digest cambió respecto del diagnóstico del 17/09 → la carga del
  token nuevo quedó bien.
- **Siguen existiendo tres secrets con nombre basura**: uno hexadecimal de 32 caracteres (es el
  App Secret escrito como nombre, con valor vacío) y dos que empiezan con `EAA…` (201 y 206
  caracteres, access tokens escritos como nombre). No se borraron. **Pendiente del usuario:
  borrarlos y rotar en Meta las tres credenciales expuestas como nombre.**
- Los logs de `function_edge_logs` conservan, del 16/09, URLs de handshake con verify tokens en la
  query (uno con forma de access token). Es inherente al protocolo; queda hasta que venza la
  retención.
- No hay `ANTHROPIC_API_KEY` cargada.

---

## 12. Tests

| Suite | Resultado |
|---|---|
| `src/modules/whatsapp/lib/analisisIA.test.ts` | 30 — salida válida, JSON malformado, alias inventados, fechas inventadas y relativas, duplicados, confianza baja, conversación vacía, privacidad de la entrada, pedido cerrado, proveedor falso. |
| `src/modules/whatsapp/lib/ia.test.ts` | Secciones, períodos AR, agrupación, vencidos, textos. |
| `src/modules/whatsapp/components/PanelIA.test.tsx` | Resumen, fuente, resolver, carga, errores, vacío, fallo no destructivo. |
| `src/modules/whatsapp/pages/InformeWhatsappPage.test.tsx` | Totales, período, enlaces a la fuente, agrupación, semanal, vacío, error, permisos. |
| `scripts/fase16-e2-whatsapp-ia-tests.mjs` | **111 comprobaciones, 0 fallos**: grupos, RLS con 8 actores, escrituras directas, validación en la base (fuente inexistente, ajena, borrada, checkpoint, obsoleto), idempotencia y no-reapertura, circuito A–F con incremental y debounce, fallos no destructivos, resolver, señales, informe (aislamiento, período, vencidos por día local, sin escrituras), limpieza. |
| `scripts/fase16-whatsapp-e1-tests.mjs` | 0 fallos (regresión E1). |
| Frontend completo | lint, typecheck, **1197 tests** (`--no-file-parallelism` y `test:isolated`), build. |

```bash
node --env-file=.env --env-file=.env.migration --experimental-strip-types scripts/fase16-e2-whatsapp-ia-tests.mjs
```

Hallazgos que salieron de las pruebas y se corrigieron:

1. `sin_respuesta` leía `last_message_dir`, que no se recalcula si un mensaje se borra → ahora se
   deriva de los mensajes.
2. `compromisos_vencidos` comparaba con `now()` y marcaba vencido un compromiso **a las 21 h del
   día anterior** → ahora compara días en hora argentina.
3. Un compromiso o decisión **descartado por una persona** seguía contando como detectado → ya no.
4. `fechasNombradas` leía `2026-11-02` también como `11-02` → se consumen las ISO primero.

### Revisión en el navegador (fixture `zz-wa-e2ui`, proveedor falso)

Chats A (simple), B (pregunta sin responder), C (compromiso con fecha), D (decisión), E (ruido),
F (error de envío, sin analizar). Verificado:

- C: «mañana te mando la cotización» → compromiso de Buscatools, vence **vie 18/09**; «el viernes
  te confirmo» → compromiso del contacto, **vie 18/09**. E: sin ítems. D: decisión sin fecha.
- «Ver mensaje» → foco y borde en el mensaje real.
- «Actualizar resumen» con la función sin desplegar → aviso, resumen e ítems intactos.
- Descartar desde la UI → `dismissed` con autor en la base; el contador de la pestaña baja.
- Informe diario y semanal; «Ver mensaje» desde el informe abre la conversación en la pestaña IA
  con el foco en la fuente.
- 1440: 3 paneles, sin overflow. 800: 2 paneles. 390: 1 panel, sin overflow, 0 controles < 44 px.

Fixture borrado al terminar.

---

## 13. Qué NO se hizo

- No se desplegó `whatsapp-ai-analyze` ni se cargó ningún secret.
- No se analizó ninguna conversación real ni se llamó a ningún proveedor real.
- No se tocaron WABAs, número, webhook, App Secret, Verify Token, Access Token, billing,
  suscripciones de Meta, WhatsApp legacy, WappFly/Baileys, `erp_store` ni el puente viejo.
- No se implementaron grupos ni ninguna integración no oficial.
- No se envía nada automáticamente.

---

## 14. Automatización futura (documentada, no implementada)

- Resumen diario a las 18:00 y semanal los viernes (cron → mismo informe SQL, sin IA).
- Push notification de conversaciones con atención.
- Envío por Slack o email del informe.
- Tareas automáticas a partir de pendientes (hoy sólo sugerencias).
- Sugerencias al CRM (vincular cliente, crear cotización) — siempre con confirmación humana.
- Análisis programado de conversaciones con mensajes nuevos (debounce por conversación).

---

## 15. Lo que queda para E3

- **Piloto real de IA**: aprobación explícita, `ANTHROPIC_API_KEY` y `WHATSAPP_AI_PROVIDER=anthropic`
  en secrets, desplegar `whatsapp-ai-analyze`, empezar con una conversación y medir tokens/costo
  por corrida. Evaluar el prompt con conversaciones reales anonimizadas antes de abrirlo.
- Paginado del hilo para llegar a fuentes anteriores a los mensajes cargados.
- `assigned_user_id` en ítems: hoy existe la columna, no hay UI ni RPC.
- Umbral de «demora» configurable por empresa (hoy 4 h fijo).
- Informe: exportar, y comparar contra el período anterior.
- Grupos: ver `PHASE_16_WHATSAPP_GROUPS_API_READINESS.md` §4 (bloqueado por OBA).
- Limpieza de los tres secrets basura y rotación de las credenciales expuestas (usuario).
