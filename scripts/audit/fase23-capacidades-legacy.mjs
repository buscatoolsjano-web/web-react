/**
 * Fase 23 · Capacidades del legacy, no pantallas.
 *
 * La unidad de auditoría es «lo que el usuario puede hacer» (§3). En el
 * legacy eso vive en tres lugares: los atributos `data-*` que después se
 * cablean, los `on*` inline, y las funciones que escriben o abren algo.
 *
 * Esto los extrae y los asigna al módulo que los contiene, usando el mapa de
 * funciones `render*` como frontera: todo lo que está entre `renderVentas` y
 * la siguiente pantalla pertenece a Ventas.
 *
 *   node scripts/audit/fase23-capacidades-legacy.mjs <ruta-al-legacy> [--json out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A qué módulo pertenece cada línea del archivo.
 *
 * Se arma con las funciones ancla de cada sección del router (`renderMain`).
 * Entre una ancla y la siguiente, el código es de ese módulo. No es exacto
 * —el legacy no está ordenado por módulo— pero es reproducible y permite
 * decir «esto vive cerca de acá», que es lo que hace falta para auditar.
 */
export const ANCLAS = [
  ['GLOBAL_SHELL', /^function (renderEmpresaPickerCards|renderSidebar|applyPermsToTopnav|getPermsFor|renderLeftNavSubItems|renderHeaderNotifPanel)\b/],
  ['PORTAL_CLIENTE', /^function (renderClienteCotizacion|renderAdminLeadsPanel|renderAdminSolicitudesPanel|wireClienteCotizacion)\b/],
  ['DASHBOARD', /^function (renderInicio|renderInicioPersonal|renderInicioWidgets|renderDashboard|renderDashboardEjecutivo|renderResumenInicio|renderEstadisticas|renderBandejaInicio|renderInicioActividadUsuario|renderSolicitudesWebSection|renderInicioSinVentas)\b/],
  ['IA', /^function (renderAiPanel|renderAiCategoryPicker|renderAiContent|_aiBuscarCliente|loadAiConfig)\b/],
  ['CATALOGO', /^function (renderCatalogo|renderCatalogoProductos|renderCatalogoServicios|renderServicioEditor|renderProductDetail|renderCatalogoVisor|renderCatalogoAdminPrecios|openCatCompare|renderPuntasSubcats|renderBalanceadorFilters|renderAtornilladorFilters)\b/],
  ['CLIENTES', /^function (renderClientes|renderClienteDetalle|renderContactos|renderContactoForm|renderRubrosAdmin)\b/],
  ['VENTAS', /^function (renderVentas|renderCotList|renderCotEditor|renderPedidos|renderPedidoEditor|renderNotasEntrega|renderNotaEntregaEditor|renderAddProdResults|renderAddProdResultsPed|renderAddProdResultsNE|renderActivityLog|renderMasInfoUI|renderAdjuntosUI|renderRelacionadosTable|renderRelacionadosCot|renderRelacionadosPed|renderRelacionadosNE)\b/],
  ['FACTURACION', /^function (renderFacturacion|renderFacturasList|renderFacturaEditor|renderRecibosList|renderNotasCreditoList)\b/],
  ['AGENDA', /^function (renderAgenda|renderCalendario|renderEventosLista)\b/],
  ['INFORMES', /^function (renderInformes|renderKpiCards|renderBarChart|renderInformeVistazo|renderInformeVentas|renderInformeCompras|renderInformeStock|renderInformeEvolucion|renderBibliotecaArchivos)\b/],
  ['CRM', /^function (renderCRM|renderCRMLeads|renderCRMPipeline|renderCRMActividades|renderCRMInformes)\b/],
  ['FINANZAS', /^function (renderFinanzas|renderFinanzasTC|renderFinanzasAging|renderFinanzasCash)\b/],
  ['MANTENIMIENTO', /^function (renderMantenimientos|wireMant)\b/],
  ['COMPRAS', /^function (renderCompras|renderProveedoresList|renderProveedorModal|renderPedidosCompraList|renderPedidoCompraEditor|renderAddProdResultsPC|renderFacturasProvList|renderFacturaProvEditor|renderNotasProvList|renderNotaProvEditor)\b/],
  ['CONEXIONES', /^function (renderConexiones|wireConexiones)\b/],
  ['TRAZABILIDAD', /^function (renderTrazabilidad|wireTrazabilidad)\b/],
  ['IMPORTACION', /^function (renderImportacion|renderImpComparar|wireImportacion|calcImportacionCourier|calcImportacionTradicional)\b/],
  ['CHAT', /^function (renderChat|renderMensajesSection)\b/],
  ['EMAILS', /^function (renderEmails|renderEmailsLista|renderEmailDetalle|renderEmailsRules|renderEmailsConfig|renderEmailsSkeleton|renderEmailsLabelsMgr|wireEmails)\b/],
  ['WHATSAPP', /^function (renderWhatsapp|wireWhatsapp)\b/],
  ['CONFIGURACION', /^function (renderConfig)\b/],
]

