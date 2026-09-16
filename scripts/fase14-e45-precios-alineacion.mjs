/**
 * Fase 14 · E4.5 — alineación de los precios ACTUALES de «Lista base» con el
 * catálogo de STEL.
 *
 *   node scripts/fase14-e45-precios-alineacion.mjs dryrun
 *   node scripts/fase14-e45-precios-alineacion.mjs aplicar --plan-hash <sha256> --autorizo-alineacion-precios
 *   node scripts/fase14-e45-precios-alineacion.mjs verificar --plan-hash <sha256>
 *
 * Reglas:
 *   · fuente de verdad: `sales-price` del catálogo de STEL (USD, medido en E4);
 *     nunca una fórmula, ni el precio de un documento, ni otra tarifa, ni FX;
 *   · identidad: `external_id` de STEL. El SKU sólo sirve para pedirle el ítem a
 *     la API; si el ítem que vuelve no tiene el id esperado, el caso se bloquea;
 *   · se escribe SÓLO en la lista por defecto («Lista base», USD) y SÓLO en
 *     `product_prices` vigentes. Nada de líneas de documentos, totales, stock,
 *     secuencias ni autoridad;
 *   · cada escritura pasa por `public.stel_sync_precio` dentro de una corrida:
 *     queda en bitácora y se revierte por run.
 *
 * La clave de STEL sale de .env.stel.local y nunca se imprime.
 */
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { crearCliente, limpiar } from './lib/stel-api.mjs'
import { canonico, huellaEmpresa } from './lib/stel-reconciliacion.mjs'

const [, , comando] = process.argv
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null }
const bandera = (n) => process.argv.includes(n)
const SALIDA = path.resolve('scripts/output/e45')
const EMPRESA = arg('--empresa') ?? 'buscatools'
const LOTE = 60

const BASE = process.env.VITE_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !SECRET) { console.error('✗ Faltan VITE_SUPABASE_URL / SUPABASE_SECRET_KEY'); process.exit(1) }
const sb = createClient(BASE, SECRET, { auth: { persistSession: false } })
const guardar = (nombre, datos) => { fs.mkdirSync(SALIDA, { recursive: true }); const f = path.join(SALIDA, nombre); fs.writeFileSync(f, JSON.stringify(datos, null, 1)); return path.relative(process.cwd(), f) }
const monto = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }
const igual = (a, b) => a !== null && b !== null && Math.abs(a - b) <= 0.01

/**
 * Clasificación de un producto vinculado. Pura: entra lo medido, sale la decisión.
 *
 *   SAFE_TO_ALIGN         React tiene un precio y STEL dice otro, sin ambigüedad
 *   ALREADY_EQUAL         ya coinciden
 *   NO_STEL_PRICE         STEL no tiene precio de catálogo para ese ítem
 *   MULTIPLE_PRICE_SOURCE más de un precio vigente del producto en la lista
 *   DATA_CONFLICT         el ítem que devuelve STEL no es el que tiene vinculado React
 *   HUMAN_REVIEW          el ítem está borrado o inactivo en STEL, o no se pudo leer
 */
export function clasificarPrecio(p) {
  if (!p.stelEncontrado) return { clase: 'HUMAN_REVIEW', motivo: 'El id STEL vinculado no se pudo leer (¿borrado en STEL?).' }
  if (p.idDistinto) return { clase: 'DATA_CONFLICT', motivo: `La referencia ${p.sku} devuelve el ítem ${p.idDevuelto} y el producto está vinculado al ${p.externalId}.` }
  if (p.stelInactivo) return { clase: 'HUMAN_REVIEW', motivo: 'El ítem está inactivo o borrado en STEL: su precio de catálogo no es el vigente.' }
  if (p.precioStel === null || p.precioStel <= 0) return { clase: 'NO_STEL_PRICE', motivo: 'STEL no tiene precio de catálogo para ese ítem.' }
  if (p.preciosEnLista > 1) return { clase: 'MULTIPLE_PRICE_SOURCE', motivo: `El producto tiene ${p.preciosEnLista} precios vigentes en la lista: no hay uno solo que actualizar.` }
  if (p.precioReact !== null && igual(p.precioReact, p.precioStel)) return { clase: 'ALREADY_EQUAL', motivo: 'Ya coincide con STEL.' }
  return {
    clase: 'SAFE_TO_ALIGN',
    motivo: p.precioReact === null
      ? 'El producto no tiene precio en la lista: se carga el de STEL.'
      : `Se reemplaza el precio de la lista por el de STEL (ratio React/STEL ${(p.precioReact / p.precioStel).toFixed(4)}).`,
  }
}

