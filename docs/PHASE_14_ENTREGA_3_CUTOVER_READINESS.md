# FASE 14 · ENTREGA 3 — CUTOVER READINESS

> Resuelve los **blockers funcionales** y deja preparado el cutover. **No se hizo cutover:** la autoridad
> sigue siendo STEL en cotizaciones, pedidos y remitos; las secuencias siguen en COTI 2629 / PDV 1316 /
> RT 1424; no se tocaron avisos, botones, STEL, Gmail, WhatsApp, apariencia, el legacy ni Make.
> Documentos históricos productivos: **sin cambios** (hash por tabla antes y después, § 16). 2026-09-15.

## 0. Resultado

| Blocker | Antes | Después | Estado |
|---|---|---|---|
| Cancelación de remito despachado | `UPDATE status='cancelled'` por REST: sin restaurar stock y sin recalcular cumplimiento | Trigger `app.proteger_estado_entrega`: **DELIVERY_ALREADY_DISPATCHED** para todos los roles, incluido service role; UI sin Cancelar ni Eliminar y con el motivo | **RESUELTO** |
| Moneda obligatoria (default USD) | `currency_code ?? 'USD'` en la conversión y en 3 pantallas; cotización sin moneda guardable | Trigger `app.exigir_moneda_documento`: **DOCUMENT_CURRENCY_REQUIRED** y **DOCUMENT_CURRENCY_MISMATCH** en documentos nuevos; UI sin moneda preseleccionada | **RESUELTO** |
| Compatibilidad precio/moneda | Precio de lista de otra moneda no se sugería, sin explicación | Regla explícita + aviso en pantalla; **FX_POLICY = UNDEFINED** | **RESUELTO (sin FX)** |
| COTI02530 | Excepción sin evidencia | Auditado: **SAFE_TO_RECONCILE** (requiere autorización) | Pendiente de decisión |
| SP.2007VPM/80 | Bloqueado por nombre | **DATA_CONFLICT_REQUIRES_HUMAN** (el conflicto está dentro de STEL) | Pendiente de decisión |
| SP.2008VP/100 | Bloqueado por nombre | **LINK_EXISTING** (atributos estructurados coinciden) | Pendiente de decisión |
| COTI02452 (cliente) | Ambiguo | **HUMAN_REVIEW** (STEL tiene CUIT; el cliente React no) | Pendiente de decisión |
| 8 líneas no autorizadas | Sin clasificar | Las 8 **SAFE_TO_DELETE**, con evidencia por línea | Pendiente de autorización |
| RT-ML | Sin decisión | **IMPORT_ONLY** en E3; requisito futuro documentado | Decidido para E3 |
| Sync de productos y precios | Sin diseño | Diseño incremental con presupuesto de llamadas (§ 8) | Diseñado, no implementado |
| Freeze de STEL | Sin plan | Procedimiento T0–T11 (§ 10) | Planificado |
| Alineación de secuencias | Sin cálculo | Fórmula y valores de hoy (§ 11) | Calculado, no ejecutado |
| Emisión concurrente | Sin análisis | Análisis y conclusión (§ 9) | Analizado |

**Readiness por documento** (§ 13): QUOTES **READY_WITH_FIXES** · ORDERS **READY_WITH_FIXES** ·
DELIVERIES **READY_WITH_FIXES**. **CUTOVER_READY = NO.**

## 1. Blocker 1 — remito despachado

### 1.1 Workflow real (auditado antes de tocar nada)

| Pregunta | Respuesta medida |
|---|---|
| Estados | `draft` · `shipped` (Despachada) · `delivered` (sólo en históricos importados) · `cancelled` |
| Cuándo se descuenta stock | Sólo en `public.confirmar_entrega`: un `stock_movements` negativo por línea con producto, con la fila del remito `FOR UPDATE` e idempotencia por estado |
| Cómo se identifica el movimiento de un remito | `source_type = 'delivery'`, `source_id = deliveries.id`, `movement_type = 'sale_delivery'` |
| Cómo se calcula lo entregado | `app.derivar_cumplimiento(order)` suma `delivery_lines.quantity` de remitos en `shipped`/`delivered`, en vivo |
| Estado de cumplimiento del pedido | `pending` / `partially_delivered` / `delivered`, escrito por esa función |
| Qué pasaba al cancelar | `deliveries.status = 'cancelled'` por REST: el movimiento quedaba, el stock no volvía y el cumplimiento **no** se recalculaba (el remito cancelado deja de contar sólo si algo vuelve a llamar a `derivar_cumplimiento`) |

