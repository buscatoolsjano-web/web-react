/**
 * Fase 22 · Etapa A — Auditoría del maestro de productos.
 *
 * Compara, producto por producto y sin tocar nada:
 *
 *   1. la base del ERP (Supabase),
 *   2. el catálogo legacy (`productos-data.json`: un archivo estático, así que
 *      es UNA descarga y no 21.772 visitas —A18—),
 *   3. lo que cada campo dice de sí mismo: vacío, cero de relleno, o dato.
 *
 * NO escribe en la base. NO corrige. Emite un informe y un archivo de
 * correcciones PROPUESTAS, auditable, para que la decisión sea de una persona.
 *
 *   node scripts/fase22-a-auditoria-maestro.mjs [--json out.json] [--csv out.csv]
 *
 * Necesita VITE_SUPABASE_URL y SUPABASE_SECRET_KEY.
 */
import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const LEGACY_URL = 'https://buscatoolsjano-web.github.io/Buscatools/productos-data.json'
const CACHE = process.env.BT_LEGACY_CACHE ?? '.cache-legacy-productos.json'

/**
 * El legacy se baja UNA vez y queda cacheado. Volver a pedirlo en cada corrida
 * sería golpear el sitio para recibir siempre lo mismo (A18).
 */
async function leerLegacy() {
  if (existsSync(CACHE)) return { productos: JSON.parse(readFileSync(CACHE, 'utf8')), desde: 'cache' }
  const r = await fetch(LEGACY_URL)
  if (!r.ok) throw new Error(`legacy HTTP ${r.status}`)
  const productos = await r.json()
  writeFileSync(CACHE, JSON.stringify(productos))
  return { productos, desde: 'red' }
}

/** El ERP, paginado: 21.828 filas no entran en una sola respuesta. */
async function leerErp(sb) {
  const filas = []
  const PAGINA = 1000
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await sb
      .from('products')
      .select(
        'id, sku, name, model_code, series, product_type, description, description_long,' +
          ' origin_country, ncm_code, weight_g, volume_cm3, attributes, status, needs_review,' +
          ' legacy_ref, external_source, brand_id, brands ( name, is_active )',
      )
      .is('deleted_at', null)
      .order('sku')
      .range(desde, desde + PAGINA - 1)
    if (error) throw new Error(`ERP: ${error.message}`)
    filas.push(...(data ?? []))
    if ((data?.length ?? 0) < PAGINA) return filas
  }
}

// ── Cómo se lee un valor ───────────────────────────────────────────────────

/**
 * Distinguir «vacío» de «cero de relleno» (A9).
 *
 * El legacy escribe `peso_g: 0` y `volumen_cm3: 0` en los productos que nunca
 * se pesaron. Contar eso como «tiene peso» da 21.772 de 21.772, que es
 * exactamente la clase de número con el que se toma una decisión equivocada.
 */
export function tieneDato(v) {
  if (v === null || v === undefined) return false
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'string') return v.trim() !== ''
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'object') return Object.keys(v).length > 0
  return true
}

/** Normaliza para COMPARAR (A2). El valor original no se toca nunca. */
export function normalizar(v) {
  if (v === null || v === undefined) return ''
  return String(v)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s._\-/]+/g, '')
    .trim()
}

/**
 * Magnitudes a una unidad común, para no comparar strings (A7).
 * Milímetros o gramos; `null` si el valor no es una magnitud reconocible.
 */
