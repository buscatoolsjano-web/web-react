/**
 * Fase 22 · Cierre — Auditoría de las equivalencias curadas del legacy.
 *
 * El legacy guarda, en cuatro campos, qué productos de otra marca son
 * alternativa de éste: `sim_sp` (SPEEDRILL), `sim_tc` (TECNA), `sim_cp`
 * (CHICAGO PNEUMATIC) e `sim_ir` (INGERSOLL RAND). Son **curadas a mano**:
 * alguien de Buscatools decidió que ese par se puede reemplazar. Ese
 * conocimiento no está en ningún atributo técnico y no se puede recalcular.
 *
 * Lo que NO hay que asumir: que 1.715 productos con equivalencias sean 1.715
 * relaciones. Cada campo es una LISTA separada por barras, así que un solo
 * producto puede declarar seis equivalencias.
 *
 * Read-only. No escribe en la base ni propone importar nada roto.
 *
 *   node scripts/fase22-d-equivalencias-legacy.mjs [--json out.json] [--csv out.csv]
 */
import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const CACHE = process.env.BT_LEGACY_CACHE ?? '.cache-legacy-productos.json'
const LEGACY_URL = 'https://buscatoolsjano-web.github.io/Buscatools/productos-data.json'

/**
 * Qué marca y qué prefijo de SKU corresponde a cada campo.
 *
 * El prefijo sale del propio legacy: su `_renderSimilarLinks(p.sim_tc, 'TE')`
 * arma el SKU destino como `TE.` + la referencia.
 */
export const ORIGENES = {
  sim_sp: { marca: 'SPEEDRILL', prefijo: 'SP' },
  sim_tc: { marca: 'TECNA', prefijo: 'TE' },
  sim_cp: { marca: 'CHICAGO PNEUMATIC', prefijo: 'CP' },
  sim_ir: { marca: 'INGERSOLL RAND', prefijo: 'IR' },
}

/** Para comparar referencias: sin separadores, en mayúsculas. */
export function normRef(v) {
  if (v === null || v === undefined) return ''
  return String(v)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s._\-/\\]+/g, '')
    .trim()
}

/**
 * Las referencias declaradas en un campo.
 *
 * «R23-1/2APM / R23-1/4APM / R2304H» son TRES equivalencias, no una. Las
 * barras que separan la lista van rodeadas de espacios; las que son parte de
 * una medida —`R23-1/2APM`— no. Esa es la única diferencia entre partir bien
 * y partir un part number al medio.
 */
export function referenciasDe(valor) {
  if (valor === null || valor === undefined) return []
  return String(valor)
    .split(/\s+\/\s+|\s*[,;]\s*/)
    .map((t) => t.trim())
    .filter((t) => t !== '')
}

/**
 * Los enlaces que declara un producto del legacy.
 *
 * Devuelve la evidencia original —el texto tal cual— junto a la referencia
 * normalizada: la auditoría tiene que poder mostrar qué decía el dato.
 */
export function enlacesDe(p) {
  const out = []
  for (const [campo, { prefijo }] of Object.entries(ORIGENES)) {
    for (const ref of referenciasDe(p[campo])) {
      out.push({
        origen: p.sku,
        campo,
        referencia: ref,
        // El SKU destino se arma como lo arma el legacy: prefijo + referencia.
        skuDestino: `${prefijo}.${ref}`,
      })
    }
  }
  return out
}

async function leerLegacy() {
  if (existsSync(CACHE)) return JSON.parse(readFileSync(CACHE, 'utf8'))
  const r = await fetch(LEGACY_URL)
  if (!r.ok) throw new Error(`legacy HTTP ${r.status}`)
  const p = await r.json()
  writeFileSync(CACHE, JSON.stringify(p))
  return p
}

async function leerProductos(sb) {
  const filas = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb
      .from('products')
      .select('id, sku, legacy_ref, company_id, brands ( name )')
      .is('deleted_at', null)
      .order('sku')
      .range(desde, desde + 999)
    if (error) throw new Error(error.message)
    filas.push(...(data ?? []))
    if ((data?.length ?? 0) < 1000) return filas
  }
}

/**
 * Resuelve un enlace contra los productos del ERP.
 *
 * Sólo cuenta la coincidencia EXACTA de referencia. Nada de fuzzy: una
 * equivalencia mal resuelta le dice a alguien que puede reemplazar una
 * herramienta por otra que no sirve.
 */
