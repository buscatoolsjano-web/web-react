# Fase 10 · Informes — Entrega 3: rankings y CSV

Fecha: **2026-09-13**. Base: Supabase `uaxcfufvapzulqvynanp`.

Agrega a `/informes` un **ranking de clientes y productos** (por importe en una
moneda a la vez, o por cantidad física) y **exportación CSV** de los tres
informes, con los filtros activos y el contenido completo.

SQL: [`docs/database/PHASE_10_INFORMES_ENTREGA_3.sql`](database/PHASE_10_INFORMES_ENTREGA_3.sql) ·
pruebas de base: `scripts/fase10-informes-entrega3-tests.mjs` ·
antecedentes: [Entrega 0](PHASE_10_INFORMES_ENTREGA_0_AUDITORIA.md), [1](PHASE_10_INFORMES_ENTREGA_1.md), [2](PHASE_10_INFORMES_ENTREGA_2.md).

**Sin tablas, columnas, vistas, índices ni cambios de RLS. Ventas no se tocó.**
Una función nueva de lectura, `public.informe_rankings_comerciales`
(migraciones `fase10_informes_entrega3_rankings` y
`fase10_informes_entrega3_rankings_orden`, la definitiva).

---

## 0 · Auditoría previa (medida antes de programar)

| qué | medido | decisión |
|---|---|---|
| documentos sin `customer_id` | **0** (la columna es NOT NULL en los tres) | agrupar por `customer_id`; «SIN CLIENTE VINCULADO» existe en la función pero hoy no aparece |
| clientes con documentos | 57, todos activos, 0 borrados | la marca «Inactivo» existe, hoy no se ve |
| productos referenciados | 692, todos activos, 0 borrados | ídem |
| líneas sin `product_id` | cot **86** (37 SKU) · ped **38** (10) · rem **62** (13); 0 sin SKU | ninguno de esos SKU está en el catálogo ni aparece vinculado en otra línea: agrupar por SKU snapshot **exacto** no fusiona nada |
| precio en remitos | **600 de 600** líneas con `unit_price` NULL | productos × entregado **sólo por cantidad** |
| unidad de medida | no hay columna de unidad en las líneas | se asume la unidad del producto; nunca se suman unidades de productos distintos |
| líneas vs total del documento | con IVA cierran 252/288 cot y 135/166 ped; neto 269/288 y 134/166 | clientes = total guardado; productos = líneas; no tienen por qué reconciliar |
| descuento/percepción de cabecera | 0 documentos con alguno | la fórmula los incluye igual |
| cantidades | mayor cantidad **con precio**: 480 (ped) / 300 (cot); p99 ≈ 150; **6 líneas ≥ 1000, todas con precio 0, todas GRAMPA.80-4T** | regla general de atípico: cantidad ≥ 1000 e importe 0 |
| volumen por mes | 4 a 11 clientes y 19 a 119 productos con remitos por mes | un Top 10 mensual es casi toda la lista: se agrega **12 meses**, el mismo tramo de la Entrega 2 |
| CSV del proyecto | `;`, CRLF, BOM, 2 decimales, moneda en columna; exporta paginando al servidor de a 500 | se sigue el patrón. **Ningún CSV existente protege contra inyección de fórmulas** (ver L) |
| collation de la base | `en_US.UTF-8` | orden y `min()` con `collate "C"` para que sea determinista |

## A · Definiciones

| | regla |
|---|---|
| **Fuentes** | las de la Entrega 1, sin semántica nueva: cotizado = `status <> 'draft'`; pedido = `confirmed`; entregado = `shipped`/`delivered` |
| **Período** | `?mes=` (el mismo de toda la página). Dentro del ranking: **mes** (el tramo del mes elegido, 1 → hoy en el mes en curso) o **12 meses** (los 12 que terminan en el mes elegido). Fecha del documento, hora de Argentina |
| **Medida** | **importe** (una moneda, obligatoria) o **cantidad** (sin moneda). Nunca las dos mezcladas en el orden |
| **Top N** | 10 en pantalla. El servidor corta con `ORDER BY … LIMIT/OFFSET` (máx. 500 por página) y devuelve `total_filas` |
| **Orden estable** | medida desc → documentos desc → etiqueta asc (`collate "C"`) → clave asc |
| **Documentos** | cantidad de documentos distintos (contexto de frecuencia). Nunca se usa como cantidad física |

Combinaciones válidas (el servidor rechaza el resto con `parametro_invalido` / `sin_importe`):

