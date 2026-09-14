# Fase 12 · Configuración — Entrega 0: auditoría legacy y mapa del ERP nuevo

Estado: **sólo lectura**, 2026-09-14. No se programó nada, no se crearon rutas ni
tablas, no se modificó RLS, no se tocó el legacy, STEL, WhatsApp, Emails ni
Informes. `MIGRATION_STATUS.md` no se actualizó.

## Fuentes

| fuente | cómo se leyó |
|---|---|
| `app.js` + `index.html` legacy (respaldo 2026-09-08, idéntico al publicado) | `scripts/fase12-configuracion-auditoria.mjs` (estático) + lectura de cada superficie |
| `erp_store` legacy | conteos por clave (auditoría global y Phase 11), sin contenido |
| Base nueva `uaxcfufvapzulqvynanp` | catálogo real (columnas, CHECK, policies, helpers `app.*`) + conteos. Consultas en `--sql` del script |
| React (`src/`) | rutas, constantes de rol, `features/empresa`, impresión |
| Docs previos | global coverage, Phase 3/3.5/4/5/7/10/11 |

Nombres de persona del equipo se usan tal como están en el código legacy
(`TEAM_USERS`). No hay emails, contraseñas, tokens ni UUID en este documento.

---

## A · Resumen

1. **«Configuración» no existe como sección en el legacy.** No hay entrada de menú
   ni render `renderConfiguracion`. Lo que hay son **20 superficies dispersas**:
   modales del header (usuarios, contraseña, tema, empresa), subpantallas de otros
   módulos (Emails › Configuración, WhatsApp › Configuración, Clientes › Rubros),
   el modal de producto, opciones de impresión y exportación de Mantenimiento. 19
   son reales y 1 es código muerto (`renderCatalogoAdminPrecios`).
2. **Casi toda la «configuración» del legacy vive en el navegador**:
   `erp_empresas_override`, `erp_prefs_*`, `erp_print_opts`,
   `erp_producto_overrides`, `erp_ai_config`… Sólo `erp_auth_users`,
   `erp_user_perms` y `erp_client_accounts` se sincronizan por `erp_store`.
3. **El ERP nuevo ya tiene el schema y la RLS** de casi todo: `companies`,
   `company_memberships` (7 roles), `profiles`, `warehouses`, `currencies`,
   `price_lists`, `product_prices`, `document_sequences`, `brands`,
   `product_categories`, atributos. **No tiene ninguna pantalla**: 0 rutas de
   configuración, `src/modules/configuracion` vacío.
4. **Inventario: 65 funcionalidades.** 15 ya resueltas en React · 1 migrable con
   modelo corregido · 12 necesitan sólo UI · 8 necesitan schema o regla · 16 no
   se migran por diseño · 8 bloqueadas por decisión · 3 código muerto ·
   2 placeholders (Q).
5. **Hallazgo central: el alta y edición de productos del legacy no persistía
   para nadie.** El modal escribe en memoria (`PRODUCTOS.push`, se pierde al
   recargar), en `erp_producto_overrides` del navegador (clave **ausente** en
   `erp_store`: nunca llegó al servidor) y en la base espejo del legacy vía RPC
   (que ninguna pantalla lee). Paridad con el legacy **no** exige un ABM; lo exige
   la decisión de **quién es el maestro de productos** (STEL o el ERP).
6. **Hallazgo de cutover: la numeración choca con STEL.** `document_sequences` de
   Buscatools tiene `delivery.next_number = 1424`, pero STEL ya emitió
   `RT0000001424`–`1426` (están en el legacy, no en React). Si React emitiera un
   remito hoy, **duplicaría un número fiscal-comercial**. Quién numera es una
   decisión bloqueante.
7. **Usuarios:** el equipo legacy son 6 (`TEAM_USERS`). En React hay cuentas para
   Jano, Juan, Norberto, Facundo y Admin — **falta Brian** (activo en el legacy
   esta semana) — y **sólo Jano inició sesión alguna vez**. Crear usuarios hoy
   requiere script con clave de servicio: no hay invitación desde la app.
8. **Configuración no bloquea el cutover por sí sola**, salvo tres decisiones:
   autoridad de numeración, maestro de productos/precios y roles del equipo. Lo
   que bloquea de verdad es la ingesta STEL → ERP nuevo (fuera de este módulo).

---

## B · Mapa legacy

### Superficies reales (el script las verifica por referencias en app.js + index.html)

