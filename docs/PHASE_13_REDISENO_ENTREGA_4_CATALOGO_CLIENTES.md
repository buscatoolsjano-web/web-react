# FASE 13 — REDISEÑO GLOBAL · ENTREGA 4 — CATÁLOGO + CLIENTES

> Migración visual controlada de Catálogo y Clientes sobre las primitivas de E1–E3.
> **Sin cambios de lógica**: mismas consultas, RPC, payloads, RLS, permisos, validaciones,
> precios, stock, relaciones y rutas. 0 archivos de `services/`, `hooks/`, `lib/` o `types/`
> modificados; 0 módulos fuera de alcance tocados. Base: `2043804` (E3 cerrada). Fecha: 2026-09-14.

## A. Baseline

### Rutas reales

| Módulo | Rutas | Piezas |
|---|---|---|
| Catálogo | `/catalogo` (listado + búsqueda + facetas), `/catalogo/:sku` (detalle) | `PanelFacetas` (chips de categoría y subcategoría, desplegables de marca y atributos enum/rango, filtros aplicados), resultados con `ResponsiveTable` + tarjeta mobile propia, `Paginador` propio, `ImagenProducto`, `ProductGallery` con visor propio, `ListaAtributos`, `Celdas` (precio, stock real/virtual, disponibilidad). Sin ABM de productos. |
| Clientes | `/clientes`, `/clientes/nuevo`, `/clientes/:id` | `FiltrosClientes`, `ListadoClientes` (tabla/tarjetas), `Paginador` propio (también en Precios), ficha con `PanelResumen` + 7 pestañas (Información, Contactos, Direcciones, Memoria de productos, Precios, Historial, Relacionados), `FormularioCliente` + `ListaDeTextos`, `EditorContactos`, `EditorDirecciones`, `PanelMemoria`, `PanelPrecios`, `PanelHistorial` + `GraficoActividad`, `PanelRelacionados`. |

Estados de producto que usa el frontend: `esKit`, `necesitaRevision` (el listado no trae `status`).
Estados de cliente: activo/inactivo, dado de baja (`deleted_at`), marcado para revisión, migrado.

### Fixture (`scripts/fase13-rediseno-ui-fixture.mjs`, empresa `zz-f13ui-*`)

Se amplió para E4: segunda categoría con 3 subtipos y 2 atributos filtrables (número con unidad y
texto), 22 productos más (30 en total; paginado de 25), fotos del propio sitio en la mitad, una foto
rota, un producto con 2 fotos + diagrama, un kit, uno a revisar, uno sin marca y un tercio sin precio.
Cliente 01 con ficha completa (nombre comercial, 2 emails, dominio, rubro, condición de pago, moneda,
notas, 2 contactos, 2 direcciones y 3 equivalencias en los tres estados) y un cliente mínimo (sólo
razón social). La empresa B (vendedor) sirve para los vacíos. La limpieza incluye ahora
`customer_product_aliases` y `product_images`.

### Medición ANTES (localhost, 10 rutas × 1440/1024/768/390)

| Hallazgo | Dónde |
|---|---|
| Contador de facetas **3.56:1** (chip activo, `opacity: .75`) | Catálogo en los 4 anchos |
| Glifos sueltos visibles (`▣` por producto, `▾`, `✕`, `←`, `↑↓`, `⚠`, `▲▼`) | 20 en Catálogo, 4 en Clientes, 3 en alta, 1–2 en detalles |
| 1024: columna Producto en 4 renglones, SKU partido, precio cortado dentro de la caja | Catálogo |
| 1024: tabla de clientes de 1039 px en una caja de 719 px | Clientes |
| 390: inputs < 16 px | Catálogo 1 («50 por página»), Clientes 2 |
| 390: primer resultado en y=518 (61 % de 844) con categoría; filtros de clientes 200 px, primer resultado y=415 | Catálogo / Clientes |
| 390: botones «Marca / Torque / Encastre» superpuestos entre sí; scrollbars visibles en chips | Catálogo |
| 390: ficha con 6 métricas + acciones antes de las pestañas (y≈1009) | Cliente |
| Confirmaciones en línea «Confirmar … / No» | Dar de baja, borrar contacto, dirección y equivalencia |
| Visor de imágenes propio sin trampa de foco ni `inert` | Detalle de producto |
| Scroll horizontal de página, alertas, sticky tapando | 0 en todas |

