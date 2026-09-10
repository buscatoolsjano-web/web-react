# Fase 7 · Mantenimiento — Entrega 1: el schema

Estado: **APLICADA**. Cinco migraciones sobre `uaxcfufvapzulqvynanp`.

**No se migró un solo dato.** Los 4 registros del legacy son de prueba y quedan
clasificados TEST / NON_PRODUCTION. Esto es una migración de **funcionalidad**.

**No se programó UI.** Las carpetas de `src/modules/mantenimiento/` siguen
vacías y la sección sigue en «Próximamente».

| | |
|---|---|
| SQL aplicado | [`docs/database/PHASE_7_MAINTENANCE.sql`](database/PHASE_7_MAINTENANCE.sql) |
| Suite | [`scripts/fase7-mantenimiento-schema-tests.mjs`](../scripts/fase7-mantenimiento-schema-tests.mjs) |
| Reglas y ERD | [`PHASE_7_MANTENIMIENTO_ENTREGA_1_REGLAS.md`](PHASE_7_MANTENIMIENTO_ENTREGA_1_REGLAS.md) |

Migraciones:

| # | nombre |
|---|---|
| 1 | `fase7_mantenimiento_tablas` |
| 2 | `fase7_mantenimiento_reglas` |
| 3 | `fase7_mantenimiento_rpc_y_rls` |
| 4 | `fase7_mantenimiento_endurecimiento_advisors` |
| 5 | `fase7_auditar_etapa_no_requerida_al_crear` |

Las dos últimas salieron de cosas que fallaron. Están en **J**.

---

## A · Tablas

**Ocho nuevas**, ninguna redundante:

| tabla | qué guarda |
|---|---|
| `maintenance_check_points` | los puntos de revisión, configurables por empresa |
| `maintenance_assets` | el equipo, con identidad propia (uuid + `EQ00001`) |
| `maintenance_orders` | la ficha de servicio (`OS00001`) |
| `maintenance_quote_lines` | lo que se le **cotiza** al cliente |
| `maintenance_order_parts` | lo que **realmente sale** del depósito |
| `maintenance_measurements` | las mediciones de torque, en filas variables |
| `maintenance_order_checks` | las 8 partes × 2 fases |
| `maintenance_audit` | el rastro, append-only |

**Tres cambios mínimos sobre lo existente**, ninguno reescribe datos:

1. `attachments_entity_type_check`: +2 valores, y las dos ramas nuevas en
   `attachments_select` —que ya estaba partida por tipo desde Compras—.
2. `stock_movements_movement_type_check`: **+1 valor**, `service_consumption`.
3. `document_sequences`: +2 filas por empresa (`EQ`, `OS`). Sin DDL.

**Lo que NO se creó:** catálogo de repuestos propio, maestro de clientes propio,
maestro de marcas, usuarios propios, `maintenance_order_steps`, cabecera de
cotización, tabla de mano de obra, `asset_serials`, sistema de archivos paralelo.

## B · Columnas, CHECKs y FKs

### El cliente, dos veces y por qué

| | `maintenance_assets.owner_customer_id` | `maintenance_orders.customer_id` |
|---|---|---|
| nulabilidad | **NULL permitido** | **NOT NULL** |
| significa | dueño **actual** | de quién era **al ingresar** |
| cambia | sí | **nunca** — lo bloquea un trigger |

Probado: se cambia el dueño del equipo, queda auditado como `owner_changed`, y
la orden **sigue con su cliente original**. Si el cliente viviera sólo en el
equipo, vender la herramienta reescribiría el historial.

### Las tres situaciones de una etapa salteable

Expresadas con columnas tipadas, sin JSONB y sin tabla genérica:

| situación | cómo se lee |
|---|---|
| **PENDIENTE** | `repair_required = true` y `repaired_at is null` |
| **COMPLETADA** | `repair_required = true` y `repaired_at is not null` |
| **NO REQUERIDA** | `repair_required = false` |

Dos CHECKs impiden los estados contradictorios:

```sql
chk_mo_repair_coherente:  repair_required or (repaired_at is null and stage <> 'repair')
chk_mo_torque_coherente:  torque_required or (torque_at is null and stage <> 'torque')
```

«No requerida **y** completada» no existe, y tampoco se puede marcar como no
requerida la etapa en la que se está parado. Probado: rechazo `23514`.