| | entregado | pedido | cotizado |
|---|---|---|---|
| clientes | importe | importe | importe |
| productos | **cantidad** | importe · cantidad | importe · cantidad |

## B · Ranking de clientes

- **Identidad:** `customer_id`. Etiqueta = nombre comercial actual o, si está vacío, razón social. Nunca se agrupa por nombre.
- **Importe:** Σ `total` guardado del documento (con impuestos), por moneda. No se recalcula nada.
- **Baja:** un cliente borrado o inactivo sigue en el ranking con la marca «Inactivo».
- **Enlace:** `/clientes/:id` por UUID.

## C · Ranking de productos

- **Identidad:** `product_id` → nombre y SKU **actuales** del catálogo. Una línea sin `product_id` va a su propia fila por **SKU snapshot exacto** (`ZZ-SUELTO` ≠ `zz-suelto`), marcada «Línea histórica sin producto del catálogo», con el menor nombre snapshot como etiqueta y sin enlace.
- **Importe de línea:** `cantidad × unit_price × (1 − dto línea) × (1 − dto cabecera) × (1 + IVA de la línea)`. Con impuestos, como los documentos de Informes. Precio de la línea (snapshot), nunca catálogo. **Precio 0 → importe 0.**
- **Baja / discontinuado:** sigue con marca «Inactivo». Admin y employee ven los productos borrados (la política `products_write` es ALL para quien escribe): la etiqueta es la del catálogo. Si la RLS alguna vez lo ocultara, la etiqueta sale del snapshot.
- **Enlace:** `/catalogo/:sku` con el SKU del producto vinculado (la ruta de catálogo es por SKU), nunca con el snapshot.
- **Importe vs documento:** la suma de líneas de un producto no tiene por qué reconciliar con los totales de documento (36 cotizaciones y 31 pedidos históricos no cierran). No se fuerza.

## D · Cantidades

- Ranking físico = Σ cantidad por producto, **sin moneda** (lo físico no depende de la moneda: junta los documentos de todas).
- Se ordenan productos individualmente; **no hay total general de unidades**.
- En el ranking por importe la cantidad se muestra como contexto de la misma fila, en la moneda elegida.
- No existe concepto de devolución: no se inventa. Remitos en borrador o cancelados no cuentan.

## E · Moneda

- ARS · USD · EUR · SIN MONEDA, un ranking por moneda, elegida con botones.
- **No hay «Todas»**: sumaría monedas. SIN MONEDA es un ranking más, visible.
- Las monedas ofrecidas son las que tienen documentos de esa fuente en el período (agregados de la Entrega 1).

## F · Datos atípicos

**Regla general, por línea:** cantidad **≥ 1000** e importe **0**.

- Umbral medido: la mayor cantidad con precio es 480 y las 6 líneas ≥ 1000 tienen precio 0.
- En remitos el precio es el del remito o, si no tiene, el de la línea de pedido enlazada.
- Una línea **sin** precio conocido (remito suelto) **no** es atípica: sin precio ≠ precio 0.

La fila del ranking cuenta `lineas_atipicas` y `cantidad_atipica`. **No se excluye nada.** En pantalla aparece la marca «Dato atípico · revisar (N u. en K líneas con importe 0)», y en el CSV van las dos columnas.

**GRAMPA.80-4T** (Buscatools, 12 meses a hoy):

| ranking | resultado |
|---|---|
| productos · entregado · cantidad | **puesto 1 de 404**, 1.598.510 u. en 8 remitos, **2 líneas atípicas = 1.598.500 u.**, marcado |
| productos · pedido · cantidad | puesto 1 de 406, mismas cifras |
| productos · pedido · importe USD | **puesto 21 de 383**, importe 3.856,88 (sus 10 unidades con precio). Las 2 líneas atípicas aportan **0**; cantidad real 1.598.510; marcado |
| con `?mes=2026-06` (jul 25 – jun 26) | sólo la línea de 13.500 u. (enero): la de 1.585.000 es del 30/7/2026 |

La regla marca **sólo** GRAMPA.80-4T en todo el histórico. Ningún KPI agregado de volumen existe para distorsionar.

## G · CSV

Dos puntos de exportación, sin cuatro botones:

| dónde | qué | contenido |
|---|---|---|
| encabezado: «Exportar» + tipo | **Actividad comercial** · **Pipeline, conversión y cumplimiento** | las filas de `informe_actividad_comercial` / `informe_pipeline_comercial` para el `?mes=` elegido, pedidas al servidor en el momento del clic (sin las de rango) |
| sección Rankings | **ranking completo** con los filtros de pantalla | todas las filas, no el Top 10: `informe_rankings_comerciales` paginado de a 500 hasta `total_filas` |