| pantalla / modal | entrada | función (línea) | estado | datos | acciones | quién | persistencia |
|---|---|---|---|---|---|---|---|
| Datos de empresa | selector de empresa → «editar» | `abrirEditorEmpresa` (628) | REAL | razón social, CUIT, dirección, teléfono, WhatsApp, email, web, logo | editar, subir logo (dataURL) | cualquiera con acceso a la empresa | **localStorage** `erp_empresas_override` (no sincroniza) |
| Cambiar de empresa | header | `abrirEmpresaPicker` (606) | REAL | `EMPRESAS` hardcodeadas (3) + `usuario.empresas` | elegir; vista «TODAS» consolidada | según `empresasPermitidas` | `erp_session_empresa` (local) |
| Administrar usuarios | menú de usuario | `abrirAdminUsuariosModal` (2477) | REAL · HIDDEN (sólo ADMIN) | `erp_auth_users`, `erp_user_perms`, `erp_client_accounts` | **equipo**: contraseña inicial, permisos por sección (14), empresas; **clientes**: buscar, borrar cuenta. **No crea usuarios del equipo** (lista fija de 6) | ADMIN | `erp_store` |
| Cambiar contraseña | menú de usuario | `abrirCambiarPassModal` (1846) | REAL | hash SHA-256 | cambiar la propia | logueado | `erp_store` |
| Crear cuenta | header (visitante) | `abrirCrearCuentaModal` (1916) | REAL | cuenta de cliente | alta | visitante | `erp_store` |
| Tema / apariencia | header | `abrirTemaModal` (2355) | REAL | plantilla, acento, tamaño y familia de fuente | elegir | logueado | `erp_prefs_<usuario>` (3 usuarios en `erp_store`) |
| Configuración de IA | asistente | `mostrarAiConfigModal` (5801) | REAL | proveedor y **API keys en el navegador** | guardar | logueado | local |
| Emails › Configuración | Emails | `renderEmailsConfig` (41034) | REAL | acceso por usuario, URLs de webhooks | editar | equipo | local + `erp_store` |
| WhatsApp › Configuración | WhatsApp | `renderConfig` (43453) | REAL | estado Baileys, QR | ver / reconectar | equipo | worker legacy |
| Conexiones | ADMIN | `renderConexiones` (33911) | REAL (ML) · PLACEHOLDER (Amazon) | credenciales ML/Amazon | guardar, probar | ADMIN | local |
| Notificaciones push | panel personal | `_renderPushNotifSection` (36552) | REAL | token FCM por dispositivo | activar / desactivar | logueado | Supabase legacy (`user_push_devices`, 1 fila) |
| Rubros y catálogos | Clientes | `renderRubrosAdmin` (19035) | REAL | `RUBROS_SEED` (4) | editar (local) | equipo | local |
| Nuevo / editar producto | Catálogo (internos) | `_abrirModalNuevoProducto` (14085), `_abrirEditProducto` (14833) | REAL, **no persistente** (A-5) | SKU, nombre, descripción, marca, categoría, modelo, estado, precio USD/ARS, costo, peso, UoM, stock real/mín/máx, kit, repuesto, código de fábrica, código de barras, tags, URLs, imagen, atributos | crear, editar | internos | memoria + local + RPC a espejo |
| Nueva marca / categoría | modal de producto | `_npCrearMarca` (13682), `_npCrearCategoria` | REAL | nombre | crear, borrar | internos | RPC a espejo |
| Opciones de impresión | modal de impresión | `loadPrintOpts` (25157) | REAL | valorado/no, imágenes, papel, carta, precios con impuestos | elegir | logueado | `erp_print_opts` (local) |
| Exportar / backup | Mantenimiento | `_mantExportarView` (30330) | REAL | colecciones de mantenimiento | CSV, backup JSON, **restore JSON** | equipo | archivo |
| Trazabilidad | ADMIN | `renderTrazabilidad` (34164) | REAL · HIDDEN | bitácora | ver, borrar | ADMIN | `erp_store` + `erp_legacy_trazabilidad` |
| Tipos de cambio | Finanzas | `renderFinanzasTC` (28362) | REAL | cotizaciones dolarapi.com | refrescar | equipo | `erp_finanzas_rates` (local) |
| Numeración | (sin UI) | `nextCotRef` (803) y 15 `next*Ref` más | REAL, **no editable** | máximo + 1 sobre la lista local | — | — | derivada |

### Dead code y placeholders de configuración

| elemento | tipo | evidencia |
|---|---|---|
| `renderCatalogoAdminPrecios` (13558), `_abrirEditOverride` (14953) | DEAD_CODE | 0 referencias en app.js e index.html |
| `mant_usuarios` (maestro de usuarios de mantenimiento) | DEAD_CODE | Phase 7: el selector usaba 6 nombres hardcodeados |
| Conexiones › Amazon | PLACEHOLDER | formulario sin llamadas |
| Emails › acceso por usuario | PLACEHOLDER de seguridad | filtra en el navegador (Phase 9 E0) |

### Constantes que en el legacy son «configuración» en código

`EMPRESAS` (267, 3 empresas) · `PERM_SECCIONES` (1003, 14) · `SUPA_WAREHOUSE_ID`
(1442, un depósito fijo) · contraseñas por defecto del equipo ·
`TEAM_USERS` (1694, 6 usuarios) · `_TEMAS` (2327) · `precioVentaProd` → `pu × 3`
(13498) · `RUBROS_SEED` (16685) · `DEFAULT_PRINT_OPTS` (25156).

### Configuración vs administración (sección 3)

