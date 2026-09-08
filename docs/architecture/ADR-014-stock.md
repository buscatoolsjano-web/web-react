# ADR-014 — Arquitectura de stock

**Estado:** Propuesta · **Fecha:** 2026-09-08 · **Fase:** 2

## Contexto

El legacy resuelve el stock así:

```js
function getEffectiveStock(p, kind){        // kind = 'sr' (real) | 'sv' (virtual)
  const base = p[kind];                      // valor del catálogo
  const delta = loadStockDeltas()[p.sku];    // ajuste en localStorage
  return base + delta;
}
```

Problemas concretos:

- El saldo depende de un **delta en `localStorage`**: distinto por
  dispositivo, y se pierde al limpiar el navegador.
- El kardex **se trunca**: `if (k.length > 5000) k.splice(5000)`.
- `sr` y `sv` no tienen definición clara. "Virtual" mezcla reservado con
  proyectado, y nadie puede explicar el número.
- Un solo depósito implícito.

**Dato medido:** de 21.772 productos, **sólo 378 tienen stock > 0**.

## Decisión

**Movimientos como fuente de verdad + saldo persistido por trigger.**

```
warehouses
stock_movements    -- append-only, bigint. La verdad.
stock_balances     -- (product_id, warehouse_id) → on_hand, reserved
stock_reservations
```

- `stock_movements` **no acepta `UPDATE` ni `DELETE`** para ningún rol,
  incluido admin. Corregir un movimiento = crear el contramovimiento.
- `stock_balances` **sólo lo escribe el trigger**. Nunca la aplicación.
- Cada movimiento guarda `source_type` + `source_id`: qué documento lo
  originó.

**Definiciones explícitas**, que el legacy no tiene:

```
disponible = on_hand - reserved
proyectado = disponible + (recepciones de compra confirmadas y pendientes)
```

Las **reservas no son movimientos**: viven en `stock_reservations` y
afectan `reserved`, no `on_hand`.

### Tipos de movimiento

`purchase_receipt · sale_delivery · adjustment · transfer_in ·
transfer_out · return_in · return_out · opening_balance ·
production_in · production_out`

## Alternativas

| Alternativa | Ventaja | Desventaja | Veredicto |
|---|---|---|---|
| `products.stock` como número | Lectura trivial | Sin historial, sin trazabilidad, condición de carrera. **Es el legacy** | ❌ |
| Saldo calculado con `SUM()` al vuelo | Siempre consistente | `SUM()` sobre millones de filas en cada listado | ❌ |
| Vista materializada | Consulta rápida | Refresco periódico = saldo desactualizado. Inaceptable para stock | ❌ |
| **Movimientos + saldo por trigger** | Lectura O(1), consistente en la misma transacción | El trigger tiene que ser correcto | ✅ |

## Ventajas

- Trazabilidad completa: cada unidad tiene su documento y su responsable.
- Lectura O(1) para listados de catálogo.
- Múltiples depósitos desde el día uno.
- Reservado, disponible y proyectado con significados distintos y
  verificables.
- **`stock_balances` arranca con ~378 filas**, no con 21.772: es diminuta.

## Desventajas

- Un movimiento mal cargado exige un contramovimiento, no una corrección.
- El trigger es código crítico que hay que testear bien.
- Más escrituras por operación (movimiento + actualización de saldo).

## Riesgo

Que el trigger falle y `stock_balances` diverja de la suma de movimientos.

**Mitigación:** job de verificación periódico que compare
`SUM(stock_movements.quantity)` contra `stock_balances.on_hand` y alerte
ante cualquier diferencia. Como los movimientos son la verdad, el saldo
siempre se puede reconstruir.

## Impacto futuro

**Alto.** Cambiar el modelo de stock con datos cargados exige recalcular
todo el histórico. Es de las decisiones más caras de revertir.

## Nota sobre la migración

El kardex legacy **no se carga** en `stock_movements`: ya está truncado a
5.000 entradas y cargarlo produciría saldos incorrectos. Se archiva como
CSV y el stock arranca con un asiento `opening_balance` por cada uno de los
378 productos con existencias. Detalle en
[`MIGRATION_PLAN.md`](../database/MIGRATION_PLAN.md).
