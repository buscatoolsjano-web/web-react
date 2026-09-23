/**
 * Fase 23 · La matriz de paridad, como dato.
 *
 * Está acá y no escrita a mano en el .md para que el documento, el CSV y los
 * conteos salgan todos de la misma fuente. Contar a mano una tabla de 300
 * filas garantiza que el resumen y la tabla digan cosas distintas — ya me
 * pasó en F22 con 57.
 *
 * Cada fila:
 *   id, modulo, submodulo, capacidad,
 *   legacyEv   evidencia: función y línea de app.js, o archivo
 *   legacySt   ACTIVE | CONDITIONAL | UNREACHABLE | DEAD_CODE | UNKNOWN
 *   reactEv    evidencia: archivo, ruta, RPC o test
 *   reactSt    OK | PARCIAL | NO | N/A
 *   paridad    PARITY | PARTIAL | MISSING | INTENTIONALLY_DIFFERENT |
 *              LEGACY_DEAD_CODE | UNKNOWN
 *   sev        BLOCKER | HIGH | MEDIUM | LOW | ''   (sólo PARTIAL/MISSING)
 *   notas
 *
 *   node scripts/audit/fase23-matriz.mjs [--csv out.csv] [--resumen]
 */
import { writeFileSync } from 'node:fs'

const F = (id, modulo, submodulo, capacidad, legacyEv, legacySt, reactEv, reactSt, paridad, sev, notas) =>
  ({ id, modulo, submodulo, capacidad, legacyEv, legacySt, reactEv, reactSt, paridad, sev, notas })

const A = 'ACTIVE'
const P = 'PARITY'
const PA = 'PARTIAL'
const M = 'MISSING'
const ID = 'INTENTIONALLY_DIFFERENT'
const U = 'UNKNOWN'

