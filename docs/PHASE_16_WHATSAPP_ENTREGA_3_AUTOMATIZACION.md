# Fase 16 · WhatsApp · Entrega 3 — Automatización controlada

Fecha: 2026-09-17. Proyecto: `uaxcfufvapzulqvynanp`.

E3 deja lista la IA automática, los informes programados, los límites de costo y el kill switch.
**Todo nace apagado**, para todas las empresas. Nada se activó.

SQL: `docs/database/PHASE_16_WHATSAPP_ENTREGA_3.sql`. Migraciones aplicadas:
`phase16_whatsapp_entrega_3_automatizacion`, `…_wrapper_informes`, `…_lock_reloj`.

---

## 1 · Prueba incremental real (antes de automatizar)

Juan mandó UN mensaje nuevo a la conversación #1. Snapshot previo: resumen con 1 análisis,
checkpoint en el mensaje 6, 3 ítems, 2 corridas, 4 mensajes válidos. Una sola llamada manual.

| Clave | Valor |
|---|---|
| PREVIOUS_SUMMARY_INCLUDED | YES (log `resumen_previo: true`) |
| NEW_MESSAGES_SENT | 1 |
| OLD_MESSAGES_RESENT | 0 (log `viejos_reenviados: 0`) |
| PROVIDER_CALLS | 1 |
| ITEMS_CREATED | 1 |
| ITEMS_UPDATED | 0 (los 3 anteriores idénticos: misma huella md5) |
| DUPLICATES | 0 (0 huellas repetidas) |
| CHECKPOINT_ADVANCED | YES (mensaje 6 → mensaje 7) |
| MODEL_USED | gpt-5.6-luna |
| INPUT / OUTPUT / CACHED / REASONING | 1018 / 197 / 0 / 76 |
| DURATION_MS | 7973 (función) |
| TOTAL_COST | USD 0.000440 |
| **INCREMENTAL_REAL_TEST** | **PASS** |

Evaluación: el compromiso «enviar la cotización» NO se duplicó; la consulta nueva quedó como
**pendiente de Buscatools**: «Informar el precio del envío», fuente = el mensaje nuevo, confianza 0.99.
Sin decisiones ni compromisos inventados. Trazabilidad PASS.

Observación: el resumen nuevo reemplazó al anterior y dejó de mencionar la entrega en 5 días y la
confirmación condicional (siguen como ítems). Se agregó a la regla 8 del prompt «conservá lo que sigue
vigente del previo». Ese cambio está probado con tests, **no con una llamada real** (no autorizada).

Costo acumulado real de la IA: 2 llamadas, USD 0.001177.

## 2 · «Mensajes enviados» corregido

`mensajes_salientes` = `direction = 'out' AND status = 'sent'`.

| status | ¿cuenta? | por qué |
|---|---|---|
| `sent` | SÍ | Meta aceptó el mensaje |
| entregado / leído | (ya incluido) | no son estados: son `delivered_at`/`read_at` sobre la misma fila `sent` → sin doble conteo |
| `pending`, `sending` | NO | en cola, todavía no aceptados |
| `failed` | NO | no salió; cuenta en «Errores de envío» |

Prod, semana 14–20/09: antes decía 4 (2 eran fallidos). Hoy dice 3 = los 3 `sent` reales.

## 3 · Arquitectura

```
mensaje entra (webhook, SIN cambios) ─┐
saliente pasa a sent (send, SIN cambios) ─┤
                                          ▼
           trigger trg_wa_msg_encolar_ia (sólo si enabled + auto_analyze,
           individual, no archivada; si falla: WARNING, el mensaje entra igual)
                                          ▼
           whatsapp_ai_analysis_queue  (1 fila por conversación, not_before = debounce)
                                          ▼
 pg_cron c/2 min → app.disparar_worker_ia_whatsapp() → SÓLO si hay trabajo listo
                                          ▼  pg_net POST + x-worker-token (Vault)
           Edge Function whatsapp-ai-worker (202 + waitUntil)
                                          ▼
 reclamar (FOR UPDATE SKIP LOCKED) → analisis.ts (el MISMO del botón manual)
   → guardas (IA apagada / límites) → proveedor → guardar → completar
```