| grupo | funcionalidades |
|---|---|
| **A · Configuración de empresa** | datos de empresa, logo, moneda base, color, numeración, opciones de impresión |
| **B · Usuarios / Administración** | usuarios del equipo, contraseñas, roles/membresías, suspensión, cuentas de clientes, trazabilidad |
| **C · Maestros operativos** | productos, precios, listas, marcas, categorías, atributos, depósitos, monedas, tipo de cambio, rubros, condiciones de pago, impuestos |
| **D · Integraciones** | STEL, Gmail, WhatsApp, Make, Firebase, Cloudflare, Tango, Resend, IA, ML/Amazon |
| **E · Seguridad** | quién escribe cada maestro (RLS), invitación de usuarios, lista blanca y hashes del legacy |
| **F · Preferencias personales** | tema, idioma, perfil/avatar, empresa activa, paginación, widgets, push |
| **G · Backups / import / export** | backup/restore JSON, importadores, CSV |
| **H · No debería estar en Configuración** | productos/precios (es Catálogo), tipo de cambio (Finanzas), rubros (Clientes), Emails/WhatsApp config (sus módulos), trazabilidad (Administración) |

---

## C · Empresas

| campo | legacy | React `companies` | Buscatools | Torquetools |
|---|---|---|---|---|
| nombre | `EMPRESAS[].nombre` | `name` | ✓ | ✓ |
| razón social | override local | `legal_name` | ✓ | — |
| CUIT | override local | `tax_id` | ✓ | — |
| dirección | override local | `address` | ✓ | — |
| teléfono | override local | `phone` | ✓ | — |
| email | override local | `email` | ✓ | — |
| web | override local | `website` | ✓ | — |
| WhatsApp | override local | — (vive en `whatsapp_accounts`) | — | — |
| logo | dataURL local / URL hardcodeada | `logo_path` | **—** | **—** |
| color | `EMPRESAS[].color` | `brand_color` | ✓ | ✓ |
| moneda base | implícita USD | `default_currency` | ARS | ARS |
| activa | — | `is_active` | ✓ | ✓ |
| país, documentos fiscales | — | — | — | — |

- **Snapshots:** la impresión de Ventas lee `companies` en el momento
  (`services/empresa.ts`); los documentos no guardan copia de los datos de la
  empresa. No hay duplicación.
- **RLS:** `companies_update` sólo `app.is_admin(id)`; no hay policy de INSERT ni
  DELETE (altas por SQL).
- **Falta:** logo (y un bucket donde guardarlo), datos de Torquetools, la empresa
  **GAS** del legacy (`EMPRESAS` tiene 3; `erp_store` tiene
  `buscatools_clientes_extra__erpemp_gas` con 7 entradas).
- **Multiempresa legacy:** `_ekey(base)` namespacing de localStorage
  (`<clave>__erpemp_<id>`; Buscatools sin sufijo), `usuario.empresas[]` en
  `erp_auth_users`, `empresasPermitidas()`, vista «TODAS» de sólo lectura. React:
  `company_memberships` + `EmpresaSelector` + `bt-empresa-activa`. **El modelo
  nuevo ya lo cubre; no hace falta uno distinto.**

## D · Usuarios

| aspecto | legacy | React |
|---|---|---|
| identidad | `erp_auth_users` en `erp_store` (11 cuentas: 6 equipo + clientes), hash SHA-256 sin sal | Supabase Auth (7 usuarios) + `profiles` (7, trigger `on_auth_user_created` → `app.handle_new_user`) |
| alta del equipo | **no existe** (lista fija `TEAM_USERS`) | script con clave de servicio |
| alta de clientes | `abrirCrearCuentaModal` | no hay |
| contraseña | la asigna ADMIN o el usuario | no hay cambio ni recuperación en la app (el login dice «pedile el restablecimiento a un administrador») |
| rol | booleanos por sección | `company_memberships.role` |
| empresa | `usuario.empresas[]` | una membresía por empresa |
| activo | — (se borra la cuenta) | `memberships.status` active/suspended + `profiles.is_active` |
| vendedor / técnico | nombres en `creadoPor` | roles `salesperson` / `technician`; `customers.salesperson_id` (1 cliente) |
| lista blanca | `_chkTeam()` + `TEAM_USERS` | RLS por rol |

**Usuarios reales en React (2026-09-14):**

| persona | membresías | inició sesión |
|---|---|---|
| Jano | Buscatools admin · Torquetools salesperson | sí (hoy) |
| Juan | Buscatools admin | nunca |
| Norberto | Buscatools employee | nunca |
| Facundo | Buscatools salesperson | nunca |
| Admin | Buscatools admin | nunca |
| Cliente Demo (test) | Buscatools customer | sí (suites) |
| Distribuidor Demo (test) | Buscatools distributor | sí (suites) |
| **Brian** | **sin cuenta** | — (activo en el legacy 09-11 y 09-13) |

## E · Roles y permisos

**Roles reales (CHECK de `company_memberships`):** `admin`, `employee`,
`salesperson`, `technician`, `distributor`, `customer`, **`supplier`** (0 filas).
Coherencia exigida por CHECK: externos con `customer_id`, `supplier` con
`supplier_id`, internos sin ninguno.

**Helpers (`app.*`, SECURITY DEFINER):** `current_role`, `is_admin`,
`is_internal` (admin, employee, salesperson, technician),
`current_writer_company_ids` (admin, employee), `current_company_ids`,
`current_customer_id(s)`, `current_price_list_id(s)`, más helpers por módulo
(`current_email_company_ids`, `current_maintenance_writer_ids`,
`current_whatsapp_admin_ids`…).

