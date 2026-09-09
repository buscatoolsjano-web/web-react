# Fase 3.5 — Preparación para la carga completa

**Nada importado todavía.** La base sigue con 219 productos.
Fecha: 2026-09-09 · Dataset auditado: `productos-data.json`, 15.658.378 bytes.

---

## Resumen para decidir

| Punto | Estado |
|---|---|
| A · Relación N:N de atributos | ✅ **implementada y probada** |
| B · Auditoría del dataset | ✅ completa — el dataset está **más limpio de lo esperado** |
| C · Taxonomía | ✅ estrategia definida, sin recategorizar nada |
| D · Importador | ✅ escrito, simulacro corrido, idempotente |
| E · Stock inicial | ⚠️ **necesita 1 índice nuevo** — SQL abajo |
| F · Precios | 🔴 **BLOQUEADO: requiere tu decisión comercial** |
| G–Q | ✅ planificado |

**El único bloqueo real es F.** Todo lo demás está listo para ejecutar.

---

## A · Relación N:N de atributos — IMPLEMENTADA

### La evidencia, ahora con los 21.772 productos

**19 de los 26 atributos aplican a más de una categoría.** Con el dataset
de 216 productos eran 8 de 11; con el completo el problema es mayor.

| Atributo | Categorías | Cuáles |
|---|:---:|---|
| `encastre` | **6** | punta, atornillador, accesorio, llave-de-impacto, remachadora, llave-dinamometrica |
| `peso_kg` | **5** | atornillador, balanceador, llave-de-impacto, remachadora, accesorio |
| `modelo`, `marca_disp`, `rpm`, `torq_max`, `torq_min`, `voltaje`, `catalogo_id`, `catalogo_pagina` | 4 | — |
| `medida`, `dim_balanceador` | 3 | — |
| 7 más | 2 | — |
| `carcasa`, `min_kg`, `max_kg`, `longitud`, `longitud_raw`, `alimentacion`, `eslinga` | 1 | — |

### Por qué la herencia no lo resuelve

Se verificó lo que pediste. Las 8 categorías tienen `parent_id = NULL`: no
hay árbol que recorrer. Y aunque se armara, no alcanzaría:

```
encastre → {punta, atornillador, accesorio, llave-de-impacto,
            remachadora, llave-dinamometrica}
medida   → {punta, llave-dinamometrica, balanceador}
```

Comparten `punta` y `llave-dinamometrica`, pero **ninguno contiene al
otro**: `encastre` toca atornillador y `medida` no; `medida` toca
balanceador y `encastre` no.

En un árbol, dos subárboles son disjuntos o uno contiene al otro — **nunca
se superponen parcialmente**. Es una propiedad de los árboles, no una
limitación de este modelo. Ninguna jerarquía puede representarlo.

### SQL ejecutado

```sql
CREATE TABLE product_attribute_categories (
  company_id              uuid NOT NULL REFERENCES companies(id),
  attribute_definition_id uuid NOT NULL
    REFERENCES product_attribute_definitions(id) ON DELETE CASCADE,
  category_id             uuid NOT NULL
    REFERENCES product_categories(id) ON DELETE CASCADE,
  created_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attribute_definition_id, category_id)
);
CREATE INDEX idx_pac_category ON product_attribute_categories (category_id);
CREATE INDEX idx_pac_company  ON product_attribute_categories (company_id);
ALTER TABLE product_attribute_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON product_attribute_categories FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON product_attribute_categories TO authenticated;
```

**La PK compuesta es la constraint de unicidad.** No hay id sintético
porque ninguna tabla referencia a ésta. `ON DELETE CASCADE` en ambos lados:
borrar un atributo o una categoría se lleva sus vínculos, nunca queda uno
huérfano.

### RLS

```sql
CREATE POLICY pac_select ON product_attribute_categories
  FOR SELECT TO authenticated
  USING (company_id = ANY (app.current_company_ids()));

CREATE POLICY pac_write ON product_attribute_categories
  FOR ALL TO authenticated
  USING (app.is_admin(company_id))
  WITH CHECK (
    app.is_admin(company_id)
    -- La referencia externa va CALIFICADA con el nombre de la tabla.
    -- Sin calificar, Postgres la resuelve contra el subquery y la
    -- condición se vuelve una tautología (ver el recuadro de abajo).
    AND EXISTS (
      SELECT 1 FROM product_attribute_definitions d
      WHERE d.id = product_attribute_categories.attribute_definition_id
        AND d.company_id = product_attribute_categories.company_id
    )
    AND EXISTS (
      SELECT 1 FROM product_categories c
      WHERE c.id = product_attribute_categories.category_id
        AND c.company_id = product_attribute_categories.company_id
    )
  );
```

