# Fase 10 · Informes — Entrega 2: pipeline, conversión, cumplimiento y ticket

Fecha: **2026-09-13**. Base: Supabase `uaxcfufvapzulqvynanp`.

Agrega a `/informes`, debajo de la actividad comercial de la Entrega 1:
**pipeline** (cotizaciones abiertas, pedidos pendientes, entregado),
**conversión real cotización → pedido**, **cumplimiento de pedidos** contra
remitos y **ticket promedio**, todo por moneda y sin conversión.

SQL: [`docs/database/PHASE_10_INFORMES_ENTREGA_2.sql`](database/PHASE_10_INFORMES_ENTREGA_2.sql) ·
pruebas de base: `scripts/fase10-informes-entrega2-tests.mjs` ·
antecedentes: [Entrega 0](PHASE_10_INFORMES_ENTREGA_0_AUDITORIA.md), [Entrega 1](PHASE_10_INFORMES_ENTREGA_1.md).

**Sin tablas, columnas, vistas, índices ni cambios de RLS. Ventas no se tocó.**
Una función nueva de lectura: `public.informe_pipeline_comercial` (migración
`fase10_informes_entrega2_pipeline`).

---

## 0 · Auditoría previa (medida antes de programar)

| qué | medido | consecuencia |
|---|---|---|
| estados de cotización | `sent` 154 · `accepted` 134 · `draft`/`rejected`/`expired` **0** | ninguna vence sola: `valid_until` vacío en las 288 |
| convertir a pedido | `convertirCotizacionEnPedido` **no cambia el estado** de la cotización; sólo bloquea `rejected` | «aceptada» ≠ convertida |
| vínculo | `sales_orders.quote_id` (FK) + índice único parcial `(company_id, quote_id)`: hoy **1 pedido por cotización**, 0 con varios | se cuenta igual con `exists` (COUNT DISTINCT de cotización), por si cambia |
| convertidas | **132** cotizaciones con pedido confirmado · 134 aceptadas · 2 aceptadas sin pedido · 0 enviadas con pedido | |
| días cotización → pedido | mediana **8** · p90 **53** · máximo 140 · 0 pedidos antes de su cotización | las recientes todavía pueden convertirse: se muestran «abiertas» |
| moneda cotización ≠ pedido | **1**: COTI02339 (ARS 4.791.600) → PDV01223 (USD 3.497,87), ambos históricos | inconsistencia histórica: se reporta, **no se corrige ni se altera**, no se convierte |
| `fulfillment_status` | 140 `delivered` · 26 `pending` | **no sirve solo**: 12 de los `delivered` tienen líneas sin entregar |
| helper existente | `app.derivar_cumplimiento`: entregado = remitos `shipped`/`delivered`, líneas ≠ `chapter` | misma definición de entregado |
| regla de Stage 2.5 | `src/modules/ventas/lib/pendientes.ts` (`RECONSTRUIDO` / `NO_CONSTA_ENTREGA` / `DETALLE_NO_RECONSTRUIDO`) | replicada en SQL, sin cambiarla |
| unidades | 593 líneas · 1.604.229 unidades pedidas; **una línea (GRAMPA.80-4T, PDV01279) = 1.585.000 = 98,8 %** | sin porcentaje por unidades |
| totales de pedidos | **31 de 166** no cierran con `app.totales_pedido` sobre sus líneas | el ticket usa el total guardado; el pendiente sale de las líneas |
| documentos con total 0 | 10 (3 cot, 2 ped, 5 remitos), p. ej. PDV01284 ARS `NO_EXCHANGE_RATE` | entran al ticket tal cual (no se recalcula el histórico) |

## A · Pipeline

**No es un embudo.** Tres etapas con datos reales que no se restan entre sí:

| etapa | cuándo | regla |
|---|---|---|
| **Cotizaciones abiertas** | **hoy** | `status in ('sent','accepted')` **sin pedido confirmado** enlazado. Un pedido en borrador o cancelado no la cierra. `draft`, `rejected`, `expired` no son abiertas. Por antigüedad desde la fecha del documento: hasta 30 días · 31–90 · más de 90 |
| **Pedidos pendientes de completar** | **hoy** | pedidos confirmados en categoría `sin_entrega` o `parcial` (ver D). Importe pendiente por moneda del pedido |
| **Entregado** | período elegido | igual que la Entrega 1: remitos `shipped`/`delivered`. No es facturado |