Formato, igual al resto del ERP:

| | regla |
|---|---|
| separador / fin de línea | `;` / CRLF |
| encoding | UTF-8 con BOM (Excel en Windows) |
| moneda | columna **Moneda**; `SIN MONEDA` escrito; en rankings por cantidad y secciones sin dinero: `no aplica`. Nunca «Total USD» |
| importes | punto decimal, **2 decimales**, sin miles ni símbolo (`12996570.72`) |
| cantidades y conteos | hasta 4 decimales, sin ceros de sobra (`1598510`, `144.09`) |
| fechas | ISO `YYYY-MM-DD`, tal como vienen del servidor |
| **inyección de fórmulas** | todo campo de **texto** que empiece con `=`, `+`, `-`, `@`, tabulación o retorno lleva `'` adelante; después se escapan `;`, comillas y saltos. Los números no pasan por ese escape |
| nombre | `informe-{clientes|productos}-{fuente}-{moneda|cantidad}-{mes|12m}-{AAAA-MM}.csv`, `informe-actividad-AAAA-MM.csv`, `informe-pipeline-conversion-cumplimiento-AAAA-MM.csv`; sólo `[A-Za-z0-9._-]` (`SIN MONEDA` → `SIN-MONEDA`) |
| botón | 44 px táctil, «Exportando…» y deshabilitado mientras corre (sin doble clic), error en línea con `role="alert"`, `aria-label` descriptivo |

**Cómo funciona realmente (dos pasos):**

1. **Consulta y paginación en el servidor.** Las filas se piden a las RPC con los
   filtros activos (`?mes=` y la selección del ranking); el servidor filtra,
   agrega, ordena y pagina (de a 500 en el ranking). Nunca se exporta sólo lo
   visible.
2. **Generación del archivo en el navegador.** Con esas filas completas, el
   archivo CSV se arma y se descarga del lado del cliente
   (`src/modules/informes/lib/csv.ts`: `actividadACsv`, `pipelineACsv`,
   `rankingACsv`, `descargarCsv`), igual que en Ventas, Compras y
   Mantenimiento. **El servidor no genera ni devuelve un archivo CSV.**

## H · Seguridad

| control | resultado |
|---|---|
| rol | `app.current_role(p_company) in ('admin','employee')` antes de leer; si no, `sin_permiso` |
| `SECURITY INVOKER` | sí (`prosecdef = false`); la RLS de documentos, líneas, clientes y productos aplica |
| multiempresa | `p_company` validado contra la membresía del JWT; joins a clientes y productos filtrados además por `company_id = p_company` |
| grants | `revoke all from public, anon` · `grant execute to authenticated`; ACL medida `postgres`, `authenticated`, `service_role`; `search_path = public, pg_temp` |
| parámetros | lista blanca de dimensión/fuente/medida/período; límite 1..500; desplazamiento ≥ 0; mes futuro rechazado |
| advisors (security) | la función **no aparece**; los hallazgos listados son previos |
| JWT reales | admin y employee leen; salesperson, technician, customer, distributor, admin ajeno, empresa nula → `sin_permiso`; anon → 42501 |

## I · Performance

| medición | resultado |
|---|---|
| RPC Top 10, 7 llamadas con red (clientes y productos, importe y cantidad, mes y 12m) | medianas **188–258 ms** |
| página de 500 filas (productos · pedido · cantidad · 12m) | mediana **372 ms** |
| suite: Top 10 productos · pedido · 12m | mediana 184 ms · máx 205 ms |
| suite: ranking completo por combinación (46, paginado) | mediana 235 ms · máx 713 ms |
| navegador: cambio de filtro del ranking | pantalla **243–503 ms** (RPC 184–442 ms) |
| navegador: cambio de mes (3 RPC en paralelo) | **503 ms** en pantalla |
| CSV clientes · entregado · 12m · USD (26 filas) | **208 ms** |
| CSV productos · cotizado · cantidad · 12m (704 filas, 2 páginas de 500) | **651 ms**, 114.781 B |
| primeras llamadas en frío | 1,2 s y 2,8 s una vez cada una; no se repitió |

Piso de red ~190 ms. Nada sostenido por encima de 500 ms: **sin EXPLAIN ni índices nuevos**.

