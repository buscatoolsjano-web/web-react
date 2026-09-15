# FASE 13 — REDISEÑO GLOBAL · ENTREGA 6 — DASHBOARD + LOGIN + CIERRE VISUAL GLOBAL

> Última entrega de la fase: Inicio útil por rol, pantallas de Auth, prioridad de columnas en tablas,
> deudas visuales de E3–E5 y barrido global. **Sin cambios de lógica de negocio**: mismas consultas, RPC,
> RLS, permisos, rutas, estados y acciones. 0 archivos en `services/` o `hooks/` modificados (se borró
> `services/supabase/health.ts`, código muerto con 0 referencias). Auth de Supabase (Site URL, redirects,
> PKCE, hash, `PASSWORD_RECOVERY`, invitaciones, SMTP, largo mínimo) sin tocar. Emails backend, STEL,
> WhatsApp y base productiva sin tocar. Base: `5762d79` (E5 cerrada). Fecha: 2026-09-15.
> **Commit local, sin push.** La fase no se declara cerrada acá (ver O).

## A. Baseline final

### Qué se midió

| Grupo | Rutas / estados | Anchos |
|---|---|---|
| Auth | Login, Recuperar (formulario), Definir contraseña (enlace vencido), usuario sin empresa. El éxito de Recuperar, la invitación y el guardado se cubren con tests (en navegador exigirían enviar un correo o consumir un enlace real) | 1440 / 1024 / 768 / 390 |
| App (17 rutas) | Inicio, 404, cotizaciones, pedido de venta, pedidos de compra, proveedor, catálogo, cliente, órdenes, orden, emails, hilo, informes, numeración, usuarios, atributos, auditoría | 1440 / 1024 / 768 / 375–390 |
| Inicio por rol | admin con datos, vendedor, admin STEL, admin empresa vacía, técnico, cliente de portal | 375 / 768 (+1440 admin) |

Medidor en el navegador (archivo temporal ignorado, ya borrado): h1, scroll horizontal del documento,
desborde de tablas, contraste AA de texto real, blancos táctiles < 44 px, inputs < 16 px a 390, controles
sin nombre, glifos unicode como íconos, «Cargando…» suelto y `<title>`.

### Fixture (`scripts/fase13-rediseno-ui-fixture.mjs`, empresas y usuarios `zz-f13ui-*`)

Ampliado para E6 con tres empresas: **Vacía** (admin, sin documentos), **Técnico** (rol technician) y
**Portal** (rol customer; crea un cliente propio porque `chk_external_link` exige `customer_id`), más un
usuario aparte para el enlace de recuperación. Todos los enlaces se generan con `generateLink`
(**no se envía ningún correo**), se guardan en un archivo ignorado y se abren desde la propia página sin
imprimirse. `limpiar` corregido: las membresías se borran antes que `customers` (la del portal apunta a un
cliente y la primera pasada fallaba por FK; verificado con preparar + limpiar de una sola pasada).

Enlace vencido: simulado con el hash de error que devuelve Supabase (`error_code=otp_expired`), sin
consumir enlaces reales. Emails: interceptor de `fetch` a `/gmail/` y `.run.app` antes de visitar la
bandeja y el hilo; nunca se escribió en el composer.

### Medición ANTES

| Hallazgo | Dónde |
|---|---|
| Inicio = pantalla de verificación de Fase 1 («Conexión a Supabase», «Cliente Demo A») | `/` |
| `<title>` «BUSCATOOLS», marca en texto «BUSCATOOLS» en Auth | index.html, AuthLayout |
| «¿Olvidaste tu contraseña?» con blanco táctil de 16 px (12 px a 390) | Login |
| Tablas que desbordan su caja, 1024 px | cotizaciones 248, pedidos de compra 167, numeración 151, usuarios 20, auditoría 113 |
| Tablas que desbordan su caja, 768 px | cotizaciones 313, pedidos de compra 247, numeración 216, usuarios 100, atributos 10, auditoría 193 |
| 390 px | stock y pendientes del pedido: 30 y 156 px, una palabra por renglón; emails del cliente 19 px de alto |
| Acciones destructivas de un clic, sin confirmación | Mantenimiento: borrar adjunto, dar de baja equipo, borrar punto |
| Confirmación en línea (botones «Confirmar baja / No») | Compras: baja de proveedor |
| Glifos `↑ ↓ ⚠ → ←` como íconos | Compras (proveedores, historial, proveedor, alta) |
| «Cargando…» como texto suelto | 15 paneles de Clientes, Compras, Mantenimiento y Ventas |
| h1 = 1, AA 0, scroll horizontal del documento 0 | todas las rutas |

