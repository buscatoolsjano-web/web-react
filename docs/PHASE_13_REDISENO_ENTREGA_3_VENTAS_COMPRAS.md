# FASE 13 — REDISEÑO GLOBAL · ENTREGA 3 — VENTAS + COMPRAS

> Migración visual controlada de Ventas y Compras sobre las primitivas de E1 y el shell de E2.
> **Sin cambios de lógica**: mismas RPC, queries, payloads, cálculos, transiciones de estado,
> RLS, movimientos de stock, secuencias y autoridad STEL. Único ajuste de comportamiento visible:
> las acciones de escritura de Ventas se **ocultan** a los roles que la base ya rechazaba
> (ver E). Base: `8605031` (E2 `4a5c43c` + fixture). Fecha: 2026-09-14.

## A. Baseline

### Rutas inventariadas

| Módulo | Listados | Altas | Detalles |
|---|---|---|---|
| Ventas | `/ventas/cotizaciones` · `/ventas/pedidos` · `/ventas/entregas` | `/ventas/cotizaciones/nueva` · `/ventas/pedidos/nuevo` | `/ventas/cotizaciones/:id` · `/ventas/pedidos/:id` · `/ventas/entregas/:id` |
| Compras | `/compras/proveedores` · `/compras/pedidos` · `/compras/recepciones` · `/compras/facturas` | `…/proveedores/nuevo` · `…/pedidos/nuevo` · `…/recepciones/nueva` · `…/facturas/nueva` | `…/proveedores/:id` · `…/pedidos/:id` · `…/recepciones/:id` · `…/facturas/:id` |

`pages/DetallePage.tsx` existe pero **no está enrutada** (deuda, ver O).

### Fixture

`scripts/fase13-rediseno-ui-fixture.mjs` (sólo empresas `zz-f13ui-%` y usuarios `zz-f13ui-%`). Para E3 se
agregó una tercera empresa `zz-f13ui-stel`: cliente, secuencias, cotización `QUO-00001` y pedido `SAL-00001`
en borrador con una línea, y autoridad STEL para cotización/pedido/remito insertada **después** de los
documentos. Nada en la empresa Buscatools real.

### Medición (helper de navegador, localhost, mismas rutas antes y después)

Por ruta: h1, scroll horizontal de página, textos que no pasan AA (sin contar deshabilitados), elementos
sticky/fixed que tapan contenido, controles < 44px e inputs < 16px a 390px, alertas de error.

| Hallazgo ANTES | Dónde |
|---|---|
| **Barra de acciones sticky tapa la tabla de líneas** | Pedido detalle a 1440/1024/768/390 · Cotización detalle a 1024/390 · pedidos STEL a 390 |
| Inputs < 16px a 390 (zoom de iOS) | 6 por listado de Ventas (cotizaciones, pedidos, entregas) |
| Controles < 44px a 390 | OC-00002: 2 enlaces en línea |
| Filtros ocupan ~60% de la pantalla a 390 | listados de Ventas |
| `window.confirm` | Ventas: cancelar y borrar documento |
| «+ Nueva» visible a vendedor/técnico | listados de Ventas (la base rechazaba el alta) |
| Scroll horizontal / AA / alertas | 0 en las 15 rutas medidas |

Capturas de referencia ANTES: 1024 PED-00002 (barra sobre líneas), OC-00002, facturas vacío; 390 cotizaciones
(filtros), SAL-00001 STEL (barra sobre líneas). Las capturas no se versionan (datos de fixture).

### Base de datos

Snapshot de sólo lectura sobre empresas no `zz-` (conteos por estado de cotizaciones, pedidos, remitos,
órdenes de compra, recepciones y facturas de proveedor; total de movimientos de stock; MD5 de secuencias,
movimientos y autoridad de numeración). Resultado en K.

## B. Patrones compartidos nuevos