/** Productos de React vinculados a STEL, con su precio vigente en la lista. */
async function leerReact() {
  const { data: emp, error } = await sb.from('companies').select('id').eq('slug', EMPRESA).single()
  if (error || !emp) throw new Error(`empresa ${EMPRESA} no encontrada`)
  const { data: listas } = await sb.from('price_lists').select('id, name, currency_code, is_default').eq('company_id', emp.id)
  const base = (listas ?? []).filter((l) => l.is_default)
  if (base.length !== 1) throw new Error('la empresa no tiene exactamente una lista de precios por defecto')
  if (base[0].currency_code !== 'USD') throw new Error(`la lista por defecto no está en USD (${base[0].currency_code})`)

  const productos = []
  for (let d = 0; ; d += 1000) {
    const { data, error: e } = await sb.from('products')
      .select('id, sku, name, status, external_id')
      .eq('company_id', emp.id).eq('external_source', 'stel').order('sku').range(d, d + 999)
    if (e) throw new Error(`productos: ${e.message}`)
    productos.push(...data)
    if (data.length < 1000) break
  }
  const precios = new Map()
  const ids = productos.map((p) => p.id)
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error: e } = await sb.from('product_prices')
      .select('id, product_id, amount, valid_from, valid_to')
      .eq('company_id', emp.id).eq('price_list_id', base[0].id).is('valid_to', null).in('product_id', ids.slice(i, i + 200))
    if (e) throw new Error(`precios: ${e.message}`)
    for (const x of data ?? []) precios.set(x.product_id, [...(precios.get(x.product_id) ?? []), x])
  }
  return { company: emp.id, lista: base[0], otrasListas: (listas ?? []).filter((l) => !l.is_default), productos, precios }
}

/** Catálogo de STEL para esos SKU, por referencia y en lotes; los que faltan, por id. */
async function leerStelCatalogo(c, productos, { maxPorId = 25 } = {}) {
  const porId = new Map()
  const refs = [...new Set(productos.map((p) => (p.sku ?? '').trim()).filter(Boolean))]
  for (const clase of ['products', 'services']) {
    for (let i = 0; i < refs.length; i += LOTE) {
      const lote = refs.slice(i, i + LOTE)
      const sinComa = lote.filter((r) => !r.includes(','))
      if (!sinComa.length) continue
      const encontrados = new Set([...porId.values()].map((x) => x['full-reference']))
      const faltan = sinComa.filter((r) => !encontrados.has(r))
      if (!faltan.length) continue
      const pagina = await c.todos(clase, { 'full-reference': `in:${faltan.join(',')}` }, { limite: 200, maxPaginas: 2 })
      for (const it of pagina) porId.set(String(it.id), { ...it, clase })
    }
  }
  // Los que quedaron sin aparecer (renombrados o borrados) se piden por id, acotado.
  const vistos = new Set(porId.keys())
  const pendientes = productos.filter((p) => !vistos.has(String(p.external_id))).slice(0, maxPorId)
  for (const p of pendientes) {
    for (const clase of ['products', 'services']) {
      try {
        const r = await c.get(`${clase}/${p.external_id}`)
        const it = Array.isArray(r) ? r[0] : r
        if (it?.id) { porId.set(String(it.id), { ...it, clase }); break }
      } catch { /* sigue como no encontrado */ }
    }
  }
  return porId
}