### Base de datos ANTES (empresas no `zz-`, `md5` por fila)

`auth.users` no zz 7 · brands 26 · companies 2 · company_memberships 8 · customers 1010 · deliveries 182 ·
document_sequences 20 · email_accounts 1 · email_events 2 · email_send_requests 2 · email_thread_reads 3 ·
email_thread_state 0 · maintenance assets/orders/audit 0 · check_points 16 · numbering_authority 3 ·
price_lists 4 · product_attribute_definitions 26 · product_categories 9 · product_prices 12505 ·
products 21775 · purchase_orders 0 · sales_orders 166 · sales_quotes 288 · stock_balances 379 ·
stock_movements 381 · suppliers 142 · users/company/catalog_audit 0/0/0 · warehouses 2 · zz 0/0.
Tablas vivas (sync de Gmail): email_threads 279 · email_sync_log 186.

## B. Dashboard (Inicio)

Reemplaza el placeholder de Fase 1. **Ninguna consulta nueva**: sólo hooks que ya existían.

| Vista | Roles | Contenido |
|---|---|---|
| Operativa | admin, employee | Cotizaciones abiertas y Pedidos por entregar (RPC de Informes `informe_pipeline_comercial`), Órdenes de servicio abiertas (listado de Mantenimiento, `porPagina 10`, sólo si el rol ve Mantenimiento), Emails pendientes (bandeja con `porPagina 1`, **sólo si la empresa tiene cuenta**), «Emitido este mes» (`informe_actividad_comercial`) con «Ver informe completo» |
| Ventas | salesperson | Cotizaciones pendientes y Borradores (listado de Ventas, `porPagina 5`), «Pendientes más recientes» |
| Accesos | technician, customer, distributor y resto | Sólo accesos rápidos |

- **Monedas**: cada importe se muestra por moneda (ARS, USD, EUR…) en una lista; `SIN MONEDA` al final.
  No hay total general, suma entre monedas ni conversión (test dedicado).
- **Alertas sólo con dato confiable**: autoridad STEL («STEL numera cotizaciones, pedidos y notas de
  entrega» + «Ver numeración» si el rol ve Configuración) y documentos del mes marcados para revisar,
  con cuántos no tienen moneda. Ninguna alerta de deuda técnica.
- **Accesos rápidos**: salen de `navegacionPara(rol)`, la misma función del menú, así que nunca ofrecen
  una ruta que el menú no ofrezca (Compras, Mantenimiento, Informes y Configuración sólo para quien los ve).
- **Empresa sin actividad**: «Aún no hay actividad registrada» + accesos, en lugar de tarjetas en cero.
- **Carga / error por tarjeta**: skeleton mientras carga (nunca un 0 inventado); si falla, «No se pudo leer
  este dato.» + Reintentar en esa tarjeta, sin tumbar el resto.
- **Layout**: 4 columnas ≥ 1280, 2 columnas < 1280, 1 columna < 600. PageHeader «Inicio» con
  «empresa · rol».
- **Consultas**: 6 hooks de datos en la vista operativa (pipeline, actividad, órdenes, cuentas, bandeja,
  autoridad), 2 en la de ventas y 0 en la de accesos, todos con la caché compartida de TanStack Query; conteo según el código, no medido en red.

Verificado en navegador con el fixture: los números del Inicio coinciden con los listados (4 órdenes
abiertas, 3 hilos pendientes, 3 cotizaciones abiertas = 2 enviadas + 1 aceptada sin pedido). Vendedor B,
STEL y Vacía muestran el estado vacío (STEL con su alerta); Técnico y Portal, sólo accesos.

## C. Login / Auth

- `AuthLayout`: `<main>` con tarjeta centrada en desktop y formulario directo sin tarjeta < 480 px; logo
  **PNG oficial** sin modificar (`alt="Buscatools"`) + «ERP»; pie «Buscatools ERP · Sistema de gestión
  interno».
- Login: `Field`/`Input`, `Button` con `loading` y `block`, error en `Alert`, enlace de recuperación con
  blanco de 44 px. Mismo `iniciarSesion`, misma redirección.