La antigüedad importa porque nada vence: de las 156 abiertas, 89 tienen más de
90 días.

## B · Conversión

**Convertida = cotización con al menos un pedido `confirmed` con `quote_id` a
ella.** No el estado `accepted` (el bug del legacy): hoy hay 134 aceptadas y 132
con pedido.

- **Cohorte:** cotizaciones con **fecha del documento** en el tramo (actual,
  anterior, 12 meses). Nunca la fecha del pedido.
- **Estado de hoy:** una cotización de agosto convertida en septiembre cuenta
  como convertida al mirar agosto.
- **Por moneda de la cotización**, con importe cotizado y convertido. Una fila
  **TODAS sólo con cantidades** (sumar importes de monedas distintas sería inventar).
- **Abiertas** del tramo a la vista: las del mes en curso todavía pueden convertirse.
- Pedidos en borrador o cancelados **no** convierten.

## C · Denominador

**Elegido: `status <> 'draft'`** — todas las emitidas del tramo, **incluidas
rechazadas y vencidas**.

| opción | conjunto | medido (12 meses) |
|---|---|---|
| A · emitidas no draft | `status <> 'draft'` | 288 |
| B · todas salvo draft | `status <> 'draft'` | 288 |
| C · sent/accepted/rejected/expired | por el CHECK de la tabla, el mismo conjunto | 288 |
| (descartada) sin rechazadas/vencidas | `sent`/`accepted` | 288 hoy; **inflaría la tasa** en cuanto existan rechazos |
| (descartada) con borradores | todo | 288 hoy; un borrador abandonado **no es una oportunidad** emitida |

Las tres opciones pedidas describen el mismo conjunto por el `CHECK` de
`sales_quotes.status`. Se elige excluir borradores (no llegaron al cliente) y
**mantener rechazadas y vencidas** (son pérdidas reales). Si un pedido sale de
una cotización en borrador (Ventas lo permite), queda fuera del denominador y se
reporta como inconsistencia `convertida_desde_borrador` (hoy **0**).

## D · Cumplimiento

Cada pedido confirmado contra lo entregado en **remitos confirmados**
(`shipped`/`delivered`), **línea por línea** (`delivery_lines.order_line_id`),
líneas ≠ `chapter`. Precedencia:

| categoría | regla | con evidencia |
|---|---|---|
| `no_consta_entrega` | sin remitos enlazados **y** el cliente tiene un remito confirmado sin pedido | **no** |
| `detalle_no_reconstruido` | alguna línea de sus remitos sin `order_line_id` | **no** |
| `sin_lineas` | pedido sin líneas | **no** |
| `sin_entrega` | nada entregado, sin remitos sueltos del cliente | sí |
| `sobreentregado` | ninguna línea pendiente y alguna con más de lo pedido | sí |
| `completo` | cada línea con entregado ≥ pedido, sin exceso | sí |
| `parcial` | alguna línea pendiente y algo entregado (si otra línea tiene exceso, sigue siendo parcial) | sí |

- **Porcentaje:** `(completo + sobreentregado) / (completo + parcial + sin_entrega + sobreentregado)`.
  **Se calcula sólo sobre los pedidos con evidencia determinable** (las cuatro
  categorías con evidencia). Los no determinables (`no_consta_entrega`,
  `detalle_no_reconstruido`, `sin_lineas`) **no están ni en el numerador ni en
  el denominador**. Hoy: 114 de 131 = 87,0 %, no 114 de 166.
- **Cohorte:** pedidos con fecha en el tramo, según lo entregado **hoy**.
- **Diferencia con Ventas:** un remito en **borrador o cancelado** no cuenta ni
  como entrega ni como «remito suelto del cliente». La pantalla de pedido de
  Ventas cuenta remitos de cualquier estado (ver L); hoy no hay ninguno, así que
  no hay diferencia en los números.

**Unidades:** no se muestra porcentaje por cantidad. Mezcla productos distintos
y una sola línea (1.585.000 unidades de GRAMPA.80-4T, entregadas completas) es el
98,8 % de lo pedido: el porcentaje sería ~100 % diga lo que diga el resto.
Detectado y documentado; no se excluyó en silencio.

## E · No determinables

`no_consta_entrega`, `detalle_no_reconstruido` y `sin_lineas`:

- se **cuentan y se muestran** en su propio grupo («Sin evidencia · no determinable»);
- **no entran** al porcentaje de completos;
- **no suman importe pendiente**: no se sabe qué falta;
- **nunca** se muestran como «0 % entregado».

**Importe pendiente** (sólo `sin_entrega` y `parcial`):
`Σ max(pedido − entregado, 0) × unit_price × (1 − dto línea) × (1 − dto cabecera)`,
**neto de impuestos**, a precio del pedido (nunca catálogo), por moneda del pedido.

## F · Ticket promedio

`Σ total / cantidad de documentos`, **por moneda**, sobre el **mismo conjunto de
documentos que la Entrega 1** (el total guardado, sin recalcular históricos):

- **Pedido confirmado** y **entregado**. El ticket cotizado no se muestra: sería
  una tercera tabla sobre el dato menos cerrado (cotizaciones que no se ganaron).
- Tramo actual, anterior y 12 meses. Sin documentos → «—», nunca 0.
- Se deriva de `informe_actividad_comercial` (sumas y conteos ya agregados por
  el servidor): la regla de qué documento entra no se duplica en otra función.
  12 meses = suma de los 12 meses de la serie.
- Promedio y mediana difieren mucho (USD pedidos 12 meses: promedio 2.648,82 ·
  mediana 884,82): se muestra el promedio pedido, con la cantidad de documentos al lado.

## G · Monedas

ARS · USD · EUR · otras · **SIN MONEDA** en fila propia; nunca un total general
de importes. La única fila entre monedas es **TODAS** en conversión y contiene
**sólo cantidades**. La conversión con moneda distinta cuenta en la moneda de la
cotización y se avisa.

## H · Seguridad

| control | resultado |
|---|---|
| rol | `app.current_role(p_company) in ('admin','employee')` antes de leer; si no, `sin_permiso` (42501) |
| `SECURITY INVOKER` | sí (`prosecdef = false`): la RLS de cada tabla sigue aplicando; no hizo falta DEFINER |
| multiempresa | `p_company` se valida contra la membresía del JWT; admin de otra empresa → `sin_permiso` |
| grants | `revoke all from public, anon` · `grant execute to authenticated`. ACL medida: `postgres`, `authenticated`, `service_role` |
| `search_path` | `public, pg_temp` |
| `STABLE`, sólo lectura | sí |
| advisors (security) | la función **no aparece**; los hallazgos listados son previos |
| JWT reales | admin y employee leen; salesperson, technician, customer, distributor, admin ajeno, empresa nula → `sin_permiso`; anon → 42501 |

## I · Performance

| medición | resultado |
|---|---|
| RPC, suite (5 llamadas, con red, Buscatools) | mediana **225 ms** · máx 252 ms · 47 filas · 10.764 B |
| RPC en el navegador, cambio de mes (6 meses) | **204–265 ms** por RPC; una de 443 ms |
| pantalla completa al cambiar de mes (las dos RPC en paralelo) | **230–294 ms**; una de 486 ms |
| primera llamada en frío | ~1 s (una vez: 2,9 s en la RPC de la Entrega 1) |
| piso de red de referencia | ~190 ms |

No supera 500 ms de forma consistente: **sin EXPLAIN ni índices nuevos**. La
latencia medida está a ~35 ms del piso de red.

## J · Mobile y accesibilidad

| ancho | resultado |
|---|---|
| 390 (táctil) | sin desborde global; 0 controles < 44 px; 0 campos < 16 px; tablas en bloques |
| 430 (táctil) | ídem |
| 768 | sin desborde; las tablas de tres períodos pasan a bloques por **container query** (la tarjeta mide ~430 px por la barra lateral); 0 tablas con scroll |
| 1440 | etapas del pipeline en una fila (3 × 371 px); tablas completas; 0 scroll interno |

- Tasas siempre con texto: «132 de 288 · 45,8 %»; nada comunicado sólo por color.
- Tablas con `caption`, `th scope="col"/"row"`, grupos en `tbody` con `th scope="rowgroup"`.
- Sin tooltips: el criterio está escrito en cada sección y en «Cómo se calcula».

## K · Datos reales (Buscatools, 2026-09-13)

**Cotizaciones abiertas hoy: 156**

