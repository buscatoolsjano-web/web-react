# ERP React Migration — Auditoría global de cobertura

> **Versión pública sanitizada (2026-09-14):** la sección H no nombra funciones,
> tablas ni ubicaciones de credenciales del legacy activo. El detalle es interno.

Estado: **auditoría de sólo lectura**, 2026-09-13. No se programó nada, no se
aplicó DDL ni DML, no se tocó ningún servicio en la nube. `MIGRATION_STATUS.md`
**no se modificó** (ver L).

## Fuentes y método

| fuente | huella | cómo se leyó |
|---|---|---|
| `app.js` legacy (respaldo 2026-09-08) | 45.345 líneas · 5.333.682 bytes · sha256 `82f3454bfd336fa0…` | completo, con `scripts/auditoria-cobertura-global.mjs` + lectura manual de cada render |
| `app.js` publicado hoy (`buscatoolsjano-web.github.io/Buscatools/`) | 5.288.337 bytes · **mismo contenido** que el respaldo (sha256 sin CR `c36dc39d4a653f7c` en ambos; Δ bytes = 45.345 = un CR por línea) · Last-Modified 2026-09-08 | `GET` público, copia temporal borrada |
| `index.html`, `firebase-messaging-sw.js` | 3,23 MB · 7 kB | menú, top-nav, service worker |
| Supabase legacy `hnyngsejohkmlaccpkux` | 72 relaciones en `public` | **sólo catálogo** (`pg_class`, `pg_policies`, `pg_proc` sin cuerpos, `storage.buckets`, publicaciones) + conteos. No se leyó contenido de negocio, salvo **tamaños y cantidades** por clave de `erp_store` |
| Supabase nuevo `uaxcfufvapzulqvynanp` | 69 tablas | catálogo + conteos |
| React (`src/`) | 44 rutas · 14 ítems de menú · 10 módulos | rutas, layout, servicios (`.from`, `.rpc`) |
| Documentos de fase | `docs/PHASE_*`, `POST_MIGRATION_BACKLOG.md`, `DEUDA_TECNICA.md`, `security/SHARED_ORIGIN_RISK.md` | coberturas y decisiones ya tomadas; no se reabren |

Nada de este documento contiene secretos. Donde un secreto existe se indica
**dónde está**, nunca su valor.

---

## A · Resumen ejecutivo

1. **El legacy tiene 19 secciones reales:** 19 ramas del router `renderMain`
   (18 del objeto `SECTIONS` + «Mi Cotización»). A eso se suman una sección
   muerta (`proyectos`, sin render ni menú) y un conjunto de capacidades fuera
   del menú: login, administración de usuarios, preferencias, selector de
   empresa, IA, notificaciones push, mensajes internos, impresión y backups.
2. **7 secciones están cerradas:** Catálogo (consulta), Ventas, Clientes,
   Compras, Mantenimientos, Emails e Informes. Estadísticas quedó cubierta y
   clasificada dentro de Informes (Entrega 5).
3. **Pendientes reales: 16**, repartidos así (detalle en D y M):
   - **P0 · seguridad:** 1;
   - **P1 · core operativo:** 2;
   - **P2 · admin/config:** 5;
   - **P3 · nice-to-have:** 4;
   - **P4 · futuro:** 4.
4. **El legacy sigue vivo y sigue cargando datos.**
   - `erp_store` tiene hoy **295 cotizaciones y 185 notas de entrega**; se
     migraron 288 y 182. Son **+7 cotizaciones y +3 remitos que React no
     tiene**, con fechas de documento hasta el 2026-09-11.
   - La trazabilidad del legacy registró actividad hoy (2026-09-13).
5. **La superficie pública del legacy sigue abierta.** Es la deuda más grave
   del proyecto (H):
   - tablas del legacy (incluido el almacén con las cuentas del legacy)
     accesibles **sin autenticación real**;
   - funciones de base de datos que **leen y escriben sin control de
     identidad**;
   - vistas que no aplican la RLS de sus tablas.
   - Detalle en la Fase 11 E0 (versión pública sanitizada); el mapa completo
     es interno y no está en este repositorio.
6. **El candidato más importante no es Configuración.** Configuración son
   varios módulos chicos (J). Lo que bloquea es:
   - la **contención de seguridad del legacy**;
   - un **cutover** (congelar el legacy y traer el delta);
   - el **alta y edición de productos y precios**, que React no tiene y el
     legacy sí.
7. **WhatsApp:** conviene la opción C, cerrarlo como infraestructura parcial
   hasta tener el número de Meta (sección 22 → K bis).

---

## B · Módulos cerrados

| módulo | cierre | evidencia |
|---|---|---|
| Catálogo | Fase 3 / 3.5 | 21.772 productos reconciliados con todos los deltas en 0; consulta, facetas, precios por rol, disponibilidad. **Sin alta ni edición** (ver D-3) |
| Ventas | Fase 4 (Stages 2, 2.5, 3; entrega 6) | 288 cot · 166 ped · 182 NE; impresión; adjuntos; auditoría |
| Clientes | Fase 5 entrega 5 | maestro, contactos, direcciones, memoria de productos, precios históricos, panel rápido |
| Compras | `PHASE_6_COMPRAS_ENTREGA_6.md` — **COMPRAS = CLOSED** | 4 de 7 entradas migradas; 3 eran `empty()` |
| Mantenimiento | `PHASE_7_MANTENIMIENTO_ENTREGA_5_CIERRE.md` — **CLOSED** | matriz de 14 funciones |
| Emails | Fase 9 entregas 0.5–5 | bandeja, hilos, redactar, responder, reenviar, borradores contra Gmail vía Cloud Run |
| Informes | `PHASE_10_INFORMES_ENTREGA_5_CIERRE.md` — **CLOSED** | 49 ítems clasificados, incluidos Dashboard ejecutivo, widgets de Inicio y Estadísticas |
| WhatsApp | **no cerrado**: Entrega 0.5 (seguridad) CLOSED, Entrega 1 (6 tablas) aplicada, integración pausada | ver K bis |

---

## C · Cobertura legacy → React

`render` = función del legacy; `línea` = `app.js`. Estados:

- **MIGRADO**
- **MIGRATED_WITH_CORRECTED_MODEL** (abreviado **MWCM**)
- **REEMPLAZADO**
- **NOT_MIGRATED_BY_DESIGN** (**NMBD**)
- **BLOCKED_BY_MISSING_DATA** (**BLOCKED**)
- **PENDIENTE_REAL** (**PEND**)

La columna `fase` indica dónde se resolvió, o dónde se resolvería.

### C.1 Menú principal

| legacy_section | legacy_screen | legacy_function | react_route | react_module | status | reason | phase | notes |
|---|---|---|---|---|---|---|---|---|
| Inicio | Inicio (bandeja de trabajo, pendientes, actividad) | `renderInicio` 2910, `renderBandejaInicio` 3510, `renderInicioActividadUsuario` 3535 | `/` | dashboard | **PEND P3** | el `/` de React es la pantalla de verificación de la Fase 1 con **3 filas DEMO** | Dashboard | ver K |
| Inicio | Dashboard (widgets) | `renderDashboard` 5110, `renderInicioWidgets` 5127 | `/informes` | informes | **REEMPLAZADO** / MWCM | KPIs cubiertos por Informes con reglas corregidas | 10 | widgets operativos: ver K |
| Inicio | Dashboard ejecutivo | `renderDashboardEjecutivo` 4214 | `/informes` | informes | MWCM / BLOCKED | pipeline y top clientes migrados; cobrado, por cobrar y aging sin facturas | 10 | `PHASE_10…_CIERRE.md` A |
| Inicio | Solicitudes web / leads del portal | `renderSolicitudesWebSection` 2960 | — | — | **PEND P3** | parte del portal de clientes (Mi Cotización) | — | 1 solicitud, 6 leads en `erp_store` |
| Inicio | Mensajes internos | `renderMensajesSection` 10912 | — | — | **PEND P4** | mensajería de equipo; decisión junto con Chat | — | `erp_mensajes` 13 · `erp_bandeja_mensajes` 14 |
| Emails | Bandeja / detalle / responder / nuevo | `renderEmails` 43872, `renderEmailsLista` 41233, `renderEmailDetalle` 41497 | `/emails`, `/emails/:threadId`, `/emails/redactar`, `/emails/borradores` | emails | MWCM | Make + `erp_emails` → Gmail API + Cloud Run + `email_threads` | 9 | 210 hilos |
| Emails | Reglas auto | `renderEmailsRules` 40917 | — | — | NMBD | `erp_email_rules` 0 filas | 9 | E0 AG |
| Emails | Configuración / acceso por usuario | `renderEmailsConfig` 41034 | — | emails | REEMPLAZADO | filtro en el navegador → RLS por rol | 9 | E0 F |
| Emails | Etiquetas locales | `renderEmailsLabelsMgr` 44017 | — | — | NMBD | localStorage, no compartido | 9 | E0 AG |
| WhatsApp | Conversaciones | `renderWhatsapp` 43826 | — | whatsapp (vacío) | **PEND P4** | schema nuevo aplicado; sin app ni número de Meta | 8 | ver K bis |
| WhatsApp | Configuración (QR Baileys) | `renderConfig` 43453 | — | — | NMBD | Baileys + QR reemplazados por Cloud API oficial | 8 | `suite_wa_*` cerradas en E0.5 |
| Chat | Chat de equipo y grupos | `renderChat` 37743 | — | — | **PEND P4** | Firebase RTDB; uso no medible sin acceso a Firebase | — | decisión O-6 |
| Catálogo | Productos (consulta, filtros, detalle, SEO) | `renderCatalogoProductos` 15308, `renderProductDetail` 16488 | `/catalogo`, `/catalogo/:sku` | catalogo | MWCM | server-side, precio por RLS | 3 / 3.5 | — |
| Catálogo | **Nuevo / editar producto** | `_abrirModalNuevoProducto` 14085 (botón en 15412), `_abrirEditProducto` 14833 → funciones del espejo del legacy | — | — | **PEND P1** | React Catálogo es de sólo lectura; el schema y la RLS de escritura ya existen | — | ver D-3 |
| Catálogo | Servicios | `renderCatalogoServicios` 15608, `renderServicioEditor` 15755 | — | — | **BLOCKED** | `erp_servicios` en localStorage, no sincroniza; sin evidencia de datos ni de uso | — | decisión O-7 |
| Catálogo | Visor de hojas de catálogo (Durofix, Speedrill) | `renderCatalogoVisor` 16814 | — | — | NMBD | imágenes estáticas embebidas o en GitHub Pages | 3 | — |
| Catálogo | Gastos e inversiones | `empty()` | — | — | **PLACEHOLDER** → NMBD | «Próximamente» | — | E |
| Catálogo | Activos en clientes | `empty()` | `/mantenimiento/activos` | mantenimiento | REEMPLAZADO | los equipos en clientes son `maintenance_assets` | 7 | — |
| Clientes | Clientes | `renderClientes` 18293, `renderClienteDetalle` 18677 | `/clientes`, `/clientes/:id` | clientes | MWCM | 1.010 clientes | 5 | — |
| Clientes | Clientes potenciales | `empty()` | — | — | NMBD | placeholder | 5 | backlog |
| Clientes | Personas de contacto | `renderContactos` 18485 | pestaña de la ficha | clientes | MWCM | 87 contactos | 5 | — |
| Clientes | Rubros y catálogos | `renderRubrosAdmin` 19035 | campo `industry` | clientes | MWCM | seed de 4 rubros; config definible con envío de mails | 5 | backlog |
| Ventas | Cotizaciones / Pedidos / Notas de entrega | `renderVentas` 19285 y editores | `/ventas/*` | ventas | MWCM | — | 4 | — |
| Ventas | Firma (pestaña) | 20638, 23313, 23823 | — | — | **PLACEHOLDER** → NMBD | «Sin firma cargada (próximamente)» | 4 | backlog |
| Ventas | Enviar documento por email con PDF | `abrirEnviarMailModal` 37284 | — | ventas + emails | **PEND P2** | Emails ya redacta; falta el puente desde el documento y la decisión de PDF | — | backlog «Impresión: no genera PDF» |
| Ventas | Importar OC con IA | `_ocShowResults` 39337 y relacionados | — | — | **PEND P4** | la API key viaja en el cliente; requiere Edge Function | — | 134 candidatos en `customer_po_candidates` |
| Facturación | Facturas / Recibos / Notas de crédito | `renderFacturasList` 27095, `renderRecibosList` 27703, `renderNotasCreditoList` 27803 | — | — | **BLOCKED** | `erp_facturas` = `[]`; la fuente fiscal es STEL; `sales_invoices`, `payments` y `payment_allocations` existen con 0 filas | 4-I | — |
| Facturación | Recibos de NC · Libro de facturas emitidas | `empty()` | — | — | **PLACEHOLDER** → NMBD | «Próximamente» | — | — |
| Compras | Proveedores · Pedidos · NE de proveedor · Facturas de proveedor | `renderCompras` 31807 | `/compras/*` | compras | MIGRADO / MWCM | — | 6 | 142 proveedores |
| Compras | Recibos de proveedor · Tickets · Libro recibidas | `empty()` | — | — | NMBD | nunca existieron | 6 | — |
| Compras | Pedido a proveedor: Más info / Adjuntos / Firma | 32598–32600 | — | compras | **PLACEHOLDER** → REEMPLAZADO | React tiene adjuntos reales | 6 | — |
| Importación | Calculadora de costo Europa → Argentina (courier / tradicional / comparar) | `renderImportacion` 35020, `renderImpComparar` 34977 | — | — | **PEND P3** | herramienta real y autocontenida; parámetros e ítems en localStorage (`imp_*`), sin datos compartidos | — | decisión O-8 |
| Mantenimientos | 13 subsecciones | `renderMantenimientos` 31025 | `/mantenimiento/*` | mantenimiento | MWCM / NMBD | matriz de 14 funciones en su cierre | 7 | — |
| Mantenimientos | Exportar: backup / restore JSON | `_mantExportarView` 30331 | CSV | mantenimiento | NMBD | el import sobrescribía nueve colecciones desde un archivo | 7 | — |
| Agenda | Calendario / Eventos | `renderAgenda` 25929 | — | — | **PEND P4** | `erp_eventos` en localStorage, **no** está en `SUPA_SYNC_KEYS`: sin datos compartidos | — | decisión O-6 |
| CRM | Leads (IA) | `renderCRMLeads` 27970 | — | — | **PEND P4** | `erp_crm_leads` sólo local; clasificación hot/warm/cold | — | decisión O-6 |
| CRM | Actividades | `renderCRMActividades` 28223 | historial de cliente + auditoría por documento | clientes / ventas | REEMPLAZADO | era un feed derivado de cotizaciones, pedidos y facturas | 5 | — |
| CRM | Pipeline · Informes | `renderCRMPipeline` 28093, `renderCRMInformes` 28259 | — | — | **DEAD_CODE** | sin referencias | — | E |
| Informes | 6 pantallas | `renderInformes` 26188 | `/informes` | informes | MWCM / NMBD / BLOCKED | ver su cierre | 10 | — |
| Finanzas | Tipos de cambio | `renderFinanzasTC` 28362 (dolarapi.com) | — | — | **PEND P3** | la cotización del día servía de referencia; los documentos ya tienen `exchange_rate`; Informes decidió no convertir | — | — |
| Finanzas | Aging / Cobranzas · Cash flow | `renderFinanzasAging` 28434, `renderFinanzasCash` 28474 | — | — | **BLOCKED** | sin facturas ni cobros; además mezclaban monedas | 10 | — |
| ADMIN | Trazabilidad | `renderTrazabilidad` 34164 | — | — | **PEND P2** (visor) · NMBD (logs viejos) | React audita por documento (`sales_audit`, `purchases_audit`, `maintenance_audit`), pero no hay visor global de admin | — | legacy: `erp_trazabilidad_log` 2.000 (tope), `erp_traz_*` 2.003, `erp_legacy_trazabilidad` 1.247.682 filas |
| ADMIN | Conexiones: Resumen · Mercado Libre · Amazon | `renderConexiones` 33911 | — | — | NMBD | ML: formulario de credenciales + `GET /users/me` de prueba, sin sincronización; Amazon: instrucciones + formulario, **sin ninguna llamada** | — | FUTURE_FEATURE |
| ADMIN | Estadísticas | `renderEstadisticas` 5563 | — | — | BLOCKED | vendedor 0/288 y 0/166, rubro 1/1.010 | 10 | Informes E5 |
| Mi Cotización | Carrito del cliente o visitante → solicitud | `renderClienteCotizacion` 2088 | — | — | **PEND P3** | portal externo; los roles customer/distributor existen en React pero sólo consultan el catálogo | — | `erp_client_carrito` 0, solicitudes 1, `erp_client_accounts` 5 |
| (sin menú) | Proyectos | `SECTIONS.proyectos` (items vacíos) | — | — | **DEAD_CODE** | sin render en el router ni ítem de menú | — | — |