### Base de datos

Snapshot de sólo lectura sobre empresas no `zz-`: conteo + MD5 por fila de `products`, `product_images`,
`product_prices`, `price_lists`, `brands`, `product_categories`, `product_attribute_definitions`,
`customers`, `customer_contacts`, `customer_addresses`, `customer_product_aliases`, `sales_quotes`,
`sales_quote_lines`, `sales_orders`, `sales_order_lines`, `deliveries`, `document_sequences`,
`stock_movements`, `stock_balances` y autoridad de numeración. Resultado en K.

## B. Catálogo

- **`CatalogoPage`**: `PageHeader` («Catálogo», «N productos · Lista») con un solo h1; `FilterBar` común
  con la búsqueda (ícono de lupa que pasa a spinner mientras llegan resultados; mismo debounce de 300 ms
  y misma sincronización con la URL) y el selector de lista de precios cuando corresponde; facetas
  dentro del `FilterBar`; filtros aplicados siempre visibles debajo.
- **Vacíos distintos**: sin productos en la empresa → «Todavía no hay productos», sin CTA de crear (React
  no tiene ABM); sin resultados por búsqueda/filtros → «Ningún producto coincide» + «Limpiar filtros».
- **Error**: `ErrorState` con «Reintentar» (`refetch` de la misma consulta). **Carga**: `SkeletonRows`.
- **Paginación**: `Pagination` común («1–25 de 30 productos», «Página 1 de 2») con el tamaño 25/50/100 en
  la misma URL (`per`); el `select` suelto de la barra se fue a la paginación.
- **Detalle**: `PageHeader` (volver, nombre, SKU · marca · categoría · serie, badges Kit / Datos a revisar),
  galería + resumen (precio con la lista, stock real/virtual o disponibilidad), descripción,
  secciones «Características» y «Ficha» (`MetaList`; sin datos lo dice). Carga con `Spinner`, error con
  `ErrorState`, no encontrado con `EmptyState` + «Volver al catálogo».
- **Visor de imágenes**: `useModalAccesible` en un portal: fondo `inert`, trampa de foco, Escape, retorno
  del foco, ← → y contador «1 de 2»; botones `IconButton`.
- **Imagen faltante**: `Icon image` decorativo (`aria-hidden`) + «Sin imagen» sólo para lectores, sin
  opacidad. La degradación miniatura → original → placeholder no cambió.
- `columnas.tsx` y el `Paginador` propio se eliminaron; `ResponsiveTable` sigue existiendo para
  Configuración y Dashboard (no se tocó).

## C. Filtros y facetas

- Las tres capas se mantienen (categorías siempre, subcategorías con categoría, desplegables de marca y
  atributos), con rótulo visible por fila y los mismos cálculos de `catalog_facets`.
- Chips con tokens: activo sobre `--color-primary` con texto `--color-on-primary` (5.18:1); contador sin
  opacidad (`--color-text-muted` 5.35:1 en el chip normal, hereda en el activo).
- Desplegables: botón con título + valor + chevron SVG que rota; panel flotante en escritorio; en
  < 768 px se apilan a lo ancho y el panel se abre **en línea** (antes los botones se pisaban y los
  paneles se salían de la pantalla). Escape cierra y devuelve el foco. Inputs de búsqueda y rango con
  `Input` (16 px en mobile).
- Mientras cargan las facetas ya no se atenúan con opacidad (bajaba los textos de AA); sólo cambia el cursor.
- Filtros aplicados: chip con `aria-label="Quitar filtro: …"` e ícono `x`; «Limpiar filtros» ghost.
- Mobile: la búsqueda queda a la vista; categorías, subcategorías y desplegables detrás de «Filtros (n)».