| moneda | cot. | importe | ≤ 30 d | 31–90 | > 90 | aceptadas sin pedido |
|---|---:|---:|---:|---:|---:|---:|
| ARS | 25 | 30.853.167,19 | 7 | 9 | 9 | 0 |
| USD | 124 | 1.046.990,99 | 19 | 26 | 79 | 2 |
| EUR | 1 | 6.711,81 | 0 | 0 | 1 | 0 |
| SIN MONEDA | 6 | 80.668,25 | 6 | 0 | 0 | 0 |

**Conversión**

| tramo | todas | ARS | USD | EUR | SIN MONEDA |
|---|---|---|---|---|---|
| 1–13 sep 2026 | 0 de 14 · 0 % (14 abiertas) | 0 de 1 | 0 de 7 | — | 0 de 6 |
| 1–13 ago 2026 | 7 de 16 · 43,8 % | 2 de 5 | 5 de 11 | — | — |
| 12 meses | **132 de 288 · 45,8 %** (156 abiertas) | 23 de 48 · 47,9 % | 109 de 233 · 46,8 % | 0 de 1 | 0 de 6 |

12 meses, importe: ARS 29.309.053,03 de 60.162.220,22 · USD 315.741,02 de
1.362.732,01. Inconsistencias: moneda distinta **1**, desde borrador **0**.

**Cumplimiento de los 166 pedidos confirmados**

| categoría | pedidos |
|---|---:|
| completos | 112 |
| parciales | 12 |
| sin entrega | 5 |
| sobreentregados | 2 |
| **con evidencia determinable** | **131** → completos 114 de 131 = **87,0 %** (denominador: sólo estos 131) |
| no consta entrega | 21 |
| detalle no reconstruido | 14 |
| sin líneas | 0 |

El 87,0 % se calcula **sólo sobre los 131 pedidos con evidencia determinable**.
Los 35 no determinables quedan fuera del porcentaje: sobre los 166 daría 68,7 %,
que trataría 35 pedidos sin evidencia como no completos.

Coincide con Stage 2.5: 126 reconstruidos (112 + 12 + 2), 5 limpios sin entrega,
21 dudosos, 14 sin detalle. Los 12 parciales tienen `fulfillment_status =
'delivered'` heredado del legacy.

**Pedidos pendientes hoy** (neto, a precio del pedido): USD 11.045,15 (3 sin
entrega + 12 parciales) · SIN MONEDA 1.203,20 (2 sin entrega). Además 35 sin
evidencia, sin importe.

**Ticket promedio, 12 meses**

| moneda | pedido confirmado | entregado |
|---|---|---|
| ARS | 1.331.373,48 (27) | 1.269.530,70 (29) |
| USD | 2.648,82 (128) | 2.562,34 (138) |
| SIN MONEDA | 8.030,14 (11) | 866.438,05 (15) |

## L · Bugs

### Del legacy (confirmados con datos)

1. **Conversión por estado**: 134 aceptadas vs 132 con pedido; el legacy medía la primera.
2. **Pendientes por estado**: 12 pedidos `delivered` con líneas sin entregar.
3. **Sin ticket promedio ni cumplimiento**: no existían.

### Encontrados en la Entrega 2 (no corregidos: Ventas no se toca)

1. **Ventas · pendientes cuenta remitos de cualquier estado.**
   `evidenciaDeEntrega` (`src/modules/ventas/services/relacionados.ts`) no filtra
   `status`: un remito en borrador o cancelado contaría como entregado en la
   pantalla del pedido, y un remito suelto en borrador volvería «dudoso» a otro
   pedido del cliente. **Latente:** hoy hay 0 remitos en borrador o cancelados.
   Informes usa sólo remitos confirmados.
2. **Ventas · convertir desde borrador y moneda por defecto.**
   `convertirCotizacionEnPedido` sólo bloquea `rejected` (un borrador se puede
   convertir) y usa `USD` si la cotización no tiene moneda. **Latente:** 0 casos
   hoy. Informes lo reporta como inconsistencia.
3. **Datos · inconsistencia histórica:** COTI02339 (ARS 4.791.600, `accepted`,
   importada) → PDV01223 (USD 3.497,87, importado). La cotización está marcada
   `needs_review = true`; **el pedido no** (`needs_review = false`). **No se
   corrigió ni se alteró** (último `updated_at` de ambos: 2026-09-09, la
   migración; la suite verifica la misma huella antes y después). En Informes
   cuenta como convertida en ARS, la moneda de la cotización, y se avisa como
   `moneda_distinta`.
