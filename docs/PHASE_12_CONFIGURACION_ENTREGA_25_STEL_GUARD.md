# Fase 12 · Configuración — Entrega 2.5: guardrail de convivencia con STEL

Mientras STEL Order sea la autoridad de numeración de un tipo de documento de
una empresa, el ERP **no emite** ese tipo. Lo impone la base, en la misma
transacción que la emisión, para cualquier llamador (admin, employee, service
role). La UI lo anticipa, pero la UI no es la que bloquea.

Fecha: 2026-09-14 · Proyecto `uaxcfufvapzulqvynanp` · Migraciones
`fase12_config_e25_stel_guard`, `fase12_config_e25_stel_guard_rls_primero`,
`fase12_config_e25_stel_guard_anon_rls_primero` (estado final en
[`docs/database/PHASE_12_CONFIGURACION_ENTREGA_25.sql`](database/PHASE_12_CONFIGURACION_ENTREGA_25.sql)).

---

## A. Resumen

| | |
|---|---|
| Autoridad | Tabla `document_numbering_authority (company_id, doc_type, authority STEL/ERP, reason)` + bitácora. Sin fila = ERP. |
| Estado cargado | Buscatools: `quote`, `sales_order`, `delivery` → **STEL**. Torquetools: **sin filas** (ver B.3). |
| Código de error | `external_numbering_authority` (message), con `details` = «La numeración de este documento todavía está administrada por STEL. No se puede emitir desde el ERP hasta completar la migración.» y `hint` = doc_type. |
| Puntos de bloqueo | `next_document_number` (antes del UPDATE de la secuencia) · triggers BEFORE INSERT/UPDATE en `sales_quotes`, `sales_orders`, `deliveries` · `confirmar_entrega` (antes de stock/reservas/eventos). |
| Sigue funcionando | Leer, buscar, filtrar, exportar, imprimir, históricos, editar borradores, cancelar/rechazar, importar documentos de STEL. |
| Secuencias | **No se tocaron.** Hash de `document_sequences` idéntico antes/después; BT COTI 2629 · PDV 1316 · RT 1424. |
| Pruebas | Suite nueva 46/46 · Config E2 71/71 · O4 stock 41 PASS / 0 hallazgos · unit 715/715 · lint · typecheck · build. |

## B. Auditoría previa

### B.1 Dónde se emite de verdad

La numeración se consume **al crear el borrador**, no al «emitir»: por eso el
bloqueo no puede ir sólo en los botones de estado.

| Acción (UI) | Servicio | Qué hace en la base |
|---|---|---|
| Nueva cotización | `crearCotizacion` | `next_document_number('quote')` + INSERT draft |
| Nuevo pedido / cotización → pedido | `crearPedido` · `convertirCotizacionEnPedido` | `next_document_number('sales_order')` + INSERT |
| Duplicar | `duplicarDocumento` | `next_document_number(quote/sales_order)` + INSERT |
| Generar remito | `crearEntregaDesdePedido` | `next_document_number('delivery')` + INSERT + líneas |
| Marcar enviada / aceptada | `cambiarEstado` | UPDATE `sales_quotes.status` |
| Confirmar pedido | `cambiarEstadoPedido` | UPDATE `sales_orders.commercial_status` |
| Confirmar y despachar | `confirmarEntrega` | RPC `confirmar_entrega`: stock, reservas, estado, eventos |

Funciones de base que numeran o insertan documentos de venta: sólo
`next_document_number` y `confirmar_entrega`. Ninguna Edge Function toca ventas.
El importador (`scripts/import-ventas-legacy.mjs`) escribe con service role y
`imported_at`.

### B.2 Datos reales

Buscatools: 288 cotizaciones, 166 pedidos, 182 remitos, **todos importados**
(`legacy_source = erp_store`), 0 nativos, 0 borradores propios. Torquetools: 0
documentos de venta.

### B.3 Torquetools

No hay documentos de venta, ni importación de STEL, ni referencias en la
documentación a que STEL numere Torquetools. **No se asumió**: no se cargó
ninguna fila. Sin fila rige el comportamiento anterior (el ERP numera). Queda
como **decisión pendiente**: si Torquetools también emite en STEL, se agregan sus
tres filas con una migración (queda auditado).

## C. Mecanismo de autoridad

- **Por qué una tabla nueva:** no existía ninguna columna ni tabla de
  configuración de autoridad (en E2 era un `CASE` sobre el slug dentro del
  diagnóstico). Una columna en `document_sequences` mezclaría la autoridad (que
  es por empresa + tipo) con cada serie, y obligaría a tocar la tabla de
  secuencias, que esta entrega no debía modificar.