El webhook NUNCA llama a OpenAI. Sin trabajo listo, el cron no hace ni una llamada HTTP (medido:
en toda la sesión, pg_net hizo 2 llamadas, las 2 pruebas de punta a punta).

## 4 · Configuración por empresa — `whatsapp_ai_settings`

`company_id` PK · `enabled` · `auto_analyze` · `daily_report_enabled` · `weekly_report_enabled` ·
`daily_report_time` · `weekly_report_day` (ISO 1–7) · `weekly_report_time` ·
`analysis_debounce_seconds` (30–3600, default 120) · `max_daily_analyses` · `max_daily_cost_usd` ·
`timezone` (fija: America/Argentina/Buenos_Aires) · `updated_at` · `updated_by`.

Modo: `enabled=false` → **desactivada** · `enabled` sin auto → **manual** · `enabled`+auto → **automática**.

Default seguro: filas explícitas para buscatools y torquetools, todo `false`. Empresa sin fila = apagada.

**Importante:** con `enabled=false` también se bloquea el análisis MANUAL (kill switch completo). Hoy
Buscatools está desactivada: para volver a usar «Actualizar resumen», un admin tiene que habilitar la IA
(queda en modo manual, sin automática).

RPCs: `config_ia_whatsapp` (admin), `guardar_config_ia_whatsapp` (admin; versión; sólo campos
editables; proveedor/modelo/zona NO), `estado_ia_whatsapp` (cualquier usuario de WhatsApp: sólo el modo).

## 5 · Cola, debounce, lock e idempotencia

- **Un trabajo por conversación** (PK). 10 mensajes en ráfaga = 1 fila = 1 llamada con los 10.
- **Debounce**: cada mensaje lleva `not_before` a ahora + debounce, sin adelantar una espera de
  reintento o de límite (`greatest`).
- **Lock**: `reclamar_analisis_whatsapp` con `FOR UPDATE SKIP LOCKED`; `locked_at` es el token.
  Probado: dos workers en paralelo sobre 4 trabajos → 4 llamadas, ninguna doble.
- **Crash recovery**: un lock de más de 10 min vuelve a pending como intento fallido (`lock_vencido`).
  El worker viejo ya no puede completarlo (`lock_perdido`).
- **Mensaje durante el análisis**: se guarda `lock_requested_at`. Si al terminar `requested_at` cambió,
  el trabajo vuelve a pending. El checkpoint sólo llega al último mensaje enviado al modelo. Probado:
  m20 analizado, m21 llega durante la llamada → pending → la siguiente manda SÓLO m21 con el resumen previo.
- **Saliente en camino**: el análisis corta antes de un saliente `pending`/`sending` reciente (< 15 min),
  para que el checkpoint no lo saltee.
- **Worker muere después de OpenAI y antes de la base**: no se guardó nada; el lock vence, se reintenta
  (una llamada más, acotada por intentos y límites). **Muere después de guardar y antes de completar**:
  el reintento ve `sin_cambios` → done, 0 llamadas. Guardar es una transacción; los ítems tienen huella única.
- Resueltos y descartados no reaparecen; mismos mensajes → 0 ítems nuevos (probado con reanálisis completo).
- Un `failed` NO se reabre solo con un mensaje nuevo (evita repetir, p. ej., un 401 por mensaje).

## 6 · Reintentos

| Error | Comportamiento |
|---|---|
| 429 `proveedor_limite`, 5xx `proveedor_caido`, red, timeout, base momentánea, lock vencido | reintento: +2 min, +10 min, +60 min; al 4.º fallo → `failed` |
| 401/403 `proveedor_auth`, sin configurar, modelo no disponible, rechazo | `failed` al primer intento |
| refusal, truncado, salida/ítems inválidos | `failed`, requiere revisión |