**Frontend:** constantes por módulo (`ROLES_INTERNOS`, `ROLES_EXTERNOS`,
`ROLES_EMAILS`, `ROLES_INFORMES`, más las de Compras y Mantenimiento en el
layout). `src/features/permissions` vacío.

| legacy | React | clasificación |
|---|---|---|
| 14 booleanos por sección por usuario (`erp_user_perms`, 5 usuarios) | roles fijos + RLS | reemplazado |
| `ADMIN` hardcodeado (Trazabilidad, Conexiones, Estadísticas, usuarios) | `admin` por empresa | reemplazado |
| checks sólo en el frontend | RLS + validaciones en RPC | reemplazado |
| — | `company_memberships.allowed_sections` (columna **sin uso**: 0 filas con valor, 0 referencias en código) | decisión (U-NB-3) |

**Qué se configura y qué está codificado:** en React **nada de permisos se
configura**: el rol se asigna (membresía) y lo que cada rol puede está en RLS y
en constantes. Es lo correcto para este tamaño de equipo; exponer permisos
editables sería reabrir el modelo del legacy.

## F · Depósitos

- **Legacy:** no hay depósitos. `SUPA_WAREHOUSE_ID` fijo en el código; el stock
  es «sr/sv» por producto y deltas locales.
- **React:** `warehouses` 2 filas (una `PRIN` por empresa, default y activa).
  Dependen: `stock_balances`, `stock_movements`, `stock_reservations`, recepciones
  de Compras, entregas de Ventas, consumo de Mantenimiento, Informes de stock.
  RLS de escritura: sólo admin.
- **Conclusión:** no hace falta UI hasta que exista un segundo depósito. Es
  funcionalidad nueva, no migración.

## G · Monedas

- **Legacy:** USD/ARS/EUR en código; moneda por documento; `_soloUSD` en los
  totales; tipo de cambio de dolarapi.com cacheado en el navegador y un campo de
  TC en el documento.
- **React:** `currencies` 3 (ARS, USD, EUR; sólo lectura por policy); moneda por
  documento y lista; `exchange_rate` en documentos (usado en **2 de 288**
  cotizaciones). **No hay tabla de tipos de cambio ni fuente aprobada.**
- **Conclusión:** monedas resueltas. Tipo de cambio necesita schema + decisión de
  fuente; no se inventa (Informes ya decidió no convertir).

## H · Listas de precios

- **Legacy:** **no existen listas.** El precio es `precio_venta` del JSON o
  `pu × 3`; overrides locales por navegador; memoria de precios por cliente
  (`spd_client_memory_v1`, migrada en Clientes). Actualización masiva: sólo el
  escenario de Make «AT-4 ACTUALIZACION DE PRECIOS SPEEDRILL» (inactivo).
- **React:** `price_lists` 4 · `product_prices` 12.505 · `customers.default_price_list_id` en 3 clientes.

| empresa | lista | moneda | default | precios | vigencia (en `product_prices`; la lista no tiene fechas) | clientes con la lista por defecto |
|---|---|---|---|---:|---|---|
| Buscatools | Lista base | USD | sí | 12.254 | desde 2026-01-01, sin fin | 1 |
| Buscatools | Distribuidores | USD | no | 124 | desde 2026-09-08 | 1 |
| Buscatools | **Especial Cliente Demo** | USD | no | 124 | desde 2026-09-08 | 1 — **datos de prueba** |
| Torquetools | Lista base | USD | sí | 3 | desde 2026-09-08 | 0 — prueba |

- RLS: listas sólo admin; precios admin + employee.
- **Prioridad:** P2 salvo que el ERP sea maestro de precios (U-B-2), en cuyo caso
  editar precios es P1.

## I · Productos y precios (sección 12)

**Qué hacía el legacy, exactamente:**

| acción | dónde escribía | ¿persistía para el equipo? |
|---|---|---|
| nuevo producto | `PRODUCTOS.push` (memoria), `erp_producto_overrides` (local), función del espejo | **no**: se pierde al recargar; el catálogo se carga de `productos-data.json` |
| editar producto | `setProductoOverride` (local) + función del espejo | **no**: la clave de overrides no está en `erp_store` |
| precio (USD/ARS/costo) | ídem | no |
| marca / categoría | funciones del espejo | sólo en el espejo, que no se lee |
| stock real/mín/máx | override local | no |
| imagen | bucket `email-attachments` del legacy (cerrado en Emails E0.5) | ya no funciona |

Evidencia: espejo legacy `products` 2.698 filas, **0 creadas o editadas desde el
2026-08-28**; 0 llamadas a esas RPC en 7 días de logs (Phase 11 E0).

**React hoy:** 21.775 productos (21.772 Buscatools importados + 3 de prueba en
Torquetools), 26 marcas, 9 categorías, 26 atributos, todos en estado `active`. RLS de escritura:
productos y precios admin + employee; marcas, categorías y atributos admin.
**No hay UI de escritura.**

**Dónde pertenece:** a **Catálogo** (maestro de productos y precios), no a
Configuración ni a Administración. Configuración sólo aporta los maestros
auxiliares (listas, marcas, categorías, atributos). Se propone como **fase
separada de Catálogo**, condicionada a U-B-2.

## J · Secuencias