- **Valores:** `CHECK (authority in ('STEL','ERP'))`, sin booleano ambiguo.
  `reason` obligatorio (3–500).
- **Acceso:** RLS activado sin políticas; `revoke all` a `public`, `anon`,
  `authenticated`. No hay pantalla ni RPC de escritura. La lectura para la UI es
  `autoridad_numeracion_empresa(p_company)` (miembros internos: admin, employee,
  salesperson, technician).
- **Bitácora:** `document_numbering_authority_audit` registra INSERT/UPDATE/DELETE
  (valor anterior, nuevo, motivo, `auth.uid()`, rol de base y rol JWT). Un UPDATE
  que no cambia nada no deja fila. **Los intentos de emisión bloqueados no se
  registran** (a pedido: sería ruido).
- **Diagnóstico de Numeración (E2):** ahora lee la tabla y devuelve además
  `autoridad_configurada`.

## D. Puntos de bloqueo (servidor)

La guarda central es `app.exigir_emision_erp(company, doc_type)`: lee la fila con
`FOR SHARE` y, si es STEL, lanza `external_numbering_authority`.

1. **`next_document_number`**: después del chequeo de permisos (un no-miembro
   recibe «sin permiso» y no se entera de la autoridad) y **antes** del
   `UPDATE document_sequences`. Aplica también sin JWT (service role).
2. **Triggers `trg_00_autoridad_numeracion`** (BEFORE INSERT OR UPDATE, primeros
   en orden alfabético) en `sales_quotes`, `sales_orders`, `deliveries`:
   - INSERT → bloqueado salvo vía de importación;
   - UPDATE que pasa a un estado emitido (`sent`/`accepted`, `confirmed`,
     `shipped`/`delivered`) → bloqueado;
   - UPDATE que mueve el documento a una empresa con autoridad STEL → bloqueado;
   - sesiones anon/authenticated que **no escriben** en esa empresa pasan de
     largo y las rechaza RLS como siempre (los BEFORE corren antes del WITH
     CHECK; sin esto un salesperson o anon recibía el código de autoridad en vez
     de «permission denied». Lo encontró la suite y se corrigió en dos
     migraciones cortas).
3. **`confirmar_entrega`**: chequeo después del lock `FOR UPDATE` y del permiso,
   **antes** de validar estado, stock, reservas, `derivar_cumplimiento` y
   `sales_audit`. Resultado medido: 0 movimientos, 0 reservas tocadas, 0 eventos.

**Atomicidad / TOCTOU:** el chequeo corre dentro de la misma transacción que la
emisión. El `FOR SHARE` hace que un cambio de autoridad concurrente espere a que
terminen las emisiones en curso, y que una emisión que llega durante el cambio
espere y relea el valor confirmado.

## E. Comportamiento por documento (empresa con autoridad STEL)

| | Crear / numerar | Duplicar / convertir | Transición de emisión | Editar borrador | Cancelar / rechazar | Leer / exportar |
|---|---|---|---|---|---|---|
| Cotización | bloqueado | bloqueado | enviar, aceptar: bloqueado | sí | sí | sí |
| Pedido | bloqueado | bloqueado | confirmar: bloqueado | sí | sí | sí |
| Remito | bloqueado | — | despachar/entregar: bloqueado (sin efectos) | sí (líneas) | sí | sí |

## F. Importar ≠ emitir

La vía de importación es: `imported_at` no nulo **y** un proceso de servidor
(`auth.role()` distinto de `authenticated`/`anon`: service role o conexión
directa). Un usuario que pone `imported_at` a mano sigue bloqueado (probado).

- Importar documentos ya numerados por STEL, en cualquier estado: **permitido y
  sin consumir la secuencia** (probado).
- Re-sincronizar estado de un importado desde el importador: permitido (probado
  borrador → enviada → aceptada). Límite **preexistente**: una cotización
  `accepted` no admite cambios de estado (trigger `bloquear_cotizacion_cerrada`),
  tampoco para el importador.

## G. Roles y procesos internos

| Identidad | Numerar (RPC directa) | INSERT directo | Despachar |
|---|---|---|---|
| admin, employee | `external_numbering_authority` | ídem | ídem |
| salesperson, technician, customer, distributor | sin permiso | sin permiso | sin permiso |
| admin de otra empresa | sin permiso | sin permiso | sin permiso |
| anon | sin permiso | sin permiso | sin permiso |
| service role (sin marca de importación) | `external_numbering_authority` | ídem | ídem |