El `WITH CHECK` cierra el agujero que trae toda tabla puente en un sistema
multiempresa: **vincular un atributo de Buscatools con una categoría de
Torquetools**. Las dos subconsultas fuerzan que las tres partes sean de la
misma empresa.

> ### ⚠️ La primera versión de esta política no funcionaba
>
> Estaba escrita como `d.company_id = company_id` dentro del subquery.
> Postgres resuelve un `company_id` sin calificar contra la tabla del
> **propio subquery**, no contra la fila que se inserta, así que quedaba
> `d.company_id = d.company_id`: una tautología. **El guardia no bloqueaba
> nada.**
>
> Y la verificación que hice entonces —«0 inconsistencias»— **era
> insuficiente**: contaba filas cruzadas en los datos existentes, o sea
> comprobaba **estado**. No comprobaba **enforcement**: si la política
> impedía crear una fila cruzada. Como los 70 pares se habían insertado
> correctamente por construcción, el conteo daba cero igual con la política
> rota.
>
> **Corregido** calificando la referencia externa con el nombre de la
> tabla: `d.company_id = product_attribute_categories.company_id`.
>
> **Verificado ahora con las dos pruebas que hacían falta**, usando el JWT
> real de Jano (admin en Buscatools, salesperson en Torquetools):
>
> | Prueba | Intento | Resultado |
> |---|---|---|
> | **Negativa** | atributo de Buscatools + categoría de **Torquetools** | **DENEGADO** (`insufficient_privilege`) |
> | **Positiva** | atributo de Buscatools + categoría de Buscatools | **PERMITIDO** |
>
> La lección aplica a toda RLS: **contar filas malas no prueba que la
> política las impida.** Hace falta intentar la escritura prohibida y ver
> que falle, y la permitida y ver que pase.

### Migración de datos

70 pares **derivados de los productos reales**, ninguno inventado: cada par
existe porque hay al menos un producto de esa categoría con esa clave
cargada y no vacía. `ON CONFLICT DO NOTHING`, así que volver a correrlo
tras la importación funciona como verificación.

### `applies_to_category_id`

**No se borró.** Se marcó obsoleta con `COMMENT`. Borrar una columna es
irreversible y no molesta a nadie estando en NULL. Se elimina en una
migración posterior, cuando la N:N lleve tiempo en uso.

### Cómo queda la lógica de filtros

| Categoría | Filtros | Claves |
|---|---:|---|
| Puntas y tubos | 3 | encastre, largo, medida |
| Balanceadores | 7 | carcasa, eslinga, longitud, max_kg, medida, min_kg, modelo |
| Atornilladores | 8 | alimentacion, encastre, ergonomia, modelo, rpm, torq_max, torq_min, voltaje |
| Accesorios | 7 | encastre, ergonomia, modelo, rpm, torq_max, torq_min, voltaje |
| Llaves de impacto | 5 | encastre, rpm, torq_max, torq_min, voltaje |
| Remachadoras | 5 | encastre, rpm, torq_max, torq_min, voltaje |
| Llaves dinamométricas | 4 | encastre, largo, medida, modelo |

Antes se ofrecían los 15 filtrables en toda categoría. Para "Puntas y
tubos" el resultado —encastre, largo, medida— **es exactamente el
`CATEGORY_FILTERS` que el legacy tenía hardcodeado** en `app.js:15087`. La
diferencia es que ahora sale de los datos, no de un objeto en el código.

Si una categoría no tiene relaciones cargadas, se ofrecen todos los
filtrables: preferimos un filtro de más que una pantalla sin filtros.

Cubierto por 6 tests nuevos (54 en total).

---

## B · Auditoría del dataset real

Script: [`scripts/audit-legacy-catalog.mjs`](../scripts/audit-legacy-catalog.mjs)
· 21.772 productos · 55 campos.

### Lo que salió mejor de lo esperado

| | |
|---|---|
| SKU vacíos | **0** |
| SKU duplicados | **0** — los 21.772 son únicos |
| Nombres vacíos | **0** |
| Categorías desconocidas | **0** — las 8 son las ya sembradas |
| Marcas desconocidas | **0** — las 25 son las ya sembradas |
| Claves de atributo no declaradas | **0** — las 26 ya existen |
| URLs de imagen inválidas | **0** |