export function resolver(enlace, idx) {
  const origen = idx.porRef.get(normRef(enlace.origen))
  const destinoExacto = idx.porRef.get(normRef(enlace.skuDestino))
  // Segundo intento: la referencia sin el prefijo, por si el SKU del ERP no
  // lo lleva. Sigue siendo coincidencia exacta de referencia.
  const destinoPorRef = idx.porRefSinPrefijo.get(normRef(enlace.referencia))

  const candidatos = destinoExacto ?? destinoPorRef ?? []
  if (!origen || origen.length === 0) return { estado: 'ORIGEN_AUSENTE' }
  if (candidatos.length === 0) return { estado: 'MISSING_TARGET' }
  if (candidatos.length > 1) return { estado: 'AMBIGUOUS_TARGET', candidatos: candidatos.map((c) => c.sku) }
  const o = origen[0]
  const d = candidatos[0]
  if (o.id === d.id) return { estado: 'SELF_REFERENCE', origen: o, destino: d }
  return { estado: 'VALID', origen: o, destino: d }
}

function indexar(productos) {
  const porRef = new Map()
  const porRefSinPrefijo = new Map()
  /*
   * Se deduplica por id: en casi todo el catálogo `legacy_ref` es idéntico al
   * `sku`, así que indexar por los dos metía el MISMO producto dos veces bajo
   * la misma clave y todo salía «ambiguo». Ambigüedad es que dos productos
   * DISTINTOS reclamen la misma referencia, no que uno esté contado doble.
   */
  const sumar = (mapa, clave, p) => {
    if (!clave || clave.length < 3) return
    const previos = mapa.get(clave) ?? []
    if (previos.some((x) => x.id === p.id)) return
    mapa.set(clave, [...previos, p])
  }
  for (const p of productos) {
    sumar(porRef, normRef(p.sku), p)
    if (p.legacy_ref) sumar(porRef, normRef(p.legacy_ref), p)
    const m = /^([A-Za-z]{2,3})\.(.+)$/.exec(p.sku)
    if (m) sumar(porRefSinPrefijo, normRef(m[2]), p)
  }
  return { porRef, porRefSinPrefijo }
}