Procesos internos legítimos:

- **Importador de documentos STEL**: service role + `imported_at`. Único camino
  que inserta en una empresa STEL.
- **Cambio de autoridad**: sólo por migración o conexión de servidor; queda en la
  bitácora. El service role tiene privilegios de administrador sobre la base: es
  un límite asumido, no un bypass de la app (la app nunca usa service role en el
  frontend, y ninguna Edge Function escribe ventas).

## H. UI

- `AvisoAutoridadStel`: banner «STEL sigue administrando la numeración de este
  documento.» con lo que sigue disponible en cada pantalla.
- Listados de cotizaciones y pedidos: «+ Nueva» deshabilitado con motivo. Remitos
  (sin alta): banner.
- Alta de cotización/pedido (URL directa): banner y «Guardar» deshabilitado.
- Cotización: «Generar pedido», «Marcar como enviada», «Marcar aceptada»
  deshabilitados; «Editar», «Rechazar», «Cancelar» habilitados.
- Pedido: «Confirmar pedido», «→ Nota de entrega» deshabilitados.
- Remito: «Confirmar y despachar» deshabilitado.
- «Duplicar» deshabilitado.
- Motivo visible (no tooltip) enlazado con `aria-describedby`; si en una barra se
  bloquean dos tipos, un solo motivo («…las cotizaciones y los pedidos…») para
  no agrandar la barra fija en mobile.
- Mientras se lee la autoridad, las acciones de emisión quedan deshabilitadas sin
  motivo; si la lectura falla no se inventa un bloqueo (decide la base).
- Error del servidor traducido en todas las acciones (`mensajeErrorVentas`).
- **Configuración → Numeración**: chips «STEL» + «Emisión desde ERP bloqueada»
  (en tarjetas mobile: «Autoridad» y «Estado de emisión»). La autoridad no se
  edita.

Revisión en navegador con un fixture (`scripts/fase12-configuracion-entrega25-ui-fixture.mjs`,
magic link de un solo uso, sin contraseñas): 10 pantallas a **390 · 430 · 768 ·
1440**, sin desborde horizontal, banner presente, acciones de emisión
deshabilitadas y las no emisoras habilitadas. Fixture limpiado.

## I. Pruebas

`scripts/fase12-configuracion-entrega25-stel-guard-tests.mjs` — **46/46 PASS**,
fixtures `zz-e25-*` borrados (0 empresas, 0 usuarios residuales).

1. Configuración: filas reales, Torquetools sin filas, CHECK, tabla y bitácora
   cerradas (admin, employee, anon), RPC de lectura por rol y entre empresas,
   diagnóstico desde la tabla.
2. `next_document_number`: matriz 6 roles + anon + service role + serie explícita
   + otra empresa × 3 tipos; código, mensaje y hint exactos; `customer` sigue
   numerando; secuencias STEL intactas.
3. INSERT directo: admin, employee, admin con `imported_at`, salesperson, service
   role, admin de otra empresa, customer, anon × 3 tablas; importación permitida;
   importar no consume secuencia.
4. Transiciones bloqueadas; edición de borradores permitida; mover a empresa STEL
   bloqueado.
5. `confirmar_entrega`: admin, service role y matriz de roles; huella de la
   empresa (secuencias, movimientos, saldos, reservas, eventos, documentos)
   idéntica.
6. 5 intentos (despacho y numeración) y 2 simultáneos (despacho y numeración):
   todos bloqueados, huella idéntica.
7. Control ERP: numerar, crear, enviar, confirmar, remito y despacho con stock
   (saldo 50 → 48).
8. Cambio de autoridad STEL → ERP → STEL auditado; la emisión obedece a la
   tabla; los bloqueos no dejan bitácora.
9. Datos reales: secuencias, autoridad, saldos, movimientos, reservas, eventos,
   documentos y bitácora idénticos.

**Antes / después (medido en la base, empresas reales):**

| | Antes | Después |
|---|---|---|
| `document_sequences` (hash) | `36f4cc5d…` | `36f4cc5d…` |
| Buscatools quote / sales_order / delivery | 2629 / 1316 / 1424 | 2629 / 1316 / 1424 |
| `stock_movements` (cantidad · hash) | 381 · `636aa81f…` | 381 · `636aa81f…` |
| `stock_reservations` · `sales_audit` | 0 · 0 | 0 · 0 |
| Cotizaciones / pedidos / remitos | 288 / 166 / 182 | 288 / 166 / 182 |

