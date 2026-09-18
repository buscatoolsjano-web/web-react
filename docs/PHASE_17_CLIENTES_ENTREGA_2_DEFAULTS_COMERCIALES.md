# Fase 17 · Clientes · Entrega 2 — Los defaults del cliente sugieren; el documento congela

Fecha: 2026-09-18. Proyecto: `uaxcfufvapzulqvynanp`.
**0 cambios de base**: no hubo migración ni SQL nuevo. Todo lo que hacía falta ya existía en
`customers` desde antes, y E1 lo dejó editable.

E2 conecta los defaults comerciales del cliente con el **alta** de cotización y de pedido manual.
La regla que sostiene todo:

> **El cliente sugiere. El documento congela.** Un default entra sólo en un borrador que todavía no
> se guardó, y sólo en un campo que la persona no tocó. Cambiar la ficha del cliente **no mueve**
> ningún documento ya emitido.

No se tocaron remitos, stock, reservas, numeración, autoridad, adjuntos, impresión ni WhatsApp.

---

## 1 · Auditoría previa

| Clave | Cómo estaba |
|---|---|
| CUSTOMER_DEFAULT_FIELDS | Existen en `customers` y no hizo falta crear ninguno: `salesperson_id`, `default_price_list_id`, `payment_terms`, `default_currency`, más `discount_pct` y `credit_limit` (ver § 6). |
| QUOTE_CURRENT_DEFAULTING | `CotizacionNuevaPage` abría con la fecha de hoy y una forma de pago fija del sistema (`30 DIAS F/F con ECHEQ`). Elegir el cliente **sólo limpiaba el contacto**: ni vendedor, ni tarifa, ni moneda. |
| ORDER_CURRENT_DEFAULTING | `PedidoNuevoPage`, idéntico. |
| MISSING_DEFAULT_FIELDS | Ninguno para lo que E2 se propuso. La tarifa del cliente ni se mostraba en la ficha hasta E1. |
| CONFLICTS_WITH_EXISTING_LOGIC | Dos reglas de Ventas que había que respetar y no romper: la tarifa **sólo sugiere el precio de las líneas nuevas** (cambiarla no recalcula lo cargado) y una tarifa de otra moneda **no se aplica** (`TARIFA_OTRA_MONEDA` en la base). Ambas siguen igual. |

## 2 · Cómo funciona

Al elegir un cliente en un documento **nuevo**, la pantalla pide sus cuatro defaults en **una sola
consulta de cuatro columnas** y los aplica con `aplicarDefaults`, una función pura con su propia
suite de 21 pruebas.

Prioridad, de mayor a menor:

1. **lo que eligió la persona**;
2. **el default del cliente**;
3. **lo que traía el borrador nuevo** (la forma de pago habitual del sistema).

| Clave | Comportamiento |
|---|---|
| SALESPERSON_DEFAULT | Se sugiere si el usuario sigue siendo miembro activo que vende. Si no, **no se aplica** y se dice: «El vendedor predeterminado del cliente ya no está disponible.» |
| PRICE_LIST_DEFAULT | Se sugiere si es de la empresa **y su moneda coincide con la del documento**. |
| PAYMENT_TERMS_DEFAULT | Texto libre: se sugiere tal cual, y le gana a la forma de pago habitual del sistema. |
| CURRENCY_DEFAULT | Se sugiere si el cliente tiene `default_currency`. **Si no tiene, no se inventa USD**: el documento queda sin moneda, como hasta ahora. |
| PRICE_LIST_CURRENCY_RULE | La moneda se resuelve **primero** y después la tarifa. Si el documento todavía no tiene moneda, la tarifa **espera**: cuando se elige la moneda, entra sola (o se descarta con su aviso). |
| INVALID_DEFAULT_BEHAVIOR | Nunca hay reemplazo silencioso: o se aplica, o se explica en un aviso de la pantalla. Y un default inválido **no bloquea** el alta. |

## 3 · Lo que la persona eligió no se pisa

`MANUAL_OVERRIDE_TRACKING`: la pantalla recuerda en un conjunto (`tocados`) qué campos tocó la
persona —vendedor, tarifa, forma de pago y moneda—. Un campo tocado **no se sobrescribe** al elegir
o cambiar de cliente.

`CUSTOMER_CHANGE_BEHAVIOR`:

- el **contacto** se limpia siempre que cambia el cliente (era de otro);
- los campos **no tocados** se recalculan con los defaults del cliente nuevo;
- los campos **tocados** se conservan… salvo que hayan quedado inválidos: una tarifa que no es de la
  empresa, o que quedó en otra moneda, **se limpia y se avisa**. Un valor inválido no se conserva
  sólo por haber sido manual;
- lo que había puesto el cliente **anterior** (y nadie tocó) se va con él.

## 4 · Un problema real que apareció al probar

La primera versión aplicaba los defaults sobre el borrador **tal como estaba cuando se pidió la
consulta**. Una prueba que ya existía lo destapó: si la persona elegía la tarifa mientras la
respuesta venía en camino, la respuesta **le pisaba la elección**. Ahora la respuesta se aplica
sobre el borrador que hay **en ese momento**, y una segunda selección de cliente descarta la
respuesta de la primera que llegue tarde.