Nunca hay loop: máximo 4 intentos. «Reintentar» (admin) en Configuración → WhatsApp · IA.

## 7 · Límites de costo y uso

Antes de CADA llamada (manual o automática), `verificar_uso_ia_whatsapp`:
- IA apagada → `desactivada`;
- llamadas de hoy (día AR) ≥ `max_daily_analyses` → `limite_analisis`;
- USD estimado de hoy ≥ `max_daily_cost_usd` → `limite_costo`.

No se llama al proveedor; queda una corrida `omitido` (no marca error en la conversación). El trabajo
espera al inicio del día siguiente con `last_error = limit_reached`. WhatsApp no se bloquea.
Desborde posible: a lo sumo una llamada por worker concurrente entre la verificación y el registro.

## 8 · Kill switch

`enabled = false` (Configuración → WhatsApp · IA → «Habilitar IA de WhatsApp»):
no hay llamadas nuevas (manuales ni automáticas); lo pendiente se cancela en la misma transacción; un
trabajo en curso termina sin llamar (`desactivada` → `cancelled`); resúmenes, ítems, corridas e informes
NO se borran; WhatsApp sigue igual. Apagar sólo `auto_analyze` cancela la cola y deja el modo manual.

## 9 · Worker y scheduler

- `whatsapp-ai-worker` (Edge Function, `--no-verify-jwt`): POST con `x-worker-token`. El token nace en
  Vault (`whatsapp_ai_worker_token`), no está en el repo, en secrets de Edge Function ni en logs; el
  worker lo valida con `validar_token_worker_ia_whatsapp` (hashes). GET → 405; sin token o inventado → 401.
- Lote de 5, presupuesto 90 s; lo que no llega a empezar se libera.
- Logs: sólo conteos por resultado.
- pg_cron: `whatsapp-ai-worker` `*/2 * * * *`; `whatsapp-ai-informes` `*/15 * * * *`.
  Auditoría: no había scheduler (ni pg_cron, ni pg_net, ni cron externo); pg_cron + pg_net es el
  mecanismo de Supabase para Edge Functions programadas.
- Sin polling de frontend: métricas y configuración se leen al entrar y con «Actualizar».

## 10 · Informes programados

- Cálculo único en `app.datos_informe_whatsapp` (INVOKER): `informe_whatsapp` sigue igual para las
  personas (RLS); el scheduler ve la empresa entera.
- `whatsapp_ai_reports` (unique empresa + tipo + período): `generar_informe_whatsapp` crea o
  actualiza, nunca duplica. `source_cutoff` y `version` en cada fila.
- Programados: diario = el día cerrado de AYER, a partir de la hora configurada; semanal = la última
  semana cerrada (lunes a lunes), el día y hora configurados. Una vez por período.
- Sin IA (probado: 0 corridas antes/después) y **sin envío** (ni email, ni WhatsApp, ni push).
- UI: WhatsApp → Informes con Hoy / Ayer / Semana actual / Semana anterior. Administración ve el snapshot
  si existe («Informe guardado · generado …»); si no, en vivo («En vivo»). Vendedores: siempre en vivo, lo suyo.
- Snapshots: sólo admin y employee (son de toda la empresa).

## 11 · Observabilidad y alertas

`metricas_ia_whatsapp` (admin), una consulta agregada: hoy, últimos 7 días y mes (AR) → corridas,
llamadas, tokens de entrada/salida/razonamiento, costo, errores, omitidas; cola (pendientes, en curso,
límite, fallidos, cancelados); proveedor (último ok/error, «no disponible»); fallidos con contacto,
error, intentos. Indicadores en pantalla (no notificaciones): proveedor no disponible, límite alcanzado,
fallidos, pendientes. Prod hoy: 2 análisis, USD 0.001177, 0 errores, cola vacía.