- Recuperar: formulario → enviando → éxito **genérico** («Si existe una cuenta asociada, vas a recibir un
  correo.», sin enumeración) → límite / sin red en `Alert`. Mismo `solicitarRecuperacion`.
- Definir contraseña: verificando (Spinner, `role=status`) → invitación («Bienvenido: elegí tu contraseña») o
  recuperación → validación local (largo mínimo y coincidencia, ayuda asociada al campo) → guardada;
  «El enlace venció» / «El enlace no sirve» con salida a pedir otro. Mismo `procesarEnlaceDeAuth` y
  `definirContrasena`; el hash se sigue leyendo antes de montar el router.
- `ProtectedRoute` y estado de empresa: Spinner en lugar de texto. `ErrorPage` sin estilos inline.
- `<title>` y manifest: «Buscatools ERP». **Favicon**: se mantiene el existente (no hay un ícono oficial
  cuadrado del logo; vectorizar el PNG está fuera de regla).

## D. Fixes globales

| Área | Cambio |
|---|---|
| Foco | `--focus-ring` definido (1 px + halo 4 px, ≥ 3:1 sobre blanco); 23 hojas pasaron de `outline: 2px solid var(--primary)` a `var(--focus-outline)`, reset incluido |
| Confirmaciones | Mantenimiento: borrar adjunto, dar de baja equipo y borrar punto ahora piden `ConfirmDialog`; Compras: baja de proveedor pasa de botones en línea a `ConfirmDialog`. Mismas mutaciones |
| Compras (deuda E3) | Detalle de proveedor sobre PageHeader, ActionBar, Tabs, DocSection/MetaList, Alert, Skeleton/Error/Empty; alta con PageHeader; glifos → `Icon` |
| Carga | 15 «Cargando…» sueltos → `SkeletonRows`; logo de empresa con Spinner |
| Ventas mobile (deuda E3) | Stock y pendientes del pedido < 600 px: bloques apilados con etiqueta por dato (`data-etiqueta`), sin palabra por renglón |
| Táctil | emails del cliente y del proveedor con blanco de 44 px |
| Plural | Categorías: «su único producto» |
| Código muerto (0 referencias) | `ventas/pages/DetallePage` (+css), `clientes/components/PanelContactos` (+css), `mantenimiento/components/Panel.module.css`, `services/supabase/health.ts`, y `rangoVisible` / `totalDePaginas` / `rangoPagina` en 6 `lib/` con sus tests (sólo borrados, 141 líneas) |

Barrido: `window.confirm` 0 · diálogos propios sin foco/Escape 0 · paginadores propios 0 · variables CSS
no definidas 0 · `!important` nuevos 0 · hex nuevos fuera de tokens 0.

**Toasts: no se implementan.** Auditado: cada acción ya informa en su lugar (botón con `loading`, `Alert`
o `StatusMessage` junto al formulario, estado nuevo visible en la ficha, diálogo que se cierra). Un toast
agregaría un segundo canal para el mismo mensaje, lejos del control, que desaparece solo (malo para lectores
de pantalla y para errores) y obligaría a tocar cada mutación. Queda 0 → 0.

## E. ResponsiveTable y prioridad de columnas

- `ResponsiveTable`: `hideBelow?: 'lg' | 'xl'` por columna (oculta < 1024 / < 1280), `th scope="col"`,
  carga con `SkeletonRows`, CSS tokenizado. En mobile sigue la tarjeta con todos los datos.
- Mismas clases en `Tabla.module.css` para tablas nativas; `.texto` baja su mínimo a 9 rem < 1280.
- Lo oculto sigue visible en otro lugar (línea compacta bajo la columna principal, tarjeta o ficha):

| Pantalla | < 1280 | < 1024 | Dónde queda el dato |
|---|---|---|---|
| Numeración | próximo, mayor, documentos | — | línea «Próximo … · mayor … · N documento(s)» bajo el tipo |
| Usuarios | ingreso | — | línea bajo la persona |
| Atributos | — | filtrable | línea bajo el nombre |
| Auditoría | entidad | fecha | líneas bajo el evento |
| Cotizaciones / pedidos / entregas | título, vendedor | origen | ficha del documento y tarjeta mobile |
| Pedidos de compra | líneas, creado por | llegada estimada | ficha del pedido y tarjeta mobile |

