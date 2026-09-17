# Fase 16 · WhatsApp · Entrega 2.5 — Piloto real con OpenAI

Fecha: 2026-09-17. Proyecto: `uaxcfufvapzulqvynanp`. Función: `whatsapp-ai-analyze`.

Un solo análisis real, autorizado explícitamente por Juan, sobre **una** conversación:
«Conversación #1 — Jano Guarini». Nada automático, nada de grupos, sin push.

## 1 · Configuración

| Clave | Valor |
|---|---|
| OPENAI_API_KEY_PRESENT | YES (verificado por nombre en `supabase secrets list`; el valor nunca se leyó) |
| OPENAI_SDK | `npm:openai@7.17.0` |
| OPENAI_API | Responses API |
| MODEL_SELECTED | `gpt-5.6-luna` |
| MODEL_ID_VERIFIED | YES — `POST {verificar_modelo:true}` → `disponible: true` (sólo Models API, sin contenido) |
| STRUCTURED_OUTPUT | `text.format` `json_schema`, `strict: true` |
| Parámetros | `store: false`, `reasoning.effort: low`, `max_output_tokens: 4000`, timeout 30 s, 1 reintento sólo transitorio, sin fallback a otro modelo |
| AI_FUNCTION_DEPLOYED | YES (sólo `whatsapp-ai-analyze`) |

### Verificación del modelo sin contenido

`{ "verificar_modelo": true }` —y nada más en el cuerpo— hace que la función consulte
`models.retrieve(modelo)` y devuelva `{proveedor, modelo, disponible, codigo}`. Requiere
sesión y membresía activa admin/employee. No lee conversaciones ni arma prompt. El log
registra sólo `evento`, `proveedor`, `disponible`, `codigo`.

## 2 · Prechecks antes de la llamada real

| Chequeo | Resultado |
|---|---|
| Mensajes de la conversación | 6 |
| Válidos para IA (`in` o `out` con `status = sent`) | **4** |
| Salientes `failed` | 2, **excluidos** |
| Payload | nombre de perfil, alias `m1…m4`, autor (empresa/contacto), hora, texto |
| Teléfono / email / CUIT / UUIDs / company_id / customer_id | NO salen. Escaneo por regex de los 4 textos: 0 números largos, 0 emails, 0 CUIT, 0 UUID |
| Otras conversaciones | No existen otras en la base (1 conversación) y el pedido es por id |
| Snapshot previo | 0 resúmenes, 0 items, 0 corridas |

## 3 · Resultado de la primera ejecución

Respuesta: `estado: ok`, `items_nuevos: 3`, `items_descartados: 0`, `alias_inventados: 0`.

- **summary**: pidió cotización de 2 balanceadores y el plazo; Buscatools dijo que envía la
  cotización hoy y estimó 5 días de entrega; queda enviar la cotización y esperar confirmación.
- **topics**: Cotización de 2 balanceadores · Plazo de entrega · Confirmación del contacto.
- **conversation_state**: `esperando_empresa`. **requires_attention**: `true`.

| Tipo | Actor | Descripción | Vence | Fuentes | Confianza |
|---|---|---|---|---|---|
| commitment | company | Enviar la cotización de 2 balanceadores hoy | 17/09 | pedido del contacto + respuesta de Buscatools | 0.96 |
| follow_up | contact | Si el precio le sirve, confirma mañana | 18/09 | pedido del contacto | 0.80 |
| important | company | Entrega estimada de 5 días | — | respuesta de Buscatools | 0.95 |

## 4 · Evaluación humana contra la conversación

| Campo | Evaluación |
|---|---|
| summary | Correcto y completo. Ignora bien «Probando» y «hola». |
| topics | Correctos. |
| requires_attention / estado | Correctos: la empresa debe la cotización hoy. |
| pendings / follow_up | Correcto. La confirmación condicional («si me sirve el precio») quedó como seguimiento, **no** como compromiso. |
| commitments | Correcto: «hoy te paso la cotización» → compromiso de Buscatools con fecha 17/09. |
| decisions | 0 — correcto, nada quedó confirmado. |
| next steps | Cubierto por el compromiso; no se duplicó. |
| actors | Correctos. |
| due dates | Correctas y resueltas respecto de la fecha del mensaje («hoy» → 17/09, «mañana» → 18/09). |
| confidence | Razonable: alta en lo explícito, media en lo condicional. |
| source traceability | 100 %: todas las fuentes existen; «Ver mensaje» resalta el mensaje correcto. |
| Hechos inventados | 0 |
| Falsos positivos | 0 |
| Falsos negativos | 0 (la pregunta del plazo ya fue respondida, no es pendiente) |