### 1.2 Decisión de negocio (esta fase)

**Un remito despachado no se cancela directamente.** `draft → cancel` sí; `shipped/delivered → cancel`,
no. Revertir un despacho necesita un flujo explícito de devolución con movimientos compensatorios y
trazabilidad, que **no** se implementa ahora.

### 1.3 Implementación (server-side, no sólo UI)

`app.proteger_estado_entrega` (BEFORE INSERT OR UPDATE en `deliveries`, trigger `trg_05_estado_entrega`):

| Transición | Resultado |
|---|---|
| `draft → cancelled` | permitida |
| `draft → shipped` | **sólo** dentro de `confirmar_entrega`, que es quien descuenta stock (contexto de transacción `app.workflow_ctx`, no falsificable desde la app) |
| `draft → delivered` u otro | `DELIVERY_STATUS_REQUIRES_DISPATCH` |
| `shipped`/`delivered` → cualquiera | `DELIVERY_ALREADY_DISPATCHED` |
| `cancelled` → cualquiera | `DELIVERY_CANCELLED` (terminal) |
| INSERT con estado ≠ `draft` y sin `imported_at` | `DELIVERY_STATUS_REQUIRES_DISPATCH` |

`app.bloquear_lineas_entrega_despachada` (`trg_05_lineas_entrega_estado`): desde la app no se insertan,
editan ni borran líneas de un remito que no está en borrador (si no, cambiaría lo entregado sin tocar el
stock). Sigue sin bypass general: los triggers no se desactivan; la única puerta es la de reconciliación
de E2, y ahí el estado de un remito no está en la lista blanca.

**Orden con el guardrail STEL:** `trg_00_autoridad_numeracion` corre antes, así que en una empresa con
autoridad STEL el mensaje sigue siendo `external_numbering_authority`. Y una sesión que no escribe en la
empresa sigue recibiendo el rechazo de RLS, no el del trigger.

### 1.4 UI

`AccionesDocumento`: un remito `shipped`/`delivered` **no** ofrece Cancelar ni Eliminar (esta última la
rechaza siempre el trigger de borrado porque ya movió stock) y muestra, en chico:
«El remito ya generó movimiento de stock y no puede cancelarse directamente.» El estado se ve como
**Despachada**. Verificado en el navegador con una empresa fixture.

### 1.5 Tests (§ 14)

`draft → cancel` PASS y sin stock · `draft → dispatch` PASS con stock una sola vez · `dispatched → cancel`
BLOCKED (admin, employee, **service role**, reintento) con stock, cumplimiento y líneas intactos · volver a
borrador, marcar entregado, editar/agregar/borrar líneas BLOCKED · forzar `shipped` por REST BLOCKED ·
insertar ya despachado BLOCKED · `cancelled` terminal · re-despachar idempotente · 0 reservas nuevas.

## 2. Blocker 2 — moneda obligatoria

### 2.1 Lo que había

`convertirCotizacionEnPedido` usaba `cot.currency_code ?? 'USD'`; `DocumentoNuevoPage` arrancaba con
`moneda: 'USD'`; los detalles de cotización y pedido mostraban `doc.moneda ?? 'USD'`. Una cotización sin
moneda se guardaba y su pedido nacía en USD sin que nadie lo eligiera.

### 2.2 Regla

- Documento **nuevo** (sin `imported_at`): `currency_code` obligatoria → `DOCUMENT_CURRENCY_REQUIRED`.
- Pedido con `quote_id`: su moneda **es** la de la cotización; remito con `order_id`: la del pedido. Otra
  cosa → `DOCUMENT_CURRENCY_MISMATCH`. Nunca se lee la moneda del cliente, de la empresa ni de la lista.
- **Históricos importados quedan fuera**: STEL tiene cambios de moneda reales entre documentos
  relacionados (COTI02339 ARS → PDV01223 USD; PDV01274 USD → RT0000001382 ARS). No se creó ninguna
  constraint que los obligue a coincidir.
- Excepción de mantenimiento: `service_role` puede quitar `imported_at` de un histórico sin tocar moneda
  ni origen (paso previo del borrado de fixtures, igual que `app.puede_borrar_por_mantenimiento`).

### 2.3 Implementación