**Ningún producto queda fuera por datos rotos.** Esto es mejor de lo que
suponía el plan de migración, que anticipaba duplicados y limpieza previa.

### Marcas

16.316 con marca (74,9%), 5.456 sin (25,1%). 25 marcas distintas.

| Marca | Productos |
|---|---:|
| SPEEDRILL | 4.928 |
| APEX | 3.807 |
| FIAM | 3.374 |
| TOHNICHI | 2.736 |
| INGERSOLL RAND | 736 |
| TECNA | 290 |
| FEIN | 174 |
| *(18 más)* | 271 |

`brand_id` es nullable, así que los 5.456 sin marca se migran sin problema.

### Categorías

| Categoría | Productos | % |
|---|---:|---:|
| otros | **12.588** | 57,8 % |
| punta | 8.623 | 39,6 % |
| balanceador | 376 | 1,7 % |
| atornillador | 129 | 0,6 % |
| accesorio | 43 | 0,2 % |
| llave de impacto | 7 | 0,0 % |
| remachadora | 4 | 0,0 % |
| llave dinamométrica | 2 | 0,0 % |

### Atributos

Las 26 claves candidatas están todas declaradas. Tres discrepancias de
tipo, que **no bloquean** porque el trigger valida existencia de la clave,
no el tipo (limitación ya documentada en la Etapa 1):

| Clave | `data_type` declarado | Tipo real |
|---|---|---|
| `rpm` | number | **string** |
| `catalogo_pagina` | text | **number** |
| `sufijos` | text | **array** |

No se corrigen en esta fase: cambiar `data_type` sin validador es
cosmético. Van al informe de limpieza.

### Imágenes

| | |
|---|---|
| Con al menos una | 7.523 (34,6 %) |
| Sin imagen | 14.249 (65,4 %) |
| URLs totales | 8.859 |
| URLs distintas | **3.317** |
| URLs repetidas en varios productos | 1.596 |
| URLs inválidas | 0 |
| Dominios | `www.buscatool.com` (5.315) · `apexbits.com.ar` (3.544) |

**Las 8.859 referencias son sólo 3.317 archivos distintos.** Cuando se
migre a Storage, es un tercio del trabajo esperado.

### Campos que NO se migran

| Campo | Filas | Motivo |
|---|---:|---|
| `s` | 21.772 | Cadena de búsqueda precalculada del legacy. La reemplaza `search_vector`, que es GENERATED STORED y se mantiene sola |
| `_importOrigen` | 12.592 | Metadato: un único valor, `STEL Order API (products)`. Describe de dónde salió el dato, no el producto |
| `_apexPageCatalog` | 3.807 | Metadato de importación |
| `_apexFamilyTitle` | 3.807 | Metadato de importación |
| `_apexEnriquecido` | 4 | Metadato de importación |
| `sim_sp` | 1.705 | Producto similar — no existe tabla en la Etapa 1 |
| `sim_tc`, `sim_cp`, `sim_ir` | 10 c/u | Idem |
| `costo` | 237 | Costo de compra — pertenece a **Compras (Fase 5)**, con su propia RLS |
| `fob_eur` | 6 | Valor FOB — pertenece a Compras |
| `imgs` | 7.523 | Siguen apuntando a URLs externas — fase aparte |
| `sv` | 18.072 | Stock virtual = `on_hand − reserved`. Se **deriva**, no se migra |

Ninguno se descarta en silencio: quedan listados en el importador.

### Clasificación

| | Productos | % |
|---|---:|---:|
| **MIGRADO** (limpio) | 9.179 | 42,2 % |
| **MIGRADO + NEEDS_REVIEW** | 12.593 | 57,8 % |
| **NO MIGRADO** | **0** | 0 % |

`needs_review` marca lo que necesita que **una persona mire la fila**:

- categoría `otros` (12.588) — requiere recategorización
- `pu` anómalo (9) — valores hasta 8.190.355 USD
- stock negativo (5)

**Deliberadamente no incluye "sin marca" ni "sin precio".** Son condiciones
masivas (5.456 y 9.509) que se consultan directamente con
`brand_id IS NULL` o por ausencia de fila en `product_prices`. Marcarlas
pondría la bandera en el 98,4 % del catálogo y la volvería inútil como
filtro. Van al informe de limpieza, que es su lugar.