### C.2 Fuera del menú

| legacy_section | legacy_screen | legacy_function | react_route | react_module | status | reason | notes |
|---|---|---|---|---|---|---|---|
| Auth | Login propio | `abrirLoginModal` 1898 | `/auth/login` | features/auth | MWCM | Supabase Auth | — |
| Auth | Crear cuenta (visitante / cliente) | `abrirCrearCuentaModal` 1916 | — | — | NMBD | alta abierta de cuentas; hoy las cuentas las crea el admin | ligado al portal (P3) |
| Auth | Cambiar contraseña / recuperar | `abrirCambiarPassModal` 1846 | — | — | **PEND P2** | el login de React dice «pedile el restablecimiento a un administrador» | — |
| Admin | Administrar usuarios: alta, contraseña inicial, permisos por sección | `abrirAdminUsuariosModal` 2477 | — | features/users (vacío) | **PEND P2** | usuarios y membresías se crean hoy por script/SQL | 7 usuarios, 8 membresías |
| Admin | Permisos por usuario × 14 secciones | `getPermsFor` 1007, `erp_user_perms` | — | RLS + menú por rol | MWCM | booleanos en el navegador → 6 roles con RLS | falta la UI de asignación (P2 de arriba) |
| Config | Selector de empresa | `renderEmpresaPickerCards` 578 | selector en el layout | features/empresa | MIGRADO | 2 empresas | GAS: ver O-9 |
| Config | Datos de empresa (razón social, CUIT, logo, color) | `_saveEmpresaOverride`, `erp_empresas_override` | — | — | **PEND P2** | `companies` tiene las columnas y la impresión de Ventas las usa; no hay pantalla para editarlas | — |
| Config | Tema / color / tamaño de fuente por usuario | `abrirTemaModal` 2355, `erp_prefs_*` | — | tokens CSS | NMBD | React sigue `prefers-color-scheme`; `profiles.theme` existe sin UI | FUTURE_FEATURE |
| IA | Asistente, IA por sección, clones, resúmenes diarios, IA de emails | `renderAiPanel` 7285, `_mountSectionAI`, `mostrarClonePerfilModal` 36106 | — | features/ai (vacío) | **PEND P4** | claves de OpenAI/Anthropic en el navegador (`erp_ai_config`, `erp_openai_key`) y worker de Cloudflare; migrarlo exige mover las llamadas al servidor | legacy: 218 conversaciones, 28 memorias, 10 resúmenes, 16 conversaciones de clones → NMBD como datos |
| Notificaciones | Campana + push FCM | `_pushBellOpenPopup` 36761, `_renderPushNotifSection` 36552, `firebase-messaging-sw.js` | — | features/notifications (vacío) | **PEND P4** | proyecto futuro; en el legacy hay 1 dispositivo registrado | — |
| Documentos | Imprimir / PDF | 25187–25910 (`html2pdf`) | modal de impresión | ventas, compras | MWCM | diálogo del navegador; mantenimiento no imprimía | backlog PDF |
| Backups | Backup y restore JSON | `_mantExportarView` | — | — | NMBD | la fuente de verdad es el servidor; PITR y backups de Supabase | — |
| Import / Export | CSV por listado | 33 puntos de export | CSV por módulo | todos | MWCM | — | inyección de fórmulas: ver H |