4. **Datos:** 31 de 166 pedidos con total guardado distinto del cálculo de sus
   líneas; 10 documentos con total 0.

### Errores propios (tests, scripts, UI) — corregidos antes del commit

1. Test unitario: `857309.1812999999` al re-sumar antigüedades en punto flotante → `redondear4`.
2. Nombre `PipelineComercial` usado para el tipo y el componente → el componente pasó a `EtapasPipeline`.
3. Texto «2 aceptadas que todavía no **tiene** pedido» → concordancia.
4. A 768 px dos tablas necesitaban scroll interno (535 px en 431) → container query.
5. Expectativas de la suite de base contadas a mano mal (6 elegibles USD en vez de 5) → corregidas antes de la primera corrida.

## M · Tests

| suite | resultado |
|---|---|
| `scripts/fase10-informes-entrega2-tests.mjs` | **43 PASS · 0 fallos** |
| `scripts/fase10-informes-entrega1-tests.mjs` (regresión) | **0 fallos** · paridad 73 filas |
| `npm run lint` | 0 errores |
| `npm run typecheck` | 0 errores |
| `npm test` | 53 archivos · **633** tests |
| `npm run test:isolated` | 53 archivos · **633** tests |
| `npm run build` | OK · `InformesPage` 33,80 kB JS (8,78 kB gzip) + 9,44 kB CSS |

La suite de base cubre:

- **Fixtures** en empresas `zz-inf2-*`, borradas al final (0 empresas, 0 usuarios).
- **Roles:** los 7 roles, anon y empresa nula.
- **Mes en curso:** 40 filas exactas contra la regla calculada en JS aparte del
  SQL; tramos; día 1; aceptada sin pedido; rechazada; vencida; pedido en borrador
  o cancelado; moneda distinta; conversión desde borrador; fuera de 12 meses.
- **Cumplimiento:** las 7 categorías; remito en borrador; sobreentrega (armada
  reactivando un remito cancelado, porque el trigger impide entregar de más);
  pendiente con descuento de línea y de cabecera.
- **Otros meses:** mes pasado (26 filas) y mes futuro rechazado.
- **Paridad con Buscatools:** 44 filas del mes en curso y 44 del anterior,
  contra filas crudas de las tablas.
- **Casos de Stage 2.5:** PDV01151 completo, PDV01264 sin entrega, PDV01193 no
  consta entrega, PDV01182 detalle no reconstruido, PDV01181 y PDV01238 sobreentregados.
- **Base intacta:** 288 / 166 / 182 documentos y 593 / 600 líneas, con la misma
  huella sha256 (id, total, estados, `updated_at`, cantidades) antes y después.

Unitarios nuevos (`lib/pipeline.test.ts`, 14): tasa y denominador, aceptada ≠
convertida, TODAS sin importes, sin elegibles → sin tasa, inconsistencias, no
determinables fuera del porcentaje, tramo sólo con no determinables, ceros,
pendiente por moneda, antigüedad, etiqueta de 12 meses, ticket por moneda y sin
documentos.

## N · Limitaciones

1. **Estado de hoy**, no histórico: conversión y cumplimiento de un mes pasado
   usan lo que pasó después; cotizaciones abiertas y pendientes no se pueden ver
   «al cierre» de un mes (no hay historial de estados).
2. `no_consta_entrega` aplica la regla de Stage 2.5 a cualquier pedido: un pedido
   nuevo de un cliente con remitos sueltos del legacy queda como no determinable
   hasta tener su propio remito.
3. Pendiente **neto de impuestos** (el ticket y la Entrega 1 son con impuestos):
   rotulado en pantalla. En los 31 pedidos cuyo total no cierra con sus líneas, el
   pendiente puede no ser proporcional al total.
4. Sin enlaces a Ventas en esta entrega: los filtros existentes (`estado`,
   `revision`, fechas) no expresan «abiertas sin pedido» ni las categorías de
   cumplimiento; un enlace más amplio confundiría.
5. Sin porcentaje por unidades (outlier GRAMPA.80-4T, 98,8 % de las unidades).
6. Sin rankings, CSV, stock, compras, mantenimiento, margen, facturación,
   cobranzas, vendedor ni rubro (fuera de alcance).
7. `MIGRATION_STATUS.md` no se actualizó (desactualizado desde la fase 3.5).