*(Si preferís el criterio amplio, es un flag del importador.)*

---

## C · Taxonomía

Los 12.588 de `otros` **se migran con su categoría actual** y
`needs_review = true`. No se recategoriza nada automáticamente.

El informe está en
[`CATALOG_DATA_CLEANUP.md`](database/CATALOG_DATA_CLEANUP.md).

---

## D · Importador

[`scripts/import-catalog.mjs`](../scripts/import-catalog.mjs). Simulacro
corrido: 21.772 válidos, 0 rechazados.

### Idempotencia

| Tabla | Clave | Estado |
|---|---|---|
| `products` | `UNIQUE (company_id, sku)` | ✅ ya existe |
| `brands` | `UNIQUE (company_id, name)` | ✅ ya existe |
| `product_categories` | `UNIQUE (company_id, slug)` | ✅ ya existe |
| `product_prices` | `UNIQUE (price_list_id, product_id, valid_from)` | ✅ ya existe |
| `stock_movements` | — | ⚠️ **falta** (ver E) |

Cuatro de las cinco claves ya existían. Correrlo dos veces no duplica nada.

### Reanudación

Escribe el avance en `import-catalog.state.json` tras cada lote. Si falla,
`--desde N` retoma. Como todo es upsert, reanudar de más tampoco duplica.

### service_role

- Se lee de `SUPABASE_SERVICE_ROLE_KEY`, variable de entorno.
- **Nunca se imprime**, ni truncada.
- No está en el repo, ni en `src/`, ni en el bundle, ni en Pages.
- El script corre a mano, fuera del frontend.
- `.gitignore` cubre `.env`; se agrega `import-catalog.state.json`.

---

## E · Stock inicial — necesita un índice

### Estrategia

`movement_type` **ya admite `'opening_balance'`**: el CHECK de la Etapa 1
lo incluía. No hace falta inventar un concepto.

Por cada producto con `sr > 0`, **un** movimiento:

```
movement_type = 'opening_balance'
quantity      = sr
source_type   = 'migration'
notes         = 'Saldo inicial migrado del catálogo legacy'
```

`stock_balances` lo mantiene el trigger `apply_stock_movement`. **Nunca se
hace `UPDATE stock_balances`** — de hecho el `REVOKE` de la Etapa 1 lo
impide incluso con service_role para `authenticated`.

No se inventa historia: un solo movimiento de apertura por producto, con
fecha y motivo explícitos, no una secuencia falsa de compras y ventas.

### Cifras

| | |
|---|---:|
| `sr > 0` → movimiento de apertura | **378** |
| Suma a migrar | **29.799** |
| `sr = 0` → sin movimiento | 17.689 |
| `sr < 0` → **saldo no migrable** | **5** |
| Sin dato de stock | 3.700 |

Los 5 con stock negativo: el **producto sí se migra**, el **saldo no**.
`on_hand` tiene `CHECK (>= 0)`, y forzarlo sería inventar un dato.

```
SP.VPTX15/50   sr = -15  (sv = 535)
SP.VPTX15/70   sr =  -4
SP.J2926B      sr =  -2
SP.J3026B      sr =  -2
SP.R100VP      sr =  -3
```

Quedan con `needs_review = true` y en el informe de limpieza.

### 🔧 Cambio de schema que hace falta

```sql
-- Un solo saldo de apertura por producto y depósito.
-- Es lo que vuelve idempotente la importación de stock: sin esto,
-- correr el importador dos veces duplicaría los movimientos y el
-- trigger sumaría el saldo dos veces.
CREATE UNIQUE INDEX uq_stock_movements_apertura
  ON stock_movements (company_id, product_id, warehouse_id)
  WHERE movement_type = 'opening_balance';
```

Índice parcial: sólo afecta a los movimientos de apertura. Los demás tipos
—compras, ventas, ajustes— siguen pudiendo repetirse cuantas veces haga
falta, que es lo correcto para un libro append-only.

**Pendiente de tu aprobación.**

### Reconciliación

Tras importar, por cada SKU: `SKU | LEGACY sr | NEW on_hand | DELTA`.
Objetivo: **delta = 0** en los 378. Los 5 negativos se listan aparte como
diferencia esperada y explicada.

---

## F 🔴 Precios — REQUIERE TU DECISIÓN

Acá me detengo, como pediste.

### Qué campo existe y qué representa