- **STEL**: «Autoridad STEL» y «Emisión desde ERP bloqueada» se apilan (sin desborde a 1440) y quedan
  visibles en tabla a 1440/1024/768 y en tarjeta a 390 (test dedicado).

## F. Accesibilidad

- 17 rutas × 4 anchos + Auth × 4 + Inicio × 6 roles × 2: **h1 = 1 · AA 0 fallas · controles sin nombre 0
  · glifos 0 · blancos < 44 px 0 · inputs < 16 px a 390: 0**.
- Foco: anillo confirmado con Tab (tras la transición CSS).
- Diálogos (navegador, **sin confirmar nada**): baja de proveedor, baja de equipo y borrar punto →
  `role=alertdialog`, foco adentro, Escape cierra, el foco vuelve al botón que lo abrió.
- Pestañas de la orden: flechas, Inicio y Fin mueven selección y foco; `tabindex=-1` en las no activas;
  `aria-controls` apunta a un panel existente.
- Auth: `role=status` en éxito y verificación, `role=alert` en errores, ayuda del campo asociada con
  `aria-describedby`.

## G. Responsive (DESPUÉS)

| Ancho | Rutas | Scroll horizontal documento | Tablas que desbordan | Otros hallazgos |
|---|---|---|---|---|
| 1440 | 17 | 0 | 0 | 0 |
| 1024 | 17 | 0 | 0 (cotizaciones 248 → 0, pedidos de compra 167 → 24 → 0 tras bajar `.texto`) | 0 |
| 768 | 17 | 0 | 0 (cotizaciones 313 → 0, pedidos de compra 247 → 0, configuración 0) | 0 |
| 375/390 | 17 | 0 | 0 | 0 |
| Inicio × rol | 6 × 375 y 768 | 0 | — | 0 |

## H. Matriz de consistencia

PASS = verificado en E6 o en la entrega indicada · N/A = no aplica · KNOWN_DEBT = ver M.

| Módulo | PageHeader | FilterBar | Pagination | Badge | Dialog | Empty | Error | Responsive | AA | Teclado |
|---|---|---|---|---|---|---|---|---|---|---|
| Inicio | PASS | N/A | N/A | N/A | N/A | PASS | PASS | PASS | PASS | PASS |
| Auth | N/A (cabecera propia) | N/A | N/A | N/A | N/A | N/A | PASS | PASS | PASS | PASS |
| Ventas | PASS (E3) | PASS (E3) | PASS (E3) | PASS | PASS (E3) | PASS | PASS | PASS · editores KNOWN_DEBT | PASS | PASS (E3) |
| Compras | PASS | PASS (E3) | PASS (E3) | PASS | PASS (E6) | PASS | PASS | PASS · grillas KNOWN_DEBT | PASS | PASS |
| Catálogo | PASS (E4) | PASS (E4) | PASS (E4) | PASS | PASS (E4) | PASS | PASS | PASS | PASS | PASS (E4) |
| Clientes | PASS (E4) | PASS (E4) | PASS (E4) | PASS | N/A | PASS | PASS | PASS | PASS | PASS (E4) |
| Mantenimiento | PASS (E5) | PASS (E5) | PASS (E5) | PASS | PASS (E6) | PASS | PASS | PASS | PASS | PASS (E6) |
| Emails | PASS (compacto, E5) | PASS (E5) | PASS (E5) | PASS | PASS (E5) | PASS | PASS | PASS | PASS | PASS (E5) |
| Informes | PASS (E5) | PASS (E5) | PASS (E5) | PASS | N/A | PASS | PASS | PASS | PASS | PASS (E5) |
| Configuración | PASS (E5) | PASS (E5) | PASS (E5) | PASS | PASS (E5) | PASS | PASS | PASS (E6) | PASS | PASS (E5) |

## I. Regresión visual y base de datos

- Regresión por **medición** (sección G) + capturas puntuales de Inicio y Auth; no hay herramienta de diff
  de píxeles en el repo y no se agregó ninguna.
- Base de datos DESPUÉS (misma consulta, empresas no `zz-`): **iguales** auth.users, company_memberships,
  customers, deliveries, document_sequences, email_accounts, maintenance (0/0/0 y check_points),
  numbering_authority, price_lists, product_attribute_definitions, product_categories, product_prices,
  products, purchase_orders, sales_orders, sales_quotes, stock_balances, stock_movements, suppliers,
  warehouses. Residuos zz 0/0, huérfanos 0 (customers, memberships, threads, sync_log, products,
  suppliers, assets), storage zz 0.