## D. Resultados

| Ancho | Patrón |
|---|---|
| ≥ 1280 px | Tabla densa (filas ~56 px): miniatura 40 px, SKU, Producto (enlace) + badges, Marca, Categoría, Serie, Stock real/virt. o Disponibilidad, Precio con moneda en el encabezado. |
| 768–1279 px | Misma tabla sin columnas Serie y Categoría; la categoría pasa debajo del nombre (a 1024 la barra lateral deja ~720 px útiles). Medido: 0 px de scroll interno a 1024 y 768. |
| < 768 px | Tarjetas compactas enlazadas: imagen 64 px, SKU + precio, nombre en 2 líneas, marca · categoría · tipo, 1–2 atributos con unidad, badges y «Stock 0» con rótulo (antes «0» suelto). |

Precios con `tabular-nums` y alineados a la derecha; «Consultar» cuando no hay precio, como antes.
Stock: «12 / 10» visual y «12 real, 10 virtual» para lectores. El enlace de la tabla es el nombre; la
fila entera sigue abriendo el producto con el mouse (no hay acciones dentro de la fila).

## E. Clientes — listado

- `PageHeader` («N clientes»; Exportar, Limpiar selección, «Nuevo cliente» primario según el mismo
  `permisosDe`: admin/employee/salesperson).
- `FilterBar` con búsqueda, rubro y las dos casillas (misma lógica de URL y debounce).
- Tabla común: orden con ícono y `aria-sort`, CUIT con `tabular-nums`, estados como Badge («1
  observación», «Dado de baja»). Hasta 1279 px el nombre comercial pasa debajo de la razón social y el
  dominio deja de ser columna; hasta 1023 px también el rubro. Medido: 0 px de scroll interno a 1024 y 768.
- Tarjetas en mobile; `ErrorState` con Reintentar; vacío con filtros («Limpiar filtros») o sin clientes
  («Nuevo cliente» si el rol puede); `Paginador` ahora adaptador de `Pagination` (mismo contrato).

## F. Detalle del cliente

Jerarquía nueva, mismos datos y mismas consultas:

1. **Identidad** — `PageHeader`: nombre visible, razón social · referencia, badges (Dado de baja, Para
   revisar, Migrado), acciones: «Editar» primaria, «Dar de baja» separada en texto de peligro,
   «Reactivar» si está de baja.
2. **Avisos** — `Alert`: baja, errores, motivos de revisión con «Dar por revisado».
3. **Contacto** — contacto principal (de los contactos ya cargados), emails con `mailto:` (ya existía),
   teléfono (sin `tel:`: no había patrón), CUIT, dirección principal (de las direcciones ya cargadas).
4. **Actividad** — el mismo resumen de `resumen_cliente`, sin cajas por métrica; la ayuda va como
   `title` y en texto para lectores.
5. **Pestañas** (hay contenido propio suficiente en cada una): Datos comerciales, Contactos (n),
   Direcciones (n), Memoria de productos, Precios, Historial (n), Relacionados. Nuevo `Tabs` compartido
   con patrón ARIA (`tablist`/`tab`/`tabpanel`, ← → Inicio Fin).

- Datos comerciales como `MetaList` (no parecen campos); cada faltante con texto («Sin CUIT», «No
  definida», «Sin notas»); verificado con el cliente mínimo: 0 `undefined`/`null`.
- «Editar» abre el formulario **en su pestaña** (antes, desde otra pestaña el formulario no se veía).
- Contactos y direcciones: tarjetas con íconos `mail`/`phone`/`map-pin`, badge «Principal», Editar/Borrar
  con primitivas; vacíos con `EmptyState`.
- Memoria de productos: tabla común, estado como Badge (Sugerida/Confirmada/Descartada), aviso
  «La dio por buena la migración, no una persona» con ícono y texto (antes `⚠` con title).