`document_sequences`: 20 filas (10 tipos × 2 empresas), RLS habilitada **sin
policies** — sólo la RPC `next_document_number` (DEFINER, valida rol por tipo)
las toca.

| tipo | prefijo | relleno | próximo Buscatools | máximo real conocido | observación |
|---|---|---:|---:|---|---|
| quote | COTI | 5 | 2629 | COTI02547 (STEL, legacy) | sin choque |
| sales_order | PDV | 5 | 1316 | PDV01315 | sin choque hoy |
| **delivery** | RT | 10 | **1424** | **RT0000001426 (STEL, legacy)** | **choque: 1424–1426 ya emitidos por STEL** |
| customer | CLI | 5 | 1225 | — | — |
| supplier | PROV | 5 | 146 | — | — |
| purchase_order | PC | 5 | 2 | — | — |
| goods_receipt | NEP | 5 | 1 | — | — |
| supplier_invoice | FP | 5 | 1 | — | — |
| maintenance_asset | EQ | 5 | 1 | — | — |
| maintenance_order | OS | 5 | 1 | — | — |

- **Legacy:** 16 numeradores `next*Ref` = máximo + 1 sobre la lista local del
  navegador; sin UI; carreras entre navegadores posibles. STEL numera
  cotizaciones, pedidos y remitos por su cuenta.
- **¿Editable en UI?** **No es seguro.** Bajar `next_number` genera duplicados;
  subirlo quema números. Una UI razonable es **sólo lectura** (ver próximo número)
  y un ajuste excepcional por SQL auditado.
- **Decisión bloqueante:** quién es la autoridad de numeración de COTI/PDV/RT
  mientras STEL siga emitiendo (U-B-1).

## K · Maestros y catálogos configurables

| maestro | legacy | React | clasificación |
|---|---|---|---|
| estados de documentos | hardcoded | CHECK + transiciones en RPC | resuelto |
| tipos de movimiento, tratamientos | hardcoded | CHECK / enum | resuelto |
| marcas | alta desde modal (espejo) | `brands` 26 | UI |
| categorías / atributos | alta desde modal (espejo) | `product_categories` 9 · `product_attribute_definitions` 26 + N:N | UI |
| rubros | `RUBROS_SEED` 4, local | `customers.industry` texto (1 cliente) | resuelto (Phase 5) |
| motivos | — | CHECK por módulo (revisión de clientes, cancelaciones) | resuelto |
| **condiciones de pago** | texto libre `formaPago` | texto libre: `customers` 3 valores, `suppliers` 13 distintos en 142, documentos 0 | **no hay maestro**; schema + regla si se quiere |
| **impuestos** | flag IVA + `ivaAmount` + IIBB | `tax_treatment` (`vat_21`, `vat_105`, `vat_0`, `exempt`, `not_taxed`, `other`) + `app.tasa_de_tratamiento` + `tax_rate_snapshot` por línea | **resuelto como regla**; no configurable (fiscal) |

Tratamientos reales en líneas de cotización: `vat_21` 843 · `other` 139 ·
`not_taxed` 8 · `vat_105` 2 — el histórico conserva su `tax_rate_snapshot`, no se
reinterpreta.

## L · Auditoría

- **Legacy:** Trazabilidad ADMIN (`erp_trazabilidad_log` 2.000, `erp_traz_*`,
  `erp_legacy_trazabilidad` 1,25 M filas de reenvíos) + `erp_activity_log`.
- **React:** `sales_audit`, `purchases_audit`, `maintenance_audit` (0 filas hoy:
  no se crearon documentos nuevos desde la carga) + historial por documento en
  cada módulo.
- **Conclusión:** hace falta un **visor admin** cuando haya operación real en
  React (P2). Los logs del legacy no se migran.

## M · Integraciones

| integración | config hoy | estado | nota |
|---|---|---|---|
| STEL Order | credencial del lado del servidor del legacy; **deuda: copias fuera del gestor de secretos** | **ACTIVE** + SECURITY_DEBT | fuente real de COTI/PDV/RT; alimenta el legacy a las 09:00 |
| Gmail | Emails React (Cloud Run, Secret Manager) | ACTIVE (React) · REPLACED (Make legacy) | — |
| WhatsApp | schema React listo | PENDING (pausado) | — |
| Make | 17 escenarios activos | ACTIVE (legacy) + SECURITY_DEBT | endpoint de automatización sin autenticación (deuda, ver Fase 11) |
| Firebase | reglas de RTDB vencidas | DEPRECATED | chat y push legacy |
| Cloudflare | browser-run PDF (Make 6060632), worker IA | ACTIVE (legacy) | — |
| Tango | credenciales fuera del gestor de secretos | DEPRECATED + SECURITY_DEBT | — |
| Resend | clave revocada, función cerrada | REMOVED | Phase 11 E0.5 |
| IA (OpenAI/Anthropic) | claves en el navegador | DEPRECATED | — |
| Mercado Libre / Amazon | credenciales locales | DEPRECATED / PLACEHOLDER | — |
| Supabase legacy | plan Free, **cuota excedida, gracia vencida 13/09** | ACTIVE en riesgo | Phase 11 |

Ninguna integración necesita pantalla de «Configuración» en React ahora: sus
credenciales van en secretos del servidor, no en UI.