`app.exigir_moneda_documento` (`trg_05_moneda_documento` en las tres tablas) + servicio y UI:
`exigirMoneda()` corta **antes** de pedir número (si no, un guardado fallido quemaba un número de la
serie); el alta no trae moneda preseleccionada (`Elegí la moneda`, `required`, ayuda «Obligatoria: no hay
moneda por defecto»); los detalles ya no completan USD.

## 3. Precio, lista y moneda — FX_POLICY = UNDEFINED

- Las cotizaciones **no** guardan lista de precios: la sugerencia sale de la lista por defecto de la
  empresa (`price_lists.is_default`, hoy «Lista base» USD).
- `precioSugerido` sugiere **sólo** si la lista está en la misma moneda que el documento. En otra moneda se
  muestra el precio original en gris, con el motivo en el `title`, y la línea queda sin precio para que la
  persona lo escriba en la moneda del documento. Sin moneda elegida: «Elegí la moneda del documento para
  ver los precios de lista».
- **No hay conversión automática.** `FX_POLICY = UNDEFINED`: no se asume ningún tipo de cambio. El campo
  `exchange_rate` sigue siendo libre y no se copia desde STEL (semántica distinta, E1 § 4).

## 4. COTI02530

| Dato | Valor |
|---|---|
| STEL | id 59757111 · estado **Pendiente** · fecha 2026-09-03 · creada 15:58 · **última modificación 2026-09-03 19:03 UTC** · USD 767,78 · 9 líneas |
| STEL en E2 | mismo estado y misma fecha de modificación (no cambió entre E2 y E3) |
| Derivados en STEL | **ninguno**: 0 pedidos y 0 remitos con esta cotización como padre, y ninguna línea hija |
| React | `accepted` · USD · 767,7813 · importada · **sin** id STEL (quedó excluida del run de E2 por pedido del usuario) · 0 pedidos · 0 remitos · 0 eventos |
| Historial | La API de STEL no expone historial de estados: sólo el actual y `utc-last-modification-date` |

**Recomendación: SAFE_TO_RECONCILE.** Bajar el estado a `sent` no rompe ninguna invariante porque no hay
documentos derivados. **No se ejecutó**: la RPC rechaza estados regresivos por diseño, así que aplicar
esto necesita autorización explícita y una excepción acotada.

## 5. Productos bloqueados

| | SP.2007VPM/80 | SP.2008VP/100 |
|---|---|---|
| STEL id | 20285217 | 24934825 |
| STEL nombre | «SPEEDRILL 2007VPM EMBOCADURA LARGO MM **65** ENCASTRE 1/4 HEX» | «SPEEDRILL 2008/100VP 8MM SIN IMAN» |
| STEL descripción | Marca SPEEDRILL · Modelo 2007VPM · Medida 7 mm · **Largo 80 mm** · Encastre 1/4" HEX | Marca SPEEDRILL · Modelo 2008/100VP · Medida 8 mm · Largo 100 mm · Encastre 1/4" HEX |
| STEL estado / precio / modificado | activo · 49,98 · 2026-04-14 | activo · 44,24 · 2025-12-30 |
| React | «SPEEDRILL 2007VPM/80 POWER DRIVE NUTSETTER» · marca SPEEDRILL · modelo 2007VPM/80 · Puntas y tubos · 1 precio | «SPEEDRILL 2008VP/100 POWER DRIVE NUTSETTER» · marca SPEEDRILL · modelo 2008VP/100 · S:8 · Puntas y tubos · 0 precios |
| Uso | 1 línea (COTI02275), mismo id de ítem STEL en esa línea | 3 líneas (COTI02417, PDV01239, RT0000001356), mismo id de ítem |
| Nombre guardado en la línea React | «…LARGO MM **80**…» (el nombre que STEL tenía al importar) | «SPEEDRILL 2008/100VP 8MM SIN IMAN» |

- **SP.2007VPM/80 → DATA_CONFLICT_REQUIRES_HUMAN.** El conflicto está **dentro de STEL**: su nombre dice
  largo 65 mm, su descripción dice 80 mm y su SKU dice /80, y el nombre que quedó en la línea de COTI02275
  decía 80 mm antes del cambio de 2026-04-14. Hasta saber cuál es el largo real no se vincula.
- **SP.2008VP/100 → LINK_EXISTING.** Coinciden SKU exacto, marca, medida (8 mm) y largo (100 mm) por los
  atributos estructurados de la descripción de STEL; la diferencia es de redacción («SIN IMAN» vs «POWER
  DRIVE NUTSETTER») y el orden del modelo. Las tres líneas React ya apuntan a ese producto.