## J · Mobile y accesibilidad

| ancho | resultado |
|---|---|
| 390 (táctil) | sin desborde global; 0 controles < 44 px (incluidos los enlaces del ranking); 0 campos < 16 px; ranking en tarjetas |
| 430 (táctil) | ídem |
| 768 | sin desborde ni scroll interno; ranking en tarjetas (container query de la tarjeta) |
| 1440 | tabla completa, sin scroll interno |

- El puesto es un número escrito en su columna «Puesto», no un color.
- Tabla con `caption`, `th scope="col"` y nombre en `th scope="row"`.
- Grupos de botones con `role="group"` y `aria-label`; selección con `aria-pressed`.
- Estados vacíos: «Sin documentos de … en …» / «Sin datos para este ranking en …»; nunca un puesto 1 vacío.
- Las marcas (atípico, sin producto, inactivo) son texto.

## K · Tests

| suite | resultado |
|---|---|
| `scripts/fase10-informes-entrega3-tests.mjs` | **61 PASS · 0 fallos** |
| `scripts/fase10-informes-entrega1-tests.mjs` (regresión) | 0 fallos |
| `scripts/fase10-informes-entrega2-tests.mjs` (regresión) | 0 fallos |
| `npm run lint` · `npm run typecheck` | 0 errores |
| `npm test` · `npm run test:isolated` | 55 archivos · **650** tests cada uno |
| `npm run build` | OK · `InformesPage` 47,98 kB JS (12,54 kB gzip) + 10,77 kB CSS |

La suite de base se corre con `node --experimental-strip-types` porque importa
`src/modules/informes/lib/csv.ts`, la misma biblioteca de la app. Cubre:

- **Roles:** 8 identidades más empresa nula.
- **Parámetros:** 9 rechazos.
- **Fixtures, contra la regla en JS:** **36 rankings** del mes en curso y 36 del mes pasado, fila por fila y en orden. La regla se calcula en JS sobre filas crudas, aparte del SQL.
- **Casos puntuales:**
  - empate resuelto por nombre;
  - `customer_id`, nombre comercial vacío, SIN MONEDA;
  - cliente de baja;
  - último día del mes anterior, fuera de 12 meses, borrador;
  - fórmula de línea con descuento de línea, de cabecera e IVA;
  - SKU suelto agrupado exacto y sin fusionar minúsculas;
  - precio 0, atípico por precio del pedido, sin precio ≠ atípico;
  - remitos en borrador o cancelados;
  - producto borrado y discontinuado;
  - cantidad entre monedas.
- **Paginación:** Top N = primeras N del completo; páginas de a 2 concatenadas = completo; desplazamiento fuera de rango vacío.
- **CSV sobre filas reales:**
  - cabecera y SIN MONEDA;
  - fórmula `=HYPERLINK(…)` neutralizada, comillas y «» intactos;
  - filas = completo; precio 0 como `0.00`; «no aplica»;
  - BOM y ningún campo peligroso sin proteger;
  - nombre de archivo.
- **Buscatools:** paridad de **46 rankings** completos (ARS, EUR, SIN MONEDA, USD × mes y 12 m) contra filas crudas. GRAMPA en cantidad e importe. Regla de atípico sólo sobre GRAMPA.
- **Base intacta:** 288/166/182 documentos y 992/593/600 líneas, con la misma huella sha256 antes y después.

Unitarios nuevos (17):
- `lib/csv.test.ts`: escape, inyección, números negativos, BOM y acentos, nombres, CSV de ranking de clientes y de productos, precio 0, actividad y pipeline.
- `lib/rankings.test.ts`: monedas por período, combinaciones válidas, normalización sin «todas», atípico, enlaces por id, nombre de archivo.

### Datos reales (Buscatools, 12 meses a 2026-09-13)

**Clientes · entregado · USD** (26 clientes): 1. Grupo Mirgor S.A. 116.023,96 (70 remitos) · 2. Leonardo Gomez 68.804,52 (3) · 3. Mabe Argentina S.A. 43.078,99 (22) · 4. Máximo Suarez 25.888,11 (2) · 5. Adriano Cassano 23.851,97 (2).

**Clientes · entregado · ARS** (9): 1. WHIRLPOOL ARGENTINA S.A. 30.761.042,23 (18) · 2. Consulta Mercadolibre 2.503.471,84 (3) · 3. Diamela Cettour 1.197.900,00 (1) · 4. Nestor Bringas 1.057.540,00 (2) · 5. GILERA MOTORS ARGENTINA S.A. 868.858,65 (1).