Del código del legacy (`app.js:15308`, la fila del catálogo):

```js
isCatCliente
  ? (precioVentaProd(p) != null ? 'PVP: USD ' + fmtNum(precioVentaProd(p)) : '—')
  : (typeof p.pu === 'number' ? 'USD ' + fmtNum(p.pu) : '—')
```

y la columna interna se titula literalmente **"Costo"** (`app.js`, header
`data-cat-sort="pu"`), y en el panel de administración, **"P. Costo (USD)"**.

| Campo | Qué es | Quién lo ve hoy | Filas |
|---|---|---|---:|
| `pu` | **Costo unitario en USD** | sólo usuarios internos | 16.739 |
| `precio_venta` | Precio de venta explícito | clientes | **131** |
| `costo` | Otro costo (¿de compra?) | nadie en el catálogo | 237 |
| `fob_eur` | Valor FOB en euros | nadie en el catálogo | 6 |

### Qué precio ve el cliente hoy

```js
function precioVentaProd(p){
  if (typeof p.precio_venta === 'number') return p.precio_venta;
  if (typeof p.pu === 'number') return p.pu * 3;   // ← markup 3×
  return null;
}
```

| Origen del precio que ve el cliente | Productos | % |
|---|---:|---:|
| `precio_venta` real | **131** | 0,6 % |
| **`pu × 3` calculado en JavaScript** | **12.123** | 55,7 % |
| `pu = 0` → el cliente ve "—" | 4.476 | 20,6 % |
| `pu` anómalo | 9 | 0,0 % |
| Sin ningún dato → "—" | 5.033 | 23,1 % |

**El 98,9 % de los precios que hoy ve un cliente no existen como dato: se
calculan multiplicando el costo por 3 en el navegador.**

### La regla comercial que lo genera

No la sé, y no la voy a inferir. Lo que puedo afirmar:

- el coeficiente es **3**, constante, sin excepciones por marca, categoría
  ni cliente;
- está escrito en el frontend público, así que **cualquiera puede despejar
  el costo desde el precio de venta**;
- no distingue entre `Distribuidores` y clientes finales: el legacy muestra
  el mismo PVP a todos los externos.

### Las tres opciones

| | Qué hace | Precios migrados | Qué ve el cliente |
|---|---|---:|---|
| **1. `solo-explicitos`** *(default)* | Migra los 131 `precio_venta` reales | 131 | "Consultar" en el 99,4 % |
| **2. `markup-legacy`** | Además materializa `pu × 3` para los que tienen `pu > 0` | **12.254** | Lo mismo que hoy, exactamente |
| **3. `ninguno`** | No migra precios | 0 | "Consultar" en todo |

### Lo que recomiendo, y por qué

**Opción 2**, con dos condiciones.

El argumento a favor: **no cambia nada de lo que el cliente ve hoy.** Los
mismos números, producto por producto. Y mueve la regla del navegador a la
base, que era el objetivo — el costo deja de viajar y el margen deja de ser
despejable.

Las dos condiciones:

1. **`pu = 0` no genera precio.** Cero no es un precio; son 4.476
   productos que hoy muestran "—" y deben seguir mostrando "Consultar".
2. **Los 9 con `pu` anómalo tampoco.** Un precio de venta de 24.571.067 USD
   no es un precio.

Y una advertencia: materializar el 3× **congela** ese margen como dato. A
partir de ahí, cambiarlo es un `UPDATE` sobre `product_prices`, no editar
JavaScript. Es más trabajo por única vez y muchísimo menos riesgo — pero es
un cambio de cómo trabaja el equipo comercial, y conviene que lo sepan.

**Si el 3× no es la política real** —si era un valor provisorio, o si
distribuidores y clientes finales deberían tener precios distintos— **esta
es la oportunidad de arreglarlo**, antes de materializar 12.254 filas.

### Reconciliación

Tras importar: `SKU | PRECIO LEGACY | PRECIO MIGRADO | LISTA | MONEDA | DELTA`,
comparando contra `precioVentaProd()` reimplementado en el verificador.
Objetivo: **delta = 0** en todos los migrados.

**No ejecuto nada de precios sin tu respuesta.**

---

## G · Carga completa

| | |
|---|---|
| Lote | 500 filas (ajustable con `--batch`) |
| Lotes previstos | 44 de productos + 1 de precios + 1 de stock |
| Orden | marcas → categorías → productos → precios → movimientos |
| Métricas | duración, lote, inserts, updates, skipped, errors, retries |