### Otros CHECKs

`status` ∈ open/closed/cancelled · `stage` ∈ las 5 · `quote_status` ∈
pending/approved/rejected · `service_type` ∈ corrective/preventive/general_review ·
`phase` ∈ diagnosis/repair · `result` ∈ ok/nok/na · `line_type` ∈
labour/part/freight/diagnosis/other · fechas coherentes · rango de torque
coherente · `max_value >= min_value` · **y `chk_mop_consumo`: o están
`consumed_at` y `stock_movement_id`, o no está ninguno**.

`stock_movement_id` es **bigint**, no uuid: `stock_movements.id` es `bigserial`.
Lo detecté verificando antes de ejecutar.

### Índices

`idx_ma_serial` (parcial, **no único**) · `idx_ma_customer` · `idx_ma_product` ·
`idx_ma_vivos` · `idx_mo_fecha` · `idx_mo_asset` · `idx_mo_customer` ·
`idx_mo_abiertas` (parcial) · `idx_mql_order` · `idx_mop_order` ·
`idx_mop_pend` (parcial) · `idx_mm_order` · `idx_moc_order` ·
`idx_mau_entity` · `idx_mau_company`.

## C · Funciones y triggers

| objeto | qué hace |
|---|---|
| `app.sellar_autor_mantenimiento()` | el autor lo pone el servidor y no se borra |
| `app.validar_equipo_mantenimiento()` | cliente y serial entregado, de la misma empresa |
| `app.validar_orden_mantenimiento()` | equipo y cliente de la misma empresa |
| `app.etapas_requeridas(repair, torque)` | la secuencia, salteando las no requeridas |
| `app.validar_etapa_mantenimiento()` | adelante de a una, atrás libre, sólo si está abierta |
| `app.proteger_orden_mantenimiento()` | congelado, número inmutable, **cliente inmutable**, y las dos puertas de estado |
| `app.proteger_mediciones_mantenimiento()` | no se puede vaciar el torque ya completado |
| `app.proteger_lineas_mantenimiento()` | las líneas de una orden no abierta no se tocan |
| `app.proteger_consumo_mantenimiento()` | `consumed_at` **sólo desde su función** |
| `app.proteger_consumo_borrado()` | un repuesto consumido no se borra |
| `app.totales_cotizacion_mant()` + `recalcular` + `empujar` | totales server-side |
| `app.auditar_orden_mantenimiento()` / `..._equipo_...` | sólo eventos de negocio |
| `public.capacidad_torque(order)` | **STABLE**: Cp, Cpk, CV y veredicto |
| `public.duplicados_de_serial(company, serial, excluir)` | **STABLE**: avisa, no bloquea |
| `public.confirmar_consumo_mantenimiento(order)` | el consumo, con stock |
| `public.cerrar_orden_mantenimiento(order)` | las 12 validaciones |
| `public.cancelar_orden_mantenimiento(order, motivo)` | la salida sin requisitos |

## D · RLS

Las 8 tablas con `enable` **y** `force`. Lectura por
`app.current_maintenance_company_ids()`, escritura por
`app.current_maintenance_writer_ids()`: hoy las dos devuelven **admin +
employee**.

`technician` **no entra en v1**, como decidiste: el rol existe en el CHECK de
`company_memberships` y tiene 0 miembros, y el legacy trataba igual a los seis
de su lista blanca, así que no hay evidencia de un rol acotado. Habilitarlo es
una línea en el helper de lectura.

`maintenance_audit` es **sólo SELECT**: se escribe desde triggers
`SECURITY DEFINER`. Probado: escribirla a mano da `42501`.

Matriz verificada con JWT real:

| rol | 8 tablas | por id / número / serie | las 3 RPC | adjuntos |
|---|---|---|---|---|
| admin / employee | su empresa | sí | sí | sí |
| salesperson (en su empresa) | no puede escribir (`23514`) | — | — | — |
| customer | **0** | **0** | rechazan | **0** |
| distributor | **0** | **0** | rechazan | **0** |
| anon | **0** | — | **las 5 rechazan** | — |

## E · Reglas de cierre

Cerrar es sólo por `cerrar_orden_mantenimiento()`. Un `UPDATE` directo da
`23001`. Las 12, probadas una por una:

| # | condición | probado |
|---|---|---|
| 1 | no se cierra dos veces | idempotente: `ya_estaba: true` |
| 2 | permiso admin/employee, **antes del atajo** | ✔ |
| 3 | `stage = 'closing'` | *«La orden está en la etapa diagnosis»* |
| 4 | diagnóstico completado | *«Falta completar el diagnóstico»* |
| 5 | **cotización resuelta** | *«La cotización sigue pendiente»* |
| 6 | aprobada → al menos una línea | ✔ |
| 7 | reparación completada o no requerida | *«Falta completar la reparación, o marcarla como no requerida»* |
| 8 | torque completado o no requerido | ✔ |
| 9 | si el torque aplica, al menos una medición | ✔ |
| 10 | fecha de entrega | *«Falta la fecha de entrega»* |
| 11 | entrega ≥ ingreso | CHECK + validación |
| 12 | ningún repuesto sin consumir | rechazo `23514` |

La #5 es la que ataca el bug medido: **2 de las 3 fichas reales del legacy se
cerraron con la cotización PENDIENTE**.

**Cancelar no valida nada**, como acordamos — salvo que ya se haya movido
stock: ahí no se cancela, se cierra.

## F · Torque

Se guarda **sólo lo que el legacy demuestra**: `torque_lsl`, `torque_nominal`,
`torque_usl` y N filas `{min, max, target}` en `numeric`. Sin unidad, sin
instrumento, sin técnico ni fecha por medición.

`capacidad_torque()` **deriva** promedio, desvío, Cp, **Cpk**, CV y el
veredicto con los mismos umbrales del legacy (≥1.33 capaz · ≥1.00 aceptable ·
<1.00 no capaz). **No se guarda ninguno**: una medición corregida no puede
dejar un Cpk viejo pegado.

Probado con 5 mediciones alrededor de 10 Nm y límites 9–11: **Cpk 4.2164 ·
veredicto «capaz»**.

Dos invariantes que el legacy no tiene:
- dar el torque por completado **sin ninguna medición**: rechazado;
- **vaciar las mediciones** de un torque ya completado: rechazado.

## G · Stock

```
agregar repuesto      →  NO mueve stock   (medido: 381 = 381)
cotizar               →  NO mueve stock
confirmar el consumo  →  1 movimiento por línea, negativo
cerrar la orden       →  NO mueve stock (ya se consumió)
```

`movement_type = 'service_consumption'`, `source_type = 'maintenance_order'`.
Ninguno de los 8 tipos que existían servía.

**La puerta:** marcar `consumed_at` con un `UPDATE` directo da **`23001`**. Sin
eso, un repuesto quedaría «consumido» sin movimiento — el agujero de recepciones.

**Saldo negativo: permitido**, y es lo que el schema ya hacía:
`stock_balances` no tiene restricción de no-negatividad sobre `on_hand` —sólo
`reserved >= 0`— y el trigger suma con signo. La reparación ya ocurrió; negarse
a registrarla haría que el sistema mienta. **Anotado en el backlog** como
política a revisar.

## H · Concurrencia e idempotencia

- **20 números en paralelo → 20 distintos**, sin huecos ni repetidos.
- `confirmar_consumo_mantenimiento` **dos veces**: `ya_estaba: true`, y el saldo
  no baja de nuevo.
- `cerrar_orden_mantenimiento` **dos veces**: `ya_estaba: true`.
- `FOR UPDATE` sobre la orden y sobre las líneas pendientes, ordenadas por id.
- El permiso va **antes** del atajo de idempotencia en las tres RPC.

## I · Tests

`scripts/fase7-mantenimiento-schema-tests.mjs`, **14 secciones, 0 fallos**:
numeración · serial · empresa cruzada · cliente congelado · etapas · totales ·
torque · puntos de revisión · repuestos y stock · las 12 del cierre ·
cancelación · auditoría · adjuntos · RLS · limpieza.

Cada prohibición con **intento real y efecto medido**, no sólo el código.

## J · Bugs encontrados

### 1 · `stock_movements.id` es bigint, no uuid

Detectado **verificando antes de ejecutar**, no después. Mi borrador declaraba
`stock_movement_id uuid`. Corregido antes de aplicar.

### 2 · `document_sequences` tiene columnas que no había mirado

La primera migración falló: `prefix` es NOT NULL y hay `padding` e `is_default`.
Como la migración es atómica **no quedó nada a medias** —verifiqué 0 tablas
creadas— y se reaplicó completa.