**Clientes · entregado · SIN MONEDA · sep 2026** (4): WHIRLPOOL 12.921.677,51 (10) · Consulta Mercadolibre 72.598,79 (1) · Grupo Mirgor 1.956,31 (3) · Fastener Tools 338,11 (1).

**Productos · pedido · USD** (383): 1. FIAM AG60-RA 18.984,90 · 2. TORERO OBN-50PH 16.476,57 · 3. TORERO OBN-30PH 14.941,08 · 4. TORERO OBN-40PD 13.455,20 · 5. ESTIC EH2-R1020-P-PP 12.753,40.

**Productos · entregado · cantidad** (404, 13 SKU sueltos): 1. GRAMPA 80-4T 1.598.510 (atípico) · 2. BIDON DE AGUA 20 LITROS 1.565 · 3. ALQUILER DE DISPENSER (SER00006, línea sin producto) 397 · 4. CABLE DE LAZO AI 5200 200 · 5. GRAMPA PRENSACABLE 1/8'' 200.

## L · Bugs

### Del legacy

1. Top de productos por **unidades cotizadas** sin tratar outliers (GRAMPA encabezaba sin aviso) → acá, ranking por cantidad marcado y ranking por importe aparte.
2. Clientes agrupados por **nombre** → acá por `customer_id`.
3. CSV «Total USD» mezclando monedas → columna Moneda.

### Datos históricos (no se corrigen)

1. GRAMPA.80-4T: 2 líneas de pedido, 2 de cotización y 2 de remito con cantidad ≥ 1000 y precio 0.
2. 600 líneas de remito sin precio.
3. 186 líneas sin producto (86 + 38 + 62) con SKU que no existen en el catálogo, entre ellas el servicio SER00006.
4. 36 cotizaciones y 31 pedidos cuyo total guardado no coincide con sus líneas con IVA.

### Producto nuevo (Entrega 3) — encontrados y corregidos antes del commit

1. **Al cambiar de mes, el ranking volvía a «Clientes · Entregado · mes»:** la sección se desmontaba mientras cargaba la actividad → la selección vive en la página.
2. **`min()` del snapshot con la collation de la base (`en_US.UTF-8`):** no determinista contra la regla → `collate "C"` (segunda migración).
3. **En celular, el conteo solo en su celda mostraba «· 8»** → clase propia sin separador.
4. **Enlaces del ranking < 44 px en táctil** → `min-height: 44px` con puntero grueso.

### De otras fases (no se tocan; se reportan)

1. **CSV injection:** los CSV de Ventas, Compras, Clientes y Mantenimiento (`celda()` en cada `lib/csv.ts`) escapan separador y comillas, pero **no** anteponen `'` a textos que empiezan con `=`, `+`, `-` o `@`. Un nombre de cliente o una descripción así se ejecutaría como fórmula al abrir el archivo en una planilla.

### Errores propios de tests

1. Fixtures: el trigger de Ventas no deja cargar líneas en cotizaciones aceptadas, rechazadas o vencidas → se crean como `sent`, se cargan las líneas y después se cierra. Los totales se recalculan desde las líneas → los montos del fixture se diseñaron para eso.
2. La regla en JS suponía que la RLS oculta a admin los productos borrados: `products_write` (ALL) se los muestra → corregida la regla; la función estaba bien.
3. Esperar importe 0 para GRAMPA entero: tiene 10 unidades con precio → el test verifica que las líneas atípicas aportan 0 y que el importe es el de sus otras líneas.

## M · Limitaciones

1. La selección del ranking (dimensión, fuente, medida, período, moneda) **no va en la URL**: se mantiene al cambiar de mes, pero no se comparte por enlace.
2. Productos × entregado sin importe: los remitos no tienen precio y no se infiere del pedido.
3. Sin columna de unidad: se asume una unidad por producto; líneas de servicio (p. ej. alquiler) se cuentan como cantidad.
4. El archivo CSV se arma en el navegador con filas completas del servidor. Importes a 2 decimales (la base guarda 4).
5. Top N fijo en 10. El CSV trae todo.
6. «Inactivo» junta borrado, `inactive` y `discontinued`/`draft`, sin distinguir cuál.
7. Sin enlace para líneas sin producto ni para «SIN CLIENTE VINCULADO».
8. Fuera de alcance: stock, margen, costo, compras, mantenimiento, facturación, cobranzas, vendedor, rubro.