- Precios: secciones, tabla común, variación con ícono + «sube/baja» (antes `▲▼`), paginación común
  «líneas». Historial: importes por moneda, gráfico y documentos en secciones; estado como Badge;
  atajos a Ventas con ícono. Relacionados: lista con ícono. Gráfico: sólo tokens.

## G. Formularios

- **Alta/edición de cliente**: `Field` + `Input/Select/Textarea` agrupados en Identidad, Contacto, Datos
  comerciales y Notas; referencia como dato de sólo lectura; `ListaDeTextos` con `Input`, `IconButton`
  «Quitar …» y «Agregar email/dominio». **Misma validación** (`validarCliente`): después de un intento
  fallido aparece un `Alert` con la cantidad de campos a revisar y cada campo queda con `aria-invalid` +
  mensaje asociado. Probado en el navegador: razón social vacía → «Revisá 1 campo»; guardado real sobre
  el cliente del fixture → se cierra el formulario y se ven los datos nuevos.
- Contactos, direcciones y equivalencias: mismos campos con `Field`, `Checkbox` y `Alert` de errores.
- El alta ocupa 880 px como máximo (no se estira a 1440); sin permiso muestra `EmptyState` con el mismo motivo.

## H. Responsive

Medición DESPUÉS (mismas 10 rutas):

| Ancho | Scroll X | Sticky tapando | AA | Inputs < 16 | Controles < 44 | Glifos | Alertas |
|---|---|---|---|---|---|---|---|
| 1440 | 0 | 0 | 0 | — | — | 0 | 0 |
| 1024 | 0 | 0 | 0 | — | — | 0 | 0 |
| 768 | 0 | 0 | 0 | — | — | 0 | 0 |
| 390 | 0 | 0 | 0 | **0** (antes 1 y 2) | 0 | 0 | 0 |

| Métrica | Antes | Después |
|---|---|---|
| Catálogo 390, primer producto con categoría | y=518 | **y=345** (barra de filtros 126 px, plegada) |
| Clientes 390, primer cliente / alto de filtros | y=415 / 200 px | **y=341 / 126 px** |
| Tabla de catálogo a 1024 / 768 (caja/contenido) | producto en 4 renglones, precio cortado | 719/719 · 639/639 |
| Tabla de clientes a 1024 / 768 | 719/1039 | 719/719 · 639/639 |
| Ficha de cliente 1024, inicio de pestañas | — | y=668 con contacto y actividad arriba |
| Ficha de cliente 390, inicio de pestañas | ≈1009 (tras 6 métricas) | 902, con contacto primero |

Catálogo a 768 con categoría: la barra de filtros abierta mide 287 px y la tabla empieza en y=510
(antes el primer resultado en 520).

## I. Accesibilidad (teclado real en el navegador)

- Pestañas de la ficha: ← mueve selección y foco, panel nombrado por su pestaña, un solo tab en el orden.
- `ConfirmDialog` de borrar contacto: título «¿Borrar el contacto ZZ Bruno Planta?», foco en «Volver», Tab
  queda dentro, Escape cierra y devuelve el foco a «Borrar», `inert` puesto y quitado, el contacto sigue.
- «Dar de baja»: «¿Dar de baja a ZZ Metalúrgica Uno?», foco en «Volver», cierra sin mutar.
- Visor de imágenes: en portal, `inert`, foco en «Cerrar», → pasa a «2 de 2», Escape vuelve al botón «Ampliar».
- Desplegable de marca: `aria-expanded`, Escape cierra y devuelve el foco.
- Encabezados: un h1 por página; secciones h2 (el título de diagramas de la galería pasaba de h1 a h3).
- `window.confirm` en Catálogo/Clientes: 0 (antes tampoco; lo que había eran confirmaciones en línea, ahora `ConfirmDialog`).
- Límite de la herramienta: la activación con Enter/Espacio de botones nativos no se pudo simular.

## J. Contraste