/** Plan puro: qué precios se tocan y por qué. */
export function planificarPrecios({ company, lista, productos, precios, stelPorId, stelPorRef }) {
  const filas = []
  for (const p of productos) {
    const stelId = String(p.external_id)
    const item = stelPorId.get(stelId) ?? null
    const porRef = stelPorRef.get((p.sku ?? '').trim()) ?? null
    const vigentes = precios.get(p.id) ?? []
    const precioReact = vigentes.length === 1 ? monto(vigentes[0].amount) : vigentes.length === 0 ? null : monto(vigentes[0].amount)
    const medido = {
      sku: p.sku,
      productId: p.id,
      externalId: stelId,
      stelEncontrado: Boolean(item),
      idDevuelto: porRef && String(porRef.id) !== stelId ? String(porRef.id) : null,
      idDistinto: Boolean(porRef) && String(porRef.id) !== stelId,
      stelInactivo: Boolean(item?.inactive || item?.deleted),
      precioStel: item ? monto(item['sales-price']) : null,
      precioReact,
      preciosEnLista: vigentes.length,
      modificadoStel: item?.['utc-last-modification-date'] ?? null,
    }
    const { clase, motivo } = clasificarPrecio(medido)
    filas.push({
      ...medido,
      ratio: medido.precioReact !== null && medido.precioStel ? Number((medido.precioReact / medido.precioStel).toFixed(6)) : null,
      esTriple: medido.precioReact !== null && medido.precioStel ? Math.abs(medido.precioReact / medido.precioStel - 3) < 1e-6 : false,
      precioId: vigentes.length === 1 ? vigentes[0].id : null,
      clase,
      motivo,
    })
  }
  const aplicar = filas.filter((f) => f.clase === 'SAFE_TO_ALIGN')
  const plan = {
    version: 1,
    empresa: company,
    lista: { id: lista.id, nombre: lista.name, moneda: lista.currency_code },
    fuente: 'STEL sales-price (catálogo, USD)',
    // Sólo lo ejecutable entra en el hash.
    aplicar: aplicar.map((f) => ({ stel_id: f.externalId, product_id: f.productId, sku: f.sku, de: f.precioReact, a: f.precioStel })),
  }
  const resumen = {
    STEL_PRODUCTS_CHECKED: stelPorId.size,
    REACT_PRICES_CHECKED: filas.length,
    PRICES_TO_UPDATE: aplicar.filter((f) => f.precioReact !== null).length,
    PRICES_TO_CREATE: aplicar.filter((f) => f.precioReact === null).length,
    ALREADY_EQUAL: filas.filter((f) => f.clase === 'ALREADY_EQUAL').length,
    NO_PRICE: filas.filter((f) => f.clase === 'NO_STEL_PRICE').length,
    BLOCKED: filas.filter((f) => ['DATA_CONFLICT', 'MULTIPLE_PRICE_SOURCE'].includes(f.clase)).length,
    HUMAN_REVIEW: filas.filter((f) => f.clase === 'HUMAN_REVIEW').length,
    EXACTAMENTE_TRIPLE: filas.filter((f) => f.esTriple).length,
    NO_TRIPLE_CON_DIFERENCIA: filas.filter((f) => !f.esTriple && f.precioReact !== null && f.precioStel !== null && !igual(f.precioReact, f.precioStel)).length,
  }
  return { plan, filas, resumen, hash: createHash('sha256').update(canonico(plan)).digest('hex') }
}

async function armar(maxLlamadas) {
  const react = await leerReact()
  const cacheDir = path.resolve(`.stel-cache/e45-${Date.now()}`)
  const c = crearCliente({ maxLlamadas, usarCache: true, cacheDir, log: () => {} })
  let stelPorId
  try {
    stelPorId = await leerStelCatalogo(c, react.productos)
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true })
  }
  const stelPorRef = new Map()
  for (const it of stelPorId.values()) if (it['full-reference']) stelPorRef.set(String(it['full-reference']).trim(), it)
  const armado = planificarPrecios({ ...react, stelPorId, stelPorRef })
  return { ...armado, react, llamadas: c.llamadas() }
}