**No se modificó ninguno de los dos.** Vincular el segundo es una acción de un run de reconciliación con
autorización.

## 6. COTI02452 — cliente ambiguo

| Dato | Valor |
|---|---|
| STEL | cuenta 17453791 · referencia CLI01227 · **tiene CUIT** · tiene email · sin `external-id` |
| React | el documento ya apunta a un cliente; ese cliente **no tiene CUIT** ni ese email cargado |
| Identidad fuerte | por CUIT: **0 candidatos** · por email exacto: **0** · por nombre exacto: 1 (el ya vinculado) |
| Equivalencia previa | la cuenta STEL tiene **1 solo** documento en el período: no hay historial que confirme |

**HUMAN_REVIEW.** Hay un camino limpio para después: cargar en el cliente React el CUIT que STEL tiene, y
entonces la identidad fuerte resuelve sola. Es un cambio de dato maestro productivo: **no se hizo**.

## 7. Las 8 líneas no autorizadas

Todas **intactas desde E2** (fila idéntica al respaldo). Ningún documento se borra: sólo se evalúan líneas.

| Documento | Línea (React) | SKU | Cant. | Precio | Evidencia STEL | Aguas abajo | Stock | Historial | Clasificación |
|---|---|---|---|---|---|---|---|---|---|
| COTI02489 | 581bf636 | PRO11778 | 1 | 3.632,01 | STEL tiene 1 línea; este SKU ya no está (editada 2026-09-01) | 0 líneas de pedido la referencian (la cotización tiene PDV01296) | n/a | 0 eventos, 0 bitácora | **SAFE_TO_DELETE** |
| COTI02489 | 4a42fec3 | UN.PTE15N | 1 | 2.085,00 | ídem | 0 | n/a | 0 / 0 | **SAFE_TO_DELETE** |
| COTI02516 | fe6c5a03 | PRO00238 | 4 | 1.616,80 | React tiene el SKU 2 veces, STEL 1 (la otra la reemplazó por GE.TSN125A, insertada en E2) | 0 | n/a | 0 / 0 | **SAFE_TO_DELETE** |
| RT0000001405 | 2a1edb27 | PRO12591 | 1 | — | STEL tiene 1 línea; estas 5 son de COTI02499 (cotización borrada en STEL, mismo total) | — | **0 movimientos** | 0 / 0 | **SAFE_TO_DELETE** |
| RT0000001405 | 3e91cbd8 | PRO12587 | 10 | — | ídem | — | 0 | 0 / 0 | **SAFE_TO_DELETE** |
| RT0000001405 | 5a2498db | PRO12590 | 1 | — | ídem | — | 0 | 0 / 0 | **SAFE_TO_DELETE** |
| RT0000001405 | 3f0… (PRO12589) | PRO12589 | 1 | — | ídem | — | 0 | 0 / 0 | **SAFE_TO_DELETE** |
| RT0000001405 | …(PRO12588) | PRO12588 | 20 | — | ídem | — | 0 | 0 / 0 | **SAFE_TO_DELETE** |

Ejecutarlas es un run de reconciliación con `--aprobar-borrados`; cambia el plan y su hash, así que
requiere un dry run nuevo y autorización. La RPC guarda la fila entera en la bitácora y el rollback la
reinserta con su id.

## 8. RT-ML y el sync de productos y precios

### 8.1 RT-ML (medido en STEL)

| Dato | Valor |
|---|---|
| Documentos históricos | **59** (RT-ML2025000003 → RT-ML2025000061) |
| Desde | 2026-12-29 (primera fecha de documento 2024-12-29) hasta 2026-09-07 |
| Último creado | RT-ML2025000061 · 2026-09-07 14:06 UTC (**hace 8 días**: la serie sigue en uso) |
| Moneda | ARS en los 59 |
| Cuentas | **1 sola** (cliente cuya razón social es MercadoLibre) |
| Padre | los 59 cuelgan de un **pedido** (0 de cotización) |
| React | 5 importados (2026-09: 057–061, los del período migrado); **sin** secuencia |

**Decisión E3: `RT-ML = IMPORT_ONLY`.** No se crea secuencia productiva. Requisito futuro: si React va a
emitir remitos de MercadoLibre, hace falta una serie `RT-ML` con su propio `next_number` alineado (hoy
sería 62) **antes** del cutover de remitos; si no, esos despachos siguen en STEL y habría doble autoridad
sobre la misma serie.