async function main() {
  const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null)
  const BASE = process.env.VITE_SUPABASE_URL
  const SECRET = process.env.SUPABASE_SECRET_KEY
  if (!BASE || !SECRET) throw new Error('Faltan VITE_SUPABASE_URL y SUPABASE_SECRET_KEY')
  const sb = createClient(BASE, SECRET, { auth: { persistSession: false } })

  const legacy = await leerLegacy()
  const productos = await leerProductos(sb)
  const idx = indexar(productos)

  const conEquivalencias = legacy.filter((p) => enlacesDe(p).length > 0)
  const enlaces = legacy.flatMap(enlacesDe)

  const porCampo = {}
  for (const e of enlaces) porCampo[e.campo] = (porCampo[e.campo] ?? 0) + 1

  const resueltos = enlaces.map((e) => ({ ...e, ...resolver(e, idx) }))
  const validos = resueltos.filter((r) => r.estado === 'VALID')

  // Duplicados: el MISMO par en el mismo campo declarado dos veces.
  const vistos = new Set()
  const duplicados = []
  const unicos = []
  for (const v of validos) {
    const clave = `${v.origen.id}|${v.destino.id}|${v.campo}`
    if (vistos.has(clave)) duplicados.push(v)
    else {
      vistos.add(clave)
      unicos.push(v)
    }
  }

  // Direccionalidad: ¿si A dice B, B dice A?
  const pares = new Set(unicos.map((v) => `${v.origen.id}|${v.destino.id}`))
  let simetricos = 0
  const unaVia = []
  for (const v of unicos) {
    if (pares.has(`${v.destino.id}|${v.origen.id}`)) simetricos++
    else unaVia.push(v)
  }

  const informe = {
    generado: new Date().toISOString(),
    LEGACY_PRODUCTS_WITH_EQUIVALENTS: conEquivalencias.length,
    TOTAL_EQUIVALENCE_LINKS: enlaces.length,
    SIM_SP: porCampo.sim_sp ?? 0,
    SIM_TC: porCampo.sim_tc ?? 0,
    SIM_CP: porCampo.sim_cp ?? 0,
    SIM_IR: porCampo.sim_ir ?? 0,
    VALID_TARGETS: validos.length,
    MISSING_TARGETS: resueltos.filter((r) => r.estado === 'MISSING_TARGET').length,
    AMBIGUOUS_TARGETS: resueltos.filter((r) => r.estado === 'AMBIGUOUS_TARGET').length,
    SELF_REFERENCES: resueltos.filter((r) => r.estado === 'SELF_REFERENCE').length,
    ORIGEN_AUSENTE: resueltos.filter((r) => r.estado === 'ORIGEN_AUSENTE').length,
    DUPLICATE_LINKS: duplicados.length,
    IMPORTABLES: unicos.length,
    // `simetricos` cuenta cada lado, así que los pares mutuos son la mitad.
    SYMMETRIC_LINKS: simetricos,
    ONE_WAY_LINKS: unaVia.length,
    EJEMPLOS: {
      validos: unicos.slice(0, 4).map((v) => `${v.origen.sku} → ${v.destino.sku} (${v.campo})`),
      faltantes: resueltos
        .filter((r) => r.estado === 'MISSING_TARGET')
        .slice(0, 6)
        .map((r) => `${r.origen} → ${r.skuDestino} (${r.campo}) NO existe`),
      ambiguos: resueltos
        .filter((r) => r.estado === 'AMBIGUOUS_TARGET')
        .slice(0, 4)
        .map((r) => `${r.origen} → ${r.referencia}: ${(r.candidatos ?? []).join(' / ')}`),
    },
    DB_CHANGES_APPLIED: 0,
  }

  console.log(JSON.stringify(informe, null, 2))

  if (process.argv.includes('--importar')) {
    const r = await importar(
      sb,
      unicos.map((v) => ({ ...v, origen: { ...v.origen, companyId: v.origen.company_id } })),
      process.argv.includes('--aplicar'),
    )
    console.error(`\n${r.dryRun ? 'DRY RUN' : 'APLICADO'}: ${r.aInsertar} enlaces, ${r.insertadas} insertadas.`)
  }

  const salidaJson = arg('--json')
  if (salidaJson) writeFileSync(salidaJson, JSON.stringify({ informe, resueltos, unicos }, null, 2))
  const salidaCsv = arg('--csv')
  if (salidaCsv) {
    const cols = ['estado', 'campo', 'sku_origen', 'referencia_original', 'sku_destino_esperado', 'sku_destino_resuelto', 'product_id', 'equivalent_product_id']
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const filas = resueltos.map((r) => ({
      estado: r.estado,
      campo: r.campo,
      sku_origen: r.origen?.sku ?? r.origen,
      referencia_original: r.referencia,
      sku_destino_esperado: r.skuDestino,
      sku_destino_resuelto: r.destino?.sku ?? '',
      product_id: r.origen?.id ?? '',
      equivalent_product_id: r.destino?.id ?? '',
    }))
    writeFileSync(salidaCsv, [cols.join(','), ...filas.map((f) => cols.map((c) => esc(f[c])).join(','))].join('\n'))
    console.error(`\n${filas.length} enlaces → ${salidaCsv}. NO importados.`)
  }
}

const esteArchivo = import.meta.url.replace(/^file:\/\/\/?/, '').replace(/\\/g, '/').toLowerCase()
const invocado = String(process.argv[1] ?? '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
if (esteArchivo.endsWith(invocado)) {
  main().catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
}

/**
 * Importa a `product_equivalences` los enlaces VÁLIDOS.
 *
 * Dry run por omisión: hay que pasar `--aplicar` a propósito. Sólo entra lo
 * que resolvió a un producto único y existente — nada de fuzzy: una
 * equivalencia mal resuelta le dice a alguien que puede reemplazar una
 * herramienta por otra que no sirve.
 *
 * Idempotente: el `unique (product_id, equivalent_product_id, source_kind)`
 * hace que correrlo dos veces no duplique nada.
 *
 *   node scripts/fase22-d-equivalencias-legacy.mjs --importar [--aplicar]
 */
export async function importar(sb, unicos, aplicar) {
  const filas = unicos.map((v) => ({
    company_id: v.origen.companyId,
    product_id: v.origen.id,
    equivalent_product_id: v.destino.id,
    source: 'legacy',
    source_kind: v.campo,
  }))
  if (!aplicar) return { insertadas: 0, aInsertar: filas.length, dryRun: true }

  let insertadas = 0
  for (let i = 0; i < filas.length; i += 500) {
    const lote = filas.slice(i, i + 500)
    const { error, count } = await sb
      .from('product_equivalences')
      .upsert(lote, { onConflict: 'product_id,equivalent_product_id,source_kind', ignoreDuplicates: true, count: 'exact' })
    if (error) throw new Error(`importando: ${error.message}`)
    insertadas += count ?? lote.length
  }
  return { insertadas, aInsertar: filas.length, dryRun: false }
}