/** Precio de las líneas de documentos y totales: tiene que quedar idéntico. */
async function huellaHistorica(company) {
  const h = await huellaEmpresa(sb, company)
  return {
    sales_quotes: h.sales_quotes, sales_quote_lines: h.sales_quote_lines,
    sales_orders: h.sales_orders, sales_order_lines: h.sales_order_lines,
    deliveries: h.deliveries, delivery_lines: h.delivery_lines,
    stock_balances: h.stock_balances, stock_movements: h.stock_movements, stock_reservations: h.stock_reservations,
    document_sequences: h.document_sequences, document_numbering_authority: h.document_numbering_authority,
    sales_audit: h.sales_audit, customers: h.customers, products: h.products, product_categories: h.product_categories,
  }
}

async function dryrun() {
  const { plan, filas, resumen, hash, llamadas } = await armar(Number(arg('--max-llamadas') ?? 60))
  const noTriple = filas.filter((f) => !f.esTriple && f.clase !== 'ALREADY_EQUAL')
  const informe = {
    generado: new Date().toISOString(), llamadasStel: llamadas, planHash: hash,
    lista: plan.lista, fuente: plan.fuente, resumen,
    casosNoTriple: noTriple.map((f) => ({
      sku: f.sku, productId: f.productId, externalId: f.externalId, precioStel: f.precioStel, precioReact: f.precioReact,
      ratio: f.ratio, modificadoStel: f.modificadoStel, preciosEnLista: f.preciosEnLista, clase: f.clase, motivo: f.motivo,
    })),
  }
  guardar(`plan-${hash.slice(0, 12)}.json`, plan)
  guardar(`dryrun-${hash.slice(0, 12)}.json`, { ...informe, filas })
  console.log(JSON.stringify(informe, null, 1))
  console.log(`\n  PLAN HASH: ${hash}`)
}

async function aplicar() {
  const autorizado = arg('--plan-hash')
  if (!bandera('--autorizo-alineacion-precios') || !/^[0-9a-f]{64}$/.test(autorizado ?? '')) {
    console.error('✗ falta --plan-hash <sha256 del dry run> --autorizo-alineacion-precios')
    process.exit(2)
  }
  const { plan, filas, resumen, hash, react, llamadas } = await armar(Number(arg('--max-llamadas') ?? 60))
  console.log(`  llamadas a STEL: ${llamadas} · plan de ahora ${hash}`)
  if (hash !== autorizado) {
    guardar(`plan-rechazado-${hash.slice(0, 12)}.json`, plan)
    console.error(`✗ GATE: el plan de ahora no es el autorizado (${autorizado.slice(0, 12)}…). No se escribió nada.`)
    console.error(JSON.stringify(resumen))
    process.exit(3)
  }
  console.log('  GATE OK: el plan de ahora es exactamente el autorizado')
  const corto = hash.slice(0, 12)

  const huellaAntes = await huellaHistorica(react.company)
  const respaldo = filas.filter((f) => f.clase === 'SAFE_TO_ALIGN').map((f) => ({ price_id: f.precioId, product_id: f.productId, sku: f.sku, amount: f.precioReact }))
  const otras = []
  for (const l of react.otrasListas) {
    const { count } = await sb.from('product_prices').select('*', { count: 'exact', head: true }).eq('price_list_id', l.id)
    otras.push({ id: l.id, nombre: l.name, precios: count ?? 0 })
  }
  guardar(`respaldo-${corto}.json`, { generado: new Date().toISOString(), planHash: hash, huella: huellaAntes, otrasListas: otras, filas: respaldo })
  console.log(`  SNAPSHOT OK · BACKUP de ${respaldo.length} precios · otras listas intactas: ${JSON.stringify(otras.map((o) => `${o.nombre}:${o.precios}`))}`)

  const tomado = await sb.rpc('stel_sync_tomar', { p_company: react.company, p_entidad: 'products', p_owner: `e45-precios@${new Date().toISOString().slice(0, 19)}` })
  if (tomado.error) throw new Error(`tomar: ${tomado.error.message}`)
  const run = tomado.data.run
  console.log(`  PRICE_SYNC_RUN_ID: ${run}`)
  guardar(`run-en-curso-${corto}.json`, { run, planHash: hash, inicio: new Date().toISOString() })

  const hechos = { actualizados: 0, creados: 0, sinCambios: 0, errores: [] }
  try {
    for (const f of plan.aplicar) {
      const r = await sb.rpc('stel_sync_precio', { p_run: run, p: { stel_id: f.stel_id, price_list_id: plan.lista.id, amount: f.a } })
      if (r.error) { hechos.errores.push({ sku: f.sku, error: r.error.message }); continue }
      if (r.data.resultado === 'actualizado') hechos.actualizados++
      else if (r.data.resultado === 'creado') hechos.creados++
      else hechos.sinCambios++
      if ((hechos.actualizados + hechos.creados) % 100 === 0 && hechos.actualizados + hechos.creados > 0) console.log(`  precios escritos: ${hechos.actualizados + hechos.creados}`)
    }
    await sb.rpc('stel_sync_cerrar', {
      p_run: run, p_estado: hechos.errores.length ? 'failed' : 'finished',
      p_cursor: null, p_cursor_id: null, p_llamadas: llamadas,
      p_resumen: { operacion: 'e45_alineacion_precios', planHash: hash, ...hechos, errores: hechos.errores.length },
      p_error: hechos.errores.length ? `${hechos.errores.length} error(es)` : null,
    })
  } catch (e) {
    await sb.rpc('stel_sync_cerrar', { p_run: run, p_estado: 'failed', p_cursor: null, p_cursor_id: null, p_llamadas: llamadas, p_resumen: hechos, p_error: String(e.message).slice(0, 400) })
    throw e
  }

  const huellaDespues = await huellaHistorica(react.company)
  const cambiadas = Object.keys(huellaAntes).filter((t) => huellaAntes[t].hash !== huellaDespues[t].hash)
  const informe = { run, planHash: hash, resumen, hechos, tablasCambiadas: cambiadas, huellaAntes, huellaDespues }
  guardar(`aplicado-${run}.json`, informe)
  console.log(JSON.stringify({ run, hechos, tablasCambiadas: cambiadas }, null, 1))
  if (cambiadas.length) { console.error(`✗ cambiaron tablas que no debían: ${cambiadas.join(', ')}`); process.exit(4) }
  if (hechos.errores.length) process.exit(4)
}