No se generan logs masivos: el importador escribe una línea cada 5 lotes.

---

## Impacto estimado en la base

Medido sobre el JSON real: **6,9 MB de texto** a insertar (1,5 de campos
cortos, 2,0 de `desc`, 3,0 de `descl`, 0,5 de `attributes`), 332 bytes
promedio por producto.

| | Hoy | Estimado después |
|---|---|---|
| `products` — datos | 160 kB | **~12 MB** |
| `products` — índices (9, con 3 GIN) | 640 kB | **~20 MB** |
| `product_prices` | 240 kB | ~4 MB *(con opción 2)* |
| `stock_movements` + `stock_balances` | 120 kB | ~200 kB |
| **Base total** | **13 MB** | **~50 MB** |

Sobre el plan de Supabase no hay problema. El costo real es el índice GIN
de trigram sobre `name`, que es también lo que hace posible la búsqueda
con errores de tipeo.

---

## Rollback

Todo lo importado lleva marca: `legacy_ref = sku` en `products`,
`source_type = 'migration'` en los movimientos.

```sql
-- 1. Movimientos de apertura de la migración (el trigger ajusta saldos)
DELETE FROM stock_movements
 WHERE source_type = 'migration' AND movement_type = 'opening_balance';

-- 2. Precios de la migración
DELETE FROM product_prices
 WHERE valid_from = '2026-01-01'
   AND product_id IN (SELECT id FROM products WHERE legacy_ref IS NOT NULL);

-- 3. Productos importados, conservando los 219 de prueba
DELETE FROM products
 WHERE legacy_ref IS NOT NULL
   AND created_at > '<marca de tiempo del inicio de la importación>';
```

⚠️ `stock_movements` tiene `REVOKE DELETE` para `authenticated`: el
rollback corre con service_role, a mano. Es a propósito — un libro
append-only no se borra desde la aplicación.

**Antes de importar conviene tomar un backup del proyecto desde el panel de
Supabase.** Es un clic y vuelve el estado exacto.

---

## Reconciliación (Etapa H)

Script aparte, tras importar. Compara legacy contra la base y **exige
delta exacto**, no "aproximadamente igual":

| Métrica | Esperado |
|---|---|
| Total productos | 21.772 + 3 de Torquetools |
| Por marca | 25 filas, delta 0 |
| Por categoría | 8 filas, delta 0 |
| Sin marca | 5.456 |
| En `otros` | 12.588 |
| Con precio | según la opción de F |
| Con stock | 378 |
| Suma de stock | **29.799** |
| SKUs | conjunto idéntico, delta 0 en ambos sentidos |
| Atributos | 70 pares, 26 claves |

Toda diferencia se explica o se corrige. Ninguna se acepta sin motivo.

---

## Lo que necesito de vos

| # | Decisión | Recomendación |
|---|---|---|
| 1 | **Precios: ¿opción 1, 2 o 3?** | **Opción 2** (`markup-legacy`), con `pu = 0` y anómalos excluidos — no cambia lo que el cliente ve hoy |
| 2 | ¿Creo el índice único parcial de `opening_balance`? | **Sí** — sin él la importación de stock no es idempotente |
| 3 | ¿`needs_review` con el criterio acotado (12.593) o el amplio (21.427)? | **Acotado** — al 98,4 % la bandera no filtra nada |
| 4 | ¿Tomás un backup del proyecto antes? | **Sí**, es un clic |

Con eso ejecuto las etapas G a Q completas.

**No importé nada. Me detengo acá.**

---

## Backup lógico — decisión final

El proyecto está en el plan Free, así que no hay snapshot ni PITR del panel.
Se aprobó el **backup lógico reconstruible** de
[`scripts/backup-logical.mjs`](../scripts/backup-logical.mjs).

**No es un `pg_dump`** y no se describe como tal. Qué cubre, qué no, y —lo
más importante— el **remapeo de identidades** que hace falta para restaurar
en otro proyecto, están en
[`BACKUP_RESTORE_NOTES.md`](database/BACKUP_RESTORE_NOTES.md).

El punto que corregí: recrear los usuarios en otro proyecto les asigna
**UUID nuevos**, así que los ids del backup dejan de servir. Hay 7 columnas
en 6 tablas que dependen de esos ids, con **19 valores poblados hoy**. El
remapeo se hace por email, que es la identidad estable.
