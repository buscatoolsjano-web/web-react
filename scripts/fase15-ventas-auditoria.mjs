/**
 * Fase 15 · E0 — auditoría de Ventas: qué datos existen de verdad detrás de la UI.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase15-ventas-auditoria.mjs [--empresa buscatools]
 *
 * SÓLO LECTURA. No escribe nada, no toca STEL, no toca autoridad ni secuencias.
 *
 * Responde tres preguntas que el diseño necesita y que no se pueden contestar
 * mirando el código:
 *   1. qué columnas existen en cada documento y cuáles están efectivamente usadas
 *      (una columna que existe pero está siempre en NULL es un campo fantasma:
 *      la UI no puede mostrarlo y no hay de dónde sacarlo);
 *   2. qué estados aparecen realmente en los datos, que no son todos los que el
 *      modelo admite;
 *   3. qué hay en las tablas satélite —contactos, adjuntos, auditoría,
 *      facturas, cobros, direcciones— que las pestañas propuestas van a leer.
 *
 * La salida va a scripts/output/fase15/ventas.json (ignorado por git: tiene
 * razones sociales) y por consola sólo cuenta y porcentajes.
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d }
const EMPRESA = arg('--empresa', 'buscatools')
const SALIDA = path.resolve('scripts/output/fase15')

const BASE = process.env.VITE_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !SECRET) { console.error('✗ Faltan VITE_SUPABASE_URL / SUPABASE_SECRET_KEY'); process.exit(1) }
const sb = createClient(BASE, SECRET, { auth: { persistSession: false } })

/** Los tres documentos y sus líneas, con el nombre que usa la gente. */
const DOCS = [
  { clave: 'cotizacion', tabla: 'sales_quotes', lineas: 'sales_quote_lines', fk: 'quote_id', estado: 'status' },
  { clave: 'pedido', tabla: 'sales_orders', lineas: 'sales_order_lines', fk: 'order_id', estado: 'commercial_status' },
  { clave: 'remito', tabla: 'deliveries', lineas: 'delivery_lines', fk: 'delivery_id', estado: 'status' },
]

const SATELITES = ['customer_contacts', 'customer_addresses', 'attachments', 'sales_audit', 'sales_invoices', 'payments']

/** Trae todas las filas de una tabla de la empresa, por páginas. */
async function todas(tabla, companyId, columnas = '*') {
  const out = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb.from(tabla).select(columnas).eq('company_id', companyId).range(desde, desde + 999)
    if (error) throw new Error(`${tabla}: ${error.message}`)
    out.push(...data)
    if (data.length < 1000) return out
  }
}

/** Cuántas filas tienen algo en cada columna. Una columna siempre vacía es un campo fantasma. */
export function usoDeColumnas(filas) {
  const uso = {}
  for (const f of filas) {
    for (const [k, v] of Object.entries(f)) {
      uso[k] ??= { conDato: 0, total: 0 }
      uso[k].total++
      if (v !== null && v !== undefined && v !== '') uso[k].conDato++
    }
  }
  return Object.fromEntries(Object.entries(uso).map(([k, v]) => [k, {
    ...v,
    pct: v.total ? Math.round((v.conDato / v.total) * 100) : 0,
    estado: v.conDato === 0 ? 'VACIA' : v.conDato === v.total ? 'SIEMPRE' : 'PARCIAL',
  }]))
}

const contar = (filas, campo) => filas.reduce((m, f) => ({ ...m, [f[campo] ?? '(null)']: (m[f[campo] ?? '(null)'] ?? 0) + 1 }), {})