export const MATRIZ = [
  // ─── GLOBAL / SHELL ──────────────────────────────────────────────────────
  F('SH-01', 'GLOBAL_SHELL', 'Sesión', 'Iniciar sesión', 'app.js:1175 AUTENTICACIÓN; erp_auth_users en localStorage', A, 'features/auth/pages/LoginPage.tsx; Supabase Auth', 'OK', ID, '', 'El legacy guarda usuarios y contraseñas en localStorage. React usa Supabase Auth. Misma capacidad, sin la vulnerabilidad.'),
  F('SH-02', 'GLOBAL_SHELL', 'Sesión', 'Cerrar sesión', 'app.js:applyAuthState', A, 'features/auth', 'OK', P, '', ''),
  F('SH-03', 'GLOBAL_SHELL', 'Sesión', 'Recuperar contraseña', 'app.js data-pwd-gen / data-setpass (autogenera y la muestra)', A, 'features/auth/pages/RecuperarPage.tsx + DefinirContrasenaPage.tsx', 'OK', ID, '', 'El legacy genera y muestra la contraseña en pantalla; React manda un enlace.'),
  F('SH-04', 'GLOBAL_SHELL', 'Sesión', 'Entrar como visitante (sin usuario)', 'app.js:1008 getPermsFor(null) → catalogo + micotizacion', A, 'sin equivalente: React exige sesión', 'NO', M, 'HIGH', 'El catálogo público y el portal de cotización del cliente no existen en React.'),
  F('SH-05', 'GLOBAL_SHELL', 'Empresa', 'Elegir empresa', 'app.js:578 renderEmpresaPickerCards; data-emp-card', A, 'features/empresa/useEmpresa', 'OK', P, '', ''),
  F('SH-06', 'GLOBAL_SHELL', 'Empresa', 'Editar datos de la empresa', 'app.js data-emp-field; erp_empresas_override', A, 'modules/configuracion/pages/EmpresaPage.tsx; RPC config_empresa_actualizar', 'OK', P, '', ''),
  F('SH-07', 'GLOBAL_SHELL', 'Navegación', 'Menú lateral por secciones y grupos', 'index.html data-section (18 secciones); app.js:39891 renderLeftNavSubItems', A, 'components/layout (sidebar)', 'PARCIAL', PA, 'MEDIUM', 'React tiene 10 módulos contra 19 secciones del legacy. El detalle está en las filas de cada módulo.'),
  F('SH-08', 'GLOBAL_SHELL', 'Navegación', 'Submenús por sección', 'app.js data-lnav-sub / data-lnav-section', A, 'components/layout', 'OK', P, '', ''),
  F('SH-09', 'GLOBAL_SHELL', 'Navegación', 'Volver/adelante del navegador, enlaces profundos', 'no: el estado vive en state{} en memoria', A, 'React Router 7 hash; 76 rutas', 'OK', ID, '', 'React sobrepasa: toda la navegación es direccionable.'),
  F('SH-10', 'GLOBAL_SHELL', 'Permisos', 'Ocultar secciones según permisos', 'app.js:1029 applyPermsToTopnav; erp_user_perms', A, 'features/permisos + RLS', 'OK', ID, '', 'El legacy oculta con display:none y el dato ya está en el navegador; React lo corta en el servidor.'),
  F('SH-11', 'GLOBAL_SHELL', 'Permisos', 'Editar permisos por usuario y sección', 'app.js data-perm-k; erp_user_perms', A, 'modules/configuracion/pages/UsuariosPage.tsx; RPC config_cambiar_rol', 'PARCIAL', PA, 'MEDIUM', 'El legacy permite activar sección por sección y por usuario. React asigna un rol.'),
  F('SH-12', 'GLOBAL_SHELL', 'Apariencia', 'Elegir tema', 'app.js:2325 SELECTOR DE TEMA; data-tema-id', A, 'RPC guardar_mi_apariencia; localStorage bt-apariencia', 'OK', P, '', ''),
  F('SH-13', 'GLOBAL_SHELL', 'Notificaciones', 'Panel de notificaciones en la cabecera', 'app.js:37187 renderHeaderNotifPanel; data-notif-msg-ok / data-notif-email', A, 'sin equivalente', 'NO', M, 'MEDIUM', ''),
  F('SH-14', 'GLOBAL_SHELL', 'Notificaciones', 'Notificaciones push del navegador (FCM)', 'app.js firebase-messaging; #push-bell-toggle-btn; erp_push_fcm_token', A, 'sin equivalente', 'NO', M, 'LOW', 'Depende de Firebase. Ver LEGACY_ONLY.'),
  F('SH-15', 'GLOBAL_SHELL', 'PWA', 'Instalar como aplicación', 'manifest.webmanifest; #push-install-btn', A, 'sin manifest', 'NO', M, 'LOW', ''),
  F('SH-16', 'GLOBAL_SHELL', 'Búsqueda', 'Búsqueda global desde la cabecera', 'no se encontró un buscador global; cada sección tiene el suyo', 'UNREACHABLE', 'cada módulo tiene su búsqueda', 'N/A', P, '', 'Ninguno de los dos tiene búsqueda global.'),
  F('SH-17', 'GLOBAL_SHELL', 'Errores', 'Mostrar un error recuperable', 'no hay estado de error: el render falla en silencio', A, 'components/feedback/ErrorState; aislamiento por bloque (Fase 21 · E3.1)', 'OK', ID, '', ''),
  F('SH-18', 'GLOBAL_SHELL', 'Responsive', 'Usar el sistema en teléfono', 'app.js mob-prod-card, mob-cat-view: sólo el catálogo tiene vista mobile', 'CONDITIONAL', 'todo el sistema es responsive', 'OK', ID, '', 'En el legacy la mayoría de los editores no son usables en teléfono.'),

  // ─── DASHBOARD ───────────────────────────────────────────────────────────
  F('DA-01', 'DASHBOARD', 'Inicio', 'Ver el panel de inicio', 'app.js:2910 renderInicio', A, 'modules/dashboard/pages/DashboardPage.tsx', 'OK', P, '', ''),
  F('DA-02', 'DASHBOARD', 'Inicio', 'Ver KPIs del período', 'app.js:4490 renderResumenInicio; erp_inicio_panel_period_', A, 'DashboardPage + RPC informe_actividad_comercial', 'OK', P, '', ''),
  F('DA-03', 'DASHBOARD', 'Inicio', 'Cambiar el período del panel', 'app.js erp_inicio_panel_period_', A, 'filtros de Informes', 'OK', P, '', ''),
  F('DA-04', 'DASHBOARD', 'Inicio', 'Panel personal por usuario', 'app.js:3078 renderInicioPersonal', A, 'sin equivalente', 'NO', M, 'LOW', ''),
  F('DA-05', 'DASHBOARD', 'Widgets', 'Acomodar widgets arrastrando (gridstack)', 'app.js:5127 renderInicioWidgets; GridStack; erp_dash_widget_cfg_', A, 'sin equivalente', 'NO', M, 'LOW', 'Personalización de layout. 21 apariciones de gridstack.'),
  F('DA-06', 'DASHBOARD', 'Gráficos', 'Gráficos SVG sin dependencias', 'app.js:3879 mini-librería de gráficos', A, 'modules/informes/components (SerieMensual, etc.)', 'OK', P, '', ''),
  F('DA-07', 'DASHBOARD', 'Ejecutivo', 'Panel ejecutivo', 'app.js:4214 renderDashboardEjecutivo', A, 'DashboardPage + InformesPage', 'PARCIAL', PA, 'LOW', 'React lo reparte entre Dashboard e Informes.'),
  F('DA-08', 'DASHBOARD', 'Bandeja', 'Bandeja de mensajes en el inicio', 'app.js:3510 renderBandejaInicio; erp_bandeja_mensajes', A, 'sin equivalente', 'NO', M, 'LOW', 'Depende del chat interno (ver CH-*).'),
  F('DA-09', 'DASHBOARD', 'Actividad', 'Actividad del usuario en el inicio', 'app.js:3535 renderInicioActividadUsuario; erp_activity_log', A, 'modules/configuracion/pages/AuditoriaPage.tsx', 'PARCIAL', PA, 'LOW', 'React lo tiene como auditoría, no en el inicio.'),
  F('DA-10', 'DASHBOARD', 'Solicitudes', 'Ver solicitudes web pendientes', 'app.js:2960 renderSolicitudesWebSection; erp_client_solicitudes', A, 'sin equivalente', 'NO', M, 'HIGH', 'Depende del portal del cliente (SH-04).'),
  F('DA-11', 'DASHBOARD', 'Drill-down', 'Abrir el detalle detrás de un KPI', 'app.js: las tarjetas navegan a la sección', A, 'InformesPage: drill-down exacto verificado en F21 · E3', 'OK', P, '', ''),
  F('DA-12', 'DASHBOARD', 'Estadísticas', 'Pantalla de estadísticas (sólo ADMIN)', 'app.js:5563 renderEstadisticas; getPermsFor: hardcodeada, invisible para todos menos ADMIN', 'CONDITIONAL', 'sin equivalente', 'NO', M, 'LOW', 'El comentario del legacy dice que es inalcanzable salvo para ADMIN.'),
  F('DA-13', 'DASHBOARD', 'Obsoleto', 'renderDashboardOLD / renderDashboardOLD_OLD', 'app.js:5578 y 5581', 'DEAD_CODE', 'no aplica', 'N/A', 'LEGACY_DEAD_CODE', '', 'Dos generaciones anteriores del panel, sin referencias desde renderMain.'),

  // ─── CLIENTES ────────────────────────────────────────────────────────────
  F('CL-01', 'CLIENTES', 'Listado', 'Listar clientes', 'app.js:18293 renderClientes', A, 'modules/clientes/pages/ClientesPage.tsx', 'OK', P, '', ''),
  F('CL-02', 'CLIENTES', 'Listado', 'Buscar cliente', 'app.js: filtro de texto sobre el listado', A, 'ClientesPage + RPC clientes_similares', 'OK', P, '', ''),
  F('CL-03', 'CLIENTES', 'Listado', 'Filtrar por rubro/estado', 'app.js data-cl-filter', A, 'ClientesPage filtros', 'OK', P, '', ''),
  F('CL-04', 'CLIENTES', 'Listado', 'Ordenar por columna', 'app.js data-cl-sort', A, 'ClientesPage', 'OK', P, '', ''),
  F('CL-05', 'CLIENTES', 'Listado', 'Paginar', 'app.js data-cl-page', A, 'ClientesPage', 'OK', P, '', ''),
  F('CL-06', 'CLIENTES', 'Listado', 'Exportar clientes a CSV', 'app.js:18475 Blob text/csv → clientes_AAAA-MM-DD.csv', A, 'modules/clientes/lib/csv.ts + ClientesPage', 'OK', P, '', ''),
  F('CL-07', 'CLIENTES', 'Alta', 'Crear cliente', 'app.js menú «Más» del listado', A, 'ClienteNuevoPage; RPC crear_cliente', 'OK', P, '', ''),
  F('CL-08', 'CLIENTES', 'Edición', 'Editar datos del cliente', 'app.js:18677 renderClienteDetalle', A, 'ClienteDetallePage; RPC guardar_cliente', 'OK', P, '', ''),
  F('CL-09', 'CLIENTES', 'Detalle', 'Ver ficha 360 del cliente', 'app.js:18677 renderClienteDetalle; data-cl-tab', A, 'ClienteDetallePage; RPC resumen_cliente_360', 'OK', P, '', ''),
  F('CL-10', 'CLIENTES', 'Contactos', 'Listar contactos', 'app.js:18485 renderContactos; data-ct-open', A, 'modules/clientes/components; RPC guardar_contacto', 'OK', P, '', ''),
  F('CL-11', 'CLIENTES', 'Contactos', 'Crear y editar contacto', 'app.js:18574 renderContactoForm; data-ct-field', A, 'RPC guardar_contacto / borrar_contacto', 'OK', P, '', ''),
  F('CL-12', 'CLIENTES', 'Direcciones', 'Crear y editar dirección', 'app.js data-ciudad / data-provincia', A, 'RPC guardar_direccion / borrar_direccion', 'OK', P, '', ''),
  F('CL-13', 'CLIENTES', 'Historial', 'Ver documentos comerciales del cliente', 'app.js: pestaña del detalle', A, 'RPC documentos_del_cliente', 'OK', P, '', ''),
  F('CL-14', 'CLIENTES', 'Historial', 'Ver productos que compró', 'app.js data-pm-sku', A, 'RPC productos_del_cliente', 'OK', P, '', ''),
  F('CL-15', 'CLIENTES', 'Historial', 'Ver último precio aplicado al cliente', 'app.js: memoria de precios', A, 'RPC ultimo_precio_cliente / precios_historicos_cliente', 'OK', P, '', ''),
  F('CL-16', 'CLIENTES', 'Historial', 'Totales por moneda', 'app.js: resumen del detalle', A, 'RPC totales_por_moneda_cliente', 'OK', P, '', ''),
  F('CL-17', 'CLIENTES', 'Memoria', 'Memoria de alias: texto de OC → SKU', 'app.js:15070 getClienteAliases/setClienteAlias; data-mem-key / data-mem-del', A, 'sin equivalente', 'NO', M, 'HIGH', 'Es lo que permite que la próxima OC del cliente se matchee sola. Ver LEGACY_ONLY.'),
  F('CL-18', 'CLIENTES', 'Memoria', 'Exportar la memoria del cliente a JSON', 'app.js:18998 download memoria-<cliente>.json', A, 'sin equivalente', 'NO', M, 'LOW', 'Depende de CL-17.'),
  F('CL-19', 'CLIENTES', 'Rubros', 'Administrar rubros', 'app.js:19035 renderRubrosAdmin', A, 'sin equivalente directo', 'NO', M, 'MEDIUM', ''),
  F('CL-20', 'CLIENTES', 'Revisión', 'Revisar clientes dudosos / duplicados', 'no se encontró', 'UNREACHABLE', 'ClientesRevisarPage; RPC resolver_revision_cliente, grupos_cuit_legacy', 'OK', ID, '', 'REACT_ONLY.'),
  F('CL-21', 'CLIENTES', 'Acciones', 'Menú «Más» del cliente', 'app.js #cl-mas-btn / data-cl-mas', A, 'ClienteDetallePage acciones', 'OK', P, '', ''),
  F('CL-22', 'CLIENTES', 'Adjuntos', 'Adjuntar archivos al cliente', 'app.js erp_attachments', A, 'modules/clientes/services/adjuntos.ts', 'OK', P, '', ''),

  // ─── CATÁLOGO (detalle completo en F22) ──────────────────────────────────
  F('CA-01', 'CATALOGO', 'Productos', 'Las 57 capacidades auditadas en F22', 'app.js:15308 renderCatalogoProductos y siguientes', A, 'docs/PHASE_22_PARIDAD_CATALOGO.md', 'PARCIAL', PA, 'HIGH', 'F22: PARITY 32 · PARTIAL 5 · MISSING 11 · INT.DIF 9. Ver ese documento; acá se cuentan agrupadas las que faltan.'),
  F('CA-02', 'CATALOGO', 'Productos', 'Agregar al carrito desde el listado', 'app.js:15308 stepper − n + por fila; #cat-cart-bar / #cat-icart-bar', A, 'sin equivalente', 'NO', M, 'BLOCKER', 'F22 #50. Es el camino por el que nace una cotización en el legacy.'),
  F('CA-03', 'CATALOGO', 'Productos', 'Exportar el catálogo a CSV con columnas a elegir', 'app.js:16960 modal de exportación, 27 columnas, alcance filtrados/todo', A, 'sin equivalente', 'NO', M, 'HIGH', 'F22 #49.'),
  F('CA-04', 'CATALOGO', 'Productos', 'Comparar 2 a 4 productos elegidos con checkbox', 'app.js:17048 openCatCompare; state.catCompare', A, 'ComparadorProductos compara contra similares calculados', 'PARCIAL', PA, 'HIGH', 'F22 #42.'),
  F('CA-05', 'CATALOGO', 'Productos', 'Ordenar por columna', 'app.js data-cat-sort (8 columnas, asc/desc)', A, 'el parámetro existe y viaja a search_products; no está expuesto', 'PARCIAL', PA, 'MEDIUM', 'F22 #13.'),
  F('CA-06', 'CATALOGO', 'Productos', 'Filtrar por stock con operadores (>5, <=2)', 'app.js:15920 catalogoFilterSort', A, 'sin equivalente', 'NO', M, 'MEDIUM', 'F22 #11.'),
  F('CA-07', 'CATALOGO', 'Productos', 'Crear producto nuevo', 'app.js _abrirModalNuevoProducto; RPC erp_create_product', A, 'sin equivalente en el catálogo', 'NO', M, 'HIGH', 'F22 #51. El legacy lo hace con RPC propias (erp_create_product, erp_update_product_full).'),
  F('CA-08', 'CATALOGO', 'Productos', 'Editar producto', 'app.js RPC erp_update_product_full / erp_sync_product', A, 'sin equivalente', 'NO', M, 'HIGH', 'No está en la matriz de F22 porque F22 auditó el listado; aparece al mirar las RPC.'),
  F('CA-09', 'CATALOGO', 'Precios', 'Administrar precios del catálogo', 'app.js:13558 renderCatalogoAdminPrecios', A, 'modules/configuracion/pages/ListasPreciosPage.tsx', 'OK', P, '', ''),
  F('CA-10', 'CATALOGO', 'Servicios', 'Listar servicios del catálogo', 'app.js:15608 renderCatalogoServicios', A, 'sin equivalente', 'NO', M, 'MEDIUM', 'Submódulo entero. Ver LEGACY_ONLY.'),
  F('CA-11', 'CATALOGO', 'Servicios', 'Crear y editar un servicio', 'app.js:15755 renderServicioEditor', A, 'sin equivalente', 'NO', M, 'MEDIUM', ''),
  F('CA-12', 'CATALOGO', 'Marcas', 'Crear y borrar marca', 'app.js RPC erp_create_brand / erp_delete_brand', A, 'MarcasPage; RPC config_marca_crear/eliminar/estado', 'OK', P, '', ''),
  F('CA-13', 'CATALOGO', 'Categorías', 'Crear y borrar categoría', 'app.js RPC erp_create_category / erp_delete_category', A, 'CategoriasPage; RPC config_categoria_crear/eliminar/renombrar', 'OK', P, '', ''),
  F('CA-14', 'CATALOGO', 'Despiece', 'Despiece interactivo de repuestos por posición', 'app.js:16045 DESPIECE INTERACTIVO (planos FEIN AccuTec)', A, 'sin equivalente', 'NO', M, 'MEDIUM', 'Ver LEGACY_ONLY.'),
  F('CA-15', 'CATALOGO', 'Descripción', 'Link de catálogo técnico en la ficha', 'app.js:28648 _descSplitLink', A, 'modules/catalogo/lib/descripcion.ts (F22 cierre)', 'OK', P, '', 'Arreglado en el cierre de F22.'),

  // ─── VENTAS ──────────────────────────────────────────────────────────────
  F('VE-01', 'VENTAS', 'Cotizaciones', 'Listar cotizaciones', 'app.js:19320 renderCotList', A, 'modules/ventas/pages/CotizacionesPage.tsx', 'OK', P, '', ''),
  F('VE-02', 'VENTAS', 'Cotizaciones', 'Buscar por texto', 'app.js #cot-list-search', A, 'ListadoDocumentos', 'OK', P, '', ''),
  F('VE-03', 'VENTAS', 'Cotizaciones', 'Filtrar por referencia, cliente, título y estado', 'app.js #cot-f-ref/#cot-f-cliente/#cot-f-titulo/#cot-f-estado', A, 'ListadoDocumentos filtros', 'OK', P, '', ''),
  F('VE-04', 'VENTAS', 'Cotizaciones', 'Filtrar por período', 'app.js #cot-period-btn / data-cot-period', A, 'filtros de listado', 'OK', P, '', ''),
  F('VE-05', 'VENTAS', 'Cotizaciones', 'Ordenar por columna', 'app.js data-cot-sort', A, 'ListadoDocumentos', 'OK', P, '', ''),
  F('VE-06', 'VENTAS', 'Cotizaciones', 'Paginar y elegir tamaño de página', 'app.js #cot-page-size/#cot-prev-page/#cot-next-page', A, 'Pagination', 'OK', P, '', ''),
  F('VE-07', 'VENTAS', 'Cotizaciones', 'Seleccionar varias con checkbox', 'app.js #cot-check-all', A, 'sin equivalente', 'NO', M, 'MEDIUM', 'Habilita las acciones en lote del menú «Más».'),
  F('VE-08', 'VENTAS', 'Cotizaciones', 'Exportar el listado a CSV', 'app.js:19585 cotizaciones-AAAA-MM-DD.csv', A, 'modules/ventas/lib/csv.ts + ListadoPage', 'OK', P, '', ''),
  F('VE-09', 'VENTAS', 'Cotizaciones', 'Crear cotización', 'app.js #cot-list-new', A, 'CotizacionNuevaPage; RPC crear_cotizacion', 'OK', P, '', ''),
  F('VE-10', 'VENTAS', 'Cotizaciones', 'Editar y guardar', 'app.js:20119 renderCotEditor; #cot-save', A, 'CotizacionDetallePage; RPC guardar_cotizacion', 'OK', P, '', ''),
  F('VE-11', 'VENTAS', 'Cotizaciones', 'Duplicar', 'app.js menú «Más»', A, 'AccionesDocumento; services/acciones.ts duplicarDocumento', 'OK', P, '', ''),
  F('VE-12', 'VENTAS', 'Cotizaciones', 'Anular / eliminar', 'app.js menú «Más»', A, 'AccionesDocumento cancelar/borrar + triggers de la base', 'OK', P, '', ''),
  F('VE-13', 'VENTAS', 'Cotizaciones', 'Imprimir', 'app.js #cot-print-btn / data-cot-print; window.print en iframe', A, 'ModalImpresion + VistaImpresion (motor A4)', 'OK', P, '', ''),
  F('VE-14', 'VENTAS', 'Cotizaciones', 'Descargar PDF', 'app.js:25891 html2pdf().save()', A, 'imprimir → guardar como PDF', 'PARCIAL', PA, 'MEDIUM', 'React no genera el archivo: depende del diálogo del navegador.'),
  F('VE-15', 'VENTAS', 'Cotizaciones', 'Enviar el documento por mail', 'app.js:37282 ENVIAR DOCUMENTO POR MAIL (mailto:); data-doc-enviar', A, 'sin equivalente', 'NO', M, 'HIGH', 'Existe en cotización, pedido, nota de entrega, factura y pedido de compra.'),
  F('VE-16', 'VENTAS', 'Cotizaciones', 'Vista previa en vivo, al lado del editor', 'app.js #cot-live-preview-panel, #cot-pv-resizer, zoom ±, reset', A, 'VistaPreviaBorrador.module.css', 'PARCIAL', PA, 'MEDIUM', 'React tiene vista previa; el legacy la tiene al lado, redimensionable y con zoom.'),
  F('VE-17', 'VENTAS', 'Cotizaciones', 'Editar el documento desde la vista previa', 'app.js data-pv-field / data-pv-idx', A, 'sin equivalente', 'NO', M, 'LOW', ''),
  F('VE-18', 'VENTAS', 'Líneas', 'Agregar producto buscándolo', 'app.js #cot-add-product; renderAddProdResults:21908', A, 'services/productosParaLinea.ts; RPC search_products', 'OK', P, '', ''),
  F('VE-19', 'VENTAS', 'Líneas', 'Agregar línea libre (sin producto)', 'app.js #cot-new-line', A, 'EditorLineas', 'OK', P, '', ''),
  F('VE-20', 'VENTAS', 'Líneas', 'Agregar capítulo', 'app.js #cot-new-chapter; data-cot-chapter-title/desc', A, 'EditorLineas / TablaLineas', 'OK', P, '', ''),
  F('VE-21', 'VENTAS', 'Líneas', 'Editar cantidad, precio, descuento, descripción, SKU, IVA', 'app.js data-cot-qty/price/dto/desc/sku/iva', A, 'TablaLineas + CeldaEditable', 'OK', P, '', ''),
  F('VE-22', 'VENTAS', 'Líneas', 'Reordenar con las flechas', 'app.js data-cot-line-up / data-cot-line-down', A, 'line_no existe como dato; sin control de reordenar', 'NO', M, 'MEDIUM', ''),
  F('VE-23', 'VENTAS', 'Líneas', 'Reordenar arrastrando', 'app.js data-cot-drag', A, 'sin equivalente', 'NO', M, 'LOW', ''),
  F('VE-24', 'VENTAS', 'Líneas', 'Borrar línea', 'app.js data-cot-del', A, 'TablaLineas', 'OK', P, '', ''),
  F('VE-25', 'VENTAS', 'Líneas', 'Abrir el catálogo desde la línea', 'app.js data-cot-open-cat', A, 'buscador de productos en la línea', 'OK', P, '', ''),
  F('VE-26', 'VENTAS', 'Líneas', 'Reemplazar el capítulo de una línea', 'app.js data-cot-replace-ch', A, 'sin equivalente', 'NO', M, 'LOW', ''),
  F('VE-27', 'VENTAS', 'Cabecera', 'Elegir cliente con autocompletado', 'app.js #cot-cliente / #cot-cli-drop', A, 'EditorCabecera; RPC clientes_similares', 'OK', P, '', ''),
  F('VE-28', 'VENTAS', 'Cabecera', 'Crear cliente sin salir del documento', 'app.js #cot-cli-nuevo', A, 'sin equivalente', 'NO', M, 'MEDIUM', ''),
  F('VE-29', 'VENTAS', 'Cabecera', 'Elegir y crear contacto sin salir', 'app.js #cot-contacto-add / #cot-contacto-nuevo', A, 'EditorCabecera elige contacto; no lo crea', 'PARCIAL', PA, 'MEDIUM', ''),
  F('VE-30', 'VENTAS', 'Cabecera', 'Condición de pago, IVA, IIBB, fecha, título', 'app.js #cot-pago/#cot-iva/#cot-iibb/#cot-fecha/#cot-titulo', A, 'EditorCabecera', 'OK', P, '', ''),
  F('VE-31', 'VENTAS', 'Cabecera', 'Descuento global', 'app.js #cot-dto-global', A, 'lib/totales.ts descuentoGlobal', 'OK', P, '', ''),
  F('VE-32', 'VENTAS', 'Cabecera', 'Moneda del documento', 'app.js #cot-moneda', A, 'EditorCabecera', 'OK', P, '', ''),
  F('VE-33', 'VENTAS', 'Documento', 'Pestañas del documento', 'app.js data-cot-tab', A, 'DocumentTabs: Líneas, Relacionados, Adjuntos, Trazabilidad', 'OK', P, '', ''),
  F('VE-34', 'VENTAS', 'Documento', 'Adjuntar archivos', 'app.js:24728 ADJUNTOS; data-adj-row/download/delete', A, 'PanelAdjuntos + services/adjuntos.ts', 'OK', P, '', ''),
  F('VE-35', 'VENTAS', 'Documento', 'Registro de cambios del documento', 'app.js:24368 AUDIT LOG por documento; renderActivityLog:24425', A, 'pestaña Trazabilidad', 'OK', P, '', ''),
  F('VE-36', 'VENTAS', 'Documento', 'Campos extra estilo StelOrder («Más información»)', 'app.js:24554 renderMasInfoUI:24638; data-mas-action/sku/idx', A, 'sin equivalente', 'NO', M, 'MEDIUM', ''),
  F('VE-37', 'VENTAS', 'Documento', 'Ver documentos relacionados y su CSV', 'app.js:24884 renderRelacionadosTable; data-rel-type/ref; CSV en :25016', A, 'PanelRelacionados', 'PARCIAL', PA, 'LOW', 'React muestra los relacionados; no los exporta.'),
  F('VE-38', 'VENTAS', 'Flujo', 'Convertir cotización en pedido', 'app.js data-pipeline-generate; #cot-generate-next-btn', A, 'RPC convertir_cotizacion_en_pedido (+ _en_serie)', 'OK', P, '', ''),
  F('VE-39', 'VENTAS', 'Flujo', 'Saltar al pedido derivado', 'app.js #cot-goto-derived-ped', A, 'PanelRelacionados', 'OK', P, '', ''),
  F('VE-40', 'VENTAS', 'Flujo', 'Ver el embudo y navegarlo', 'app.js data-pipeline-nav / data-pipeline-ref', A, 'RPC informe_pipeline_comercial (en Informes)', 'PARCIAL', PA, 'LOW', 'React lo tiene como informe, no como navegador dentro de Ventas.'),
  F('VE-41', 'VENTAS', 'Pedidos', 'Listar, buscar, filtrar, ordenar, paginar', 'app.js:22743 renderPedidos; data-ped-*', A, 'PedidosPage', 'OK', P, '', ''),
  F('VE-42', 'VENTAS', 'Pedidos', 'Editar el pedido', 'app.js:23103 renderPedidoEditor', A, 'PedidoDetallePage; RPC guardar_pedido', 'OK', P, '', ''),
  F('VE-43', 'VENTAS', 'Pedidos', 'Confirmar stock del pedido', 'app.js #ped-confirm-stock', A, 'PanelPendientes / flujo de entrega', 'OK', P, '', ''),
  F('VE-44', 'VENTAS', 'Pedidos', 'Generar remito desde el pedido', 'app.js #ped-to-ne', A, 'RPC crear_remito_desde_pedido', 'OK', P, '', ''),
  F('VE-45', 'VENTAS', 'Pedidos', 'Cambiar el estado del pedido a mano', 'app.js #ped-estado', A, 'estados derivados del flujo, no editables sueltos', 'NO', ID, '', 'React no deja poner un estado a mano: lo decide el flujo.'),
  F('VE-46', 'VENTAS', 'Remitos', 'Listar, buscar, filtrar, ordenar, paginar', 'app.js:22275 renderNotasEntrega; data-ne-*', A, 'EntregasPage', 'OK', P, '', ''),
  F('VE-47', 'VENTAS', 'Remitos', 'Editar el remito', 'app.js:23628 renderNotaEntregaEditor', A, 'EntregaDetallePage; RPC guardar_remito', 'OK', P, '', ''),
  F('VE-48', 'VENTAS', 'Remitos', 'Entrega parcial: elegir cuánto de cada línea', 'app.js #ne-parcial-modal; data-ne-qty; #ne-parc-all/clear/cancel/ok', A, 'ModalEntregaParcial', 'OK', P, '', ''),
  F('VE-49', 'VENTAS', 'Remitos', 'Confirmar el remito y mover stock', 'app.js #ne-confirm-stock', A, 'RPC confirmar_entrega', 'OK', P, '', ''),
  F('VE-50', 'VENTAS', 'Remitos', 'Generar factura desde el remito', 'app.js #ne-gen-factura', A, 'sin equivalente: no hay facturación en React', 'NO', M, 'BLOCKER', 'Ver el módulo FACTURACION.'),
  F('VE-51', 'VENTAS', 'Importar', 'Importar una OC del cliente desde PDF', 'app.js:38347 OC Import — parser de PDF inline; #oc-ok-btn/#oc-retry-btn/#oc-create-prod-btn', A, 'sin equivalente', 'NO', M, 'HIGH', 'Lee el PDF, propone líneas y permite crear el producto faltante. Ver LEGACY_ONLY.'),
  F('VE-52', 'VENTAS', 'Series', 'Elegir la serie del documento', 'app.js: numeración por serie', A, 'RPC series_de_documento, next_document_number, autoridad_numeracion_*', 'OK', P, '', ''),
  F('VE-53', 'VENTAS', 'Acciones', 'Menú «Más» del listado (acciones en lote)', 'app.js #cot-list-mas-btn / data-cot-list-mas', A, 'sin equivalente', 'NO', M, 'MEDIUM', 'Depende de VE-07.'),
  F('VE-54', 'VENTAS', 'Acciones', 'Menú «Más» del documento', 'app.js #cot-mas-btn / data-cot-mas', A, 'AccionesDocumento', 'OK', P, '', ''),
  F('VE-55', 'VENTAS', 'Descartadas', 'Marcar una cotización como descartada', 'app.js erp_cot_descartadas', A, 'cancelarDocumento', 'OK', P, '', ''),

  // ─── COMPRAS ─────────────────────────────────────────────────────────────
  F('CO-01', 'COMPRAS', 'Proveedores', 'Listar y buscar proveedores', 'app.js:31853 renderProveedoresList; data-prov-open', A, 'modules/compras/pages/ProveedoresPage.tsx', 'OK', P, '', ''),
  F('CO-02', 'COMPRAS', 'Proveedores', 'Crear y editar proveedor', 'app.js:31969 renderProveedorModal', A, 'ProveedorNuevaPage / ProveedorDetallePage', 'OK', P, '', ''),
  F('CO-03', 'COMPRAS', 'Proveedores', 'Exportar proveedores', 'app.js #prov-mas-list-btn', A, 'ProveedoresPage CSV', 'OK', P, '', ''),
  F('CO-04', 'COMPRAS', 'Pedidos', 'Listar, buscar, ordenar', 'app.js:32094 renderPedidosCompraList; data-pc-sort', A, 'compras/pages/PedidosPage.tsx', 'OK', P, '', ''),
  F('CO-05', 'COMPRAS', 'Pedidos', 'Crear y editar pedido de compra', 'app.js:32418 renderPedidoCompraEditor', A, 'PedidoNuevoPage / PedidoDetallePage', 'OK', P, '', ''),
  F('CO-06', 'COMPRAS', 'Pedidos', 'Líneas: SKU, descripción, cantidad, precio, descuento', 'app.js data-pc-sku/nombre/desc/qty/price/dto', A, 'compras/components', 'OK', P, '', ''),
  F('CO-07', 'COMPRAS', 'Pedidos', 'Capítulos en el pedido de compra', 'app.js data-pc-chapter', A, 'sin equivalente', 'NO', M, 'LOW', ''),
  F('CO-08', 'COMPRAS', 'Pedidos', 'Duplicar pedido de compra', 'app.js menú «Más»', A, 'RPC duplicar_pedido_compra', 'OK', P, '', ''),
  F('CO-09', 'COMPRAS', 'Pedidos', 'Imprimir pedido de compra', 'app.js #pc-print-btn / data-pc-print', A, 'VistaImpresionCompras', 'OK', P, '', ''),
  F('CO-10', 'COMPRAS', 'Pedidos', 'Enviar el pedido por mail', 'app.js data-doc-enviar', A, 'sin equivalente', 'NO', M, 'HIGH', 'Mismo caso que VE-15.'),
  F('CO-11', 'COMPRAS', 'Recepción', 'Registrar recepción de mercadería', 'app.js data-nep-qty (recepción parcial)', A, 'RecepcionNuevaPage; RPC confirmar_recepcion', 'OK', P, '', ''),
  F('CO-12', 'COMPRAS', 'Facturas', 'Listar facturas de proveedor', 'app.js:33191 renderFacturasProvList; data-fp-open', A, 'compras/pages/FacturasPage.tsx', 'OK', P, '', ''),
  F('CO-13', 'COMPRAS', 'Facturas', 'Crear y editar factura de proveedor', 'app.js:33332 renderFacturaProvEditor', A, 'FacturaNuevaPage / FacturaDetallePage; RPC registrar_factura_proveedor', 'OK', P, '', ''),
  F('CO-14', 'COMPRAS', 'Notas', 'Notas de crédito/débito de proveedor', 'app.js:33572 renderNotasProvList; :33686 renderNotaProvEditor', A, 'sin equivalente', 'NO', M, 'MEDIUM', ''),
  F('CO-15', 'COMPRAS', 'Costos', 'Ver el último precio de compra', 'app.js: memoria de costos', A, 'RPC ultimo_precio_compra', 'OK', P, '', ''),
  F('CO-16', 'COMPRAS', 'Trazabilidad', 'Registrar evento de compra', 'app.js erp_trazabilidad_log', A, 'RPC registrar_evento_compra', 'OK', P, '', ''),
  F('CO-17', 'COMPRAS', 'Pendientes', 'Ver lo pendiente de facturar y de pedir', 'app.js: columnas del listado', A, 'RPC pendiente_de_facturar / pendiente_de_pedido', 'OK', P, '', ''),

  // ─── STOCK ───────────────────────────────────────────────────────────────
  F('ST-01', 'STOCK', 'Existencias', 'Ver stock real y virtual por producto', 'app.js getEffectiveStock; columnas del catálogo', A, 'Celdas.tsx StockCelda; RPC informe_stock_actual', 'OK', P, '', ''),
  F('ST-02', 'STOCK', 'Existencias', 'Informe de stock del catálogo', 'app.js:26404 renderInformeStock', A, 'RPC informe_stock_catalogo / informe_stock_resumen; TablaStock', 'OK', P, '', ''),
  F('ST-03', 'STOCK', 'Movimientos', 'Ver el historial de movimientos de un producto', 'app.js loadKardex, 15 últimos en la ficha', A, 'HistorialStock; RPC informe_kardex_producto', 'OK', P, '', ''),
  F('ST-04', 'STOCK', 'Movimientos', 'Listar todos los movimientos con filtros', 'app.js: dentro del informe de stock', A, 'MovimientosStock; RPC informe_movimientos_stock', 'OK', P, '', ''),
  F('ST-05', 'STOCK', 'Movimientos', 'Exportar movimientos a CSV', 'app.js:30340 export CSV del módulo', A, 'lib/csvStock.ts', 'OK', P, '', ''),
  F('ST-06', 'STOCK', 'Entradas', 'Dar entrada por recepción de compra', 'app.js: recepción del pedido de compra', A, 'RPC confirmar_recepcion', 'OK', P, '', ''),
  F('ST-07', 'STOCK', 'Salidas', 'Dar salida por remito', 'app.js #ne-confirm-stock', A, 'RPC confirmar_entrega', 'OK', P, '', ''),
  F('ST-08', 'STOCK', 'Ajustes', 'Ajustar existencias a mano', 'no se encontró una pantalla de ajuste', U, 'sin equivalente', 'NO', U, '', 'Hay que confirmar con Juan si el ajuste se hacía por otra vía.'),
  F('ST-09', 'STOCK', 'Reservas', 'Reservar stock (virtual = real − reservado)', 'app.js getEffectiveStock usa sr y sv precalculados', A, 'stock_balances.reserved; confirmar_entrega', 'OK', P, '', ''),
  F('ST-10', 'STOCK', 'Depósitos', 'Manejar más de un depósito', 'no se encontró', 'UNREACHABLE', 'stock_balances tiene el depósito', 'PARCIAL', ID, '', 'React modela el depósito; el legacy no lo expone.'),
  F('ST-11', 'STOCK', 'Transferencias', 'Transferir entre depósitos', 'no se encontró', 'UNREACHABLE', 'sin equivalente', 'NO', P, '', 'Ninguno de los dos lo tiene.'),
  F('ST-12', 'STOCK', 'Sin saldo', 'Distinguir «sin saldo registrado» de cero', 'app.js muestra 0', A, 'Celdas.tsx: muestra «—»', 'OK', ID, '', 'React corrige una afirmación falsa del legacy.'),

  // ─── MANTENIMIENTO ───────────────────────────────────────────────────────
  F('MA-01', 'MANTENIMIENTO', 'Activos', 'Listar y abrir activos', 'app.js:28616 FEIN AccuTec data layer; data-mant-open-activo; mant_activos', A, 'modules/mantenimiento/pages/ActivosPage.tsx', 'OK', P, '', ''),
  F('MA-02', 'MANTENIMIENTO', 'Activos', 'Crear y editar activo', 'app.js:29086 Nueva Ficha — tool selector', A, 'ActivoNuevoPage / ActivoDetallePage', 'OK', P, '', ''),
  F('MA-03', 'MANTENIMIENTO', 'Órdenes', 'Ficha de servicio en 5 pasos', 'app.js:29170 Ficha layout + steps; data-mant-step; :29266 Diagnóstico, :29322 Cotización, :29397 Reparación, :29429 Torque, :29520 Cierre', A, 'OrdenDetallePage; RPC precheck_cierre_mantenimiento, cerrar_orden_mantenimiento', 'OK', P, '', ''),
  F('MA-04', 'MANTENIMIENTO', 'Órdenes', 'Pausar una ficha', 'app.js #mant-pausar-btn', A, 'estados de la orden', 'PARCIAL', PA, 'LOW', ''),
  F('MA-05', 'MANTENIMIENTO', 'Órdenes', 'Aprobar o rechazar la cotización del servicio', 'app.js #cot-aprobar / #cot-rechazar / #cot-pendiente', A, 'RPC aprobar_cotizacion_mantenimiento / rechazar_cotizacion_mantenimiento', 'OK', P, '', ''),
  F('MA-06', 'MANTENIMIENTO', 'Órdenes', 'Registrar mediciones de torque', 'app.js:29429 Step 4: Torque', A, 'RPC capacidad_torque; modules/mantenimiento/components', 'OK', P, '', ''),
  F('MA-07', 'MANTENIMIENTO', 'Repuestos', 'Consumir repuestos en la orden', 'app.js mant_repuestos', A, 'RPC confirmar_consumo_mantenimiento', 'OK', P, '', ''),
  F('MA-08', 'MANTENIMIENTO', 'Historial', 'Ver el histórico importado de STEL', 'app.js mant_historico; data-hist-id / data-hist-del', A, 'histórico STEL separado (F20 · E2, opción C)', 'OK', P, '', ''),
  F('MA-09', 'MANTENIMIENTO', 'Historial', 'Borrar un registro del histórico', 'app.js data-hist-del / #btn-hist-clear', A, 'sin equivalente: el histórico es de sólo lectura', 'NO', ID, '', 'Deliberado: el histórico importado no se edita.'),
  F('MA-10', 'MANTENIMIENTO', 'Lotes', 'Cotizaciones por lotes', 'app.js:30129 Cotizaciones por Lotes; data-lote-id / #btn-nuevo-lote', A, 'sin equivalente', 'NO', M, 'MEDIUM', ''),
  F('MA-11', 'MANTENIMIENTO', 'Modelos', 'Administrar modelos de herramienta', 'app.js:30183 Modelos; data-modelo / data-mod-row / #btn-nuevo-modelo; mant_modelos_custom', A, 'derivado del catálogo (_mantCatalogModelos)', 'PARCIAL', PA, 'MEDIUM', 'React no deja crear un modelo a mano.'),
  F('MA-12', 'MANTENIMIENTO', 'Manuales', 'Adjuntar y abrir manuales PDF', 'app.js:30273 Manuales / PDF; data-man-del / #btn-nuevo-manual; mant_manuales', A, 'sin equivalente', 'NO', M, 'MEDIUM', ''),
  F('MA-13', 'MANTENIMIENTO', 'Backup', 'Exportar histórico, actividad, clientes y nuevos a CSV', 'app.js:30328 #exp-hist-csv/#exp-act-csv/#exp-cli-csv/#exp-new-csv', A, 'modules/mantenimiento/lib/csv.ts', 'PARCIAL', PA, 'LOW', 'React exporta activos y órdenes; no los cuatro del legacy.'),
  F('MA-14', 'MANTENIMIENTO', 'Backup', 'Backup completo a JSON', 'app.js #exp-backup-json', A, 'sin equivalente', 'NO', M, 'LOW', 'En React el dato vive en la base; el backup es de la base.'),
  F('MA-15', 'MANTENIMIENTO', 'Usuarios', 'Usuarios del módulo de mantenimiento', 'app.js:30417 Usuarios; data-usr-toggle / data-usr-del; mant_usuarios', A, 'usuarios del sistema (UsuariosPage)', 'OK', ID, '', 'React no tiene un padrón de usuarios aparte por módulo.'),
  F('MA-16', 'MANTENIMIENTO', 'Puntos', 'Puntos de mantenimiento', 'no se encontró', 'UNREACHABLE', 'PuntosPage', 'OK', ID, '', 'REACT_ONLY.'),
  F('MA-17', 'MANTENIMIENTO', 'Despiece', 'Elegir el repuesto sobre el plano', 'app.js:16045 DESPIECE INTERACTIVO; data-part', A, 'sin equivalente', 'NO', M, 'MEDIUM', 'Mismo caso que CA-14.'),
  F('MA-18', 'MANTENIMIENTO', 'Panel', 'Panel del módulo con sus métricas', 'app.js:28932 Dashboard (mantenimiento); data-mant-view / data-mant-filter', A, 'OrdenesPage con filtros', 'PARCIAL', PA, 'LOW', ''),

  // ─── EMAILS ──────────────────────────────────────────────────────────────
  F('EM-01', 'EMAILS', 'Bandeja', 'Ver la bandeja de entrada', 'app.js:40294 EMAILS; renderEmailsLista:41233; tabla erp_emails', A, 'modules/emails/pages/EmailsPage.tsx; RPC listar_bandeja_email', 'OK', P, '', ''),
  F('EM-02', 'EMAILS', 'Bandeja', 'Abrir y leer un hilo', 'app.js:41497 renderEmailDetalle', A, 'EmailHiloPage', 'OK', P, '', ''),
  F('EM-03', 'EMAILS', 'Bandeja', 'Buscar y filtrar', 'app.js: filtros de la lista', A, 'EmailsPage filtros', 'OK', P, '', ''),
  F('EM-04', 'EMAILS', 'Bandeja', 'Marcar leído / no leído', 'app.js: acciones de la lista', A, 'RPC marcar_hilo_leido_email / cambiar_estado_email', 'OK', P, '', ''),
  F('EM-05', 'EMAILS', 'Bandeja', 'Marcar como spam', 'app.js erp_emails_spam', A, 'RPC cambiar_estado_email', 'OK', P, '', ''),
  F('EM-06', 'EMAILS', 'Redacción', 'Redactar y enviar', 'app.js erp_email_sent', A, 'EmailRedactarPage; backend/emails', 'OK', P, '', ''),
  F('EM-07', 'EMAILS', 'Redacción', 'Responder un hilo', 'app.js erp_emails_webhook_reply', A, 'EmailHiloPage', 'OK', P, '', ''),
  F('EM-08', 'EMAILS', 'Redacción', 'Borradores', 'no se encontró', 'UNREACHABLE', 'EmailBorradoresPage', 'OK', ID, '', 'REACT_ONLY.'),
  F('EM-09', 'EMAILS', 'Adjuntos', 'Ver y descargar adjuntos', 'app.js:24770 iconos por mime', A, 'modules/emails/components', 'OK', P, '', ''),
  F('EM-10', 'EMAILS', 'Etiquetas', 'Administrar etiquetas', 'app.js:44017 renderEmailsLabelsMgr; erp_email_labels', A, 'sin equivalente', 'NO', M, 'MEDIUM', ''),
  F('EM-11', 'EMAILS', 'Reglas', 'Reglas de clasificación automática', 'app.js:40917 renderEmailsRules; tabla erp_email_rules', A, 'sin equivalente', 'NO', M, 'MEDIUM', ''),
  F('EM-12', 'EMAILS', 'Config', 'Configurar la cuenta de correo', 'app.js:41034 renderEmailsConfig; erp_emails_access', A, 'configuración del backend', 'PARCIAL', PA, 'LOW', ''),
  F('EM-13', 'EMAILS', 'Asociación', 'Vincular un hilo a un cliente', 'app.js: acciones del detalle', A, 'RPC vincular_cliente_email / sugerencias_cliente_email', 'OK', P, '', ''),
  F('EM-14', 'EMAILS', 'Asignación', 'Asignar el hilo a un usuario', 'no se encontró', 'UNREACHABLE', 'RPC asignar_hilo_email / usuarios_asignables_email', 'OK', ID, '', 'REACT_ONLY.'),
  F('EM-15', 'EMAILS', 'Destinatarios', 'Autocompletar destinatarios', 'no se encontró', 'UNREACHABLE', 'RPC autocompletar_destinatarios_email', 'OK', ID, '', 'REACT_ONLY.'),
  F('EM-16', 'EMAILS', 'Sincronización', 'Sincronizar por webhook', 'app.js erp_emails_webhook_sync', A, 'backend/emails en Cloud Run (F9)', 'OK', P, '', ''),

  // ─── INFORMES ────────────────────────────────────────────────────────────
  F('IN-01', 'INFORMES', 'General', 'Pantalla de informes', 'app.js:26188 renderInformes', A, 'modules/informes/pages/InformesPage.tsx', 'OK', P, '', ''),
  F('IN-02', 'INFORMES', 'Vistazo', 'Vistazo general', 'app.js:26245 renderInformeVistazo', A, 'ResumenComercial', 'OK', P, '', ''),
  F('IN-03', 'INFORMES', 'Ventas', 'Informe de ventas', 'app.js:26309 renderInformeVentas', A, 'RPC informe_actividad_comercial + informe_documentos', 'OK', P, '', ''),
  F('IN-04', 'INFORMES', 'Compras', 'Informe de compras', 'app.js:26367 renderInformeCompras', A, 'sin equivalente propio', 'NO', M, 'MEDIUM', 'React tiene los listados de compras, no el informe.'),
  F('IN-05', 'INFORMES', 'Stock', 'Informe de stock', 'app.js:26404 renderInformeStock', A, 'TablaStock; RPC informe_stock_*', 'OK', P, '', ''),
  F('IN-06', 'INFORMES', 'Evolución', 'Evolución mensual', 'app.js:26502 renderInformeEvolucion', A, 'SerieMensual (F21 · E3.1)', 'OK', P, '', ''),
  F('IN-07', 'INFORMES', 'Rankings', 'Ranking de clientes y productos', 'app.js: dentro de los informes', A, 'RankingComercial; RPC informe_rankings_comerciales', 'OK', P, '', ''),
  F('IN-08', 'INFORMES', 'Drill-down', 'Abrir los documentos detrás de un número', 'app.js: navegación a la sección', A, 'SeccionDocumentos; RPC informe_documentos (F21 · E3: 18/18 exactos)', 'OK', ID, '', 'React sobrepasa: el drill-down reconcilia exacto con el KPI.'),
  F('IN-09', 'INFORMES', 'Exportar', 'Exportar el informe a CSV', 'app.js: exports por listado', A, 'ExportarInforme + lib/csv.ts', 'OK', P, '', ''),
  F('IN-10', 'INFORMES', 'Moneda', 'Ver por moneda sin sumarlas', 'app.js:20056 convierte a USD para comparar', A, 'SelectorMoneda; no suma monedas', 'OK', ID, '', 'Decisión de F21: no sumar monedas distintas.'),
  F('IN-11', 'INFORMES', 'Biblioteca', 'Biblioteca de archivos', 'app.js:26556 renderBibliotecaArchivos; erp_attachments', A, 'sin equivalente', 'NO', M, 'MEDIUM', 'Repositorio central de los adjuntos de todos los documentos.'),
  F('IN-12', 'INFORMES', 'Período', 'Elegir el período y comparar contra el anterior', 'app.js: selector de período', A, 'useFiltrosInformes', 'OK', P, '', ''),

  // ─── CONFIGURACIÓN ───────────────────────────────────────────────────────
  F('CF-01', 'CONFIGURACION', 'General', 'Pantalla de configuración', 'app.js:43453 renderConfig', A, 'modules/configuracion/pages', 'OK', P, '', ''),
  F('CF-02', 'CONFIGURACION', 'Usuarios', 'Alta, baja y edición de usuarios', 'app.js #btn-admin-users; erp_auth_users', A, 'UsuariosPage; RPC config_listar_usuarios, config_cambiar_estado', 'OK', P, '', ''),
  F('CF-03', 'CONFIGURACION', 'Roles', 'Asignar rol', 'app.js: role en erp_auth_users (ADMIN/cliente/equipo)', A, 'RPC config_cambiar_rol (admin/employee/salesperson/technician/customer/distributor)', 'OK', ID, '', 'React tiene más roles y los aplica con RLS.'),
  F('CF-04', 'CONFIGURACION', 'Permisos', 'Permiso por sección y por usuario', 'app.js data-perm-k; PERM_SECCIONES; erp_user_perms', A, 'sólo por rol', 'PARCIAL', PA, 'MEDIUM', 'Mismo punto que SH-11.'),
  F('CF-05', 'CONFIGURACION', 'Empresas', 'Varias empresas y cambio entre ellas', 'app.js data-empresa-k; erp_empresas_override', A, 'useEmpresa; RLS por company_id', 'OK', P, '', ''),
  F('CF-06', 'CONFIGURACION', 'Marcas', 'Administrar marcas', 'app.js RPC erp_create_brand/erp_delete_brand', A, 'MarcasPage', 'OK', P, '', ''),
  F('CF-07', 'CONFIGURACION', 'Categorías', 'Administrar categorías', 'app.js RPC erp_create_category/erp_delete_category', A, 'CategoriasPage', 'OK', P, '', ''),
  F('CF-08', 'CONFIGURACION', 'Atributos', 'Definir atributos técnicos', 'app.js: atributos a medida en el alta de producto', A, 'AtributosPage; RPC config_atributos_listar', 'OK', P, '', ''),
  F('CF-09', 'CONFIGURACION', 'Series', 'Numeración y series de documento', 'app.js: numeración por serie', A, 'NumeracionPage; RPC autoridad_numeracion_*, config_numeracion_diagnostico', 'OK', P, '', ''),
  F('CF-10', 'CONFIGURACION', 'Listas', 'Listas de precios', 'app.js:13558 renderCatalogoAdminPrecios', A, 'ListasPreciosPage; RPC config_listas_precios_listar, config_lista_precios_items/clientes', 'OK', P, '', ''),
  F('CF-11', 'CONFIGURACION', 'Auditoría', 'Ver quién hizo qué', 'app.js:38211 TRAZABILIDAD; :34164 renderTrazabilidad (sólo ADMIN); erp_trazabilidad_log', A, 'AuditoriaPage; RPC config_auditoria_listar / config_auditoria_actores', 'OK', P, '', ''),
  F('CF-12', 'CONFIGURACION', 'Impresión', 'Opciones de impresión guardadas', 'app.js erp_print_opts', A, 'ModalImpresion', 'PARCIAL', PA, 'LOW', 'React no recuerda las opciones entre documentos.'),
  F('CF-13', 'CONFIGURACION', 'Depósitos', 'Administrar depósitos', 'no se encontró', 'UNREACHABLE', 'sin pantalla propia', 'NO', P, '', 'Ninguno de los dos lo expone.'),
  F('CF-14', 'CONFIGURACION', 'IA', 'Configurar la clave de IA', 'app.js loadAiConfig; erp_ai_config / erp_openai_key en localStorage', A, 'RPC config_ia_whatsapp / guardar_config_ia_whatsapp', 'PARCIAL', ID, '', 'React guarda la configuración del lado del servidor; el legacy pone la clave de OpenAI en localStorage.'),
  F('CF-15', 'CONFIGURACION', 'STEL', 'Estado de la sincronización con STEL', 'app.js: import de STEL', A, 'RPC stel_sync_estado', 'OK', P, '', ''),

  // ─── MÓDULOS QUE SÓLO EXISTEN EN EL LEGACY ───────────────────────────────
  F('FA-01', 'OTROS', 'Facturación', 'Listar facturas de venta', 'app.js:27095 renderFacturasList; data-fact-open', A, 'sin equivalente', 'NO', M, 'BLOCKER', ''),
  F('FA-02', 'OTROS', 'Facturación', 'Crear y editar factura de venta', 'app.js:27366 renderFacturaEditor; data-fact-sku/qty/price/dto', A, 'sin equivalente', 'NO', M, 'BLOCKER', ''),
  F('FA-03', 'OTROS', 'Facturación', 'Imprimir y enviar la factura', 'app.js #fact-print-btn / data-doc-enviar', A, 'sin equivalente', 'NO', M, 'BLOCKER', ''),
  F('FA-04', 'OTROS', 'Facturación', 'Exportar facturas a CSV', 'app.js:27313 facturas-AAAA-MM-DD.csv', A, 'sin equivalente', 'NO', M, 'HIGH', ''),
  F('FA-05', 'OTROS', 'Facturación', 'Recibos de cobro', 'app.js:27703 renderRecibosList; :27776 CSV', A, 'sin equivalente', 'NO', M, 'HIGH', ''),
  F('FA-06', 'OTROS', 'Facturación', 'Notas de crédito', 'app.js:27803 renderNotasCreditoList; :27876 CSV', A, 'sin equivalente', 'NO', M, 'HIGH', ''),
  F('CR-01', 'OTROS', 'CRM', 'Leads: listar, abrir y borrar', 'app.js:27970 renderCRMLeads; data-lead-open / data-lead-del; erp_client_leads', A, 'sin equivalente', 'NO', M, 'MEDIUM', ''),
  F('CR-02', 'OTROS', 'CRM', 'Embudo de oportunidades', 'app.js:28093 renderCRMPipeline; data-opp-open', A, 'RPC informe_pipeline_comercial (sólo lectura, en Informes)', 'PARCIAL', PA, 'MEDIUM', ''),
  F('CR-03', 'OTROS', 'CRM', 'Actividades comerciales', 'app.js:28223 renderCRMActividades', A, 'sin equivalente', 'NO', M, 'MEDIUM', ''),
  F('CR-04', 'OTROS', 'CRM', 'Informes de CRM', 'app.js:28259 renderCRMInformes', A, 'sin equivalente', 'NO', M, 'LOW', ''),
  F('FI-01', 'OTROS', 'Finanzas', 'Tipo de cambio', 'app.js:28362 renderFinanzasTC; erp_finanzas_rates', A, 'sin equivalente', 'NO', M, 'HIGH', 'Los documentos en moneda extranjera dependen de esto.'),
  F('FI-02', 'OTROS', 'Finanzas', 'Aging de cuentas por cobrar', 'app.js:28434 renderFinanzasAging', A, 'sin equivalente', 'NO', M, 'HIGH', ''),
  F('FI-03', 'OTROS', 'Finanzas', 'Flujo de caja', 'app.js:28474 renderFinanzasCash', A, 'sin equivalente', 'NO', M, 'MEDIUM', ''),
  F('AG-01', 'OTROS', 'Agenda', 'Calendario de eventos', 'app.js:25935 renderCalendario; data-agenda-day; erp_eventos', A, 'sin equivalente', 'NO', M, 'MEDIUM', ''),
  F('AG-02', 'OTROS', 'Agenda', 'Crear y abrir un evento', 'app.js:25998 renderEventosLista; data-agenda-ev', A, 'sin equivalente', 'NO', M, 'MEDIUM', ''),
  F('IM-01', 'OTROS', 'Importación', 'Calculadora de costo Europa → Argentina', 'app.js:34644; :34852 courier; :34922 tradicional; imp_params_v1', A, 'sin equivalente', 'NO', M, 'MEDIUM', ''),
  F('IM-02', 'OTROS', 'Importación', 'Comparar courier contra despacho formal', 'app.js:34977 renderImpComparar; data-imp-mode', A, 'sin equivalente', 'NO', M, 'MEDIUM', ''),
  F('IM-03', 'OTROS', 'Importación', 'Cargar y editar los ítems a importar', 'app.js data-imp-row/edit/idx/del/add; imp_items_v1', A, 'sin equivalente', 'NO', M, 'MEDIUM', ''),
  F('CN-01', 'OTROS', 'Conexiones', 'Integración con Mercado Libre', 'app.js:33911 renderConexiones; #btn-ml-guardar/test/borrar; erp_conexiones', 'CONDITIONAL', 'sin equivalente', 'NO', M, 'LOW', 'Sólo ADMIN. Falta confirmar si está en uso.'),
  F('CN-02', 'OTROS', 'Conexiones', 'Integración con Amazon', 'app.js #btn-amz-guardar/test/borrar', 'CONDITIONAL', 'sin equivalente', 'NO', M, 'LOW', 'Ídem.'),
  F('CH-01', 'OTROS', 'Chat', 'Chat interno entre usuarios', 'app.js:35584 CHAT (local, mismo navegador); erp_chat_messages / erp_chat_groups', A, 'sin equivalente', 'NO', M, 'LOW', 'El legacy lo hace con localStorage: sólo funciona entre pestañas del mismo navegador.'),
  F('CH-02', 'OTROS', 'Chat', 'Grupos de chat', 'app.js data-cg-member; erp_chat_groups', A, 'sin equivalente', 'NO', M, 'LOW', ''),
  F('CH-03', 'OTROS', 'Mensajes', 'Mensajes internos con acuse', 'app.js:10912 renderMensajesSection; data-msg-para / data-msg-ok; erp_mensajes', A, 'sin equivalente', 'NO', M, 'LOW', ''),
  F('PC-01', 'OTROS', 'Portal cliente', 'Catálogo público sin iniciar sesión', 'app.js:1008 getPermsFor(null)', A, 'sin equivalente', 'NO', M, 'HIGH', ''),
  F('PC-02', 'OTROS', 'Portal cliente', 'Armar una cotización como cliente', 'app.js:2088 renderClienteCotizacion; erp_client_carrito; data-micot-inc/dec/del', A, 'sin equivalente', 'NO', M, 'HIGH', ''),
  F('PC-03', 'OTROS', 'Portal cliente', 'Enviar la solicitud y que la vea el equipo', 'app.js:2294 renderAdminSolicitudesPanel; erp_client_solicitudes', A, 'sin equivalente', 'NO', M, 'HIGH', ''),
  F('PC-04', 'OTROS', 'Portal cliente', 'Panel de leads de la web', 'app.js:2273 renderAdminLeadsPanel; erp_client_leads', A, 'sin equivalente', 'NO', M, 'MEDIUM', ''),
  F('PC-05', 'OTROS', 'Portal cliente', 'Cuentas de cliente', 'app.js erp_client_accounts', A, 'roles customer/distributor con RLS', 'PARCIAL', PA, 'HIGH', 'React tiene los roles pero no la pantalla del portal.'),
  F('IA-01', 'OTROS', 'IA', 'Asistente del catálogo', 'app.js:5763 ASISTENTE IA del Catálogo (Claude/OpenAI directo)', A, 'sin equivalente', 'NO', M, 'LOW', 'Fuera de alcance por decisión: «NO queremos IA todavía».'),
  F('IA-02', 'OTROS', 'IA', 'Cuatro chats especializados', 'app.js:6346 AI_CATS', A, 'sin equivalente', 'NO', M, 'LOW', 'Ídem.'),
  F('IA-03', 'OTROS', 'IA', 'La IA ejecuta acciones (crear cotización, agregar SKU)', 'app.js:9151 EJECUTOR DE ACCIONES; data-ai-add-sku / data-ai-cot-keep / data-ai-open-doc-ref', A, 'sin equivalente', 'NO', M, 'LOW', 'Ídem. Es la parte más delicada: la IA escribe documentos.'),
  F('IA-04', 'OTROS', 'IA', 'Clave de OpenAI en el navegador', 'app.js erp_openai_key en localStorage', A, 'no se replica', 'N/A', ID, '', 'Diferencia de seguridad deliberada: no se copia.'),
  F('IA-05', 'OTROS', 'IA', 'Resumen diario y memoria de la IA', 'app.js tablas erp_ai_daily_summaries / erp_ai_memory / erp_ai_conversations', A, 'sin equivalente', 'NO', M, 'LOW', 'Ídem.'),
  F('IA-06', 'OTROS', 'IA', 'Clon conversacional por usuario', 'app.js tablas erp_clone_conversations / erp_clone_notes / erp_clone_prompts', 'CONDITIONAL', 'sin equivalente', 'NO', U, '', 'Cómo verificarlo: mirar si erp_clone_conversations tiene filas con created_at del último año; si está vacía, es código sin uso. Dato necesario: un select count(*) por fecha.'),
  F('WA-01', 'OTROS', 'WhatsApp', 'Ver el estado de la sesión de WhatsApp', 'app.js:43826 renderWhatsapp; tabla suite_wa_sesion; RPC suite_wa_ping', A, 'modules/whatsapp/pages/WhatsappPage.tsx', 'OK', P, '', ''),
  F('WA-02', 'OTROS', 'WhatsApp', 'Conversaciones y asignación', 'app.js bt_wa_settings', A, 'RPC asignar_conversacion_whatsapp, no_leidos_whatsapp, marcar_conversacion_leida_whatsapp', 'OK', P, '', ''),
  F('WA-03', 'OTROS', 'WhatsApp', 'IA sobre las conversaciones', 'no se encontró en el legacy', 'UNREACHABLE', 'ConfigIAWhatsappPage; RPC estado_ia_whatsapp, metricas_ia_whatsapp, resolver_item_ia_whatsapp', 'OK', ID, '', 'REACT_ONLY.'),
  F('WA-04', 'OTROS', 'WhatsApp', 'Informe de WhatsApp', 'no se encontró', 'UNREACHABLE', 'InformeWhatsappPage; RPC informe_whatsapp', 'OK', ID, '', 'REACT_ONLY.'),
  F('TR-01', 'OTROS', 'Trazabilidad', 'Vista de trazabilidad para ADMIN', 'app.js:34164 renderTrazabilidad', 'CONDITIONAL', 'AuditoriaPage', 'OK', P, '', 'Duplica CF-11; se cuenta una sola vez allá.'),
  F('OT-01', 'OTROS', 'Obsoleto', 'renderDocRowRel_OLD', 'app.js:25025', 'DEAD_CODE', 'no aplica', 'N/A', 'LEGACY_DEAD_CODE', '', 'Sin referencias.'),
  F('OT-02', 'OTROS', 'Obsoleto', '_supaClienteSyncDone (bandera de sincronización vieja)', 'app.js localStorage', 'DEAD_CODE', 'no aplica', 'N/A', 'LEGACY_DEAD_CODE', '', 'Bandera de una migración ya hecha.'),
]