- **Contador de facetas**: 3.56:1 → sin opacidad, `--color-text-muted` (5.35:1) o `--color-on-primary` sobre
  primario (5.18:1). Test en `tokens.test.ts` que lee el CSS del panel (sin `opacity`, colores por token) y
  mide los pares.
- **Imagen faltante**: `▣` con `opacity: .5` → ícono `--color-text-muted` sin opacidad.
- Los hex sueltos de los dos módulos (`#d9600a`, `#fff`, `#f4f4f5`) pasaron a tokens.
- Medición de todos los textos visibles activos en las 10 rutas × 4 anchos: **0 fallas AA**.

## K. Regresión visual y base de datos

Capturas revisadas (no versionadas, datos de fixture): Catálogo 1024 con categoría antes/después; Catálogo
390 antes (botones superpuestos) / después (plegado y abierto con panel en línea); ficha de cliente 1024 y
390 antes/después; visor de imágenes.

| Tabla | Filas | MD5 antes = después (con fixture y tras limpiar) |
|---|---|---|
| products | 21 775 | `564466fc…` |
| product_images | 8 859 | `71d89c2a…` |
| product_prices | 12 505 | `fb49cb1c…` |
| price_lists / brands / product_categories / attribute_definitions | 4 / 26 / 9 / 26 | `05677212…` / `2d7f81f3…` / `1362b2e6…` / `f5ba43d2…` |
| customers | 1 010 | `9a105551…` |
| customer_contacts / addresses / product_aliases | 87 / 0 / 14 | `ea0b13d1…` / — / `9113e269…` |
| sales_quotes / lines | 288 / 992 | `215e6d68…` / `34e10a38…` |
| sales_orders / lines | 166 / 593 | `e4a6cc75…` / `524a21a8…` |
| deliveries | 182 | `b91158dd…` |
| document_sequences | 20 | `412c8d53…` |
| stock_movements / stock_balances | 381 / 379 | `489a5bff…` / `384a8999…` |
| autoridad de numeración | 3 | `f7b01823…` |

Limpieza: sesión zz del navegador borrada; `fixture limpiar` → 3 empresas y 2 usuarios; SQL: 0 empresas
y usuarios zz, 0 productos/imágenes/atributos/precios/clientes/contactos/direcciones/equivalencias
huérfanos, 0 SKUs `ZZF13-*`, 0 clientes «ZZ »; temporales borrados; servidor detenido. Ninguna suite vieja
que escribe en la empresa real se ejecutó.

## L. Bundle

| Grupo | Antes JS (gzip) · CSS (gzip) | Después JS (gzip) · CSS (gzip) |
|---|---|---|
| Inicial | 123.0 kB (36.1) · 20.4 kB (4.7) | 123.5 kB (36.3) · 20.4 kB (4.7) |
| Catálogo (2 páginas) | 42.8 kB (15.8) · 36.4 kB (9.3) | 55.4 kB (21.5) · 50.7 kB (13.5) |
| Clientes (3 páginas) | 85.8 kB (26.6) · 49.8 kB (10.7) | 106.3 kB (36.2) · 56.6 kB (14.8) |

El inicial sube 0.2 kB gzip por los tres íconos nuevos (`image`, `phone`, `map-pin`). Catálogo y Clientes
cargan ahora primitivas compartidas (`Field`, `FilterBar`, `Pagination`, `Dialog`, `Badge`, `EmptyState`,
`Tabs`, `Tabla.module.css`) que ya bajan Ventas y Compras: son chunks comunes, no se descargan dos veces.

## M. Tests

Nuevos (32; servicios y hooks mockeados, pasan también en `test:isolated`):