async function main() {
  const { data: emp, error } = await sb.from('companies').select('id, name').eq('slug', EMPRESA).single()
  if (error || !emp) throw new Error(`empresa ${EMPRESA} no encontrada`)
  const out = { generado: new Date().toISOString(), empresa: EMPRESA, documentos: {}, satelites: {} }

  for (const d of DOCS) {
    const cab = await todas(d.tabla, emp.id)
    const lin = await todas(d.lineas, emp.id)
    const porDoc = {}
    for (const l of lin) porDoc[l[d.fk]] = (porDoc[l[d.fk]] ?? 0) + 1
    const cuentas = Object.values(porDoc)
    out.documentos[d.clave] = {
      tabla: d.tabla,
      documentos: cab.length,
      importados: cab.filter((x) => x.imported_at).length,
      emitidosPorElErp: cab.filter((x) => !x.imported_at && !x.external_id).length,
      estados: contar(cab, d.estado),
      ...(d.clave === 'pedido' ? { cumplimiento: contar(cab, 'fulfillment_status'), facturacion: contar(cab, 'invoicing_status'), cobro: contar(cab, 'payment_status') } : {}),
      monedas: contar(cab, 'currency_code'),
      lineas: { total: lin.length, porDocumento: { min: Math.min(...cuentas, 0), max: Math.max(...cuentas, 0), promedio: cuentas.length ? Math.round((lin.length / cuentas.length) * 10) / 10 : 0 }, tipos: lin[0] && 'line_type' in lin[0] ? contar(lin, 'line_type') : 'sin columna line_type' },
      camposCabecera: usoDeColumnas(cab),
      camposLinea: usoDeColumnas(lin),
    }
  }

  for (const t of SATELITES) {
    try {
      const filas = await todas(t, emp.id)
      out.satelites[t] = { filas: filas.length, campos: usoDeColumnas(filas) }
      if (t === 'attachments' && filas.length) out.satelites[t].porEntidad = contar(filas, 'entity_type')
      if (t === 'sales_audit' && filas.length) { out.satelites[t].porEntidad = contar(filas, 'entity_type'); out.satelites[t].porAccion = contar(filas, 'action') }
    } catch (e) {
      out.satelites[t] = { error: e.message }
    }
  }

  // Lo que el diseño necesita saber de un vistazo.
  const fantasmas = {}
  for (const [clave, d] of Object.entries(out.documentos)) {
    fantasmas[clave] = {
      cabecera: Object.entries(d.camposCabecera).filter(([, v]) => v.estado === 'VACIA').map(([k]) => k),
      linea: Object.entries(d.camposLinea).filter(([, v]) => v.estado === 'VACIA').map(([k]) => k),
    }
  }
  out.camposFantasma = fantasmas

  fs.mkdirSync(SALIDA, { recursive: true })
  const f = path.join(SALIDA, 'ventas.json')
  fs.writeFileSync(f, JSON.stringify(out, null, 1))

  for (const [clave, d] of Object.entries(out.documentos)) {
    console.log(`\n== ${clave} (${d.tabla}) ==`)
    console.log(`   ${d.documentos} documentos · ${d.importados} importados · ${d.emitidosPorElErp} emitidos por el ERP`)
    console.log(`   estados: ${JSON.stringify(d.estados)}`)
    console.log(`   monedas: ${JSON.stringify(d.monedas)}`)
    console.log(`   líneas: ${d.lineas.total} (min ${d.lineas.porDocumento.min} / prom ${d.lineas.porDocumento.promedio} / max ${d.lineas.porDocumento.max}) · tipos ${JSON.stringify(d.lineas.tipos)}`)
    console.log(`   campos de cabecera SIEMPRE vacíos: ${fantasmas[clave].cabecera.join(', ') || 'ninguno'}`)
    console.log(`   campos de línea SIEMPRE vacíos:    ${fantasmas[clave].linea.join(', ') || 'ninguno'}`)
  }
  console.log('\n== tablas que alimentarían las pestañas ==')
  for (const [t, v] of Object.entries(out.satelites)) console.log(`   ${t.padEnd(20)} ${v.error ? 'ERROR: ' + v.error : v.filas + ' filas'}`)
  console.log(`\n  detalle: ${path.relative(process.cwd(), f)} (ignorado por git)`)
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  main().catch((e) => { console.error('✗', e.message); process.exit(1) })
}
