/**
 * Fase 22 · Validación de direccionalidad de las equivalencias.
 *
 * La pregunta: el legacy declaró 7.811 equivalencias en UNA sola dirección
 * («TECNA 9336L tiene como alternativa a IR BMDS-2»). Abriendo el otro
 * extremo, ¿alguien ve la relación?
 *
 * Medido antes de tocar nada: **ninguno**. Los 607 productos que están del
 * lado B no muestran a ninguno de sus 7.811 equivalentes declarados, porque
 * 7.797 de esas relaciones cruzan marcas y el puntaje calculado premia la
 * misma marca: los hermanos de catálogo llenan los ocho lugares antes de que
 * llegue la alternativa de otro fabricante.
 *
 * No escribe nada. Mide, y sirve para comparar antes y después.
 *
 *   node scripts/fase22-f-direccionalidad.mjs [--json out.json]
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'

/** Los casos que hay que poder mirar a ojo, no sólo contar. */
export const CASOS_CROSS_BRAND = ['TE.9336L', 'IR.BMDS-2', 'CP.CP9911', 'AP.M13MM11', 'SP.R23-1/2APM']
/** Los que fijan el costo: una familia grande, una chica y una mínima. */
export const CASOS_RENDIMIENTO = ['SP.R2315HL', 'TE.X-LIGHT.2', 'FE.92604182020']

async function todasLasRelaciones(sb) {
  const filas = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb
      .from('product_equivalences')
      .select('product_id, equivalent_product_id, source_kind')
      .range(desde, desde + 999)
    if (error) throw new Error(error.message)
    filas.push(...(data ?? []))
    if ((data?.length ?? 0) < 1000) return filas
  }
}

/** Las relaciones que el legacy declaró en una sola dirección. */
export function unaSolaVia(pares) {
  const declaradas = new Set(pares.map((p) => `${p.product_id}|${p.equivalent_product_id}`))
  return pares.filter((p) => !declaradas.has(`${p.equivalent_product_id}|${p.product_id}`))
}

/** Agrupa por el extremo B: es el que hay que abrir para ver si aparece A. */
export function porExtremoB(unaVia) {
  const m = new Map()
  for (const p of unaVia) m.set(p.equivalent_product_id, [...(m.get(p.equivalent_product_id) ?? []), p.product_id])
  return m
}

async function medirUno(sb, id, limite = 8, corridas = 3) {
  const t = []
  let data = null
  for (let i = 0; i < corridas; i++) {
    const a = Date.now()
    const r = await sb.rpc('productos_similares', { p_product_id: id, p_limite: limite })
    t.push(Date.now() - a)
    data = r.data
  }
  return { ms: t.sort((x, y) => x - y)[Math.floor(corridas / 2)], filas: data ?? [] }
}

async function main() {
  const BASE = process.env.VITE_SUPABASE_URL
  const SECRET = process.env.SUPABASE_SECRET_KEY
  if (!BASE || !SECRET) throw new Error('Faltan VITE_SUPABASE_URL y SUPABASE_SECRET_KEY')
  const sb = createClient(BASE, SECRET, { auth: { persistSession: false } })

  const pares = await todasLasRelaciones(sb)
  const unaVia = unaSolaVia(pares)
  const porB = porExtremoB(unaVia)

  // ¿Cuántas relaciones inversas se ven HOY al abrir el extremo B?
  const Bs = [...porB.keys()]
  const porProducto = []
  const CONC = 12
  for (let i = 0; i < Bs.length; i += CONC) {
    const lote = Bs.slice(i, i + CONC)
    const r = await Promise.all(
      lote.map(async (b) => {
        const { filas } = await medirUno(sb, b, 8, 1)
        const ids = new Set(filas.map((x) => x.id))
        const as = porB.get(b) ?? []
        return {
          b,
          totalA: as.length,
          encontrados: as.filter((a) => ids.has(a)).length,
          porFuente: filas.reduce((m, f) => ({ ...m, [f.fuente]: (m[f.fuente] ?? 0) + 1 }), {}),
        }
      }),
    )
    porProducto.push(...r)
  }

  const relaciones = porProducto.reduce((n, x) => n + x.totalA, 0)
  const cubiertas = porProducto.reduce((n, x) => n + x.encontrados, 0)

  // Los casos concretos, con nombres, para poder mirarlos.
  const idsDe = async (skus) => {
    const { data } = await sb.from('products').select('id, sku, brands ( name )').in('sku', skus)
    return data ?? []
  }
  const nombrar = async (ids) => {
    if (ids.length === 0) return new Map()
    const { data } = await sb.from('products').select('id, sku, brands ( name )').in('id', ids)
    return new Map((data ?? []).map((r) => [r.id, `${r.brands?.name ?? '?'} ${r.sku}`]))
  }

  const casos = {}
  for (const p of await idsDe(CASOS_CROSS_BRAND)) {
    const { ms, filas } = await medirUno(sb, p.id)
    const m = await nombrar(filas.map((f) => f.id))
    casos[p.sku] = {
      marca: p.brands?.name ?? null,
      ms,
      top: filas.slice(0, 5).map((f) => `${m.get(f.id) ?? '?'} [${f.fuente}${f.motivo ? ':' + f.motivo : ''}]`),
    }
  }

  const rendimiento = {}
  for (const p of await idsDe(CASOS_RENDIMIENTO)) {
    rendimiento[p.sku] = (await medirUno(sb, p.id)).ms
  }

  const informe = {
    generado: new Date().toISOString(),
    STORED_RELATIONS: pares.length,
    SYMMETRIC_LINKS: pares.length - unaVia.length,
    ONE_WAY_LINKS: unaVia.length,
    PRODUCTOS_EN_EL_EXTREMO_B: porB.size,
    FORWARD_ONLY_UX: relaciones - cubiertas,
    REVERSE_ALREADY_FOUND_CALCULATED: cubiertas,
    REVERSE_NOT_FOUND_AT_ALL: relaciones - cubiertas,
    B_SIN_NINGUN_EQUIVALENTE_VISIBLE: porProducto.filter((x) => x.encontrados === 0).length,
    CASOS: casos,
    RENDIMIENTO_MS: rendimiento,
  }
  console.log(JSON.stringify(informe, null, 2))

  const salida = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null
  if (salida) writeFileSync(salida, JSON.stringify({ informe, porProducto }, null, 2))
}

const esteArchivo = import.meta.url.replace(/^file:\/\/\/?/, '').replace(/\\/g, '/').toLowerCase()
const invocado = String(process.argv[1] ?? '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
if (esteArchivo.endsWith(invocado)) {
  main().catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
}