| Pieza | Archivo | Qué resuelve |
|---|---|---|
| `Alert` | `components/feedback/Alert.tsx` | Avisos info/warning/danger/success/neutral con ícono decorativo, título, acción y `role` elegido por contexto (`note` por defecto, `alert` para errores). |
| `LinkButton` | `components/ui/LinkButton.tsx` | Enlace de router con el aspecto de `Button` (acciones que navegan: «Nueva cotización», «Editar»…). |
| `FilterBar` | `components/filters/FilterBar.tsx` | `role="search"`; horizontal en escritorio; en < 768 búsqueda a la vista y el resto plegado detrás de «Filtros (n)» con `aria-expanded`/`aria-controls`; «Limpiar filtros» sólo si hay filtros. No toca estado de URL ni semántica. |
| `ActionBar` | `components/document/ActionBar.tsx` | Una primaria, secundarias agrupadas, peligro separado, nota con motivos. **En el flujo de la página** (nunca `fixed`/`sticky`). |
| `DocSection` · `MetaList` · `Missing` · `Totals` | `components/document/DocSection.tsx` | Secciones con h2 (`aria-labelledby`), metadatos como `<dl>`, «Sin registrar» explícito, bloque de totales con fila final destacada. |
| `Document.module.css` · `Tabla.module.css` | `components/document/`, `components/tables/` | Página de documento (max-width 1200) y tabla común (`tabular-nums`, orden con ícono, texto con ancho mínimo) + tarjetas mobile. |
| `useModalAccesible` | `components/modals/useModalAccesible.ts` | Lo extraído de `Dialog`: pila de modales, `inert` sobre `#root`, bloqueo de scroll, foco inicial, trampa de Tab, Escape, retorno del foco. Lo usan `Dialog`, `ModalImpresion` y `ModalImpresionCompras`. |
| `Pagination` | `components/tables/Pagination.tsx` | Suma selector «Por página» opcional y «Página X de Y». Tamaños de página **los mismos** de cada módulo. |

## C. Ventas

- **Listados** (`ListadoPage` compartido por cotizaciones, pedidos y entregas): `PageHeader` con conteo
  singular/plural, Exportar y «Nueva cotización» / «Nuevo pedido»; `FilterBar` (misma lógica de debounce
  y URL); tabla común con badges de estado y cumplimiento; tarjetas en mobile; skeleton; `ErrorState` con
  Reintentar; `EmptyState` distinto con y sin filtros; `Pagination` común (reemplaza `Paginador` propio).
- **Detalles** (cotización, pedido, remito): `PageHeader` (volver, número, badges, «Migrado», cliente · fecha ·
  título, total), avisos históricos y banner STEL como `Alert`, `ActionBar` en flujo, secciones «Datos del …»,
  «Líneas» (con totales), entregas, stock, adjuntos y relacionados. Carga con `Spinner`, error y «no encontrado»
  con estados propios.
- **Acciones del documento**: `AccionesDocumento` pasa a `useAccionesDocumento(doc)` y devuelve grupos
  (secundarias, peligro, motivo, capas) para la barra. Mismas mutaciones (duplicar/cancelar/borrar).
- **Alta** (`DocumentoNuevoPage`): `PageHeader`, secciones, totales estimados, `ActionBar` Guardar/Cancelar
  con los mismos ids de motivo.
- **Cabecera de cotización**: `Field` + `Input/Select/Textarea` en fieldsets «Cliente y referencia», «Fechas y
  condiciones», «Notas». Mismos campos y validaciones.
- **Líneas**: `TablaLineas` con tarjetas apiladas en mobile (`data-label`), ícono en vez de glifo para
  «fuera de catálogo»; `EditorLineas` con `IconButton` «Subir» / «Bajar» / «Eliminar línea».
- **Entrega parcial**: `ModalEntregaParcial` pasa a `Dialog` (lg, `busy`, sin cierre por overlay).
- **Estados**: `ChipEstado` sobre `Badge` (neutro→neutral, info→info, ok→success, alerta→warning, error→danger).
- Eliminados: 9 CSS Modules propios (listado, filtros, paginador, chip, avisos, acciones) y `Paginador.tsx`.

## D. Compras

- **Listados** (pedidos, recepciones, facturas): `PageHeader`, `Alert` para sin acceso / error de exportación,
  `FilterBar` (labels «Pedido desde/hasta», «Llegada desde/hasta»), tabla común con columna Estado que
  junta estado comercial y de recepción, skeleton, `ErrorState`, `EmptyState`. `Paginador` queda como
  **adaptador** sobre `Pagination` (mismo contrato + `sustantivo`). Proveedores: sólo el sustantivo.
- **Detalles** (pedido, recepción, factura): `PageHeader`, `Alert`, `ActionBar` (pedido: «Recibir mercadería» o
  «Confirmar pedido»; secundarias Editar/Imprimir/Facturar/Duplicar; peligro «Cancelar pedido»). Los
  «¿Seguro? Sí / No» en línea pasan a `ConfirmDialog` con las mismas mutaciones.