## N · Preferencias personales

| preferencia | legacy | React | clasificación |
|---|---|---|---|
| tema / acento / fuente | `abrirTemaModal`, `erp_prefs_*` (3 usuarios) | tokens CSS + `prefers-color-scheme`; `profiles.theme` sin uso | UI P4 |
| idioma | — | `profiles.locale` = `es-AR` | UI P4 |
| perfil (nombre, teléfono, avatar) | — | `profiles` (0 avatares) | UI P3 |
| empresa activa | `erp_session_empresa` | `bt-empresa-activa` + selector | resuelto |
| paginación / sidebar colapsado | `erp_ln_collapsed` | por pantalla | no migrar |
| widgets del dashboard | `erp_dash_widget_cfg_*` | — (Informes) | no migrar |
| firma de email | no existía | Emails decidió no tener | no migrar |
| notificaciones push | FCM por dispositivo | — | futuro (mensajería) |
| opciones de impresión | persistidas por navegador | por impresión (formato, precios con impuestos, papel) | resuelto |

## O · Backups e importaciones

- **Backup/restore JSON** (Mantenimiento): sobrescribía colecciones desde un
  archivo del usuario. En un ERP con base de datos es un riesgo, no una función:
  **NOT_MIGRATED_BY_DESIGN** (ya decidido en Phase 7). Los backups son de la
  plataforma.
- **Importaciones reales del legacy:** logo de empresa, adjuntos, PDF de OC con
  IA, JSON de mantenimiento, archivos de WhatsApp. **Importaciones de datos
  (productos, clientes, precios, stock) no existían en la UI**: se hicieron con
  scripts de migración (`scripts/import-*`, fases 3.5/4/5).
- **Export CSV:** resuelto por módulo en React.

## P · Cobertura React

| área | rutas | pantallas | schema | RLS de escritura |
|---|---|---|---|---|
| configuración / admin | **0** | **0** (`modules/configuracion` vacío) | — | — |
| empresa | — | selector en layout | `companies` | admin (UPDATE) |
| usuarios / membresías | — | — | Auth + `profiles` + `company_memberships` | admin (memberships); perfil propio |
| depósitos | — | lectura en Informes | `warehouses` | admin |
| monedas | — | selects en documentos | `currencies` | ninguna (seed) |
| listas y precios | — | lectura en Catálogo/Ventas | `price_lists`, `product_prices` | admin / admin+employee |
| productos, marcas, categorías, atributos | — | lectura en Catálogo | tablas completas | admin+employee / admin |
| secuencias | — | — | `document_sequences` | sólo RPC |
| auditoría | — | historial por documento | `*_audit` | triggers |

---

## Q · Clasificación

Letras: **A** MIGRABLE_1_TO_1 · **B** MIGRABLE_WITH_CORRECTED_MODEL · **C**
ALREADY_SOLVED_IN_REACT · **D** NEEDS_NEW_UI_ONLY · **E** NEEDS_SCHEMA_OR_RULE ·
**F** NOT_MIGRATED_BY_DESIGN · **G** BLOCKED_BY_DECISION · **H** DEAD_CODE ·
**I** PLACEHOLDER.