## J. Regresión

| Comando / suite | Resultado |
|---|---|
| `fase12-configuracion-entrega25-stel-guard-tests.mjs` | 46/46 |
| `fase12-configuracion-entrega2-tests.mjs` | 71/71 |
| `security-o4-stock-movements-tests.mjs` | 41 PASS · 0 hallazgos |
| `npm run lint` · `npm run typecheck` · `npm run build` | verdes |
| `npm run test:isolated` | 61 archivos · 715 tests |
| `npm test` | 715/715 con `--maxWorkers=3`; con los workers por defecto, 1–5 archivos no arrancaron por timeout del pool (carga de la máquina), sin tests fallidos |

**No ejecutadas, a propósito:** `stage1-ventas-tests`, `stage1-ventas-rls`,
`stage3-*` (Ventas), `fase6-cierre-tests` y `fase7-mantenimiento-entrega5-tests`.
Numeran o insertan sobre **Buscatools real** y después «restauran»
`document_sequences` con un UPDATE. Las de Ventas ahora quedan bloqueadas por
diseño y se cortarían a mitad de camino, con restauraciones calculadas sobre
números que ya no llegan. Correrlas escribiría secuencias reales, que esta
entrega tenía prohibido. Compras y Mantenimiento no tienen filas de autoridad:
el único cambio compartido (`next_document_number`) queda cubierto por la suite
E2.5 (tipo `customer` en la empresa STEL y todos los tipos en la empresa ERP).

## K. Bugs y deuda preexistentes (no corregidos)

1. **Suites que escriben en Buscatools real** (las de J): hay que portarlas a
   empresas fixture. Las de Ventas quedan inservibles mientras Buscatools sea STEL.
2. **UI ofrece alta a roles que no pueden escribir:** el listado muestra «+ Nueva»
   a todo interno (`esInterno`), pero la base sólo deja escribir ventas a admin y
   employee. Un salesperson o technician ve el botón y recibe «permission denied».
   Con STEL no se nota en Buscatools (está deshabilitado para todos).
3. **Re-sincronización de cotizaciones aceptadas:** `bloquear_cotizacion_cerrada`
   impide cambiar el estado de una `accepted`, también al importador (F).
4. **`npm test` en esta máquina:** timeouts intermitentes al arrancar workers de
   vitest (J).

Ninguno era imprescindible para el guardrail.

## L. Cutover STEL → ERP (diseñado, no implementado) y archivos

Cutover futuro, por tipo y por empresa, en una sola transacción:

1. Congelar la emisión en STEL para ese tipo e importar lo último.
2. Medir con Configuración → Numeración (`BEHIND` = colisión).
3. Si hace falta, alinear `next_number` con una migración revisada (no desde la app).
4. `UPDATE document_numbering_authority SET authority = 'ERP', reason = '…'`: queda
   en la bitácora, y el `FOR SHARE` serializa contra emisiones en curso.
5. Verificar con la suite (sección 8) y en la UI (desaparecen banner y bloqueos).

Reversión: el mismo UPDATE a `STEL`.

**Archivos**

- Base: `docs/database/PHASE_12_CONFIGURACION_ENTREGA_25.sql`.
- Ventas: `lib/autoridad.ts` (+test), `services/autoridad.ts`,
  `hooks/useAutoridadNumeracion.ts`, `components/AvisoAutoridadStel.tsx` (+css),
  `components/AccionesDocumento.tsx` (+css), `pages/ListadoPage.tsx` (+css),
  `pages/DocumentoNuevoPage.tsx`, `pages/CotizacionDetallePage.tsx`,
  `pages/PedidoDetallePage.tsx`, `pages/EntregaDetallePage.tsx`,
  `pages/EditorCotizacion.module.css`.
- Configuración: `lib/numeracion.ts` (+test), `services/numeracion.ts`,
  `pages/NumeracionPage.tsx`, `components/Configuracion.module.css`.
- Tipos: `src/types/database.types.ts`.
- Scripts: `scripts/fase12-configuracion-entrega25-stel-guard-tests.mjs`,
  `scripts/fase12-configuracion-entrega25-ui-fixture.mjs`.

No se tocó: STEL, valores de secuencias, importación, legacy, productos, precios,
WhatsApp, Emails, Informes, Entrega 3, delta migration, series de React, diseño
global.