- **Altas**: `PageHeader`, Cancelar como botón ghost, retornos tempranos con `Alert` neutral, `Spinner`.
- `EditorLineas` con `IconButton`; `ModalImpresionCompras` con `useModalAccesible`.
- `ProveedorDetallePage.module.css` (compartido por 8 páginas): restyle con tokens de revisión, pestañas,
  bloques, datos, notas, errores, aviso de baja y tabla de líneas; controles 44px en puntero grueso.
- CSS Modules propios eliminados: 3 (chip, filtros, paginador). `ListadoPedidos.module.css` se conserva
  porque lo usa `FacturaDetallePage`.

## E. Acciones y permisos

**Alineación de la UI con la base (no se amplía ni se reduce ningún permiso).** En Ventas, RLS
(`quotes_write`, `orders_write`, `deliveries_write`, tablas de líneas, adjuntos), `next_document_number` y
`confirmar_entrega` exigen `app.current_writer_company_ids()` = **admin / employee**. La UI decidía con
`esInterno`, que también incluye vendedor y técnico: les mostraba «+ Nueva», Editar, Duplicar, Cancelar,
Eliminar y Adjuntar, y la base los rechazaba al guardar.

- Nuevo `modules/ventas/lib/permisos.ts` → `escribeVentas(rol)` (admin/employee), con test.
- Lo usan: listado («Nueva»), alta (vendedor/técnico ven «Tu rol no crea documentos de venta»), acciones del
  documento, editabilidad de cabecera/líneas, confirmación de remito y adjuntos.
- Textos de motivo: «Sólo el equipo interno edita …» → «Tu rol no edita … : es de administradores y empleados.»
  (`cotizaciones.ts`, `pedidos.ts`, `entregas.ts`; sólo el string).
- Compras ya decidía con `permisosDe` (admin/employee): sin cambios.

**Jerarquía de la barra**: una primaria por estado (Confirmar pedido / Generar nota de entrega / Generar
pedido / Confirmar y despachar / Recibir mercadería / Confirmar recepción / Facturar), secundarias
agrupadas y peligro separado (borde superior en mobile).

**Redundancia retirada**: el pedido de Ventas tenía «Cancelar pedido» propio y «Cancelar documento» en las
acciones compartidas, que ejecutan la **misma escritura**. Queda una sola acción «Cancelar pedido» (la
compartida, con confirmación).

**Guardia STEL intacta**: banner `aviso-autoridad-stel`, emisión y duplicado deshabilitados, y los mismos
`aria-describedby` / ids (`motivo-nueva`, `motivo-emision-pedido`, `motivo-emision-cotizacion`,
`motivo-duplicar-{id}`, `motivo-despachar`, `motivo-guardar`) con los mismos textos. Verificado en navegador
con la empresa STEL del fixture y en test.

## F. Diálogos

- `window.confirm` eliminado de Ventas (cancelar y borrar). En `src/modules/ventas` y `src/modules/compras`
  queda 0 llamadas (sólo una mención en un comentario).
- `ConfirmDialog` tono peligro: título específico («¿Cancelar pedido PED-00002?», «¿Eliminar pedido
  PED-00002?»), descripción de consecuencia, botón de salida «Volver» con **foco inicial**.
- Compras: confirmar/cancelar pedido, registrar/anular/borrar factura, confirmar («Confirmar y sumar stock»)
  y borrar recepción → `ConfirmDialog`.
- Verificado con teclado real en navegador: foco en «Volver», Tab cicla dentro, Escape cierra, el foco vuelve
  al disparador, `inert` se pone y se quita, hoja inferior en mobile; el pedido siguió Confirmado.
- Emails: fuera de alcance (conserva su `window.confirm`).

## G. Formularios

- `Field` aplicado donde era seguro: filtros de ambos módulos, cabecera de cotización, fecha de entrega parcial.
- Secciones con título: datos principales, cliente, condiciones, líneas, notas.
- Los metadatos de sólo lectura se muestran como `<dl>` (no como inputs deshabilitados).
- Inputs a 16px en mobile (0 inputs < 16px a 390 en las 15 rutas).
- No migrados (deuda): formularios de Compras (ver O).

## H. Tablas y listados

- Tabla común: cabeceras ordenables con `aria-sort` e ícono, números con `tabular-nums` alineados a la
  derecha, texto largo con ancho mínimo (sin columnas de 3–4 renglones a 1024), hover y fila seleccionada.