- Tablas vivas: email_threads 279 → 311 y email_sync_log 186 → 218 (sync automático de Gmail).
- **Cambios que NO son de esta entrega** (detectados al comparar; no se revirtieron): entre 13:04 y
  13:14 UTC, un único usuario productivo existente (roles admin + salesperson, no `zz`, último login
  2026-09-14) editó sitio web y logo de la empresa (`company_audit` 0 → 2, `companies` md5 distinto),
  desactivó 9 marcas (`catalog_audit` 0 → 9, `brands` md5 distinto, mismas 26) y envió un correo nuevo
  (`email_send_requests` 2 → 3, `email_events` 2 → 3, `email_thread_reads` 3 → 4). En esa ventana esta
  sesión sólo operaba en localhost con el admin del fixture, sin membresía en empresas reales, y la
  pestaña de producción no se usó desde las 12:01 UTC. **Hay que confirmarlo con el equipo.**

## J. Bundle (build de producción, gzip entre paréntesis)

| | E0 | E5 cerrada (antes de E6) | E6 |
|---|---|---|---|
| JS total | 1515 kB | 1550.0 kB (497.2) | 1567.9 kB (504.6) |
| CSS total | 210 kB | 194.5 kB (51.4) | 202.6 kB (53.2) |
| Entrada JS | — | 127.9 kB (38.1) | 125.0 kB (36.5) |
| Entrada CSS | — | 20.4 kB (4.7) | 22.2 kB (5.0) |
| Inicial estático (entrada + vendors) | — | 649.4 kB (188.6) | 649.9 kB (188.6) |
| Chunk Inicio | — | 2.9 kB (1.2) | 13.8 kB (4.4) + CSS 5.8 kB (1.3) |
| Chunk Login | — | 1.7 kB (0.8) | 1.7 kB (0.9) |

Mayores: vendor-react 269.2 kB (84.7) · vendor-data 251.7 kB (65.4) · index 125.0 kB (36.5) ·
InformesPage 79.9 → 70.5 kB · OrdenDetallePage 62.1 kB · ClienteDetallePage 49.0 kB.
El Inicio crece +10.9 kB JS (+3.2 gzip) por sus tarjetas ; el código de Informes que usa (hooks y formato)
pasó a un chunk compartido, por eso InformesPage baja 9.4 kB. Carga inicial prácticamente igual (+0.5 kB).
`/dev/ui`, interceptor y medidor fuera de `dist`.

## K. Tests

| Gate | Resultado |
|---|---|
| `npm run lint` | 0 |
| `tsc -b` | 0 |
| `npm test` | 94 archivos · 921 tests OK |
| `npm run test:isolated` | 94 archivos · 921 tests OK |
| `npm run build` | OK |

Nuevos: `DashboardPage.test.tsx` (9: h1 y accesos por rol, monedas separadas sin total y SIN MONEDA al
final, plural, alertas STEL/revisión, sin cuenta de correo, empresa vacía, carga/error/Reintentar, vendedor
sin rutas ajenas, técnico/cliente sólo accesos), `AuthPages.test.tsx` (11: logo PNG y marca, login y error,
recuperación genérica sin enumeración, límite, verificando, vencido, inválido, validación y guardado,
invitación), `ResponsiveTable.test.tsx` (columnas esenciales/ocultables, tarjetas), `NumeracionPage.test.tsx`
(STEL en tabla y tarjeta). Ajustado: `AuditoriaPage.test.tsx` (el usuario aparece también en la línea
compacta). Borrados: tests de los helpers de paginación muertos.

Suites DB: sólo fixture-safe. **No** se corrieron `stage1-ventas-*`, `stage3-*`, `fase6-cierre-tests` ni
`fase7-mantenimiento-entrega5-tests` (escriben en Buscatools real).

## L. Bugs encontrados y corregidos

1. Inicio mostraba la verificación técnica de Fase 1 a cualquier usuario.
2. Tablas de cotizaciones/pedidos/entregas, pedidos de compra y Configuración desbordaban a 1024 y 768.
3. Chips de autoridad STEL desbordaban la celda a 1440 (visto en la revisión de producción de E5).
4. Stock y pendientes del pedido a 390: una palabra por renglón.
5. Borrar adjunto, dar de baja equipo y borrar punto se ejecutaban con un clic, sin confirmación.
6. «¿Olvidaste tu contraseña?» y emails de cliente/proveedor con blancos táctiles de 12–19 px.
7. `<title>` «BUSCATOOLS».
8. `limpiar` del fixture fallaba en la primera pasada por FK (membresía de portal → cliente).

