/**
 * Fase 22 · Cierre — Auditoría READ-ONLY de los productos sin marca.
 *
 * Responde una sola pregunta: de los 5.509 productos sin `brand_id`, ¿cuántos
 * pueden DEMOSTRARSE de una marca, y con qué evidencia?
 *
 * La regla que ordena todo: **el texto no es identidad**. Que un producto se
 * llame «APEX ...» no lo hace APEX; puede decir «compatible con APEX», y
 * «Mercedes Benz» en el nombre casi siempre es el cliente, no el fabricante.
 * Por eso el nombre nunca alcanza para proponer una asignación automática:
 * hace falta que coincida una REFERENCIA —el SKU o el modelo del fabricante—
 * con la de un producto que ya tiene esa marca.
 *
 * NO escribe nada. Ni en la base ni en el legacy.
 *
 *   node scripts/fase22-c-auditoria-sin-marca.mjs [--json out.json] [--csv out.csv]
 */
import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const LEGACY_URL = 'https://buscatoolsjano-web.github.io/Buscatools/productos-data.json'
const CACHE = process.env.BT_LEGACY_CACHE ?? '.cache-legacy-productos.json'

/** Una sola descarga, cacheada: el legacy es un archivo estático de 15 MB. */
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
      .select('id, sku, name, model_code, brand_id, status, legacy_ref, category_id, brands ( name )')
      .is('deleted_at', null)
      .order('sku')
      .range(desde, desde + 999)
    if (error) throw new Error(error.message)
    filas.push(...(data ?? []))
    if ((data?.length ?? 0) < 1000) return filas
  }
}

// ── Normalización de referencias (A2 de la Etapa A) ────────────────────────

/**
 * Una referencia comparable.
 *
 * Mayúsculas, sin acentos y sin separadores: `SP.J23-1/2H` y `spj2312h` son la
 * misma referencia escrita distinto. Lo que NO hace es acortar ni parecerse:
 * dos referencias distintas siguen siendo distintas.
 */
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
 * La referencia sin el prefijo de marca del SKU.
 *
 * Los SKU del catálogo llevan un prefijo de dos letras —`SP.`, `AP.`, `TE.`—
 * que es de Buscatools, no del fabricante. Para comparar contra un producto
 * sin ese prefijo hay que sacarlo; si no, `AP.1107` y `1107` no se cruzan
 * nunca.
 */
export function sinPrefijo(sku) {
  const s = String(sku ?? '')
  const m = /^([A-Za-z]{2,3})\.(.+)$/.exec(s)
  return normRef(m ? m[2] : s)
}

/** Palabras que NO son marca aunque abran el nombre. */
export const NO_SON_MARCA = new Set([
  'LLAVE', 'CINTA', 'JUEGO', 'PINZA', 'KIT', 'GUANTE', 'ZAPATO', 'ZAPATOS', 'CABLE',
  'TORNILLO', 'DISCO', 'SET', 'PUNTA', 'PUNTAS', 'MECHA', 'CAJA', 'CEPILLO', 'CONECTOR',
  'DESTORNILLADOR', 'ARMARIO', 'STORAGE', 'COLLAR', 'EQUILIBRADOR', 'TUBO', 'ADAPTADOR',
  'CANO', 'CAÑO', 'MARTILLO', 'PISTOLA', 'MANGUERA', 'CARRO', 'LIJA', 'CODO', 'IMAN',
  'TIJERA', 'PANEL', 'PILA', 'ROLLO', 'HOJA', 'PINCEL', 'BOMBA', 'LAMPARA', 'TAPA',
  'BROCA', 'ESLINGA', 'CUPLA', 'CABO', 'PIN', 'BUJE', 'MACHO', 'PANO', 'PAÑO', 'GAVETA',
  'SOPORTE', 'ALICATE', 'FICHA', 'FUENTE', 'MEDIDOR', 'PROTECTOR', 'ACOPLE', 'BOTIN',
  'BOTÍN', 'MAMELUCO', 'CALIBRE', 'CANCAMO', 'TORQUIMETRO', 'AMOLADORA', 'PINTURA',
  'JIG', 'SENSOR', 'MINI', 'REJA', 'RELE', 'PRENSACABLE', 'BALANZA', 'UNIDAD',
])

/**
 * La marca que el NOMBRE sugiere, si sugiere alguna.
 *
 * Devuelve el texto, no una decisión: sirve para clasificar como
 * «HIGH_CONFIDENCE_NAME_ONLY», que es explícitamente lo que NO se aplica solo.
 */