- Mobile: tarjetas enlazadas (número + estado, cliente, fecha, importe, observaciones) en vez de tabla.
- Estados siempre con texto (nunca sólo color).
- Paginación con «X–Y de N cotizaciones» (singular/plural), «Página X de Y» y el mismo tamaño de página.
- Sin DataTable genérico.

## I. Responsive

| Medición DESPUÉS (15 rutas × 1440/1024/768/390) | Resultado |
|---|---|
| Sticky/fixed tapando contenido | **0** (antes: pedido en los 4 anchos, cotización a 1024/390) |
| Scroll horizontal de página | 0 |
| Inputs < 16px a 390 | **0** (antes 6 por listado de Ventas) |
| Controles < 44px a 390 | 0, salvo 2 enlaces en línea de OC-00002 (exentos: enlaces dentro de texto) |
| Alertas de error | 0 |

Capturas DESPUÉS revisadas: 1024 PED-00002 (barra en flujo, líneas visibles), OC-00002 (pestañas a 768),
listado de cotizaciones; 390 cotizaciones (primera tarjeta a ~200px), PED-00002, OC-00002, SAL-00001 STEL.

## J. Accesibilidad

- 0 textos que no pasan AA en las 15 rutas (sin contar deshabilitados), en los 4 anchos.
- `IconButton` siempre con nombre accesible («Subir», «Bajar», «Eliminar línea», «Cerrar», «Borrar {archivo}»…).
- Íconos SVG propios, decorativos (`aria-hidden`), en lugar de emoji/glifos unicode.
- Modales de impresión con `aria-labelledby`, trampa de foco y Escape (antes no tenían).
- `FilterBar` con `role="search"`; contador de filtros anunciado («2 aplicados»).
- Vendedor en empresa B verificado: sin «Nueva» en cotizaciones/pedidos; `/ventas/cotizaciones/nueva` explica
  que su rol no crea documentos.
- Límite de la herramienta: la activación con Enter de botones nativos no se pudo simular con el driver del
  navegador (sí Tab y Escape reales); es comportamiento nativo del `<button>`.

## K. Regresión visual y base de datos

| Chequeo | Antes | Después |
|---|---|---|
| sales_quotes accepted / sent | 134 / 154 | 134 / 154 |
| sales_orders confirmed/delivered · confirmed/pending | 140 · 26 | 140 · 26 |
| deliveries delivered | 182 | 182 |
| purchase_orders / goods_receipts / supplier_invoices reales | 0 | 0 |
| stock_movements | 381 | 381 |
| MD5 secuencias | `412c8d53…` | `412c8d53…` |
| MD5 movimientos de stock | `489a5bff…` | `489a5bff…` |
| MD5 autoridad de numeración | `f7b01823…` | `f7b01823…` |

Tomado dos veces después: con el fixture activo y después de limpiarlo. **Idéntico.**

Limpieza: sesión zz del navegador borrada (`bt-auth`, `bt-empresa-activa`), `fixture limpiar` → 3 empresas y
2 usuarios zz borrados; SQL: 0 empresas zz, 0 usuarios zz, 0 cotizaciones/pedidos/clientes/secuencias/autoridad
huérfanos; temporales `node_modules/.zz-*` borrados; servidor de preview detenido.

No se corrió ninguna suite vieja que escribe en Buscatools real (`stage1-ventas-*`, `stage3-*`,
`fase6-cierre-tests`, `fase7-mantenimiento-entrega5-tests`).

Guardas de diff: 0 cambios en `.rpc(` / `.from(` / `.select(` / `.insert(` / `.update(` / `.delete(`;
en `services/` sólo cambian 3 strings de motivo; 0 `!important`; 0 hex nuevos fuera de `tokens.css`.

## L. Tests

Nuevos (25 tests, sin cliente de Supabase — servicios y hooks mockeados):

| Archivo | Cubre |
|---|---|
| `modules/ventas/lib/permisos.test.ts` | `escribeVentas` por rol |
| `modules/ventas/pages/ListadoPage.test.tsx` | «Nueva» visible a admin/employee y oculta a salesperson/technician/customer; STEL (banner, deshabilitada, `motivo-nueva`); h1 + singular/plural + paginación; vacío con/sin filtros; error con Reintentar; filtros plegados en mobile |
| `modules/ventas/components/AccionesDocumento.test.tsx` | acciones por rol; `ConfirmDialog` con título y descripción específicos, foco en «Volver», confirma llama al servicio, nunca `window.confirm`; «Volver» no ejecuta; Duplicar deshabilitado con motivo STEL |
| `components/document/Document.test.tsx` | `ActionBar` (grupo, sin estilos fijos, vacío no renderiza), `DocSection`/`MetaList`/`Missing`/`Totals`, `Alert`, `FilterBar` escritorio/mobile |
| `modules/compras/components/ChipEstado.test.tsx` | etiquetas de estados de Compras; `Paginador` conversión de página, pluralización y tamaño |