### 8.2 Diseño del sync STEL → React (no implementado)

| Pieza | Diseño |
|---|---|
| Identidad | `products.external_source='stel'` + `external_id` (ya existe, 764 productos vinculados). Nunca por SKU en un segundo paso |
| Productos | Incremental por `utc-last-modification-date >= checkpoint`, `sort=utc-last-modification-date:asc`, `limit=200`, paginado por `start`. Un producto nuevo entra por el mismo filtro |
| Precios | `item-rates` viene **embebido** en cada producto: 0 llamadas extra. `/rates` (12 tarifas) 1 llamada para nombres. Mapeo a `price_lists`: hoy no existe equivalencia (React tiene 3 listas propias) → **decisión pendiente**, sin mapear no se sincroniza precio de tarifa |
| Precio de catálogo | Sólo `sales-price` a la lista por defecto, y sólo para productos con id STEL |
| Bajas | `inactive` viene en el mismo listado → `status='discontinued'`. **Borrados**: no aparecen en los listados (sólo por GET por id); se detectan comparando el total (búsqueda binaria, ~18 llamadas) una vez por mes, o al fallar un GET puntual |
| Conflictos | STEL manda en nombre, descripción, estado y precio de los productos que él creó; React manda en categoría, marca y atributos. Un SKU que ya existe en React con otro id STEL, o con nombre incompatible, **no se vincula**: queda para revisión |
| Checkpoint | Tabla `stel_sync_state(company_id, entidad, ultima_modificacion, ultimo_run)` (a crear cuando se implemente) |
| Estado | Diseñado. **No se implementó**: necesita un cron nuevo y la decisión de tarifas |

### 8.3 Presupuesto de llamadas (cupo compartido con Make)

| Corrida | Llamadas estimadas |
|---|---|
| Diaria incremental: productos (≈2 modificados/día) + tarifas + clientes + delta de documentos | **8–12** |
| Semanal: verificación de bajas por conteo | ~20 |
| Reconciliación completa manual (como E2) | ~60 |

Nunca un full scan frecuente: el scan completo de productos son ~75 llamadas. Con reintentos acotados,
backoff, timeout y checkpoint, como ya hace `scripts/lib/stel-api.mjs`.

### 8.4 Precios históricos vs actuales

Los documentos quedan congelados con el precio de su línea (E2 copió `item-base-price` de cada línea
STEL, incluidos los 595 renglones de remitos). El sync de tarifas **sólo** afecta la sugerencia de precio
de documentos **nuevos**. Son dos cosas distintas y no se mezclan.

## 9. Emisión concurrente

Para un mismo tipo y serie no puede haber dos autoridades: si STEL y React numeran a la vez, dos
documentos distintos toman el mismo número y ninguna reconciliación lo arregla después (el número es la
identidad de negocio). Hoy el ERP no puede emitir porque `document_numbering_authority` dice STEL y la
base lo hace cumplir en `next_document_number`, en los triggers de emisión y en `confirmar_entrega`. Por
eso el corte necesita un **freeze**: el momento en que STEL deja de emitir y React empieza, sin
solapamiento.

## 10. Plan de freeze (procedimiento, no ejecutado)

| Paso | Acción | Verificación |
|---|---|---|
| T0 | Avisar a los usuarios: ventana y qué deja de poder hacerse en STEL | — |
| T1 | STEL deja de emitir cotizaciones, pedidos y remitos (acuerdo operativo; la API no tiene modo lectura) | Nadie crea documentos nuevos |
| T2 | Esperar operaciones en vuelo (documentos empezados en STEL) | Sin actividad en STEL |
| T3 | Leer la API: `dryrun` de E2 | 59 llamadas, sin errores |
| T4 | Últimos números reales por serie, incluidas RT-ML y los PDV11xxx | Anotados |
| T5 | Delta final STEL → React: `aplicar` con hash autorizado | 0 fallidos |
| T6 | Reconciliación: auditoría completa | 0 faltantes, 0 mismatch salvo excepciones aprobadas |
| T7 | Alinear secuencias de React (§ 11) | `next_number` > último de STEL en cada serie |
| T8 | Cambiar `document_numbering_authority` a ERP (los tres tipos, o por etapas según § 12) | Bitácora de autoridad registra el cambio |
| T9 | Smoke test controlado: cotización → pedido → remito → despacho en una empresa de prueba y un documento real chico | Números correlativos, stock correcto |
| T10 | Habilitar UI: no hace falta deploy (§ 13.1); los usuarios recargan | Botones activos, aviso STEL desaparecido |
| T11 | Monitoreo: primeros documentos, numeración, stock y cumplimiento | Sin duplicados ni huecos inesperados |

