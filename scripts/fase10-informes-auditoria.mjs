/**
 * Fase 10 · Informes — entrega 0: auditoría de SÓLO LECTURA.
 *
 * Mide, sin escribir nada en ningún lado:
 *
 *   1. el bundle legacy (app.js): huella y ubicación de las funciones de Informes
 *      y de las pantallas vecinas que calculan KPIs;
 *   2. los datos legacy que Informes lee, desde los respaldos read-only ya
 *      existentes (erp_store del 2026-09-09 y localStorage de Compras del
 *      2026-09-10). SÓLO las claves que usa Informes; del resto, sólo si existen;
 *   3. las fórmulas legacy REPLICADAS tal cual —incluida la zona horaria del
 *      navegador (America/Argentina/Buenos_Aires, UTC−3)— contra la versión con
 *      el mes tomado del string de fecha, para medir el corrimiento;
 *   4. el ERP nuevo en Supabase: conteos, monedas, fechas, vendedor, stock,
 *      costos. Sólo SELECT (supabase-js `.select`), nunca insert/update/delete/rpc.
 *
 * No imprime datos personales: nombres de clientes sólo como conteos y
 * colisiones agregadas (el top de clientes se reporta con hash corto).
 *
 *   set -a; source .env; source .env.migration; set +a
 *   node scripts/fase10-informes-auditoria.mjs \
 *     --bundle <legacy/app.js> \
 *     --store <erp_store-completo.json> \
 *     --compras <backups-legacy/compras-2026-09-10> \
 *     [--productos <productos-data.json>] [--chrome <AUDITORIA-CHROME-REAL.json>] \
 *     [--hoy 2026-09-13] [--out reporte.json]
 */
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// ── argumentos ──────────────────────────────────────────────────────────────
const arg = (n, def = null) => {
  const i = process.argv.indexOf(`--${n}`)
  return i > 0 ? process.argv[i + 1] : def
}
const BUNDLE = arg('bundle')
const STORE = arg('store')
const COMPRAS = arg('compras')
const PRODUCTOS = arg('productos')
const CHROME = arg('chrome')
const HOY = arg('hoy', new Date().toISOString().slice(0, 10))
const OUT = arg('out')
if (!BUNDLE || !STORE || !COMPRAS) {
  console.error('Uso: node scripts/fase10-informes-auditoria.mjs --bundle app.js --store erp_store-completo.json --compras <dir> [--productos productos-data.json] [--chrome AUDITORIA-CHROME-REAL.json] [--hoy YYYY-MM-DD] [--out reporte.json]')
  process.exit(1)
}
const URL_SB = process.env.VITE_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!URL_SB || !SECRET) { console.error('Faltan VITE_SUPABASE_URL / SUPABASE_SECRET_KEY'); process.exit(1) }