---

## D · Pendientes reales

| # | pendiente | prioridad | por qué es real | datos | depende de |
|---|---|---|---|---|---|
| D-1 | **Contención de la superficie pública del legacy** | **P0 security** | H: tablas, funciones y vistas del legacy accesibles sin autenticación real; el legacy está en producción | nada que migrar | O-1 (qué usa todavía el legacy) |
| D-2 | **Cutover del legacy**: congelar escrituras, migrar el delta, retirar el acceso | **P1 core** | el negocio sigue cargando en el legacy: +7 cotizaciones y +3 NE que React no tiene; mientras conviva, D-1 no se cierra del todo | delta medido; el script de Stage 2 es reutilizable | O-1, D-3 |
| D-3 | **Alta y edición de productos, precios y listas** (con marcas, categorías e imágenes) | **P1 core** | el legacy tiene «Nuevo producto» y «Editar» para internos; React no puede crear un SKU ni cambiar un precio | 21.772 productos, 12.505 precios, 4 listas; en la base normalizada del legacy 2.698 productos, 0 nuevos desde el 09-09 | decisión de precios de la Fase 3.5 |
| D-4 | Usuarios y membresías: alta, baja, rol, reset de contraseña | P2 admin | hoy sólo por SQL o script | 7 usuarios, 8 membresías | — |
| D-5 | Datos de empresa editables | P2 admin | la impresión los usa y nadie puede corregirlos | 2 empresas | — |
| D-6 | Visor de auditoría / trazabilidad para admin | P2 admin | la auditoría existe por documento, sin vista global | tablas `*_audit` | — |
| D-7 | Enviar cotización / pedido / remito por email con PDF | P2 | circuito comercial del legacy; los módulos ya existen por separado | — | Emails, decisión de PDF |
| D-8 | Reemplazar el Dashboard DEMO de la Fase 1 | P2 | el `/` de producción muestra tres pedidos inventados | — | — |
| D-9 | Dashboard operativo real | P3 | ver K | APIs ya migradas | D-8 |
| D-10 | Portal de clientes / Mi Cotización | P3 | función real del legacy, uso bajo | 1 solicitud · 5 cuentas · 6 leads | política comercial para externos |
| D-11 | Calculadora de importación | P3 | herramienta real, sin datos compartidos | ninguno en servidor | O-8 |
| D-12 | Tipo de cambio de referencia diario | P3 | Finanzas › TC | ninguno | — |
| D-13 | WhatsApp: integración | P4 | bloqueado por Meta | 0 filas nuevas | K bis |
| D-14 | IA (asistente, OC con IA) | P4 | exige llamadas del lado del servidor | NMBD | — |
| D-15 | Chat interno, mensajes, agenda, CRM de leads | P4 | uso no medible o sólo local | locales / Firebase | O-6 |
| D-16 | Notificaciones push | P4 | proyecto futuro | 1 dispositivo | — |

---

## E · Placeholders y código muerto

### Placeholders (`empty()` → «🚧 Próximamente · Esta sección se está desarrollando»)

| ubicación | tipo |
|---|---|
| Catálogo › Gastos e inversiones, Activos en clientes | PLACEHOLDER |
| Clientes › Clientes potenciales | PLACEHOLDER |
| Facturación › Recibos de notas de crédito, Libro de facturas emitidas | PLACEHOLDER |
| Compras › Recibos de proveedor, Tickets y otros gastos, Libro de facturas recibidas | PLACEHOLDER |
| Pestaña **Firma** en cotización, pedido, nota de entrega y pedido a proveedor | PLACEHOLDER |
| Pedido a proveedor › Más información, Adjuntos | PLACEHOLDER |
| `abrirChatGrupoInfoModal` («Stub mínimo: solo cierra») | PLACEHOLDER |
| Conexiones › Amazon (instrucciones + formulario, sin llamadas) | PLACEHOLDER |
| Dashboard ejecutivo › Leads HOT / embudo (leads = 0 fijo) | PLACEHOLDER (Informes E5) |

Ninguno es pendiente salvo decisión de negocio.

### Código muerto