Existentes que siguen verdes sin cambios de expectativa: `Dialog` (14), `TablaLineas` (4), shell y primitivas.

| Comando | Resultado |
|---|---|
| `npm run lint` | 0 problemas |
| `npm run typecheck` | OK |
| `npm test` | 79 archivos / 858 tests |
| `npm run test:isolated` | 79 / 858 (dos corridas seguidas). Una primera corrida, lanzada justo después de `npm test`, dio 16 fallos en 11 archivos (incluidos tests de Configuración no tocados); los mismos archivos pasan solos y las dos corridas completas siguientes pasaron. Se anota como inestabilidad bajo carga, sin causa raíz confirmada. |
| `npm run build` | OK; `/dev/ui` fuera de `dist/` (0 coincidencias) |

## M. Bundle

`vite build --manifest`; cada módulo suma sus chunks de páginas más los compartidos que carga.

| Grupo | Antes JS (gzip) · CSS (gzip) | Después JS (gzip) · CSS (gzip) |
|---|---|---|
| Inicial | 125.2 kB (37.3) · 20.4 kB (4.7) | **123.0 kB (36.1)** · 20.4 kB (4.7) |
| Ventas (8 páginas) | 125.6 kB (40.9) · 59.1 kB (13.9) | 141.9 kB (50.8) · 66.2 kB (16.8) |
| Compras (12 páginas) | 210.5 kB (71.3) · 68.2 kB (18.3) | 230.5 kB (81.6) · 86.3 kB (23.4) |

El inicial baja 2.2 kB. Ventas y Compras suben ~10 kB gzip de JS y 3–5 kB gzip de CSS: ahora cargan
primitivas que antes no usaban (`Field`, `Dialog`/`ConfirmDialog`, `Badge`, `Pagination`, `FilterBar`,
`Alert`, íconos). Son chunks compartidos: se descargan una vez para ambos módulos, así que la suma no es
aditiva para quien usa los dos.

## N. Bugs corregidos

1. **P0 — barra de acciones tapando la tabla de líneas** (pedido en todos los anchos, cotización a 1024/390):
   la barra sticky se reemplazó por `ActionBar` en el flujo. 0 solapamientos medidos.
2. «+ Nueva» y acciones de escritura visibles a vendedor/técnico en Ventas, que la base rechazaba (E).
3. Inputs de 14px en filtros de Ventas a 390 (zoom automático en iOS).
4. Cliente/título partidos en 3–4 renglones en el listado de Ventas a 1024.
5. Doble «Cancelar» en el pedido de Ventas (misma escritura).
6. Modales de impresión sin trampa de foco, Escape ni retorno del foco.
7. Filtros de Ventas ocupando ~60% de la pantalla a 390.

## O. Deudas

- `modules/ventas/pages/DetallePage.tsx` + `.module.css`: código muerto, no enrutado. Borrar en una entrega de limpieza.
- Formularios de Compras sin migrar a `Field`: `FormularioPedido`, `CabeceraPedido`, `EditorLineas` (inputs),
  `GrillaRecepcion`, `GrillaFactura`, `LineasLibresFactura`, `PanelTotales`.
- Páginas de Proveedores casi sin tocar (sólo paginación y el CSS compartido).
- Cotización: «Marcar rechazada» y «Cancelar cotización» hacen escrituras equivalentes; se dejó la
  distinción de negocio sin cambios, pero conviene decidir si ambas deben existir.
- Pedido STEL: el motivo de emisión y el de duplicado muestran el mismo texto en dos renglones.
- `ListadoPedidos.module.css` sigue vivo sólo por `FacturaDetallePage`; `rangoVisible` de `ventas/lib/formato` y `compras/lib/formato` quedó sin llamadores en producción (sólo tests).
- Enlaces en línea < 44px (OC-00002) exentos por ser texto.
- `test:isolated` con una corrida inestable bajo carga (L).
- Emails conserva `window.confirm` (fuera de alcance).