**Calidad: BUENA.** No se propone Terra.

## 5 · Métricas y costo

| Clave | Valor |
|---|---|
| MODEL_USED | gpt-5.6-luna |
| MESSAGES_SENT | 4 |
| INPUT_TOKENS | 1033 |
| OUTPUT_TOKENS | 442 |
| CACHED_TOKENS | 0 |
| REASONING_TOKENS | 192 (incluidos en la salida) |
| DURATION_MS | 10 209 en la función (11 423 medidos desde el navegador) |
| INPUT_COST | USD 0.0002066 |
| CACHED_COST | USD 0 |
| OUTPUT_COST | USD 0.0005304 |
| TOTAL_COST | **USD 0.000737** (coincide con `whatsapp_ai_runs.estimated_cost_usd`) |

Precios verificados el 2026-09-17: Luna USD 0.20 / 0.02 / 1.20 por millón (entrada / cacheada / salida).

### PROYECCIÓN (no medida)

Supone que cada análisis cuesta lo mismo que éste. Esta conversación es corta (4 mensajes);
una conversación larga manda más entrada y cuesta más.

| Análisis/día | Por día | Por 30 días |
|---|---|---|
| 100 | USD 0.07 | USD 2.21 |
| 500 | USD 0.37 | USD 11.06 |
| 1000 | USD 0.74 | USD 22.11 |

Con Terra, lo mismo multiplicado por 10.

## 6 · Segunda ejecución sin mensajes nuevos

| Clave | Valor |
|---|---|
| Respuesta | `sin_cambios` |
| PROVIDER_CALLS | 0 (corrida registrada `sin_cambios`, sin tokens ni costo) |
| ITEMS_CREATED | 0 |
| SUMMARY_UNCHANGED | YES (md5 de la fila igual antes y después) |
| CHECKPOINT_UNCHANGED | YES (`last_analyzed_message_id` / `_at` iguales) |
| INCREMENTAL_ANALYSIS | NO PROBADO — no llegó un mensaje nuevo y no se autorizó |

## 7 · Informes

`/whatsapp/informes`, diario y semanal: los únicos pedidos a Supabase fueron
`company_memberships`, `profiles` y `rpc/informe_whatsapp`. Ninguna llamada a
`whatsapp-ai-analyze`; las corridas siguieron en 2. Muestran el resumen y los 3 items guardados.

- DAILY_REPORT: OK (17/09: 1 activa, 1 error de envío ese día, 1 pendiente, 1 compromiso).
- WEEKLY_REPORT: OK (14/09–20/09: 2 recibidos, 4 enviados, 2 errores de envío).

Observación, sin cambio: «Mensajes enviados 4» del semanal cuenta también los 2 salientes que fallaron.

## 8 · UI de la conversación piloto

| Ancho | Desborde de página | Toque ≥ 44 | Inputs ≥ 16 px |
|---|---|---|---|
| 1440 | No | n/a en escritorio | n/a |
| 800 | No | n/a en escritorio | n/a |
| 390 | No | Sí (0 controles por debajo) | Sí (16 px) |

## 9 · Seguridad y privacidad

- Logs de la función: sólo estado, contadores, proveedor y duración. Sin texto, prompt, respuesta ni clave.
- La clave de OpenAI no se leyó, no está en React, ni en `VITE_*`, ni en el repo.
- `.env.openai-temp` lo borró Juan; nunca se commiteó.
- Secrets basura (3 de Meta + 1 `sk-…` cargado como nombre): siguen existiendo; se borran sólo con autorización.

## 10 · Tests y baseline

- lint, typecheck, build: OK.
- vitest: 114 archivos, 1231 tests. test:isolated: igual.
- Suites contra la base (en serie, proveedor falso/mock, sin red): E1 0 fallos; E2 0 fallos.
- Baseline después de las suites: 1 conversación, 6 mensajes, 1 resumen, 3 items, 2 corridas (1 real), 0 empresas `zz`; huellas de resumen e items sin cambios.

## 11 · Estado

| Clave | Valor |
|---|---|
| REAL_CONVERSATION_AUTHORIZED | Conversación #1 — Jano Guarini |
| REAL_CONVERSATION_ANALYZED | 1 (una llamada) |
| PROD_MESSAGES_SENT_TO_OPENAI | 4 |
| OTHER_CONVERSATIONS_SENT | 0 |
| READY_FOR_REAL_AI | YES, a pedido manual y conversación por conversación |
| READY_FOR_AUTOMATION | NO |
| GROUPS_READY | BLOCKED_BY_META |