- **Sección muerta:** `proyectos` (en `SECTIONS`, sin render ni menú). Es
  DEAD_CODE.
- **Funciones sin ninguna referencia** en `app.js` ni en `index.html`: 57 de
  1.159 declaraciones de primer nivel (listado completo con la salida del
  script). Las relevantes:

| función | línea | nota |
|---|---|---|
| `renderAdminLeadsPanel`, `renderAdminSolicitudesPanel` | 2273, 2294 | paneles de admin del portal |
| `renderDashboardOLD`, `renderDashboardOLD_OLD`, `renderResumenInicio` | 5578, 5581, 4490 | dashboards viejos |
| `gmailConnect` / `gmailLoadEmails` / … (6) | 4441–4488 | integración Gmail del navegador abandonada |
| `renderCatalogoAdminPrecios`, `_abrirEditOverride` | 13558, 14953 | overrides de precio/stock en localStorage |
| `renderCRMPipeline`, `renderCRMInformes` | 28093, 28259 | CRM |
| `_generarPdfBase64`, `renderDocRowRel_OLD` | 25187, 25025 | PDF para mail, fila vieja |
| `_wappflyStartPolling` / `_wappflyPoll` | 43868–43870 | proveedor viejo de WhatsApp |
| `_cloneHist*`, `_cloneNote*`, `_cloneLearnFromExchange` | 35724–35805 | clones de IA |
| `abrirChatAttachModal`, `abrirChatGrupoModal`, `getChatBetween` | 37577, 37675, 36931 | chat |

**REAL_BUT_HIDDEN:** ninguna pantalla real queda sin ruta. Hay dos capacidades
reales detrás de condiciones:
- Trazabilidad, Conexiones y Estadísticas sólo para `ADMIN`;
- el editor de producto sólo para internos.

Ambas están clasificadas en C.

---

## F · Bloqueado por datos

| qué | medición | desbloquea |
|---|---|---|
| Facturación (facturas, recibos, NC) | `erp_facturas` = `[]`; `creadoPor = STEL Order` en 62 documentos; `sales_invoices` 0, `payments` 0 | sincronización con STEL (Fase 4-I) |
| Aging, cobranzas, cash flow, cobrado | ídem | ídem |
| Estadísticas por vendedor | `salesperson_id` 0/288 y 0/166 | vendedor cargado desde ahora |
| Clientes por rubro | `industry` 1/1.010 | carga manual |
| Servicios del catálogo | `erp_servicios` sólo local; nada en el servidor | confirmar si existen (O-7) |
| Stock crítico, valorización, margen | sin mínimo ni costo | datos nuevos (Informes E5) |
| Compras y mantenimiento productivos | 0 filas | uso real de los módulos |

## G · No migrado por diseño

- **Reglas de negocio del legacy:**
  - `_soloUSD`;
  - «facturado» calculado desde remitos;
  - conversión por estado;
  - «sin stock» sobre el catálogo;
  - umbral fijo de crítico;
  - valorización al precio de venta.
- **Seguridad del navegador:**
  - lista blanca de 6 nombres (`_chkTeam`);
  - permisos en localStorage;
  - filtro de emails en el navegador;
  - sesión simulada (`erp_session_*`).
- **Persistencia:**
  - `erp_store` como almacén de blobs sincronizado cada 30 s;
  - overrides locales de precio/stock;
  - backup/restore JSON.
- **Integraciones reemplazadas:**
  - Make (ingesta y envío de mails) → Gmail API + Cloud Run;
  - Baileys / wappfly → WhatsApp Cloud API;
  - Gmail desde el navegador (código muerto).
- **Pantallas:**
  - Conexiones (ML/Amazon);
  - visor de hojas de catálogo;
  - Clientes potenciales;
  - Recibos de proveedor, Tickets y Libro de facturas recibidas;
  - Reglas de email;
  - etiquetas locales;
  - preferencias de tema por usuario.
- **Datos que no se migran:**
  - trazabilidad de navegación del legacy (1,25 M filas + 4.003 en `erp_store`);
  - conversaciones y memorias de IA;
  - `audit_logs` del legacy (509.255 filas);
  - la base normalizada paralela del legacy (`products` 2.698, `sales_orders`
    459, `customers` 59), que no fue fuente de la migración y no se actualiza
    desde el 2026-08-28.

---

## H · Deuda de seguridad

Medido hoy sobre el catálogo del proyecto legacy. **Nada se ejecutó contra
esas superficies**: la clasificación de las RPC es por firma y por texto del
cuerpo (sin imprimirlo), no por prueba de explotación.

| # | superficie | medición | clase | prioridad |
|---|---|---|---|---|
| H-1 | **Almacén del legacy escribible con una credencial embebida en el cliente público** | afecta el almacén principal y otras tablas del legacy (logs, asistente, trazabilidad). Rotar la credencial no alcanza: el legacy la necesita publicada | SECURITY_PRIORITY | **P0** |
| H-2 | **Cuentas y permisos del legacy dentro de ese almacén** | cuentas con hash de contraseña sin sal y permisos por sección; quedan expuestas a lectura y escritura por H-1 (riesgo de toma de cuentas) | SECURITY_PRIORITY | **P0** |
| H-3 | **Funciones de base de datos ejecutables sin control de identidad** | decenas de funciones; una parte lee datos personales y otra escribe o borra en la base normalizada del legacy | SECURITY_PRIORITY | **P0** |
| H-4 | **Vistas que no aplican RLS** | 2 vistas de stock y estado de pedidos legibles sin autenticación | SECURITY_PRIORITY | P0 |
| H-5 | **Tiempo real** | una publicación de tiempo real incluye el almacén de H-1 (sin suscriptores medidos) | SECURITY_PRIORITY | P0 (se cierra con H-1) |
| H-6 | Hosting | el legacy sigue en `buscatoolsjano-web.github.io/Buscatools/`. React se mudó: `/web-react/` responde **301 → `app.buscatools.com`**. **El riesgo de origen compartido está resuelto**: ya no comparten `localStorage` | — | cerrado |
| H-7 | Firebase RTDB del legacy | **las reglas de la base no se auditaron**: requieren acceso a Firebase | SECURITY_PRIORITY | P1 (verificar) |
| H-8 | Credenciales huérfanas o guardadas en el navegador del legacy | ver `SHARED_ORIGIN_RISK.md` | SECURITY_PRIORITY | P1 (revocar) |
| H-9 | Escenarios de Make | Emails E0.5 los dejó **sin tocar**; estado actual no verificado (requiere acceso a Make) | MIGRATION | P2 |
| H-10 | Inyección de fórmulas en CSV | `celda()` de ventas, compras, clientes y mantenimiento | MIGRATION | P2 |
| H-11 | Base nueva | 0 funciones DEFINER ejecutables por `anon`; buckets `ventas` y `whatsapp` privados; Realtime sólo en email/whatsapp; advisors preexistentes en `PHASE_10_INFORMES_ENTREGA_5_CIERRE.md` G | — | sin P0 |