| Archivo | Cubre |
|---|---|
| `components/ui/Tabs.test.tsx` | roles ARIA, foco itinerante, ← → Inicio Fin con vuelta, click, panel nombrado, contador |
| `modules/catalogo/components/ImagenProducto.test.tsx` | sin imagen: ícono decorativo + «Sin imagen» sin `▣`; miniatura rota → original → placeholder |
| `modules/catalogo/components/PanelFacetas.test.tsx` | chips con `aria-pressed` y conteo, cambio de categoría descarta subfiltros, desplegable con Escape y foco, chevron SVG, filtros aplicados (quitar uno / limpiar / oculto sin filtros) |
| `styles/tokens.test.ts` (+1) | contador de facetas AA en chip normal y activo |
| `modules/catalogo/pages/CatalogoPage.test.tsx` | h1 único, singular/plural, paginación con tamaño, badge Kit y «Consultar», enlace al detalle, vacío de empresa sin CTA, vacío por filtros con «Limpiar filtros», error con Reintentar, mobile plegado |
| `modules/clientes/pages/ClientesPage.test.tsx` | «Nuevo cliente» por rol (admin/employee/salesperson sí; technician/customer no), badges y paginación en singular, vacíos, mobile plegado |
| `modules/clientes/pages/ClienteDetallePage.test.tsx` | orden de secciones, contacto como lista con `mailto:`, cliente mínimo sin null/undefined, Editar/Dar de baja por rol, `ConfirmDialog` con foco en «Volver» y sin `window.confirm`, Editar abre su pestaña, dado de baja con Reactivar |

| Comando | Resultado |
|---|---|
| `npm run lint` | 0 problemas |
| `npm run typecheck` | OK |
| `npm test` | 85 archivos / 890 tests |
| `npm run test:isolated` | 85 / 890 en **dos corridas seguidas**; el fallo intermitente de E3 no apareció |
| `npm run build` | OK; `/dev/ui` fuera de `dist/` |

## N. Bugs encontrados y corregidos (sólo presentación)

1. Contador de facetas por debajo de AA (3.56:1).
2. `▣` sin contraste ni semántica para la imagen faltante.
3. 390: botones de los desplegables de facetas superpuestos entre sí.
4. 1024: tabla de catálogo con precio y stock fuera de la caja; tabla de clientes de 1039 px en 719 px.
5. Inputs < 16 px a 390 (zoom de iOS) en Catálogo y Clientes.
6. Confirmaciones en línea («Confirmar … / No») para dar de baja y borrar contacto, dirección y equivalencia.
7. Visor de imágenes sin trampa de foco ni fondo inerte.
8. «Editar» en la ficha no mostraba el formulario si se estaba en otra pestaña.
9. Salto de encabezado (h1 → h3) en la galería del producto.
10. Opacidad de carga en las facetas que bajaba textos secundarios de AA.
11. Stock «0» sin rótulo en las tarjetas mobile.

## O. Deudas

- `modules/clientes/components/PanelContactos.tsx` + `.module.css`: código muerto (no se importa).
- `rangoVisible`/`totalDePaginas` de `catalogo/lib/formato` y `clientes/lib/formato` quedaron sin llamadores
  en producción (sólo tests).
- `GraficoActividad`: sólo se pasó a tokens; sus chips, selector y tabla no usan primitivas.
- El listado de productos no muestra activo/discontinuado: el tipo del frontend no trae `status` y no se
  agregaron columnas a la consulta (prohibido en E4).
- `tel:` no se agregó (no había patrón previo).
- Vendedor: ve «Editar» en todos los clientes; RLS sólo le permite los asignados (sin cambios; ya era así).
- `EditorDirecciones`: el comentario dice que no hay tipo «otra», pero `TIPOS_DE_DIRECCION` lo incluye
  (inconsistencia previa, no se tocó).
- Catálogo 768 con categoría: la barra abierta mide 287 px; se podría plegar también en tablet.
- Filas de chips con scroll horizontal sin barra visible: la última categoría puede quedar oculta sin pista.
- Deudas de datos sin tocar, sólo representadas: marcas de dos letras, categoría «Otros», productos
  históricos, clientes incompletos.
- Capturas del panel del navegador inestables a 1440 (render parcial); la medición se hizo por DOM.
- `test:isolated`: seguir observando el fallo intermitente registrado en E3 (no reapareció).