export function marcaEnNombre(nombre, marcasConocidas) {
  const palabras = String(nombre ?? '').trim().split(/\s+/)
  for (const largo of [2, 1]) {
    const cand = palabras.slice(0, largo).join(' ').replace(/[.,;:]+$/, '').toUpperCase()
    if (largo === 1 && NO_SON_MARCA.has(normRef(cand))) return null
    const hit = marcasConocidas.get(normRef(cand))
    if (hit) return hit
  }
  return null
}

/**
 * Las referencias que aparecen DENTRO del nombre.
 *
 * En buena parte de estos productos el SKU es un correlativo interno
 * (`PRO00249`) y el part number del fabricante está escrito en el nombre:
 * «APEX EX-508-18». Sin mirar ahí, esos productos quedan clasificados como
 * «sólo el nombre» cuando en realidad tienen una referencia verificable — y
 * medido, 3 de cada 6 de esas referencias existen en el catálogo de la marca.
 *
 * Un token cuenta como referencia si mezcla letras y dígitos, o si es un
 * número largo. Se descartan las medidas —«6.35mm», «1/4», «20V»— porque son
 * la especificación del producto, no su identidad.
 */
export function referenciasEnNombre(nombre) {
  const crudo = String(nombre ?? '')
  const tokens = crudo.split(/[\s,;()[\]]+/).filter(Boolean)
  const out = []
  for (const t of tokens) {
    const limpio = t.replace(/[.,;:]+$/, '')
    if (limpio.length < 4 || limpio.length > 24) continue
    if (limpio.includes('/')) continue // 1/4, 5/16: encastres, no referencias
    if (/^\d+([.,]\d+)?(MM|CM|M|KG|G|V|NM|W|RPM|PZ|PCS)$/i.test(limpio)) continue
    const tieneDigito = /\d/.test(limpio)
    const tieneLetra = /[A-Za-z]/.test(limpio)
    if (!(tieneDigito && tieneLetra) && !/^\d{5,}$/.test(limpio)) continue
    out.push(normRef(limpio))
  }
  return [...new Set(out)].filter((r) => r.length >= 4)
}

/**
 * ¿El nombre dice que es de esa marca, o que es COMPATIBLE con esa marca?
 *
 * «APEX 49-A-TX-25» afirma; «Punta compatible con APEX» no. La diferencia
 * decide si el texto es siquiera un indicio.
 */
export function esMencionDeCompatibilidad(nombre, marca) {
  const t = String(nombre ?? '').toUpperCase()
  const m = String(marca ?? '').toUpperCase()
  const i = t.indexOf(m)
  if (i < 0) return false
  const antes = t.slice(Math.max(0, i - 40), i)
  return /(COMPATIBLE|EQUIVALENTE|PARA|TIPO|SIMILAR|REEMPLAZ|ALTERNATIV|APLICA)/.test(antes)
}

// ── Clasificación (§5) ─────────────────────────────────────────────────────

export const CLASES = [
  'EXACT_MATCH_SAME_SKU',
  'EXACT_MATCH_MODEL',
  'HIGH_CONFIDENCE_NAME_ONLY',
  'MULTIPLE_CANDIDATES',
  'NO_MATCH',
  'CONFLICT',
]

/**
 * Clasifica UN producto sin marca contra los índices de referencias.
 *
 * El orden importa: primero la evidencia dura (referencia idéntica a la de un
 * producto con marca, acá o en el legacy), después la blanda (el nombre), y
 * si hay más de una marca candidata no se elige — se reporta el empate.
 */