- **Almacenamiento legacy:** un solo bucket (`email-attachments`), privado,
  sin policies. Queda cerrado desde Emails E0.5.
- **Otras tablas del legacy:** protegidas por identidad; con 0 usuarios de
  Auth en el legacy no devuelven filas a nadie. No son superficie activa.

**Lo que no se puede hacer sin romper el legacy vivo** es la razón de que D-1
y D-2 vayan juntos.

Qué parte de esa superficie usa todavía el legacy se midió en la Fase 11 E0
(la versión pública no nombra las funciones).

---

## I · Integraciones

| integración | uso | estado |
|---|---|---|
| Supabase legacy (`hnyngsejohkmlaccpkux`) | `erp_store` + 11 rutas REST + RPC | **actual** (legacy vivo) → deprecated con el cutover |
| Supabase nuevo (`uaxcfufvapzulqvynanp`) | toda la app React | **actual** |
| Gmail vía Make (`hook.us2.make.com`, `hook.make.com`) | ingesta y envío legacy | **replaced** (Gmail API + Cloud Run, Fase 9); escenarios no verificados (H-9) |
| Gmail API + Cloud Run | Emails React | **actual** |
| WhatsApp Baileys (worker + QR, `suite_wa_*`) | legacy | **deprecated**; lectura y escritura públicas cerradas en E0.5 |
| wappfly | legacy viejo | **deprecated** (código muerto, token huérfano) |
| WhatsApp Cloud API (Meta) | nuevo | **pending** (sin app ni número) |
| Firebase RTDB + FCM | chat y push del legacy | actual en el legacy / **pending** decisión (D-15, D-16) |
| OpenAI / Anthropic desde el navegador | IA legacy | **deprecated** en esa forma |
| Cloudflare Workers (`buscatools-ai…workers.dev`) | proxy de IA; `WORKER_SECRET` rotado en WA E0.5 | actual en el legacy / pending |
| dolarapi.com | tipos de cambio | actual en el legacy / pending (D-12) |
| Mercado Libre API | test de credenciales | deprecated (NMBD) |
| Amazon SP-API | ninguno (placeholder) | — |
| STEL Order | fuente fiscal externa | **pending** integración (F) |
| GitHub Pages | legacy y React (`app.buscatools.com`) | actual |

---

## J · Configuración y administración

No es una pantalla: son siete asuntos distintos.

| asunto | legacy | schema nuevo | UI React | clasificación |
|---|---|---|---|---|
| Empresas | 3 hardcodeadas (Buscatools, Torquetools, **GAS**) + overrides locales | `companies` (2) con razón social, CUIT, dirección, logo y color | selector sí; edición **no** | selector MIGRADO · datos **PEND P2** (D-5) · GAS: O-9 |
| Usuarios | modal ADMIN: alta, contraseña, permisos | `auth.users` 7, `profiles` 7 | **no** | **PEND P2** (D-4) |
| Roles y permisos | 14 booleanos por usuario en localStorage | 6 roles en `company_memberships` + RLS | menú por rol; asignación **no** | modelo MWCM · UI dentro de D-4 |
| Depósitos | **no había UI**; «sv/sr» por producto y deltas locales | `warehouses` 2 (1 por empresa) | no (Informes los lee) | **funcionalidad nueva, no migración**: se construye cuando haya un segundo depósito |
| Monedas | USD/ARS/EUR en código | `currencies` 3 | no hace falta | MWCM (seed) |
| Listas de precios | `pu × 3` en JavaScript, overrides locales, memoria por cliente | `price_lists` 4 · `product_prices` 12.505 (124 de «Distribuidores») | **no** | **PEND P1**, dentro de D-3 |
| Secuencias | numeración en el navegador | `document_sequences` 20 filas, 10 tipos, server-side | no hace falta hoy | MWCM |
| Estados | strings libres | CHECK constraints y transiciones en RPC | — | MWCM |
| Preferencias | tema, color y fuente por usuario | `profiles.theme` | no | NMBD / FUTURE |
| Integraciones | Conexiones, IA, emails, WA | cuentas de email/WA en tablas; secretos en Secret Manager | no | por módulo |
| Auditoría / logs | Trazabilidad ADMIN | `*_audit` | no | **PEND P2** (D-6) |

**Stock operativo** (sección 8 del pedido):
- **Ajustes manuales, transferencias, conteos de inventario, movimientos
  manuales:** el legacy **no los tenía como función viva**. Las pantallas de
  overrides de precio/stock son código muerto, y el alta de producto cargaba
  sólo un stock inicial. En React sería **funcionalidad nueva**.
- **Reservas:** `stock_reservations` existe con 0 filas y el legacy no
  reservaba. También es funcionalidad nueva.
- **Informes de stock:** ya migrados.
- **Movimientos:** los generan entregas, recepciones y consumo de
  mantenimiento.

---

## K · Dashboard