## 12 · UI

Configuración → **WhatsApp · IA** (sólo admin; no aparece para otros roles): estado, proveedor OpenAI y
modelo gpt-5.6-luna (no editables, sin claves), zona horaria, habilitar/automática/debounce/límites,
informes, uso y costo, cola y fallidos con «Reintentar». El panel IA de la conversación muestra el modo;
con IA desactivada, «Actualizar resumen» queda deshabilitado y lo ya analizado sigue visible.

Verificado en el navegador con la sesión de Juan (sólo lectura, sin guardar): 1440 / 800 / 390 sin
desborde de página (el subnav de Configuración tiene scroll propio, por diseño); en 390 todos los
controles ≥ 44 px y campos a 16 px. 0 llamadas a `whatsapp-ai-analyze` al navegar.

## 13 · Privacidad

OpenAI recibe exactamente lo de E2.5: nombre visible, zona horaria, resumen previo, ítems abiertos
(texto), mensajes válidos nuevos con alias, autor, hora y texto. Nunca teléfono, email, CUIT, UUIDs,
company_id ni customer_id. La suite arma el pedido REAL a la Responses API (cliente mock) con una
conversación vinculada a un cliente con CUIT y email, y falla si aparece cualquiera de esos datos o
cualquier uuid; verifica también `store:false`, `reasoning low`, `max_output_tokens 4000`, `gpt-5.6-luna`.

## 14 · Seguridad

- RLS explícita en las 3 tablas nuevas; nadie escribe directo (probado).
- Revocado EXECUTE a public/anon (y a authenticated en las de servidor) en cada función: los default
  privileges del proyecto lo otorgan. Probado: un admin no puede llamar reclamar, completar,
  verificar_uso, generar_informe, programados ni validar_token.
- SECURITY DEFINER con `search_path` fijo. `CONFLICTO_VERSION` sin errcode 40001 (PostgREST lo reintentaba).
- Advisors: sólo el WARN esperado de RPC de usuario con chequeo de rol interno.
- Secrets: los 4 basura se borraron al inicio de E3 tras verificar digests; los activos, intactos.
  No se rotó nada.

## 15 · Tests

| Suite | Resultado |
|---|---|
| lint, typecheck, build | OK |
| vitest / test:isolated | 117 archivos, 1272 tests |
| E3 base (`fase16-e3-whatsapp-automatizacion-tests.mjs`) | 167 PASS, 0 fallos |
| E3 punta a punta (`fase16-e3-worker-e2e.mjs`): cron → pg_net → worker real, sin proveedor | 0 fallos |
| E2 base | 0 fallos (+ incremental: resumen previo y 0 reenviados) |
| E1 base | 0 fallos |

Fixture zz: A (1 mensaje), B (ráfaga de 10), C (mensaje durante el análisis), D (429 hasta failed),
E (500), 401, refusal, F (límites de análisis y costo, manual y automático), G (kill switch),
H/I (informes diario y semanal, programados). Proveedor FALSO o mock; ni una llamada real.

## 16 · Rollback

Ver el bloque ROLLBACK al final del SQL. Orden: desplegar primero la `whatsapp-ai-analyze` de E2.5
(la de E3 llama a `verificar_uso_ia_whatsapp`), borrar la función `whatsapp-ai-worker`, después la base.

## 17 · Estado

| Clave | Valor |
|---|---|
| READY_FOR_AUTO_PILOT | YES |
| AUTO_ANALYSIS_ENABLED | NO |
| READY_FOR_SCHEDULED_REPORTS | YES |
| GROUPS_READY | BLOCKED_BY_META |

Para el piloto automático (sólo con autorización de Juan), en Configuración → WhatsApp · IA:
habilitar IA + automática, debounce 120 s, 50 análisis/día, USD 0.25/día. Informes programados: aparte.