**Rollback del corte:** volver `document_numbering_authority` a STEL (la UI y la base vuelven a bloquear
solas) y, si ya se emitió algo en React, no reutilizar esos números en STEL.

## 11. Alineación de secuencias (cálculo, NO ejecutado)

Fórmula: `nextReact = max(currentReactNext, STELLast + 1, ReactHighest + 1)`, por serie y respetando su
formato, **sin reutilizar jamás un número emitido** y **sin bajar** una secuencia.

| Serie | React next hoy | STEL último | React mayor | **next mínimo seguro** | Nota |
|---|---|---|---|---|---|
| COTI (padding 5) | 2629 | COTI02555 | COTI02555 | **2629** (no se toca) | Queda por encima; los huecos 2556–2628 se conservan |
| PDV (padding 5) | 1316 | PDV01318 | PDV01318 | **1319** | Excluye los 9 PDV11xxx, que son numeración atípica del propio STEL |
| RT (padding 10) | 1424 | RT0000001432 | RT0000001432 | **1433** | |
| RT-ML | no existe | RT-ML2025000061 | (5 importados) | **62** si se decide emitir | Hoy IMPORT_ONLY |

Se recalcula en el momento del corte (T4/T7), no ahora: STEL sigue emitiendo.

## 12. Cutover progresivo — análisis

| Escenario | Qué pasa |
|---|---|
| Sólo cotizaciones en ERP | Una cotización emitida en el ERP **no existe** en STEL, así que su pedido no puede emitirse en STEL: el vendedor tendría que recrearla a mano allá. Rompe la cadena |
| Cotizaciones + pedidos en ERP, remitos en STEL | El remito de STEL necesita un pedido de STEL: mismo problema, y además el stock se movería en el ERP sin remito |
| Sólo remitos en ERP | Un remito del ERP necesita un pedido del ERP (`order_id`); los pedidos vivirían en STEL |

**Conclusión: los tres tipos se cambian en la misma ventana de freeze.** La autoridad por tipo sirve
igual, pero como **secuencia dentro del corte** (T8: quote → sales_order → delivery en minutos, para
hacer el smoke test en orden), no como etapas separadas por días. Excepción: si se decide que
MercadoLibre siga despachando en STEL, la serie RT-ML queda fuera y eso **sí** es doble autoridad sobre
remitos: hay que resolverlo antes (§ 8.1).

## 13. UI, roles y aviso

### 13.1 Botones de escritura

`useAutoridadNumeracion` lee `document_numbering_authority` del servidor (RPC `autoridad_numeracion_empresa`)
y de ahí salen: Nueva cotización, Nuevo pedido, Duplicar, Convertir a pedido, Crear remito y Confirmar y
despachar, más el aviso `AvisoAutoridadStel`. **No hay nada hardcodeado**: cuando la autoridad pase a ERP,
la UI se habilita sola y el aviso desaparece. Cache de 5 minutos (`staleTime`): en T10 alcanza con que la
persona recargue. **No hace falta deploy durante el freeze.**

### 13.2 Roles

Sin cambios de RLS ni de permisos. Verificado en esta entrega: admin y employee operan; salesperson,
technician, customer, distributor, anon y el admin de otra empresa no cancelan, no fuerzan estados y no
despachan (§ 14). La matriz completa de roles del workflow futuro sigue cubierta por la suite de E0.

### 13.3 Readiness por tipo de documento

| | Antes de E3 | Después de E3 | Falta para emitir | Estado |
|---|---|---|---|---|
| **QUOTES** | Moneda con default USD; una cotización podía guardarse sin moneda | Moneda obligatoria y sin default; regla de precio explícita; conversión a pedido sin `?? 'USD'` | Freeze (§ 10) · autoridad → ERP · secuencia ya alcanza (2629) · COTI02530 y COTI02452 decididos | **READY_WITH_FIXES** |
| **ORDERS** | Heredaban USD de la conversión | Moneda obligatoria y **igual** a la de su cotización (`DOCUMENT_CURRENCY_MISMATCH`) | Freeze · autoridad → ERP · secuencia PDV → **1319** | **READY_WITH_FIXES** |
| **DELIVERIES** | Cancelables después de despachar, con el stock ya descontado | Estados cerrados por trigger; líneas congeladas fuera de borrador; moneda igual a la del pedido | Freeze · autoridad → ERP · secuencia RT → **1433** · decisión RT-ML (§ 8.1) · flujo de devolución (§ 18.7) | **READY_WITH_FIXES** |