## 5 · Lo que NO cambia

| Clave | Estado |
|---|---|
| QUOTE_TO_ORDER_SNAPSHOT | El pedido que nace de una cotización **no mira los defaults del cliente**: hereda el snapshot aprobado de la cotización (E4). Probado con el cliente cambiado en el medio: la cotización tenía la tarifa A, el cliente pasó a la B, el pedido salió con **A**. |
| DUPLICATE_SNAPSHOT | Duplicar copia el documento original, no la ficha del cliente de hoy. |
| HISTORICAL_DOCUMENTS_CHANGED | **NO.** Cero backfill: los 306 cotizaciones, 172 pedidos y 193 remitos históricos siguen con contacto, tarifa, vendedor y dirección en `null`. |
| DOCUMENT_AUDIT | Un documento creado con defaults se audita como cualquier otro: **no** se agregó ningún evento «se aplicó un default», ni columna de procedencia. |

## 6 · Lo que quedó afuera, con su motivo

- **`discount_pct`**: existe en `customers`, está en **0 en los 1.010 clientes**, ninguna pantalla lo
  usa y no hay regla escrita que diga si es un descuento de cabecera o por línea. Aplicarlo
  automáticamente cambiaría precios sin que nadie lo haya pedido. Queda documentado como gap.
- **`credit_limit`**: igual, vacío en todos. **No se usa para bloquear nada**: una regla de crédito
  sin especificación es una forma de romper ventas.

## 7 · La ficha del cliente

`CUSTOMER_UI_DEFAULTS`: vendedor y tarifa ya eran editables desde E1 (admin/employee). E2 agregó:

- la **tarifa en la vista de lectura** de «Datos comerciales», que no estaba;
- la **moneda junto al nombre** en el selector de tarifas («Lista base · USD»), para que se vea al
  elegirla y no al crear el documento.

Todo dentro del mismo borrador de E1: dirty guard, no-op, concurrencia y auditoría siguen
funcionando igual. `CUSTOMER_AUDIT`: cambiar tarifa, vendedor, condición de pago y moneda de una vez
deja **un solo evento `updated`** con el antes y el después de los cuatro campos (probado).

## 8 · Pruebas

| Suite | Resultado |
|---|---|
| `scripts/fase17-e2-defaults-tests.mjs` (base real) | **23 PASS · 0 fallos** |
| `scripts/fase17-e1-clientes-tests.mjs` (regresión E1) | 0 fallos |
| `npm test` / `npm run test:isolated` | 1479 tests, 127 archivos |
| `npm run lint`, `npx tsc -b`, `npm run build` | limpio |

Frontend: **21 pruebas** de la lógica pura (`defaults.test.ts`) que cubren los casos A–M del pedido —
cliente completo, sin defaults, parcial, tarifa en otra moneda, vendedor inactivo, overrides,
cambio de cliente, e inválido que no se conserva— más 7 en `CotizacionNuevaPage.test.tsx` y 3 en
`PedidoNuevoPage.test.tsx` sobre la pantalla real.

De la base: `la cotización NO cambió` y `ni siquiera se tocó su updated_at` después de cambiarle los
cuatro defaults al cliente; `pero un documento nuevo ya recibiría la tarifa nueva`; `el pedido hereda
la tarifa de la COTIZACIÓN`; `la copia repite la tarifa del original`; `una tarifa en otra moneda que
la del documento — TARIFA_OTRA_MONEDA`; `producción idéntica al baseline`.

## 9 · Verificación en el navegador

Con datos reales y **sin crear ningún documento**: en «Nueva cotización» se eligió un cliente que ya
tenía defaults cargados y la pantalla completó **vendedor (Facundo), moneda (USD), tarifa (Especial
Cliente Demo) y forma de pago**, exactamente lo que dice su ficha. Sin desborde horizontal a 375,
430, 768 ni 1440 px.

`PERFORMANCE`: **una consulta por selección de cliente**, de cuatro columnas. No se trae la ficha, ni
contactos, ni direcciones, ni historial, ni precios. Sin N+1.

`ACCESSIBILITY`: los avisos son texto dentro de un `Alert` con `role="status"` —no dependen del
color— y los selectores conservan sus labels y su navegación por teclado.

## 10 · Qué falta para E3 (`E3_GAPS`)

- **Contactos y direcciones**: contacto principal atómico y que sugiera el `contact_id` del
  documento (hoy hay **0 contactos marcados como principal**), permisos del vendedor sobre contactos
  y direcciones (decisión 3), y dirección de entrega explícita en el pedido con su snapshot
  (decisión 4). Hoy **no hay ninguna UI** que cargue direcciones fuera de la ficha, y hay 0 cargadas.
- **`discount_pct` y `credit_limit`**: decisión de negocio pendiente.
- **Alta de cliente atómica** con su primer contacto, si E3 define ese flujo.