// Las filas cuya paridad no se cuenta contra el legacy: código muerto y
// capacidades que sólo existen en React.
export const NO_CUENTAN = new Set(['LEGACY_DEAD_CODE'])

export function resumen(filas = MATRIZ) {
  const activas = filas.filter((f) => !NO_CUENTAN.has(f.paridad))
  const cuenta = (p, arr = activas) => arr.filter((f) => f.paridad === p).length
  const porModulo = {}
  for (const f of activas) {
    porModulo[f.modulo] = porModulo[f.modulo] ?? { total: 0, PARITY: 0, PARTIAL: 0, MISSING: 0, INTENTIONALLY_DIFFERENT: 0, UNKNOWN: 0 }
    porModulo[f.modulo].total++
    porModulo[f.modulo][f.paridad]++
  }
  const sev = (s) => activas.filter((f) => f.sev === s).length
  return {
    FILAS_TOTALES: filas.length,
    LEGACY_DEAD_CODE: filas.length - activas.length,
    TOTAL_ACTIVE_LEGACY_CAPABILITIES: activas.length,
    PARITY: cuenta('PARITY'),
    PARTIAL: cuenta('PARTIAL'),
    MISSING: cuenta('MISSING'),
    INTENTIONALLY_DIFFERENT: cuenta('INTENTIONALLY_DIFFERENT'),
    UNKNOWN: cuenta('UNKNOWN'),
    BLOCKERS: sev('BLOCKER'),
    HIGH: sev('HIGH'),
    MEDIUM: sev('MEDIUM'),
    LOW: sev('LOW'),
    POR_MODULO: porModulo,
  }
}