## 14. Tests

| Suite | Resultado |
|---|---|
| `scripts/fase14-e3-cutover-readiness-tests.mjs` (nueva) | **ALL PASS** — moneda (9 casos), remito (17), red team (7 roles × 4 vías), autoridad, limpieza |
| `scripts/fase14-stel-e2-tests.mjs` | ALL PASS |
| `scripts/fase14-stel-api-reconcile-fixture-tests.mjs` | ALL PASS |
| `scripts/fase14-ventas-cutover-fixture-tests.mjs` | TODO PASA (actualizada: sin moneda ya no guarda; cancelar despachado ahora bloquea) |
| `scripts/fase12-configuracion-entrega25-stel-guard-tests.mjs` | TODO PASA (los documentos del fixture ERP llevan moneda) |
| `lint` · `typecheck` · `test` (962) · `test:isolated` (962) · `build` | OK |

Unitarios nuevos: `lib/moneda.test.ts` (moneda obligatoria y regla de precio en otra moneda),
`autoridad.test.ts` (códigos de workflow → mensaje), `AccionesDocumento.test.tsx` (remito despachado sin
Cancelar ni Eliminar, con motivo; borrador sí).

Verificación en navegador (fixture zz, empresa con autoridad ERP): alta de cotización con moneda vacía,
obligatoria y con ayuda; remito despachado sin Cancelar ni Eliminar y con el motivo a la vista.

## 15. Migraciones y rollback

`fase14_e3_invariantes_remito_moneda` + correcciones `fase14_e3_moneda_documento_campos_por_tabla`
(PL/pgSQL resolvía `new.quote_id` en tablas que no lo tienen; lo detectó la suite E3) y
`fase14_e3_moneda_desmarcar_por_mantenimiento` (service_role puede desmarcar un histórico sin tocar su
moneda). SQL y rollback completos: `docs/database/PHASE_14_ENTREGA_3_INVARIANTES_REMITO_MONEDA.sql`.
Nada de esto cambia datos: sólo agrega una tabla de contexto, dos funciones de trigger y cuatro triggers,
y reemplaza `confirmar_entrega` por la misma función con el contexto alrededor del cambio de estado.

## 16. Datos productivos

Hash por tabla antes y después de todo E3 (Ventas, líneas, stock, movimientos, reservas, secuencias,
autoridad, productos y clientes): **idénticos**. 0 reservas, 0 eventos, 0 filas zz, contextos de
transacción vacíos. Las secuencias siguen en COTI 2629 / PDV 1316 / RT 1424 y la autoridad en STEL ×3.

## 17. Última lectura de STEL (7 llamadas)

| | Último | Nuevos desde E2 | Modificados desde E2 |
|---|---|---|---|
| Cotizaciones | **COTI02555** (2026-09-15 15:14 UTC) | 0 | 0 |
| Pedidos | **PDV01318** (15:14 UTC) | 0 | 0 |
| Remitos | **RT0000001432** (15:15 UTC) | 0 | 0 |

No se importó nada en E3.

## 18. Blockers que siguen

1. STEL sigue siendo la autoridad y sigue emitiendo: falta el freeze (§ 10).
2. Secuencias sin alinear (PDV → 1319, RT → 1433) — se hace en el corte.
3. Decisión RT-ML: import-only o serie propia en React (§ 8.1).
4. Excepciones abiertas: COTI02530, SP.2007VPM/80, SP.2008VP/100, COTI02452 y las 8 líneas.
5. Sync de productos y precios: diseñado, no implementado; falta decidir el mapeo de las 12 tarifas.
6. FX_POLICY = UNDEFINED: sin tipo de cambio no hay documentos con precios de otra moneda.
7. Flujo de devolución/reversión de un remito despachado (la cancelación quedó bloqueada a propósito).
8. Emisión concurrente durante la ventana: depende del acuerdo operativo del punto 1.

**CUTOVER_READY = NO.**