### 3 · `revoke … from anon` no alcanza

Las tres RPC seguían siendo ejecutables por `anon` después del `revoke`. El
motivo: Postgres otorga `EXECUTE` a **PUBLIC** al crear la función, y `anon`
hereda de PUBLIC. Hay que revocarle a PUBLIC. Corregido y verificado: las cinco
funciones dan `false` para `anon` y `true` para `authenticated`.

> **Vale la pena mirar si esto pasa en otros módulos.** Acá lo agarró el
> advisor de Supabase; en Compras el advisor no las marca, así que ahí el
> revoke sí tomó — pero conviene revisarlo cuando toquemos esas migraciones.

### 4 · `app.etapas_requeridas` sin `search_path` fijo

Marcado por el advisor. Es IMMUTABLE y no toca tablas, pero se corrigió igual:
una función sin `search_path` fijo es un punto de entrada para el secuestro de
schema.

### 5 · «No requerida» al crear no quedaba auditada

El trigger sólo detectaba la transición `true → false`. Una orden que **nace**
con la reparación no requerida no dejaba evento, y entonces la única forma de
saber por qué se salteó una etapa era deducirlo de un booleano — justo lo que
pediste evitar. Corregido: ahora también audita al insertar.

### 6 · Tres bugs en mi propia suite

La orden no avanzaba de etapa (el primer salto era de dos y la suite no miraba
el error), y la limpieza borraba el movimiento de stock **antes** que el
repuesto que lo referencia, así que el `DELETE` fallaba por la FK en silencio y
dejaba 2 movimientos huérfanos. Corregidos, y los 2 residuales limpiados a mano.

### 7 · Hallazgo AJENO: `delivery_serials` tiene la RLS mal

**No lo toqué** porque es de Ventas, pero hay que decirlo. Su política de
lectura es:

```sql
EXISTS (SELECT 1 FROM delivery_lines dl
         WHERE dl.id = delivery_serials.delivery_line_id
           AND dl.company_id = delivery_serials.company_id)
```

Eso compara la línea con **su propia** empresa, no con las del usuario: es
efectivamente `true` para cualquier fila bien formada. Con `authenticated`
teniendo `SELECT`, **cualquier usuario logueado vería todos los seriales de
todas las empresas**.

Hoy es inofensivo —la tabla tiene **0 filas**— pero filtraría en cuanto Ventas
empiece a registrar seriales. El arreglo es una línea:
`company_id in (select unnest(app.current_internal_company_ids()))`.

**Decisión tuya:** lo dejo anotado, o lo corrijo en una migración aparte.

## K · Regresión

| | |
|---|---|
| Suites de base | **17 / 17**, 0 FAIL (16 previas + la nueva) |
| Tests unitarios | 436 en 40 archivos |
| lint · build | limpios |

### Invariantes

| | esperado | medido |
|---|---|---|
| equipos / órdenes / líneas / repuestos / mediciones / checks / auditoría de mant. | 0 | **0** |
| puntos de revisión sembrados | 16 (8 × 2 empresas) | **16** |
| suppliers | 142 | **142** |
| customers | 1010 | **1010** |
| stock_movements | 381 | **381** |
| stock_balances | 379 | **379** |
| purchases_audit | 0 | **0** |
| cotizaciones / pedidos / entregas históricas | 288 / 166 / 182 | **288 / 166 / 182** |
| huella md5 de Ventas | `8091b916…` | **intacta** |

## L · CI / deploy

El frontend **no cambió**: no se programó UI. Igual se corrieron lint, tests y
build para confirmar que nada se rompió. El commit lleva SQL, la suite y estos
documentos.

`database.types.ts` **no se regeneró todavía**: no hay código que use las tablas
nuevas y regenerarlo ahora sería adelantar trabajo de la entrega 2.

---

## Lo que queda abierto

1. **`delivery_serials`** (J‑7): ¿lo corrijo o queda anotado?
2. **Política de stock negativo** en Mantenimiento: hoy permitido, al backlog.
3. **Unidad e instrumento** en el torque: funcionalidad nueva, sin decidir.
4. **Impuestos** en la cotización de reparación: funcionalidad nueva, sin decidir.
5. **`technician`**: cuando exista alguien con ese rol, una línea en el helper.