export function clasificar(p, idx) {
  const refs = [
    { clave: normRef(p.sku), tipo: 'EXACT_MATCH_SAME_SKU' },
    { clave: sinPrefijo(p.sku), tipo: 'EXACT_MATCH_SAME_SKU' },
    { clave: normRef(p.model_code), tipo: 'EXACT_MATCH_MODEL' },
    { clave: sinPrefijo(p.model_code), tipo: 'EXACT_MATCH_MODEL' },
  ].filter((r) => r.clave.length >= 4) // referencias de 1–3 caracteres cruzan cualquier cosa

  const marcas = new Map()
  let mejorTipo = null
  for (const r of refs) {
    for (const [fuente, mapa] of [['erp', idx.porRefErp], ['legacy', idx.porRefLegacy]]) {
      const hit = mapa.get(r.clave)
      if (!hit) continue
      for (const m of hit.marcas) {
        const prev = marcas.get(m) ?? { evidencia: [], tipo: r.tipo }
        prev.evidencia.push(`${fuente}:${r.tipo === 'EXACT_MATCH_SAME_SKU' ? 'sku' : 'modelo'}=${r.clave}→${hit.ejemplo}`)
        if (r.tipo === 'EXACT_MATCH_SAME_SKU') prev.tipo = 'EXACT_MATCH_SAME_SKU'
        marcas.set(m, prev)
      }
      if (!mejorTipo || r.tipo === 'EXACT_MATCH_SAME_SKU') mejorTipo = r.tipo
    }
  }

  const porNombre = marcaEnNombre(p.name, idx.marcasConocidas)
  const soloCompatible = porNombre ? esMencionDeCompatibilidad(p.name, porNombre) : false

  /*
   * Si el SKU no dice nada, la referencia del fabricante puede estar escrita
   * en el nombre. Sólo cuenta cuando confirma a la MISMA marca que el nombre
   * afirma: que «APEX EX-508-18» tenga una referencia que existe en el
   * catálogo APEX es identidad; que exista en otro catálogo es una
   * coincidencia de numeración, y ahí no se elige nada.
   */
  if (marcas.size === 0 && porNombre && !soloCompatible) {
    for (const ref of referenciasEnNombre(p.name)) {
      for (const [fuente, mapa] of [['erp', idx.porRefErp], ['legacy', idx.porRefLegacy]]) {
        const hit = mapa.get(ref)
        if (!hit) continue
        for (const m of hit.marcas) {
          if (normRef(m) !== normRef(porNombre)) continue
          const prev = marcas.get(m) ?? { evidencia: [], tipo: 'EXACT_MATCH_MODEL' }
          prev.evidencia.push(`${fuente}:referencia-en-nombre=${ref}→${hit.ejemplo}`)
          marcas.set(m, prev)
        }
      }
    }
  }

  if (marcas.size > 1) {
    return {
      clase: 'MULTIPLE_CANDIDATES',
      marca: null,
      candidatas: [...marcas.keys()],
      evidencia: [...marcas.values()].flatMap((v) => v.evidencia).slice(0, 4).join(' · '),
    }
  }

  if (marcas.size === 1) {
    const [m, v] = [...marcas.entries()][0]
    // El nombre dice una marca y la referencia dice otra: no se elige, se avisa.
    if (porNombre && !soloCompatible && normRef(porNombre) !== normRef(m)) {
      return {
        clase: 'CONFLICT',
        marca: null,
        candidatas: [m, porNombre],
        evidencia: `referencia dice ${m}; el nombre empieza con ${porNombre} · ${v.evidencia[0]}`,
      }
    }
    return { clase: v.tipo, marca: m, candidatas: [m], evidencia: v.evidencia.slice(0, 3).join(' · ') }
  }

  if (porNombre && !soloCompatible) {
    return {
      clase: 'HIGH_CONFIDENCE_NAME_ONLY',
      marca: null,
      candidatas: [porNombre],
      evidencia: `el nombre empieza con «${porNombre}» y no hay ninguna referencia que lo confirme`,
    }
  }

  return { clase: 'NO_MATCH', marca: null, candidatas: [], evidencia: soloCompatible ? 'el nombre menciona una marca como compatibilidad, no como fabricante' : '' }
}

/** Índice de referencia → marcas que la usan. Se arma una vez. */
export function indexar(conMarca, legacy) {
  const porRefErp = new Map()
  const porRefLegacy = new Map()
  const marcasConocidas = new Map()

  const sumar = (mapa, clave, marca, ejemplo) => {
    if (!clave || clave.length < 4 || !marca) return
    const e = mapa.get(clave) ?? { marcas: new Set(), ejemplo }
    e.marcas.add(marca)
    mapa.set(clave, e)
  }

  for (const p of conMarca) {
    const marca = p.brands?.name
    if (!marca) continue
    marcasConocidas.set(normRef(marca), marca)
    sumar(porRefErp, normRef(p.sku), marca, p.sku)
    sumar(porRefErp, sinPrefijo(p.sku), marca, p.sku)
    sumar(porRefErp, normRef(p.model_code), marca, p.sku)
    sumar(porRefErp, sinPrefijo(p.model_code), marca, p.sku)
  }
  for (const l of legacy) {
    if (!l.marca) continue
    marcasConocidas.set(normRef(l.marca), String(l.marca).toUpperCase())
    sumar(porRefLegacy, normRef(l.sku), String(l.marca).toUpperCase(), l.sku)
    sumar(porRefLegacy, sinPrefijo(l.sku), String(l.marca).toUpperCase(), l.sku)
    sumar(porRefLegacy, normRef(l.base), String(l.marca).toUpperCase(), l.sku)
  }
  return { porRefErp, porRefLegacy, marcasConocidas }
}