export function aMagnitud(valor, familia) {
  if (valor === null || valor === undefined) return null
  const t = String(valor).trim().toLowerCase().replace(',', '.')
  const m = /^(-?\d+(?:\.\d+)?)\s*(mm|cm|m|kg|g|")?$/.exec(t)
  if (!m) return null
  const n = Number(m[1])
  const implicita = familia === 'longitud' ? 'mm' : 'g'
  const u = m[2] ?? implicita
  const aMm = { mm: 1, cm: 10, m: 1000, '"': 25.4 }
  const aG = { g: 1, kg: 1000 }
  if (familia === 'longitud' && u in aMm) return { valor: n * aMm[u], unidad: 'mm', raw: String(valor) }
  if (familia === 'masa' && u in aG) return { valor: n * aG[u], unidad: 'g', raw: String(valor) }
  return null
}

/**
 * De dónde vino cada producto.
 *
 * `_importOrigen` dice si la fila salió de la API de STEL —el ERP
 * administrativo, que factura y no describe— o de un catálogo técnico. Es la
 * variable que explica los agujeros: no es que los datos se hayan perdido en
 * la migración, es que para esas filas nunca existieron.
 */
export function procedencia(legacy) {
  if (!legacy) return 'SOLO_ERP'
  return legacy._importOrigen && /stel/i.test(legacy._importOrigen) ? 'STEL' : 'CATALOGO'
}

/** Los campos que hacen a un producto comparable con otro. */
export const CAMPOS_TECNICOS = ['tipo', 'medida', 'largo', 'encastre', 'serie']

/** Cómo se llama en el ERP cada campo del legacy. */
export const EQUIVALENCIAS = [
  { legacy: 'tipo', erp: (p) => p.product_type, campo: 'product_type', magnitud: null },
  { legacy: 'serie', erp: (p) => p.series, campo: 'series', magnitud: null },
  { legacy: 'desc', erp: (p) => p.description, campo: 'description', magnitud: null },
  { legacy: 'descl', erp: (p) => p.description_long, campo: 'description_long', magnitud: null },
  { legacy: 'origen', erp: (p) => p.origin_country, campo: 'origin_country', magnitud: null },
  { legacy: 'ncm', erp: (p) => p.ncm_code, campo: 'ncm_code', magnitud: null },
  { legacy: 'peso_g', erp: (p) => p.weight_g, campo: 'weight_g', magnitud: 'masa' },
  // `volume_cm3` es `integer` en el ERP y decimal en el legacy: 1,6 se guardó
  // como 2. Eso es el redondeo de la importación, no un desacuerdo sobre
  // cuánto mide la caja. Compararlo como texto inventa 4.506 conflictos.
  { legacy: 'volumen_cm3', erp: (p) => p.volume_cm3, campo: 'volume_cm3', magnitud: null, redondeo: true },
  { legacy: 'medida', erp: (p) => p.attributes?.medida, campo: 'attributes.medida', magnitud: null },
  { legacy: 'largo', erp: (p) => p.attributes?.largo, campo: 'attributes.largo', magnitud: 'longitud' },
  { legacy: 'encastre', erp: (p) => p.attributes?.encastre, campo: 'attributes.encastre', magnitud: null },
]

/** Campos donde ERP y legacy dicen cosas distintas, y los dos dicen algo. */
export function diferencias(erp, legacy) {
  const out = []
  for (const eq of EQUIVALENCIAS) {
    const a = eq.erp(erp)
    const b = legacy[eq.legacy]
    if (!tieneDato(a) || !tieneDato(b)) continue
    if (eq.redondeo) {
      const na = Number(a)
      const nb = Number(b)
      if (Number.isFinite(na) && Number.isFinite(nb)) {
        if (Math.round(nb) !== na) out.push({ campo: eq.campo, erp: a, legacy: b, motivo: 'no es redondeo' })
        continue
      }
    }
    if (eq.magnitud) {
      const ma = aMagnitud(a, eq.magnitud)
      const mb = aMagnitud(b, eq.magnitud)
      // 80 mm y 8 cm son el mismo largo: compararlos como texto sería inventar
      // un conflicto.
      if (ma && mb) {
        if (ma.valor !== mb.valor) out.push({ campo: eq.campo, erp: a, legacy: b, motivo: 'magnitud distinta' })
        continue
      }
    }
    if (normalizar(a) !== normalizar(b)) out.push({ campo: eq.campo, erp: a, legacy: b, motivo: 'texto distinto' })
  }
  return out
}

/** Campos que el legacy tiene y el ERP no: candidatos a completar. */
export function faltantesEnErp(erp, legacy) {
  if (!legacy) return []
  return EQUIVALENCIAS.filter((eq) => !tieneDato(eq.erp(erp)) && tieneDato(legacy[eq.legacy])).map((eq) => ({
    campo: eq.campo,
    legacy: legacy[eq.legacy],
  }))
}

/**
 * Clasifica un producto contra el legacy (A3).
 *
 * No existe acá un `EXACT_OFFICIAL`: esta corrida no consulta fabricantes.
 * Inventarlo con datos del legacy sería declarar verificado contra una fuente
 * que no se miró.
 */
export function clasificar(erp, legacy) {
  if (!legacy) return { match: 'NO_MATCH', confianza: 'LOW', difs: [] }
  const difs = diferencias(erp, legacy)
  if (difs.length > 0) return { match: 'CONFLICT', confianza: 'MEDIUM', difs }
  return { match: 'EXACT_LEGACY', confianza: 'HIGH', difs: [] }
}

/**
 * La marca escondida en el nombre.
 *
 * Miles de productos no tienen marca en el ERP pero la llevan escrita en la
 * primera palabra del nombre: «GEDORE 760-50…», «BREMEN 6906…». Esto NO
 * asigna nada: propone, y sólo cuando la marca ya existe en la tabla, para no
 * inventar marcas nuevas a partir de una palabra suelta.
 */
export function marcaSugerida(nombre, marcasConocidas) {
  const palabras = String(nombre ?? '')
    .trim()
    .split(/\s+/)
  for (const largo of [2, 1]) {
    const cand = palabras.slice(0, largo).join(' ').replace(/[.,]+$/, '')
    const hit = marcasConocidas.get(normalizar(cand))
    if (hit) return hit
  }
  return null
}

/** Cuántos campos técnicos tiene cargados un producto del ERP. */
export function tecnicosCargados(p) {
  return CAMPOS_TECNICOS.filter((k) =>
    tieneDato(k === 'tipo' ? p.product_type : k === 'serie' ? p.series : p.attributes?.[k]),
  ).length
}

/**
 * Clave para detectar duplicados (A12): marca + modelo normalizados.
 * Sin modelo no hay clave: dos productos sin modelo no son «el mismo».
 */
export function claveDuplicado(p) {
  const modelo = normalizar(p.model_code)
  if (!modelo) return null
  return `${normalizar(p.brands?.name ?? '')}|${modelo}`
}

function contarPor(filas, clave) {
  const m = new Map()
  for (const f of filas) {
    const k = clave(f) ?? '(sin dato)'
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

async function main() {
  const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null)
  const salidaJson = arg('--json')
  const salidaCsv = arg('--csv')

  const BASE = process.env.VITE_SUPABASE_URL
  const SECRET = process.env.SUPABASE_SECRET_KEY
  if (!BASE || !SECRET) throw new Error('Faltan VITE_SUPABASE_URL y SUPABASE_SECRET_KEY')
  const sb = createClient(BASE, SECRET, { auth: { persistSession: false } })

  const { productos: legacy, desde } = await leerLegacy()
  const erp = await leerErp(sb)
  const porRef = new Map(legacy.map((p) => [p.sku, p]))
  const refsDelErp = new Set(erp.map((p) => p.legacy_ref).filter(Boolean))

  const marcasConocidas = new Map()
  for (const p of erp) if (p.brands?.name) marcasConocidas.set(normalizar(p.brands.name), p.brands.name)

  const analizados = erp.map((p) => {
    const l = porRef.get(p.legacy_ref) ?? null
    const c = clasificar(p, l)
    return {
      id: p.id,
      sku: p.sku,
      nombre: p.name,
      marca: p.brands?.name ?? null,
      marca_sugerida: p.brands?.name ? null : marcaSugerida(p.name, marcasConocidas),
      modelo: p.model_code,
      clave_dup: claveDuplicado(p),
      procedencia: procedencia(l),
      match: c.match,
      confianza: c.confianza,
      difs: c.difs,
      faltantes: faltantesEnErp(p, l),
      tecnicos: tecnicosCargados(p),
      revision: p.needs_review,
      estado: p.status,
    }
  })

  const porClave = new Map()
  for (const a of analizados) {
    if (!a.clave_dup) continue
    porClave.set(a.clave_dup, [...(porClave.get(a.clave_dup) ?? []), a.sku])
  }
  const duplicados = [...porClave.entries()].filter(([, skus]) => skus.length > 1)

  const informe = {
    generado: new Date().toISOString(),
    fuente_legacy: { url: LEGACY_URL, desde, productos: legacy.length },
    TOTAL_PRODUCTS: erp.length,
    TOTAL_BRANDS: new Set(analizados.map((a) => a.marca).filter(Boolean)).size,
    LEGACY_PRODUCTS_FOUND: legacy.length,
    SOLO_EN_LEGACY: legacy.filter((l) => !refsDelErp.has(l.sku)).length,
    EXACT_LEGACY: analizados.filter((a) => a.match === 'EXACT_LEGACY').length,
    CONFLICTS: analizados.filter((a) => a.match === 'CONFLICT').length,
    NO_MATCH: analizados.filter((a) => a.match === 'NO_MATCH').length,
    // Esta corrida NO consulta fabricantes. Declararlo, no estimarlo.
    EXACT_OFFICIAL: 0,
    OFFICIAL_SOURCES_FOUND: 0,
    OFFICIAL_PDFS_FOUND: 0,
    NO_OFFICIAL_SOURCE: erp.length,
    POR_PROCEDENCIA: Object.fromEntries(contarPor(analizados, (a) => a.procedencia)),
    MISSING_TECHNICAL_FIELDS: analizados.filter((a) => a.tecnicos === 0).length,
    SIN_MARCA: analizados.filter((a) => !a.marca).length,
    SIN_MARCA_CON_SUGERENCIA: analizados.filter((a) => !a.marca && a.marca_sugerida).length,
    POSSIBLE_DUPLICATES: duplicados.reduce((n, [, skus]) => n + skus.length, 0),
    DUPLICATE_GROUPS: duplicados.length,
    BY_BRAND: contarPor(analizados, (a) => a.marca ?? '(SIN MARCA)').map(([marca, n]) => {
      const f = analizados.filter((a) => (a.marca ?? '(SIN MARCA)') === marca)
      return {
        marca,
        productos: n,
        de_stel: f.filter((a) => a.procedencia === 'STEL').length,
        de_catalogo: f.filter((a) => a.procedencia === 'CATALOGO').length,
        sin_tecnicos: f.filter((a) => a.tecnicos === 0).length,
        conflictos: f.filter((a) => a.match === 'CONFLICT').length,
      }
    }),
  }

  const propuestas = []
  for (const a of analizados) {
    if (a.marca_sugerida) {
      propuestas.push({
        product_id: a.id,
        sku: a.sku,
        brand: '',
        model: a.modelo ?? '',
        field: 'brand_id',
        current_value: '',
        legacy_value: '',
        official_value: '',
        proposed_value: a.marca_sugerida,
        source: 'nombre del producto',
        reference: 'la primera palabra coincide con una marca ya existente',
        confidence: 'MEDIUM',
        reason: 'producto sin marca cuyo nombre empieza con una marca de la tabla',
      })
    }
    for (const f of a.faltantes) {
      propuestas.push({
        product_id: a.id,
        sku: a.sku,
        brand: a.marca ?? '',
        model: a.modelo ?? '',
        field: f.campo,
        current_value: '',
        legacy_value: String(f.legacy),
        official_value: '',
        proposed_value: String(f.legacy),
        source: 'legacy',
        reference: LEGACY_URL,
        confidence: 'HIGH',
        reason: 'el legacy lo tiene y el ERP no',
      })
    }
    for (const d of a.difs) {
      propuestas.push({
        product_id: a.id,
        sku: a.sku,
        brand: a.marca ?? '',
        model: a.modelo ?? '',
        field: d.campo,
        current_value: String(d.erp),
        legacy_value: String(d.legacy),
        official_value: '',
        proposed_value: '',
        source: 'conflicto sin resolver',
        reference: LEGACY_URL,
        confidence: 'LOW',
        reason: `ERP y legacy difieren (${d.motivo}); hace falta la fuente oficial`,
      })
    }
  }
  informe.PROPOSED_CORRECTIONS = propuestas.length
  informe.AUTO_FIX_HIGH_CONFIDENCE = propuestas.filter((p) => p.confidence === 'HIGH').length
  informe.MANUAL_REVIEW_REQUIRED = propuestas.filter((p) => p.confidence !== 'HIGH').length
  informe.DB_CHANGES_APPLIED = 0
  informe.PRODUCTS_CHANGED = 0

  console.log(JSON.stringify(informe, null, 2))
  if (salidaJson) writeFileSync(salidaJson, JSON.stringify({ informe, analizados }, null, 2))
  if (salidaCsv) {
    const cols = [
      'product_id', 'sku', 'brand', 'model', 'field', 'current_value', 'legacy_value',
      'official_value', 'proposed_value', 'source', 'reference', 'confidence', 'reason',
    ]
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    writeFileSync(salidaCsv, [cols.join(','), ...propuestas.map((p) => cols.map((c) => esc(p[c])).join(','))].join('\n'))
    console.error(`\ncorrecciones propuestas → ${salidaCsv} (${propuestas.length} filas). NO aplicadas.`)
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