const reporte = { generado: new Date().toISOString(), hoy_simulado: HOY, zona_legacy: 'America/Argentina/Buenos_Aires (UTC−3, sin horario de verano)' }
const sha = (b) => createHash('sha256').update(b).digest('hex')
const hashCorto = (s) => sha(String(s)).slice(0, 8)
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
const seccion = (t) => console.log(`\n== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)

// ═══════════════════════════════════════════════════════════════════════════
// 1 · BUNDLE LEGACY
// ═══════════════════════════════════════════════════════════════════════════
seccion('1 · bundle legacy')
const bundleBuf = readFileSync(BUNDLE)
const bundle = bundleBuf.toString('utf8')
const lineas = bundle.split('\n')
const lineaDe = (re) => {
  const i = lineas.findIndex((l) => re.test(l))
  return i >= 0 ? i + 1 : null
}
const FUNCIONES = [
  'renderInformes', 'getMonthSeries', 'renderKpiCards', 'renderBarChart', 'renderInformeVistazo', 'renderInformeVentas',
  'renderInformeCompras', 'renderInformeStock', 'renderInformeEvolucion', 'renderBibliotecaArchivos', 'wireInformes',
  '_soloUSD', '_dashMonthlySeries', '_dashTickerCard', 'renderDashboardEjecutivo', 'renderDashboard', 'renderEstadisticas',
  'statWidgetVendidoVendedor', 'statWidgetClientesRubroPie', 'dashWidgetStockBajo', 'dashWidgetVentasMesChart',
  'renderFinanzasAging', 'renderFinanzasCash', 'renderCRMInformes', '_chkTeam', 'getPermsFor', '_ekey',
  '_todasEmpresasCollect', '_dashLoad', 'getEffectiveStock', 'loadKardex', 'appendKardex', 'loadAttachmentsStore',
  'downloadCSV', 'loadCotizaciones', 'loadPedidos', 'loadNotasEntrega', 'loadPedidosCompra', 'loadNotasProveedor',
]
const ubicaciones = Object.fromEntries(FUNCIONES.map((f) => [f, lineaDe(new RegExp(`^(async )?function ${f.replace('$', '\\$')}\\(`))]))
ubicaciones['SECTIONS.informes'] = lineaDe(/^\s*informes: \{ items:\[/)
ubicaciones['SUPA_SYNC_KEYS'] = lineaDe(/^const SUPA_SYNC_KEYS = \[/)
ubicaciones['TEAM_USERS'] = lineaDe(/^const TEAM_USERS = /)
ubicaciones['productos-data.json (XHR síncrono)'] = lineaDe(/_pxhr\.open\('GET', 'productos-data\.json', false\)/)

// Claves sincronizadas con Supabase legacy (erp_store): el resto vive SÓLO en el navegador.
const syncIni = ubicaciones['SUPA_SYNC_KEYS']
let syncTexto = ''
for (let i = syncIni - 1; i < lineas.length; i++) {
  syncTexto += lineas[i]
  if (lineas[i].includes('];')) break
}
const SYNC = new Set([...syncTexto.matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]))
const usosSoloUSD = (bundle.match(/_soloUSD\(/g) ?? []).length - 1

reporte.bundle = {
  archivo: BUNDLE.split(/[\\/]/).pop(),
  bytes: bundleBuf.length,
  lineas: lineas.length,
  sha256: sha(bundleBuf).slice(0, 16),
  ubicaciones,
  usos_de__soloUSD: usosSoloUSD,
  claves_sincronizadas: SYNC.size,
}
console.log(`app.js ${bundleBuf.length} bytes · ${lineas.length} líneas · sha256 ${reporte.bundle.sha256}…`)
for (const [k, v] of Object.entries(ubicaciones)) console.log(`  ${String(v ?? '—').padStart(6)}  ${k}`)
console.log(`  _soloUSD() usado en ${usosSoloUSD} lugares`)

// ═══════════════════════════════════════════════════════════════════════════
// 2 · FUENTES LEGACY DE INFORMES
// ═══════════════════════════════════════════════════════════════════════════
seccion('2 · fuentes legacy')
const store = JSON.parse(readFileSync(STORE, 'utf8'))
const storeKeys = new Set(store.map((r) => r.key))
const deStore = (k) => store.find((r) => r.key === k)?.value
const leerCompras = (k) => {
  const p = join(COMPRAS, `${k}.json`)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : undefined
}
const manifestCompras = existsSync(join(COMPRAS, 'MANIFEST.json')) ? JSON.parse(readFileSync(join(COMPRAS, 'MANIFEST.json'), 'utf8')) : null
const chrome = CHROME && existsSync(CHROME) ? JSON.parse(readFileSync(CHROME, 'utf8')) : null

// Claves que Informes (y las pantallas vecinas de KPIs) leen, según el código.
const FUENTES = [
  { clave: 'erp_cotizaciones', usa: 'Vistazo, Ventas, Evolución, CSV ventas, dashboards', namespaced: true },
  { clave: 'erp_pedidos', usa: 'Vistazo (serie), Ventas (conteo), Evolución, dashboards (vendido)', namespaced: true },
  { clave: 'erp_notas_entrega', usa: 'Vistazo (vendido, por cobrar), Ventas (facturado), Evolución', namespaced: true },
  { clave: 'erp_pedidos_compra', usa: 'Vistazo (comprado), Compras, CSV compras, Cash flow', namespaced: true },
  { clave: 'erp_notas_proveedor', usa: 'Compras (conteo)', namespaced: true },
  { clave: 'erp_kardex', usa: 'Stock (kardex)', namespaced: true },
  { clave: 'erp_stock_deltas', usa: 'Stock (sr/sv efectivos), dashboard stock bajo', namespaced: true },
  { clave: 'erp_producto_overrides', usa: 'Stock (sr/sv/pu sobreescritos por SKU)', namespaced: true },
  { clave: 'productos-data.json', usa: 'Stock (catálogo + sr/sv/pu base)', namespaced: false, fuera_de_localStorage: true },
  { clave: 'erp_attachments', usa: 'Archivos adjuntos', namespaced: false },
  { clave: 'erp_facturas', usa: 'Dashboard ejecutivo (por cobrar, aging, facturado), Finanzas', namespaced: true },
  { clave: 'erp_recibos', usa: 'Dashboard ejecutivo (cobrado mes)', namespaced: true },
  { clave: 'erp_notas_credito', usa: 'Dashboard ejecutivo (pendiente de factura)', namespaced: true },
  { clave: 'erp_facturas_prov', usa: 'Cash flow', namespaced: true },
  { clave: 'buscatools_clientes_extra', usa: 'Estadísticas: clientes por rubro', namespaced: true },
]
const estadoFuente = (f) => {
  if (f.fuera_de_localStorage) return PRODUCTOS && existsSync(PRODUCTOS) ? 'EMBEDDED (archivo estático, snapshot local)' : 'EMBEDDED (no provisto)'
  if (storeKeys.has(f.clave)) return 'EXISTS (erp_store legacy)'
  const enCompras = manifestCompras?.exportadas?.some((e) => e.key === f.clave)
  if (enCompras) return 'EXISTS (localStorage, export 2026-09-10)'
  const ausenteCompras = manifestCompras?.ausentes_en_el_origen?.includes(f.clave)
  const chromeFin = chrome?.claves_financieras?.[f.clave]
  if (ausenteCompras || (chromeFin && /AUSENTE/.test(chromeFin))) return 'MISSING (medido ausente en el origen)'
  if (chromeFin && /VACÍA/.test(chromeFin)) return 'EXISTS VACÍA (medido en el origen)'
  return SYNC.has(f.clave) ? 'MISSING (sincronizable, no está en erp_store)' : 'LOCAL ONLY (no sincroniza; no medido)'
}
reporte.fuentes = FUENTES.map((f) => ({ ...f, sincroniza_con_erp_store: SYNC.has(f.clave), estado: estadoFuente(f) }))
for (const f of reporte.fuentes) console.log(`  ${f.clave.padEnd(28)} ${(f.sincroniza_con_erp_store ? 'sync' : 'local').padEnd(6)} ${f.estado}`)

// ═══════════════════════════════════════════════════════════════════════════
// 3 · FÓRMULAS LEGACY REPLICADAS
// ═══════════════════════════════════════════════════════════════════════════
seccion('3 · documentos legacy y fórmulas replicadas')
const cots = deStore('erp_cotizaciones') ?? []
const peds = deStore('erp_pedidos') ?? []
const nes = deStore('erp_notas_entrega') ?? []
const pcs = leerCompras('erp_pedidos_compra') ?? []
const kardex = deStore('erp_kardex') ?? []

// _soloUSD exactamente como el legacy: sin moneda cuenta como USD.
const soloUSD = (d) => {
  if (!d) return 0
  const m = (d.moneda || '').toString().toUpperCase()
  if (m && m !== 'USD') return 0
  return d.total || 0
}
// Mes que ve el legacy: new Date('YYYY-MM-DD') es medianoche UTC; getMonth() en
// el navegador (UTC−3) cae en el día anterior.
const OFFSET_AR_MS = -3 * 3600_000
const mesLegacy = (fecha) => {
  const t = Date.parse(fecha)
  if (Number.isNaN(t)) return null
  const d = new Date(t + OFFSET_AR_MS)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() }
}
const mesString = (fecha) => (/^\d{4}-\d{2}/.test(fecha ?? '') ? { y: Number(fecha.slice(0, 4)), m: Number(fecha.slice(5, 7)) - 1 } : null)
const hoy = { y: Number(HOY.slice(0, 4)), m: Number(HOY.slice(5, 7)) - 1 }
const mismoMes = (a, b) => !!a && !!b && a.y === b.y && a.m === b.m
const mesAtras = (i) => {
  const d = new Date(Date.UTC(hoy.y, hoy.m - i, 1))
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() }
}
const etiqueta = ({ y, m }) => `${y}-${String(m + 1).padStart(2, '0')}`

const perfilDocs = (nombre, docs) => {
  const moneda = {}
  const totalPorMoneda = {}
  for (const d of docs) {
    const k = d.moneda === undefined ? '(sin campo)' : String(d.moneda || '(vacía)')
    moneda[k] = (moneda[k] ?? 0) + 1
    totalPorMoneda[k] = r2((totalPorMoneda[k] ?? 0) + (d.total || 0))
  }
  const sinMoneda = docs.filter((d) => !d.moneda)
  const estados = {}
  for (const d of docs) estados[d.estado ?? '(null)'] = (estados[d.estado ?? '(null)'] ?? 0) + 1
  const dia01 = docs.filter((d) => /^\d{4}-\d{2}-01$/.test(d.fecha ?? ''))
  const corridos = docs.filter((d) => d.fecha && !mismoMes(mesLegacy(d.fecha), mesString(d.fecha)))
  const clientes = docs.map((d) => d.cliente).filter(Boolean)
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.,\s]+/g, ' ').replace(/\b(s ?a|s ?r ?l|s ?a ?u|srl|sa|sau)\b/g, '').trim()
  const distintos = new Set(clientes)
  const normalizados = new Map()
  for (const c of distintos) {
    const n = norm(c)
    normalizados.set(n, [...(normalizados.get(n) ?? []), c])
  }
  const colisiones = [...normalizados.values()].filter((v) => v.length > 1)
  const lineasDoc = docs.flatMap((d) => d.items ?? [])
  return {
    documentos: docs.length,
    moneda,
    total_por_moneda: totalPorMoneda,
    sin_moneda: {
      documentos: sinMoneda.length,
      total_contado_como_USD_por__soloUSD: r2(sinMoneda.reduce((s, d) => s + (d.total || 0), 0)),
      pista__moneda_de_importacion: Object.fromEntries(Object.entries(sinMoneda.reduce((a, d) => ({ ...a, [String(d._moneda ?? '(sin _moneda)')]: (a[String(d._moneda ?? '(sin _moneda)')] ?? 0) + 1 }), {}))),
    },
    excluido_por__soloUSD: { documentos: docs.filter((d) => d.moneda && d.moneda.toUpperCase() !== 'USD').length, total_nominal: r2(docs.filter((d) => d.moneda && d.moneda.toUpperCase() !== 'USD').reduce((s, d) => s + (d.total || 0), 0)) },
    estados,
    creadoPor_con_valor: docs.filter((d) => d.creadoPor).length,
    fechas: {
      formato_YYYY_MM_DD: docs.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.fecha ?? '')).length,
      dia_01: dia01.length,
      corridos_de_mes_por_zona_horaria: corridos.length,
      rango: docs.length ? [docs.map((d) => d.fecha).sort()[0], docs.map((d) => d.fecha).sort().at(-1)] : null,
    },
    clientes: {
      con_cliente: clientes.length,
      sin_cliente: docs.length - clientes.length,
      nombres_distintos: distintos.size,
      grupos_que_colisionan_al_normalizar: colisiones.length,
      nombres_involucrados_en_colisiones: colisiones.reduce((s, v) => s + v.length, 0),
    },
    lineas: {
      total: lineasDoc.length,
      sin_sku: lineasDoc.filter((l) => !l.sku).length,
      capitulo: lineasDoc.filter((l) => l.type === 'chapter').length,
      unidades: r2(lineasDoc.reduce((s, l) => s + (l.qty || 0), 0)),
    },
  }
}
reporte.legacy = {
  cotizaciones: perfilDocs('cotizaciones', cots),
  pedidos: perfilDocs('pedidos', peds),
  notas_entrega: perfilDocs('notas_entrega', nes),
  pedidos_compra: perfilDocs('pedidos_compra', pcs),
}
for (const [k, v] of Object.entries(reporte.legacy)) {
  console.log(`  ${k}: ${v.documentos} docs · moneda ${JSON.stringify(v.moneda)} · sin moneda ${v.sin_moneda.documentos} (USD ${v.sin_moneda.total_contado_como_USD_por__soloUSD} contados como USD) · día 01: ${v.fechas.dia_01} · corridos de mes: ${v.fechas.corridos_de_mes_por_zona_horaria} · creadoPor: ${v.creadoPor_con_valor} · colisiones de nombre: ${v.clientes.grupos_que_colisionan_al_normalizar}`)
}

// ── Vistazo, replicado ──────────────────────────────────────────────────────
const enMes = (docs, mesFn, mes) => docs.filter((d) => d.fecha && mismoMes(mesFn(d.fecha), mes))
const suma = (docs) => r2(docs.reduce((s, d) => s + soloUSD(d), 0))
const vistazo = (mesFn) => ({
  cotizado_mes_USD: suma(enMes(cots, mesFn, hoy)),
  cotizaciones_mes: enMes(cots, mesFn, hoy).length,
  vendido_mes_USD__notas_de_entrega: suma(enMes(nes, mesFn, hoy)),
  notas_entrega_mes: enMes(nes, mesFn, hoy).length,
  comprado_mes_USD: suma(enMes(pcs, mesFn, hoy)),
  pedidos_compra_mes: enMes(pcs, mesFn, hoy).length,
  por_cobrar_USD__NE_no_facturadas: suma(nes.filter((n) => n.estado !== 'facturada')),
  por_cobrar_etiqueta_facturas__en_realidad_NE: nes.filter((n) => n.estado !== 'facturada').length,
  actividad_6_meses: Array.from({ length: 6 }, (_, k) => {
    const mes = mesAtras(5 - k)
    return { mes: etiqueta(mes), cot: enMes(cots, mesFn, mes).length, ped: enMes(peds, mesFn, mes).length, ne: enMes(nes, mesFn, mes).length }
  }),
})
reporte.replica_vistazo = { como_lo_ve_el_legacy: vistazo(mesLegacy), con_mes_del_string: vistazo(mesString) }

// ── Ventas / Evolución, replicado ───────────────────────────────────────────
const serie12 = (docs, mesFn) => Array.from({ length: 12 }, (_, k) => {
  const mes = mesAtras(11 - k)
  const items = enMes(docs, mesFn, mes)
  return { mes: etiqueta(mes), n: items.length, usd: suma(items) }
})
const difSeries = (a, b) => a.map((x, i) => ({ mes: x.mes, legacy: x.usd, string: b[i].usd, dif: r2(x.usd - b[i].usd), n_legacy: x.n, n_string: b[i].n })).filter((x) => x.dif !== 0 || x.n_legacy !== x.n_string)
const prod = new Map()
for (const c of cots) for (const it of c.items ?? []) {
  if (it.type === 'chapter' || !it.sku) continue
  const cur = prod.get(it.sku) ?? { sku: it.sku, qty: 0 }
  cur.qty += it.qty || 0
  prod.set(it.sku, cur)
}
const topProd = [...prod.values()].sort((a, b) => b.qty - a.qty).slice(0, 10)
const prodNE = new Map()
for (const n of nes) for (const it of n.items ?? []) if (it.sku) prodNE.set(it.sku, (prodNE.get(it.sku) ?? 0) + (it.qty || 0))
const cli = new Map()
for (const c of cots) if (c.cliente) cli.set(c.cliente, (cli.get(c.cliente) ?? 0) + soloUSD(c))
const topCli = [...cli.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
const convertidas = cots.filter((c) => c.estado === 'cerrada' || c.convertidaA).length
reporte.replica_ventas = {
  kpis: { cotizaciones: cots.length, pedidos: peds.length, notas_entrega: nes.length, monto_facturado_total_USD__suma_NE: suma(nes) },
  cotizaciones_por_mes_12: serie12(cots, mesLegacy),
  diferencias_zona_horaria_cotizaciones: difSeries(serie12(cots, mesLegacy), serie12(cots, mesString)),
  diferencias_zona_horaria_notas_entrega: difSeries(serie12(nes, mesLegacy), serie12(nes, mesString)),
  top10_productos_por_unidades_COTIZADAS: topProd.map((p) => ({ sku: p.sku, unidades_cotizadas: p.qty, unidades_entregadas_NE: prodNE.get(p.sku) ?? 0 })),
  top10_clientes_por_monto_COTIZADO: topCli.map(([n, t]) => ({ cliente_hash: hashCorto(n), usd: r2(t) })),
  top10_productos_incluye_cotizaciones_no_convertidas: true,
  evolucion: {
    tasa_conversion_legacy_pct: cots.length ? Math.round((convertidas / cots.length) * 100) : 0,
    convertidas_cerrada_o_convertidaA: convertidas,
    cerradas: cots.filter((c) => c.estado === 'cerrada').length,
    con_convertidaA: cots.filter((c) => c.convertidaA).length,
    cerradas_sin_convertidaA: cots.filter((c) => c.estado === 'cerrada' && !c.convertidaA).length,
    pedidos_con_fromCotizacion: peds.filter((p) => p.fromCotizacion).length,
    cotizado_acumulado_USD: suma(cots),
    vendido_acumulado_USD__NE: suma(nes),
  },
}
// ── CSV de ventas: columna «Total USD» sin filtrar moneda ───────────────────
reporte.replica_csv = {
  ventas: {
    filas: cots.length,
    columna_dice: 'Total USD',
    filas_con_moneda_no_USD: cots.filter((c) => c.moneda && c.moneda.toUpperCase() !== 'USD').length,
    filas_sin_moneda: cots.filter((c) => !c.moneda).length,
    suma_columna_mezclando_monedas: r2(cots.reduce((s, c) => s + (c.total || 0), 0)),
    suma_realmente_USD: suma(cots.filter((c) => (c.moneda || '').toUpperCase() === 'USD')),
    exporta_moneda: false,
    respeta_filtros: 'no hay filtros: exporta TODAS las cotizaciones',
  },
  compras: { filas: pcs.length, columna_dice: 'Total USD', filas_con_moneda_no_USD: pcs.filter((p) => p.moneda && p.moneda.toUpperCase() !== 'USD').length },
}
console.log(`  Vistazo legacy (${HOY}): ${JSON.stringify(reporte.replica_vistazo.como_lo_ve_el_legacy).slice(0, 260)}…`)
console.log(`  conversión legacy: ${reporte.replica_ventas.evolucion.tasa_conversion_legacy_pct}% · CSV «Total USD» con ${reporte.replica_csv.ventas.filas_con_moneda_no_USD} filas no-USD`)
console.log(`  meses con diferencia por zona horaria (cotizaciones): ${reporte.replica_ventas.diferencias_zona_horaria_cotizaciones.length}`)

// ── Kardex ──────────────────────────────────────────────────────────────────
const cuenta = (arr, f) => arr.reduce((a, x) => ({ ...a, [String(f(x))]: (a[String(f(x))] ?? 0) + 1 }), {})
reporte.legacy.kardex = {
  movimientos: kardex.length,
  tope_en_codigo: 5000,
  tipos: cuenta(kardex, (k) => k.tipo),
  kind: cuenta(kardex, (k) => k.kind),
  usuarios: Object.keys(cuenta(kardex, (k) => k.user)).length,
  rango: kardex.length ? [kardex.map((k) => k.fecha).sort()[0], kardex.map((k) => k.fecha).sort().at(-1)] : null,
  skus_distintos: new Set(kardex.map((k) => k.sku)).size,
  con_documento: kardex.filter((k) => k.doc).length,
}

// ── Stock desde productos-data.json (snapshot local) ────────────────────────
if (PRODUCTOS && existsSync(PRODUCTOS)) {
  const pbuf = readFileSync(PRODUCTOS)
  const productos = JSON.parse(pbuf.toString('utf8'))
  const num = (v) => (typeof v === 'number' ? v : 0)
  const conSr = productos.filter((p) => typeof p.sr === 'number')
  const valor = productos.map((p) => num(p.pu) * num(p.sr))
  reporte.legacy.stock_embebido = {
    archivo_bytes: pbuf.length,
    sha256: sha(pbuf).slice(0, 16),
    productos: productos.length,
    con_sr_numerico: conSr.length,
    con_sv_numerico: productos.filter((p) => typeof p.sv === 'number').length,
    sr_menor_igual_0__KPI_sin_stock: productos.filter((p) => num(p.sr) <= 0).length,
    sr_entre_1_y_5__KPI_stock_critico: productos.filter((p) => num(p.sr) > 0 && num(p.sr) <= 5).length,
    sr_mayor_0: productos.filter((p) => num(p.sr) > 0).length,
    sr_negativo: productos.filter((p) => num(p.sr) < 0).length,
    con_pu_numerico: productos.filter((p) => typeof p.pu === 'number').length,
    con_costo: productos.filter((p) => p.costo != null && p.costo !== '').length,
    valor_stock_al_precio_venta_USD: r2(valor.reduce((s, v) => s + v, 0)),
    nota: 'Falta erp_stock_deltas (LOCAL ONLY, por navegador) y erp_producto_overrides (no está en erp_store): el valor que ve cada usuario puede diferir.',
  }
  console.log(`  productos-data.json: ${productos.length} productos · sr≤0: ${reporte.legacy.stock_embebido.sr_menor_igual_0__KPI_sin_stock} · 1–5: ${reporte.legacy.stock_embebido.sr_entre_1_y_5__KPI_stock_critico} · con costo: ${reporte.legacy.stock_embebido.con_costo}`)
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · ERP NUEVO (sólo SELECT)
// ═══════════════════════════════════════════════════════════════════════════
seccion('4 · ERP nuevo')
const sb = createClient(URL_SB, SECRET, { auth: { persistSession: false } })
// Único acceso a la base: select paginado. No hay otra llamada en este script.
async function leer(tabla, columnas, filtro = (q) => q) {
  const filas = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await filtro(sb.from(tabla).select(columnas)).range(desde, desde + 999)
    if (error) throw new Error(`${tabla}: ${error.message}`)
    filas.push(...data)
    if (data.length < 1000) break
  }
  return filas
}
async function contar(tabla, filtro = (q) => q) {
  const { count, error } = await filtro(sb.from(tabla).select('*', { count: 'exact', head: true }))
  if (error) throw new Error(`${tabla}: ${error.message}`)
  return count
}

const empresas = await leer('companies', 'id, name, slug')
const nombreEmpresa = Object.fromEntries(empresas.map((e) => [e.id, e.slug]))
const porEmpresa = (filas) => cuenta(filas, (f) => nombreEmpresa[f.company_id] ?? f.company_id)

const docsNuevos = {}
for (const [tabla, fecha, extra] of [
  ['sales_quotes', 'quote_date', 'status, salesperson_id, customer_id, created_by, number, original_number'],
  ['sales_orders', 'order_date', 'commercial_status, fulfillment_status, invoicing_status, payment_status, salesperson_id, customer_id, created_by, quote_id, number, original_number'],
  ['deliveries', 'delivery_date', 'status, customer_id, order_id, created_by, number, original_number'],
  ['sales_invoices', 'invoice_date', 'status, customer_id, due_date, number'],
  ['purchase_orders', 'order_date', 'status, receipt_status, supplier_id, expected_date, number'],
  ['supplier_invoices', 'invoice_date', 'status, supplier_id, due_date, number'],
]) {
  const cols = `company_id, currency_code, exchange_rate, total, created_at, ${fecha}, ${extra}`
  const filas = await leer(tabla, cols)
  const moneda = cuenta(filas, (f) => f.currency_code ?? '(null)')
  const totalPorMoneda = {}
  for (const f of filas) totalPorMoneda[f.currency_code ?? '(null)'] = r2((totalPorMoneda[f.currency_code ?? '(null)'] ?? 0) + Number(f.total ?? 0))
  const estadoCol = extra.split(',')[0].trim()
  docsNuevos[tabla] = {
    filas: filas.length,
    por_empresa: porEmpresa(filas),
    moneda,
    total_por_moneda: totalPorMoneda,
    exchange_rate_null: filas.filter((f) => f.exchange_rate == null).length,
    exchange_rate_null_en_no_USD: filas.filter((f) => f.exchange_rate == null && f.currency_code && f.currency_code !== 'USD').length,
    fecha_documento_null: filas.filter((f) => f[fecha] == null).length,
    fecha_documento_distinta_de_created_at: filas.filter((f) => f[fecha] && f.created_at && f[fecha] !== f.created_at.slice(0, 10)).length,
    [estadoCol]: cuenta(filas, (f) => f[estadoCol] ?? '(null)'),
    ...(filas[0] && 'salesperson_id' in filas[0] ? { salesperson_id_con_valor: filas.filter((f) => f.salesperson_id).length } : {}),
    ...(filas[0] && 'customer_id' in filas[0] ? { customer_id_null: filas.filter((f) => !f.customer_id).length } : {}),
    ...(filas[0] && 'created_by' in filas[0] ? { created_by_con_valor: filas.filter((f) => f.created_by).length } : {}),
    ...(tabla === 'sales_orders' ? { con_quote_id: filas.filter((f) => f.quote_id).length, fulfillment_status: cuenta(filas, (f) => f.fulfillment_status ?? '(null)'), invoicing_status: cuenta(filas, (f) => f.invoicing_status ?? '(null)'), payment_status: cuenta(filas, (f) => f.payment_status ?? '(null)') } : {}),
    ...(tabla === 'deliveries' ? { con_order_id: filas.filter((f) => f.order_id).length } : {}),
  }
  docsNuevos[tabla]._filas = filas
}
// Paridad legacy ↔ nuevo por número: ¿el ERP nuevo tiene moneda en los documentos que el legacy no?
const paridad = (legacyDocs, nuevos) => {
  const porNumero = new Map()
  for (const f of nuevos) for (const n of [f.number, f.original_number]) if (n) porNumero.set(n, f)
  let encontrados = 0, sinMonedaLegacy = 0, sinMonedaLegacyConMonedaNueva = {}, monedaDistinta = 0, totalDistinto = 0
  for (const d of legacyDocs) {
    const f = porNumero.get(d.ref)
    if (!f) continue
    encontrados++
    if (!d.moneda) {
      sinMonedaLegacy++
      sinMonedaLegacyConMonedaNueva[f.currency_code ?? '(null)'] = (sinMonedaLegacyConMonedaNueva[f.currency_code ?? '(null)'] ?? 0) + 1
    } else if (d.moneda.toUpperCase() !== f.currency_code) monedaDistinta++
    if (Math.abs(Number(f.total ?? 0) - Number(d.total ?? 0)) > 0.01) totalDistinto++
  }
  return { legacy: legacyDocs.length, encontrados_por_numero: encontrados, sin_moneda_en_legacy: sinMonedaLegacy, esos_en_el_nuevo: sinMonedaLegacyConMonedaNueva, moneda_distinta: monedaDistinta, total_distinto: totalDistinto }
}
reporte.paridad_legacy_nuevo = {
  cotizaciones: paridad(cots, docsNuevos.sales_quotes._filas),
  pedidos: paridad(peds, docsNuevos.sales_orders._filas),
  notas_entrega: paridad(nes, docsNuevos.deliveries._filas),
}
for (const v of Object.values(docsNuevos)) delete v._filas
reporte.nuevo = { empresas: empresas.map((e) => e.slug), documentos: docsNuevos }

// Líneas
const lineasNuevas = {}
for (const [tabla, qty] of [['sales_quote_lines', 'quantity'], ['sales_order_lines', 'quantity_ordered'], ['delivery_lines', 'quantity']]) {
  const filas = await leer(tabla, `product_id, ${qty}, ${tabla === 'delivery_lines' ? 'unit_price' : 'unit_price, line_type'}`)
  lineasNuevas[tabla] = {
    filas: filas.length,
    product_id_null: filas.filter((f) => !f.product_id).length,
    unit_price_null: filas.filter((f) => f.unit_price == null).length,
    ...(filas[0] && 'line_type' in filas[0] ? { line_type: cuenta(filas, (f) => f.line_type ?? '(null)') } : {}),
  }
}
reporte.nuevo.lineas = lineasNuevas

// Clientes
const clientes = await leer('customers', 'company_id, status, deleted_at, industry, salesperson_id, created_at, imported_at, legacy_source, default_currency, customer_type')
reporte.nuevo.clientes = {
  filas: clientes.length,
  por_empresa: porEmpresa(clientes),
  borrados: clientes.filter((c) => c.deleted_at).length,
  status: cuenta(clientes, (c) => c.status ?? '(null)'),
  industry_con_valor: clientes.filter((c) => c.industry).length,
  salesperson_id_con_valor: clientes.filter((c) => c.salesperson_id).length,
  importados: clientes.filter((c) => c.imported_at).length,
  creados_en_el_erp_nuevo: clientes.filter((c) => !c.imported_at).length,
  customer_type: cuenta(clientes, (c) => c.customer_type ?? '(null)'),
}
const clientesConDocs = new Set([...(await leer('sales_orders', 'customer_id')).map((f) => f.customer_id), ...(await leer('deliveries', 'customer_id')).map((f) => f.customer_id)].filter(Boolean))
reporte.nuevo.clientes.con_pedido_o_entrega = clientesConDocs.size

// Productos, precios, costo
reporte.nuevo.productos = {
  filas: await contar('products'),
  activos: await contar('products', (q) => q.eq('status', 'active')),
  kits: await contar('products', (q) => q.eq('is_kit', true)),
  sin_marca: await contar('products', (q) => q.is('brand_id', null)),
  sin_categoria: await contar('products', (q) => q.is('category_id', null)),
}
const listas = await leer('price_lists', 'id, company_id, name, currency_code, is_default')
reporte.nuevo.listas_de_precio = listas.map((l) => ({ empresa: nombreEmpresa[l.company_id], nombre: l.name, moneda: l.currency_code, default: l.is_default }))
reporte.nuevo.precios_por_lista = {}
for (const l of listas) reporte.nuevo.precios_por_lista[`${nombreEmpresa[l.company_id]}/${l.name}`] = await contar('product_prices', (q) => q.eq('price_list_id', l.id))
const columnasCosto = await sb.from('products').select('*').limit(1)
reporte.nuevo.columnas_de_costo_o_minimo = {
  products: Object.keys(columnasCosto.data?.[0] ?? {}).filter((c) => /cost|costo|margin|minim|reorder|min_stock|safety/i.test(c)),
  nota: 'Se revisan además purchase_order_lines.unit_price / supplier_invoice_lines como fuente posible de costo (ver conteos de compras).',
}

// Stock
const balances = await leer('stock_balances', 'company_id, warehouse_id, on_hand, reserved')
const movs = await leer('stock_movements', 'company_id, movement_type, source_type, created_at')
reporte.nuevo.stock = {
  balances: balances.length,
  por_empresa: porEmpresa(balances),
  on_hand_menor_igual_0: balances.filter((b) => Number(b.on_hand) <= 0).length,
  on_hand_1_a_5: balances.filter((b) => Number(b.on_hand) > 0 && Number(b.on_hand) <= 5).length,
  on_hand_negativo: balances.filter((b) => Number(b.on_hand) < 0).length,
  con_reserva: balances.filter((b) => Number(b.reserved) > 0).length,
  disponible_negativo: balances.filter((b) => Number(b.on_hand) - Number(b.reserved) < 0).length,
  movimientos: movs.length,
  movimientos_por_tipo: cuenta(movs, (m) => m.movement_type),
  movimientos_por_origen: cuenta(movs, (m) => m.source_type ?? '(null)'),
  rango_movimientos: movs.length ? [movs.map((m) => m.created_at).sort()[0], movs.map((m) => m.created_at).sort().at(-1)] : null,
  reservas: await contar('stock_reservations'),
  depositos: (await leer('warehouses', 'company_id, code, is_default')).map((w) => `${nombreEmpresa[w.company_id]}/${w.code}${w.is_default ? '*' : ''}`),
}

// Compras, mantenimiento, cobranzas, emails
reporte.nuevo.otros = {
  suppliers: await contar('suppliers'),
  purchase_orders: await contar('purchase_orders'),
  purchase_order_lines: await contar('purchase_order_lines'),
  goods_receipts: await contar('goods_receipts'),
  supplier_invoices: await contar('supplier_invoices'),
  sales_invoices: await contar('sales_invoices'),
  payments: await contar('payments'),
  maintenance_orders: await contar('maintenance_orders'),
  maintenance_assets: await contar('maintenance_assets'),
  email_threads: await contar('email_threads'),
  email_events: await contar('email_events'),
  attachments: await contar('attachments'),
}
const membresias = await leer('company_memberships', 'company_id, role, status')
reporte.nuevo.membresias_por_rol = cuenta(membresias.filter((m) => m.status === 'active'), (m) => `${nombreEmpresa[m.company_id]}/${m.role}`)

for (const [k, v] of Object.entries(reporte.nuevo.documentos)) console.log(`  ${k.padEnd(18)} ${String(v.filas).padStart(4)} · ${JSON.stringify(v.moneda)} · exchange_rate null ${v.exchange_rate_null}${v.salesperson_id_con_valor !== undefined ? ` · vendedor ${v.salesperson_id_con_valor}` : ''}`)
console.log(`  paridad: ${JSON.stringify(reporte.paridad_legacy_nuevo)}`)
console.log(`  clientes: ${JSON.stringify(reporte.nuevo.clientes)}`)
console.log(`  stock: ${JSON.stringify(reporte.nuevo.stock).slice(0, 400)}`)
console.log(`  costo/mínimo en products: ${JSON.stringify(reporte.nuevo.columnas_de_costo_o_minimo.products)}`)
console.log(`  otros: ${JSON.stringify(reporte.nuevo.otros)}`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify(reporte, null, 2))
  console.log(`\nreporte completo: ${OUT}`)
}