/** Para cada línea, el módulo vigente. */
export function mapaDeModulos(src) {
  const lineas = src.split('\n')
  const marcas = []
  for (let i = 0; i < lineas.length; i++) {
    for (const [mod, re] of ANCLAS) {
      if (re.test(lineas[i] ?? '')) { marcas.push({ linea: i + 1, mod }); break }
    }
  }
  marcas.sort((a, b) => a.linea - b.linea)
  return (linea) => {
    let actual = 'OTROS'
    for (const m of marcas) {
      if (m.linea <= linea) actual = m.mod
      else break
    }
    return actual
  }
}

/** Los `data-*` que el legacy usa como handler, no como dato de estilo. */
const DESCARTAR = new Set([
  'data-theme', 'data-testid', 'data-id', 'data-idx', 'data-sku', 'data-ref',
  'data-value', 'data-key', 'data-name', 'data-type', 'data-url', 'data-src',
])

export function capacidades(src) {
  const deModulo = mapaDeModulos(src)
  const out = new Map()
  const sumar = (clave, linea, forma) => {
    const mod = deModulo(linea)
    const id = `${mod}::${clave}`
    const v = out.get(id) ?? { modulo: mod, clave, formas: new Set(), veces: 0, primera: linea }
    v.formas.add(forma)
    v.veces++
    if (linea < v.primera) v.primera = linea
    out.set(id, v)
  }

  const lineaDe = (() => {
    // Índice de saltos de línea, para no recortar el string en cada match.
    const cortes = []
    for (let i = 0; i < src.length; i++) if (src[i] === '\n') cortes.push(i)
    return (pos) => {
      let lo = 0, hi = cortes.length
      while (lo < hi) { const mid = (lo + hi) >> 1; if ((cortes[mid] ?? 0) < pos) lo = mid + 1; else hi = mid }
      return lo + 1
    }
  })()

  for (const m of src.matchAll(/\bdata-([a-z][a-z0-9-]{2,})\s*=/gi)) {
    const clave = `data-${(m[1] ?? '').toLowerCase()}`
    if (DESCARTAR.has(clave)) continue
    sumar(clave, lineaDe(m.index ?? 0), 'data')
  }
  for (const m of src.matchAll(/\bid\s*=\s*["'](btn-[\w-]+|[\w-]*-btn|cat-[\w-]+|cot-[\w-]+|ped-[\w-]+|ne-[\w-]+|exp-[\w-]+)["']/gi)) {
    sumar(`#${m[1]}`, lineaDe(m.index ?? 0), 'id')
  }
  return [...out.values()].map((v) => ({ ...v, formas: [...v.formas].join('+') }))
}

function main() {
  const base = process.argv[2]
  if (!base) throw new Error('uso: fase23-capacidades-legacy.mjs <ruta-al-legacy> [--json out.json]')
  const src = readFileSync(join(base, 'app.js'), 'utf8') + '\n' + readFileSync(join(base, 'index.html'), 'utf8')

  const caps = capacidades(src)
  const porModulo = {}
  for (const c of caps) {
    porModulo[c.modulo] = porModulo[c.modulo] ?? []
    porModulo[c.modulo].push(c)
  }
  for (const k of Object.keys(porModulo)) porModulo[k].sort((a, b) => a.primera - b.primera)

  const resumen = Object.fromEntries(
    Object.entries(porModulo).map(([k, v]) => [k, v.length]).sort((a, b) => b[1] - a[1]),
  )
  console.log(JSON.stringify({ TOTAL_CAPACIDADES_CANDIDATAS: caps.length, POR_MODULO: resumen }, null, 2))

  const salida = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null
  if (salida) {
    writeFileSync(salida, JSON.stringify({ resumen, porModulo }, null, 2))
    console.error(`${salida} escrito.`)
  }
}

const esteArchivo = import.meta.url.replace(/^file:\/\/\/?/, '').replace(/\\/g, '/').toLowerCase()
const invocado = String(process.argv[1] ?? '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
if (invocado && esteArchivo.endsWith(invocado)) {
  try { main() } catch (e) { console.error(e.stack); process.exit(1) }
}