| # | funcionalidad | grupo | clase | prioridad |
|---|---|---|---|---|
| F01 | Datos de empresa (razón social, CUIT, dirección, teléfono, email, web) | A | D | P2 |
| F02 | Logo de empresa | A | E (bucket + policy) | P3 |
| F03 | WhatsApp en datos de empresa | A | F (vive en `whatsapp_accounts`) | — |
| F04 | Color de marca | A | C | — |
| F05 | Moneda base de empresa | A | C | — |
| F06 | Alta de empresas / empresa GAS | A | G | P4 |
| F07 | Selector de empresa activa | F | C | — |
| F08 | Vista consolidada «TODAS» | A | F (mezclaba monedas) | — |
| F09 | Login | B | C | — |
| F10 | Alta / invitación de usuario del equipo | B | E (server-side con clave de servicio) | **P1** |
| F11 | Contraseña: recuperación y cambio propio | B | E (flujo de Auth + SMTP) | **P1** |
| F12 | Asignar rol / membresía por empresa | B | D (+ regla «no quitar el último admin») | **P1** |
| F13 | Suspender / reactivar usuario | B | D | P2 |
| F14 | Permisos por sección (14 booleanos) / `allowed_sections` | E | G | P4 |
| F15 | Cuentas de clientes y distribuidores (portal) | B | G | P3 |
| F16 | Vendedor / técnico | B | B (roles + `salesperson_id`) | — |
| F17 | Lista blanca `TEAM_USERS` / `_chkTeam` | E | F | — |
| F18 | Contraseñas por defecto en el bundle | E | F (deuda Phase 11) | — |
| F19 | Depósitos | C | D (cuando haya un 2.º) | P4 |
| F20 | Monedas | C | C | — |
| F21 | Tipo de cambio | C | E (+ fuente) | P3 |
| F22 | Listas de precios (maestro) | C | D | P2 |
| F23 | Precios por producto y lista, vigencias | C | D | P1/P2 según U-B-2 |
| F24 | Actualización masiva de precios | C | G | P3 |
| F25 | Alta y edición de productos | C | G (maestro: STEL o ERP) | P1 si ERP |
| F26 | Marcas | C | D | P2 |
| F27 | Categorías y atributos | C | D | P3 |
| F28 | Kits / repuestos | C | E | P4 |
| F29 | Stock inicial, mínimo y máximo en el alta | C | E | P4 |
| F30 | Rubros | C | C | — |
| F31 | Condiciones de pago | C | E (si se quiere maestro) | P4 |
| F32 | Impuestos / tratamientos | C | C (regla en base) | — |
| F33 | Secuencias server-side | A | C | — |
| F34 | Estados de documentos | C | C | — |
| F35 | Opciones de impresión | A | C | — |
| F36 | STEL | D | G (ingesta y autoridad) | **P1** |
| F37 | Gmail | D | C | — |
| F38 | WhatsApp | D | G (pausado) | P4 |
| F39 | Make (legacy) | D | F (se retira con el legacy) | — |
| F40 | Firebase | D | F | — |
| F41 | Cloudflare PDF (Make) | D | F | — |
| F42 | Tango | D | F | — |
| F43 | Resend | D | F (retirado) | — |
| F44 | Configuración de IA en el navegador | D | F | — |
| F45 | Conexiones ML / Amazon | D | F | — |
| F46 | RLS de escritura de maestros | E | C | — |
| F47 | Invitación de usuarios sin exponer la clave de servicio | E | E | **P1** |
| F48 | Tema / apariencia | F | D | P4 |
| F49 | Idioma | F | D | P4 |
| F50 | Mi perfil (nombre, teléfono, avatar) | F | D | P3 |
| F51 | Empresa activa persistida | F | C | — |
| F52 | Paginación / sidebar colapsado | F | F | — |
| F53 | Firma de email | F | F | — |
| F54 | Widgets de dashboard | F | F | — |
| F55 | Push FCM | F | F (mensajería futura) | — |
| F56 | Backup / restore JSON | G | F | — |
| F57 | Importaciones de datos (scripts) | G | C | — |
| F58 | Importar OC con IA | G | G | P4 |
| F59 | Export CSV | G | C | — |
| F60 | Visor de auditoría | B | D | P2 |
| F61 | `renderCatalogoAdminPrecios` | C | H | — |
| F62 | `_abrirEditOverride` | C | H | — |
| F63 | `mant_usuarios` | B | H | — |
| F64 | Conexiones › Amazon | D | I | — |
| F65 | Emails › acceso por usuario (filtro en el navegador) | E | I | — |

**Totales:** A 0 · B 1 · C 15 · D 12 · E 8 · F 16 · G 8 · H 3 · I 2 = **65**.

## R · Prioridades

| prioridad | funcionalidades |
|---|---|
| **P0 seguridad** | ninguna nueva en Configuración React. Las del legacy (ver Fase 11, versión pública) siguen en Phase 11 |
| **P1 cutover** | F10/F47 invitación de usuarios · F11 recuperación de contraseña · F12 roles/membresías · F36 STEL (fuera de Configuración) · F23/F25 **sólo si** el ERP es maestro de productos y precios |
| **P2 administración** | F01 datos de empresa · F13 suspender · F22 listas · F26 marcas · F60 visor de auditoría |
| **P3 conveniencia** | F02 logo · F15 portal · F21 tipo de cambio · F24 actualización masiva · F27 categorías/atributos · F50 mi perfil |
| **P4 futuro** | F06 empresas/GAS · F14 permisos finos · F19 depósitos · F28 kits · F29 mín/máx · F31 condiciones de pago · F38 WhatsApp · F48 tema · F49 idioma · F58 OC con IA |

## Seguridad de configuración (sección 23) — propuesta, no implementada

| maestro | escribe hoy (RLS) | propuesta |
|---|---|---|
| empresa | admin | admin |
| usuarios / membresías | admin (memberships); alta sólo con clave de servicio | admin, vía RPC/Edge Function que no deje quitar el último admin ni escalar a otra empresa |
| depósitos | admin | admin |
| listas de precios | admin | admin |
| precios | admin + employee | admin + employee (decisión U-NB-2 si el employee debe poder bajar precios) |
| productos | admin + employee | admin + employee |
| marcas / categorías / atributos | admin | admin |
| secuencias | nadie (sólo RPC) | nadie: lectura para admin, ajuste por SQL auditado |
| monedas | nadie (seed) | nadie |

## Dependencias (sección 24)

| pendiente | de qué depende | quién depende |
|---|---|---|
| usuarios / membresías | Auth + SMTP de Auth | **todos los módulos** (nadie opera sin cuenta) |
| autoridad de numeración | decisión STEL | Ventas (emisión), ingesta STEL |
| maestro de productos | decisión STEL | Catálogo, Ventas, Compras, Mantenimiento, ingesta STEL (SKU nuevos) |
| precios / listas | maestro de productos | Catálogo (externos), Ventas (líneas) |
| datos de empresa | — | impresión de documentos, Emails |
| depósitos | — | stock, Compras, Ventas, Mantenimiento (hoy 1 fijo por empresa, alcanza) |
| tipo de cambio | fuente aprobada | Informes, documentos multimoneda |
| visor de auditoría | operación real en React | Administración |

---