## M. Deudas restantes

| Deuda | Por qué queda |
|---|---|
| 85 `<button>` nativos | En su mayoría celdas de orden de columna, chips de filtro, grillas de edición y controles internos de primitivas; migrarlos no cambia lo que se ve |
| 40 `<table>` nativas (editores de líneas de Ventas/Compras, grillas de recepción y factura, informes, impresión) | Tienen scroll interno propio y su tarjeta mobile; pasarlas a `ResponsiveTable` es un rediseño de edición |
| 61 colores literales fuera de tokens | Concentrados en las vistas de impresión (blanco/negro para papel) y la galería |
| 20 `font-size` distintos (16 px, 11 px, 10 px, 9 px… en impresión) y 18 media queries distintas | Impresión en mm/px a propósito; unificar breakpoints requiere tocar módulos ya cerrados |
| `StatusMessage` (25) conviviendo con `Alert` (98) | Mismo resultado visual; unificar es mecánico pero amplio |
| Glifo `→` en 2 textos | Es prosa («Stock 5 → 3»), no un ícono |
| «Cargando…» en 3 lugares | Acompañan un Spinner o son el subtítulo de Informes |
| Favicon abstracto | Falta un ícono oficial cuadrado; no se vectoriza el logo |
| Fuera de alcance (no tocado) | U-B-2, escritura REST de productos, SPF/DKIM/DMARC, corte STEL, suites viejas de Ventas, WhatsApp, legacy, datos Torquetools, usuarios pendientes, datos históricos raros |

## N. E0 → E6

| Métrica | E0 | E6 |
|---|---|---|
| Colores literales fuera de tokens | 105 | 61 |
| Variables CSS no definidas (usos) | 18 | 0 |
| `font-size` distintos | 22 | 20 |
| `border-radius` distintos | 11 | 9 |
| Media queries distintas | 17 | 18 |
| `<button>` nativos | 345 | 85 |
| `<Button>` compartido | 40 | 251 |
| `window.confirm` | 2 | 0 |
| Archivos con íconos unicode | 20 | 2 (prosa) |
| Diálogos propios sin foco/Escape | 7 | 0 |
| Paginadores propios | 6 | 0 |
| Pestañas con `role=tab` | 0 | 1 primitiva (5 usos) |
| Toasts | 0 | 0 (decisión documentada) |
| JS total | 1515 kB | 1568 kB |
| CSS total | 210 kB | 203 kB |
| Uso de primitivas | — | Field 112 · Alert 98 · Badge 85 · PageHeader 79 · EmptyState 59 · SkeletonRows 56 · DocSection 42 · ErrorState 39 · LinkButton 39 · Spinner 35 · IconButton 28 · ConfirmDialog 20 · Pagination 11 · FilterBar 10 · ActionBar 10 · Dialog 5 · Tabs 5 |

Script: `node scripts/fase13-rediseno-auditoria.mjs` (bloque «E0 → HOY»).

## O. Criterios de cierre de la Fase 13

Localmente cumplidos: gates verdes; 0 desbordes y 0 fallas AA en 17 rutas × 4 anchos, Auth e Inicio por
rol; STEL visible; confirmaciones destructivas con diálogo; base sin cambios atribuibles a la entrega;
fixture y temporales limpios; sin secretos ni `.zz-*` en el commit.

**La fase no está cerrada.** Para cerrarla:

1. Aprobación explícita del push de este commit.
2. CI de GitHub Actions en verde y deploy de GitHub Pages verificado.
3. Revisión en producción con fixture zz (sin usuarios reales ni correos): Inicio por rol (admin con
   datos, vendedor, vacía, STEL, técnico, cliente), Login / Recuperar / Definir contraseña (enlace vencido
   simulado), 404, usuario sin empresa, prioridad de columnas a 1024/768 y tarjetas a 390, diálogos de
   Mantenimiento y Compras sin confirmar.
4. Limpieza del fixture y comparación de base otra vez.
5. Confirmar con el equipo los cambios productivos del 2026-09-15 13:04–13:14 UTC (sección I).