const COLS = ['id', 'modulo', 'submodulo', 'capacidad', 'legacyEv', 'legacySt', 'reactEv', 'reactSt', 'paridad', 'sev', 'notas']
const CAB = ['ID', 'MODULO', 'SUBMODULO', 'CAPACIDAD', 'LEGACY_EVIDENCE', 'LEGACY_STATUS', 'REACT_EVIDENCE', 'REACT_STATUS', 'PARITY_STATUS', 'SEVERITY', 'NOTES']

export function aCsv(filas = MATRIZ) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return [CAB.join(';'), ...filas.map((f) => COLS.map((c) => esc(f[c])).join(';'))].join('\r\n')
}

function main() {
  const r = resumen()
  const ids = MATRIZ.map((f) => f.id)
  if (new Set(ids).size !== ids.length) throw new Error('hay un ID repetido en la matriz')
  for (const f of MATRIZ) {
    if ((f.paridad === 'PARTIAL' || f.paridad === 'MISSING') && !f.sev) {
      throw new Error(`${f.id}: PARTIAL/MISSING sin severidad`)
    }
    if (f.paridad === 'PARITY' && f.sev) throw new Error(`${f.id}: PARITY no lleva severidad`)
  }
  const salida = process.argv.includes('--csv') ? process.argv[process.argv.indexOf('--csv') + 1] : null
  if (salida) { writeFileSync(salida, aCsv()); console.error(`${salida} escrito (${MATRIZ.length} filas).`) }
  console.log(JSON.stringify(r, null, 2))
}

const esteArchivo = import.meta.url.replace(/^file:\/\/\/?/, '').replace(/\\/g, '/').toLowerCase()
const invocado = String(process.argv[1] ?? '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
if (invocado && esteArchivo.endsWith(invocado)) {
  try { main() } catch (e) { console.error(e.message); process.exit(1) }
}