## S · Blockers de cutover

Qué de **Configuración** impide apagar el legacy:

| # | bloqueo | tipo | por qué |
|---|---|---|---|
| S-1 | **Autoridad de numeración COTI/PDV/RT** | decisión (U-B-1) | STEL sigue numerando; `delivery.next_number` ya choca (1424 vs RT0000001426). Sin decidir, React no puede emitir remitos sin duplicar |
| S-2 | **Cuentas del equipo operativas en React** | UI + regla (F10, F11, F12) | falta Brian; 4 de 5 cuentas nunca iniciaron sesión; no hay recuperación de contraseña. Se puede puentear con script, pero no es operable sin intervención técnica |
| S-3 | **Maestro de productos y precios** | decisión (U-B-2) | si STEL es el maestro, hace falta ingesta de productos; si es el ERP, hace falta ABM (fase de Catálogo). El legacy no tenía un ABM que funcionara, así que no es «paridad»: es una decisión de negocio |

**No bloquean:** datos de empresa (Buscatools completo salvo logo), depósitos,
monedas, impuestos, condiciones de pago, preferencias, visor de auditoría,
backups.

**El bloqueo mayor está fuera de Configuración:** la ingesta STEL → ERP nuevo
(los documentos que hoy sólo llegan al legacy) y el riesgo de cuota del Supabase
legacy.

## T · Plan por entregas

Propuesta según evidencia (no se empieza):

| entrega | contenido | por qué en este orden | tamaño |
|---|---|---|---|
| **E1 · Usuarios y membresías** | Administración › Usuarios: invitar (Edge Function/RPC con clave de servicio del lado del servidor), asignar rol por empresa, suspender/reactivar, regla del último admin; recuperación de contraseña de Auth; Mi perfil mínimo (nombre, teléfono) | S-2; dependencia de todos los módulos; schema ya existe | M |
| **E2 · Empresa y numeración** | Configuración › Empresa (datos, logo con bucket privado + URL firmada), Configuración › Numeración **sólo lectura** con el próximo número y el máximo conocido; aplicar la decisión U-B-1 (p. ej. alinear `next_number` o serie propia) | S-1; la impresión usa los datos de empresa | S–M |
| **E3 · Maestros de catálogo** | listas de precios, marcas, categorías y atributos (admin) | prerequisito de un ABM de productos; bajo riesgo | M |
| **E4 · Visor de auditoría y cierre** | Administración › Auditoría (sales/purchases/maintenance), invariantes, RLS red-team por rol, docs | cuando haya operación real | S–M |
| **Fuera de Configuración** | ABM de productos y precios (fase de **Catálogo**, si U-B-2 = ERP) · ingesta STEL → ERP (fase propia) · tipo de cambio (Finanzas) · portal de clientes | pertenecen a otros módulos | — |

### Forma visual (sección 34, sólo propuesta)

Dos entradas separadas en el menú, cada una con **sidebar interno** y páginas
propias (no tabs en una sola pantalla):

- **Administración** (admin): Usuarios · Auditoría.
- **Configuración** (admin): Empresa · Numeración · Listas de precios · Marcas ·
  Categorías y atributos · (Depósitos cuando haga falta).
- **Mi perfil** desde el menú de usuario (todos).

Sin rediseño global en esta fase.

---

## U · Decisiones necesarias

### BLOCKING

1. **U-B-1 · Autoridad de numeración.** Mientras STEL emita COTI/PDV/RT: ¿React
   no emite esos tipos (sólo importa), usa una **serie propia** (el schema ya
   tiene `series_code`), o se alinea `next_number` con STEL y se deja de emitir en
   STEL? Hoy el remito ya choca.
2. **U-B-2 · Maestro de productos y precios.** ¿El catálogo y los precios se
   administran en **STEL** (y el ERP los importa) o en el **ERP** (y hace falta un
   ABM, fase de Catálogo)? Define si F23/F25 son P1 o desaparecen.
3. **U-B-3 · Roles del equipo.** Confirmar el rol de cada persona (hoy: Juan
   admin, Norberto employee, Facundo salesperson, Admin admin, Jano admin) y
   **dar de alta a Brian** con su rol. Un `salesperson` ve montos de toda la
   empresa pero sólo sus clientes (Phase 10).

### NON-BLOCKING

1. **U-NB-1 · Empresa GAS:** ¿se da de alta o se descarta?
2. **U-NB-2 · Precios:** ¿un `employee` puede cambiar precios (hoy la RLS lo
   permite) o sólo admin?
3. **U-NB-3 · `allowed_sections` y rol `supplier`:** columna y rol sin uso. ¿Se
   eliminan o se reservan?
4. **U-NB-4 · Tipo de cambio:** ¿hace falta una tabla de cotizaciones y con qué
   fuente, o se sigue sin conversión?
5. **U-NB-5 · Condiciones de pago:** ¿maestro o texto libre (hoy 13 variantes en
   142 proveedores)?
6. **U-NB-6 · Datos de prueba:** ¿se borran «Especial Cliente Demo», las cuentas
   demo y la lista base de Torquetools con 3 productos, y cuándo?
7. **U-NB-7 · Logo de empresa:** ¿bucket privado con URL firmada (recomendado) o
   público?