- **Hoy:** el `/` de React es `DashboardPage` de la Fase 1, «pantalla de
  verificación, no el dashboard real», con `FILAS_DEMO` («Cliente Demo A»,
  «PEDIDO #1001»). Es la primera pantalla después del login. Eso es D-8, P2 y
  chico.

Del Inicio del legacy:

| grupo | contenido | destino |
|---|---|---|
| KPIs de ventas (cotizado, vendido, tickers, top, por estado) | reglas legacy incorrectas | **ya reemplazados por Informes**: no duplicar |
| Métricas legacy incorrectas | vendido = pedidos, comparación de mes parcial, clientes nuevos sin fecha | NMBD |
| Widgets operativos | cotizaciones recientes, pedidos en curso, pendientes, solicitudes de cotización | resumen operacional con APIs ya migradas (listados con filtros de Ventas, Compras, Mantenimiento y Emails) |
| Accesos rápidos | nueva cotización, nuevo pedido, nuevo cliente | enlaces a rutas existentes |
| Alertas | documentos en revisión, sin moneda, remitos pendientes, órdenes de mantenimiento vencidas, emails sin asignar | reutiliza los contadores que ya calculan Informes y los listados |
| Tareas / agenda / reuniones | Agenda (P4) | fuera hasta decidir O-6 |

**Propuesta, no construida:** una fase corta «Inicio operativo» (D-8 + D-9).
- Un bloque «Hoy» con pendientes por rol, que enlace a listados ya filtrados.
- Alertas con los mismos contadores de Informes.
- Accesos rápidos.
- **Sin KPIs monetarios propios**: el que quiera números va a Informes.

Va después del cutover, cuando la gente trabaje sólo en React.

## K bis · WhatsApp — evaluación (sección 22)

| opción | a favor | en contra |
|---|---|---|
| A · retomarlo ahora | el schema y la RLS ya están | **bloqueado afuera**: no hay Meta Business Portfolio, app, número ni token, y hacerlo implica decidir qué pasa con el número actual del negocio (hoy en Baileys). Sin eso no hay nada que probar de punta a punta |
| B · dejarlo pausado | no cuesta nada | queda como «incompleto» indefinido en cada auditoría |
| **C · cerrarlo como infraestructura parcial** | refleja la realidad: seguridad legacy cerrada (E0.5), 6 tablas, RLS, bucket y Realtime listos (E1), integración **condicionada** a un evento externo | ninguno relevante |

**Recomendación: C.**
- Declararlo `INFRA_READY / BLOCKED_BY_EXTERNAL (Meta)`.
- Se reabre sólo cuando exista el número de Meta y la decisión sobre el número
  actual.
- No reabrir porque «está incompleto».

---

## L · MIGRATION_STATUS: lo que dice vs la realidad

`MIGRATION_STATUS.md` dice «Última actualización: 2026-09-09 · Fase actual:
3.5 CERRADA». **No se modificó**; esta tabla es el insumo para actualizarlo en
una fase separada.

| MIGRATION_STATUS dice | realidad (2026-09-13) |
|---|---|
| Fase actual 3.5 | Fases 4–7 y 10 cerradas; 8 parcial; 9 entregada hasta la 5 |
| «En línea: `buscatoolsjano-web.github.io/web-react/`» | 301 → **`app.buscatools.com`** |
| 🔴 riesgo de origen compartido abierto, prioridad alta | **resuelto** con el dominio propio (H-6). Sigue abierta la superficie del legacy (H-1…H-5) |
| Ventas `—` · Diseñado | cerrado |
| Clientes `—` · Diseñado | cerrado |
| Compras `—` · Diseñado | **COMPRAS = CLOSED** |
| Mantenimiento `—` · Diseñado | **MANTENIMIENTO = CLOSED** |
| WhatsApp `—` · Diseñado | seguridad E0.5 cerrada; schema E1 aplicado; integración pausada (K bis) |
| Emails `—` · Diseñado | bandeja, hilos, redactar, responder y borradores en producción |
| Informes / CRM `—` · Parcial | Informes CLOSED; CRM: Actividades reemplazado, Leads P4 |
| Dashboard `—` · Parcial | DEMO de la Fase 1 en producción (D-8) |
| IA `—` · Parcial | sin iniciar (P4) |
| Tabla de fases 4–8 = `—` (con otra numeración: «4 Ventas + Clientes, 5 Compras, 6 Mantenimiento, 7 WhatsApp, 8 Emails + IA + PWA») | la numeración real es 4 Ventas, 5 Clientes, 6 Compras, 7 Mantenimiento, 8 WhatsApp, 9 Emails, 10 Informes |
| «Próximo: Etapa 2 (Ventas)» | próximo: ver N |
| «Base 13 MB → 80 MB» / 219 productos | 21.775 productos (21.772 + 3 de Torquetools), 69 tablas |
| No menciona Facturación, Importación, Agenda, Chat, Finanzas, Conexiones, Trazabilidad, Mi Cotización, Configuración | clasificadas en C |

Nota sobre un documento ya cerrado: `PHASE_10_INFORMES_ENTREGA_5_CIERRE.md`
dice «1.014 clientes» en dos lugares. **Hoy son 1.010.** La medición se tomó
mientras corría una suite con 4 clientes de prueba `zz-*`, que después se
borraron. No cambia ninguna clasificación; se corrige al actualizar la
documentación.

---

## M · Prioridades

| prioridad | pendientes | justificación |
|---|---|---|
| **P0 security** | D-1 | legacy en producción con escritura pública sobre usuarios, documentos y catálogo (H-1…H-5) |
| **P1 core operativo** | D-2 cutover · D-3 alta y edición de catálogo y precios | doble carga ya produce divergencia (+7 / +3); sin D-3 la gente vuelve al legacy para dar de alta un producto |
| **P2 admin/config** | D-4 usuarios · D-5 datos de empresa · D-6 visor de auditoría · D-7 enviar documentos por email · D-8 quitar el DEMO | uso diario del admin; hoy dependen de SQL |
| **P3 nice-to-have** | D-9 Inicio operativo · D-10 portal de clientes · D-11 calculadora de importación · D-12 tipo de cambio | valor real, uso bajo o sin datos |
| **P4 future** | D-13 WhatsApp · D-14 IA · D-15 chat, agenda, CRM de leads · D-16 push | bloqueados afuera o sin evidencia de uso |

(Para D-2, «datos» incluye además H-7 y H-8 como verificaciones externas).

---

## N · Candidatos para la próxima fase (máximo 3)

### 1 · Contención de seguridad del legacy (D-1)

- **Qué:** una fase E0.5 transversal, con el mismo patrón que WhatsApp y
  Emails E0.5:
  - inventario de llamadores reales de cada RPC y tabla expuesta;
  - backup;
  - cerrar lo que el legacy **no** usa, si O-1 lo confirma;
  - sacar del tiempo real lo que nadie escucha;
  - plan para la credencial embebida y las cuentas del legacy compatible con
    el legacy vivo.
- **Por qué ahora:** es el único P0, y el legacy sigue cargando datos todos
  los días.
- **Tamaño:** chico-mediano (1 entrega de contención + 1 de verificación).
- **Datos a migrar:** ninguno (backup previo).
- **Riesgo:** **alto si se hace a ciegas**, porque puede romper el legacy en
  uso. Bajo con inventario de llamadores y reversión preparada.
- **Dependencias:** O-1. Coordinación con quien usa el legacy.
- **Acceso externo:** no para la base (MCP). Sí, opcional, para Firebase y
  Make (H-7, H-9).

### 2 · Cutover del legacy (D-2)

- **Qué:**
  - fecha de congelamiento;
  - migración incremental del delta (cotizaciones y remitos nuevos, más lo que
    aparezca hasta la fecha) con el mismo reconciliador de Stage 2/2.5;
  - legacy en solo lectura;
  - retiro del acceso público al almacén del legacy.
- **Por qué ahora:** cada día agrega divergencia, y sin cutover la contención
  (1) nunca puede ser completa.
- **Tamaño:** mediano.
- **Datos a migrar:** hoy +7 cotizaciones y +3 notas de entrega (más clientes
  o contactos nuevos si los hubiera; se miden en la fase).
- **Riesgo:** medio. Hay dos operaciones en paralelo durante la ventana y
  alguien puede quedar sin una función que usaba (ver D-3).
- **Dependencias:** decisión de negocio (O-1, O-2) y D-3 o un procedimiento
  alternativo para dar de alta productos.
- **Acceso externo:** no.

### 3 · Alta y edición de productos, precios y listas (D-3)

- **Qué:**
  - alta y edición de producto (SKU, marca, categoría, atributos, imágenes);
  - precio por lista con vigencia;
  - baja lógica;
  - con auditoría y RLS de escritura para admin y employee (ya existe).
- **Por qué ahora:** es la única función **core** del legacy que React no
  tiene, y bloquea el cutover.
- **Tamaño:** mediano-grande (3–4 entregas: producto, precios y listas,
  imágenes, cierre).
- **Datos a migrar:** ninguno. Opera sobre los 21.772 productos y 12.505
  precios ya cargados.
- **Riesgo:** medio. La política de precios de la Fase 3.5 (markup legacy vs
  precio explícito) tiene que estar decidida, porque cambia qué ve cada rol.
- **Dependencias:** O-3.
- **Acceso externo:** no.

**Recomendación: atacar primero el candidato 1 (contención de seguridad).**

Es P0, es chico, no depende de construir nada y reduce el riesgo mientras se
preparan 3 y 2. El orden natural después es **3 → 2**: sin alta de productos
en React, el cutover obliga a mantener el legacy para una función.
Configuración (usuarios, datos de empresa) entra como P2 después, y el Inicio
operativo al final.

---

## O · Decisiones necesarias

1. **¿Qué usa todavía el legacy y quién?**
   - Confirmar si el worker de IA, el service worker de push u otro proceso
     llaman a las RPC `ai_*`, `sync_*` y de notificaciones.
   - Confirmar quién sigue cargando cotizaciones y remitos en el legacy.
2. **Fecha de congelamiento del legacy** y qué pasa con lo cargado hasta ese
   día.
3. **Política de precios** para el ABM: ¿markup legacy (12.123 precios
   derivados) o precio explícito por lista? ¿Quién edita?
4. **Facturación:** ¿se integra STEL (sincronización de facturas y cobros) o
   la facturación queda fuera del ERP?
5. **WhatsApp:** ¿se acepta la opción C?
6. **Chat interno, mensajes, agenda y CRM de leads:** ¿se migran o se
   reemplazan por herramientas externas (Google Calendar, WhatsApp)? Sin datos
   compartidos que preservar.
7. **Servicios del catálogo:** ¿existen servicios cargados en algún navegador
   que haya que preservar?
8. **Calculadora de importación:** ¿se usa? Si sí, es P3; si no, NMBD.
9. **Empresa GAS:** existe en el legacy (`buscatools_clientes_extra__erpemp_gas`,
   7 entradas) y no en la base nueva. ¿Se da de alta o se descarta?
10. **Datos de prueba en producción:** la lista de precios «Especial Cliente
    Demo» y los usuarios de prueba de la Fase 2.5. ¿Se limpian y cuándo?
11. **Verificaciones externas** (requieren login del usuario): reglas de
    Firebase RTDB (H-7), escenarios de Make (H-9), revocar `erp_wappfly_token`
    y claves de IA (H-8).

---

### Script

`scripts/auditoria-cobertura-global.mjs`: sólo lectura de archivos locales. No
hace requests ni toca bases de datos.

Inventaría:
- secciones, router y menú del legacy;
- funciones (renders, modales, wires) y funciones sin referencias;
- exports, impresiones, importaciones y placeholders;
- claves de localStorage y `SUPA_SYNC_KEYS`;
- hosts externos y ubicación de secretos (nunca su valor);
- rutas, menú y tablas/RPC por módulo en React.

```bash
node scripts/auditoria-cobertura-global.mjs <dir-legacy> [salida.json]
```

Salida de esta corrida:
- 19 `SECTIONS` · 19 ramas de router · 14 `PERM_SECCIONES` · 19 ítems de menú
  lateral;
- 1.159 funciones de primer nivel · 120 render · 36 modales · 60 wire · 57 sin
  referencias;
- 33 exports CSV · 14 líneas de impresión/PDF · 19 líneas con placeholders
  (`empty()`, «próximamente», stubs; filtradas a mano en E);
- 81 claves de localStorage · 34 `SUPA_SYNC_KEYS` · 27 hosts externos;
- 44 rutas React · 14 ítems de menú.

Las mediciones de las bases (conteos, policies, funciones, buckets, Realtime)
se hicieron con consultas de catálogo de sólo lectura y están transcriptas en
H, J y L.