function contar(filas, clave) {
  const m = new Map()
  for (const f of filas) m.set(clave(f), (m.get(clave(f)) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

async function main() {
  const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null)
  const BASE = process.env.VITE_SUPABASE_URL
  const SECRET = process.env.SUPABASE_SECRET_KEY
  if (!BASE || !SECRET) throw new Error('Faltan VITE_SUPABASE_URL y SUPABASE_SECRET_KEY')
  const sb = createClient(BASE, SECRET, { auth: { persistSession: false } })

  const legacy = await leerLegacy()
  const todos = await leerProductos(sb)
  const conMarca = todos.filter((p) => p.brand_id)
  const sinMarca = todos.filter((p) => !p.brand_id)
  const idx = indexar(conMarca, legacy)

  const analizados = sinMarca.map((p) => ({ ...clasificar(p, idx), id: p.id, sku: p.sku, name: p.name, modelo: p.model_code, status: p.status }))

  // ── Duplicados contra productos que YA tienen marca (§10) ───────────────
  const porRefConMarca = new Map()
  for (const p of conMarca) {
    for (const k of [normRef(p.sku), sinPrefijo(p.sku)]) {
      if (k.length < 4) continue
      porRefConMarca.set(k, [...(porRefConMarca.get(k) ?? []), p])
    }
  }
  /*
   * La sorpresa de esta auditoría: los productos «sin marca» que se pueden
   * identificar NO son productos a los que les falta la marca. Son el MISMO
   * producto cargado dos veces — una por el catálogo técnico
   * (`AP.EX-508-18`) y otra por la API de STEL (`PRO00249`) —, y la evidencia
   * que demuestra la marca es, literalmente, el otro producto.
   *
   * Por eso el duplicado se cuenta con la misma evidencia que la
   * clasificación, y no comparando SKU contra SKU: el SKU es justamente lo
   * único que NO comparten.
   */
  const duplicados = { exactos: [], posibles: [] }
  for (const a of analizados) {
    const contra = [...a.evidencia.matchAll(/→([^\s·]+)/g)].map((m) => m[1])
    if (contra.length === 0) continue
    const lista = { sku: a.sku, nombre: (a.name ?? '').slice(0, 45), marca: a.marca, contra: [...new Set(contra)] }
    if (a.clase === 'EXACT_MATCH_SAME_SKU') duplicados.exactos.push(lista)
    else if (a.clase === 'EXACT_MATCH_MODEL') duplicados.posibles.push(lista)
  }

  // ── El caso APEX (§6) ───────────────────────────────────────────────────
  const mencionanApex = sinMarca.filter((p) => /APEX/i.test(p.name ?? '') || /APEX/i.test(p.sku ?? ''))
  const apex = {
    UNBRANDED_APEX_TEXT: mencionanApex.length,
    EXACT_APEX_BY_SKU: 0,
    EXACT_APEX_BY_MODEL: 0,
    AMBIGUOUS_APEX: 0,
    NOT_ACTUALLY_APEX: 0,
    detalle: [],
  }
  for (const p of mencionanApex) {
    const c = analizados.find((a) => a.id === p.id)
    const esApex = (c.marca ?? '').toUpperCase() === 'APEX'
    if (c.clase === 'EXACT_MATCH_SAME_SKU' && esApex) apex.EXACT_APEX_BY_SKU++
    else if (c.clase === 'EXACT_MATCH_MODEL' && esApex) apex.EXACT_APEX_BY_MODEL++
    else if (c.clase === 'MULTIPLE_CANDIDATES' || c.clase === 'CONFLICT') apex.AMBIGUOUS_APEX++
    else apex.NOT_ACTUALLY_APEX++
    if (apex.detalle.length < 12) apex.detalle.push({ sku: p.sku, name: (p.name ?? '').slice(0, 58), clase: c.clase, marca: c.marca, evidencia: c.evidencia.slice(0, 70) })
  }

  // ── Discontinuados (§13) ────────────────────────────────────────────────
  const descon = todos.filter((p) => p.status === 'discontinued')
  const refsLegacy = new Set(legacy.map((l) => normRef(l.sku)))
  const { data: usados } = await sb
    .from('sales_quote_lines')
    .select('product_id')
    .in('product_id', descon.map((p) => p.id))
  const conDocumentos = new Set((usados ?? []).map((u) => u.product_id))
  const discontinued = {
    total: descon.length,
    en_legacy: descon.filter((p) => refsLegacy.has(normRef(p.legacy_ref ?? p.sku))).length,
    con_documentos: descon.filter((p) => conDocumentos.has(p.id)).length,
    con_marca: descon.filter((p) => p.brand_id).length,
    evidencia_oficial: 0, // no se consultó ningún fabricante en esta corrida
  }

  const informe = {
    generado: new Date().toISOString(),
    UNBRANDED_TOTAL: sinMarca.length,
    POR_CLASE: Object.fromEntries(CLASES.map((c) => [c, analizados.filter((a) => a.clase === c).length])),
    TOP_UNBRANDED_CANDIDATE_BRANDS: contar(
      analizados.filter((a) => a.marca ?? a.candidatas[0]),
      (a) => a.marca ?? a.candidatas[0],
    )
      .slice(0, 20)
      .map(([marca, n]) => {
        const f = analizados.filter((a) => (a.marca ?? a.candidatas[0]) === marca)
        return {
          marca,
          total: n,
          exactos: f.filter((a) => a.clase.startsWith('EXACT')).length,
          solo_nombre: f.filter((a) => a.clase === 'HIGH_CONFIDENCE_NAME_ONLY').length,
          ambiguos: f.filter((a) => a.clase === 'MULTIPLE_CANDIDATES' || a.clase === 'CONFLICT').length,
        }
      }),
    APEX: apex,
    EXACT_DUPLICATES: duplicados.exactos.length,
    POSSIBLE_DUPLICATES: duplicados.posibles.length,
    DUPLICADOS_EJEMPLO: duplicados.exactos.slice(0, 5).concat(duplicados.posibles.slice(0, 5)),
    DISCONTINUED_AUDIT: discontinued,
    DB_CHANGES_APPLIED: 0,
    PRODUCTS_CHANGED: 0,
  }

  const proponibles = analizados.filter((a) => a.clase.startsWith('EXACT') && a.marca)
  informe.PROPOSED_BRAND_ASSIGNMENTS = proponibles.length
  informe.MANUAL_REVIEW_REQUIRED = analizados.length - proponibles.length

  console.log(JSON.stringify(informe, null, 2))

  const salidaJson = arg('--json')
  const salidaCsv = arg('--csv')
  if (salidaJson) writeFileSync(salidaJson, JSON.stringify({ informe, analizados }, null, 2))
  if (salidaCsv) {
    const cols = ['product_id', 'sku', 'name', 'current_brand', 'proposed_brand', 'match_type', 'legacy_reference', 'official_reference', 'confidence', 'evidence', 'reason']
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const filas = analizados.map((a) => ({
      product_id: a.id,
      sku: a.sku,
      name: a.name,
      current_brand: '',
      proposed_brand: a.clase.startsWith('EXACT') ? (a.marca ?? '') : '',
      match_type: a.clase,
      legacy_reference: /legacy:/.test(a.evidencia) ? a.evidencia : '',
      official_reference: '',
      confidence: a.clase.startsWith('EXACT') ? 'HIGH' : a.clase === 'HIGH_CONFIDENCE_NAME_ONLY' ? 'LOW' : 'NONE',
      evidence: a.evidencia,
      reason:
        a.clase === 'HIGH_CONFIDENCE_NAME_ONLY'
          ? 'sólo el texto del nombre; NO alcanza para asignar (§9)'
          : a.clase === 'MULTIPLE_CANDIDATES'
            ? `más de una marca posible: ${a.candidatas.join(' / ')}`
            : a.clase === 'CONFLICT'
              ? 'la referencia y el nombre dicen marcas distintas'
              : a.clase === 'NO_MATCH'
                ? 'ninguna referencia ni nombre permite identificar marca'
                : 'referencia idéntica a la de un producto con esa marca',
    }))
    writeFileSync(salidaCsv, [cols.join(','), ...filas.map((f) => cols.map((c) => esc(f[c])).join(','))].join('\n'))
    console.error(`\n${filas.length} filas → ${salidaCsv}. NO aplicadas.`)
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