async function verificar() {
  const { resumen, hash, filas, llamadas } = await armar(Number(arg('--max-llamadas') ?? 60))
  const pendientes = filas.filter((f) => f.clase === 'SAFE_TO_ALIGN')
  const informe = {
    generado: new Date().toISOString(), llamadasStel: llamadas, planHash: hash, resumen,
    segundoDryRun: { PRICES_TO_UPDATE: resumen.PRICES_TO_UPDATE, PRICES_TO_CREATE: resumen.PRICES_TO_CREATE, pendientes: pendientes.map((f) => ({ sku: f.sku, de: f.precioReact, a: f.precioStel })) },
    // Lo que queda sin alinear, con motivo: el preflight lo lee para no contar
    // como «desalineado» algo que no se puede alinear.
    filas: filas
      .filter((f) => ['DATA_CONFLICT', 'MULTIPLE_PRICE_SOURCE', 'HUMAN_REVIEW', 'NO_STEL_PRICE'].includes(f.clase))
      .map((f) => ({ sku: f.sku, productId: f.productId, externalId: f.externalId, precioStel: f.precioStel, precioReact: f.precioReact, clase: f.clase, motivo: f.motivo })),
  }
  guardar('verificacion.json', informe)
  console.log(JSON.stringify(informe, null, 1))
}

const acciones = { dryrun, aplicar, verificar }
// Se importa desde la suite de tests para reusar `clasificarPrecio`: sólo corre
// como CLI cuando se lo invoca directamente.
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  if (!acciones[comando]) { console.error('uso: dryrun | aplicar --plan-hash H --autorizo-alineacion-precios | verificar'); process.exit(1) }
  acciones[comando]().catch((e) => { console.error('✗', limpiar(e.message)); process.exit(1) })
}
