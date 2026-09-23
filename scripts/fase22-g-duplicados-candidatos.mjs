/**
 * Fase 22 · Duplicados — revisión de los 92 candidatos, uno por uno.
 *
 * De dónde salen los 92: de `docs/fase22-e3-duplicados-stel.csv`, congelado en
 * la auditoría anterior. Son las filas `PAR_1_A_1` con decisión «retirar el de
 * STEL» — es decir, pares 1:1 en los que el registro del catálogo técnico
 * tiene más ficha y el de STEL no tiene stock. **El archivo es la lista; acá
 * no se vuelve a buscar candidatos.** Si se recalcularan, la lista que revisa
 * Juan y la que aplicaría la migración podrían no ser la misma.
 *
 * Esto NO aplica nada. Lee, cruza, clasifica y escribe un CSV revisable.
 *
 *   node scripts/fase22-g-duplicados-candidatos.mjs [--csv out.csv] [--json out.json]
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'
import { normRef, sinPrefijo, referenciasEnNombre } from './fase22-c-auditoria-sin-marca.mjs'

const ORIGEN = 'docs/fase22-e3-duplicados-stel.csv'

/** Un CSV con comillas dobles, sin dependencias. */
export function leerCsv(texto) {
  const lineas = texto.replace(/\r\n/g, '\n').trim().split('\n')
  const parse = (l) => {
    const out = []
    let campo = ''
    let entre = false
    for (let i = 0; i < l.length; i++) {
      const c = l[i]
      if (entre) {
        if (c === '"') {
          if (l[i + 1] === '"') { campo += '"'; i++ } else entre = false
        } else campo += c
      } else if (c === '"') entre = true
      else if (c === ',') { out.push(campo); campo = '' }
      else campo += c
    }
    out.push(campo)
    return out
  }
  const cols = parse(lineas[0])
  return lineas.slice(1).map((l) => Object.fromEntries(parse(l).map((v, i) => [cols[i], v])))
}

// ── Las reglas de §5, cada una por separado ────────────────────────────────

/**
 * Palabras que dicen «esto es una PARTE de aquello», no «esto es aquello».
 *
 * Es el error que ya cometimos una vez: `RV.RIV504` es la remachadora y las 94
 * filas que la nombraban eran sus repuestos («RIV504 JAWS Cod.1249200»).
 * Fusionar un repuesto con su máquina borra el repuesto del catálogo y deja
 * pedidos futuros apuntando a la máquina entera.
 */
export const PALABRAS_DE_PARTE = [
  'REPUESTO', 'REPUESTOS', 'KIT DE', 'JUEGO DE', 'JAWS', 'MORDAZA', 'MORDAZAS',
  'BOQUILLA', 'BOQUILLAS', 'RESORTE', 'ORING', 'O-RING', 'RETEN', 'RETÉN',
  'EMPAQUE', 'JUNTA', 'FILTRO', 'CARBONES', 'ESCOBILLA', 'ESCOBILLAS',
  'ROTOR', 'ESTATOR', 'RODAMIENTO', 'RULEMAN', 'TORNILLERIA', 'ACCESORIO',
  'ADAPTADOR PARA', 'SOPORTE PARA', 'FUNDA', 'ESTUCHE',
]

/**
 * «PARA», «P/» y «COMPATIBLE CON» son señal BLANDA.
 *
 * «CARGADOR PARA BATERIAS 20V» no dice que el cargador sea parte de la
 * batería: dice para qué sirve. Es su propia descripción. Por eso esta lista
 * manda a revisar y no descarta, mientras que un sustantivo de repuesto
 * —JAWS, MORDAZA, REPUESTO— sí descarta.
 */
const SUBORDINA = /\b(PARA|P\/|COMPATIBLE|APLICA A|APTO PARA|SE USA EN)\b/

/**
 * ¿El SKU declara que el producto es un repuesto?
 *
 * `FM.REP.BC12_ST` lo dice en el segundo segmento. El nombre no lo dice —«FIAM
 * ARM BC12 SISTEMA TELESCOPICO»— así que mirando sólo el nombre el par pasaba
 * como bueno contra «FIAM ARM BC12 BRAZO DE REACCION», que es otra cosa.
 *
 * Se exige que `REP` sea un segmento entero, no una subcadena: si no,
 * cualquier part number que contenga esas tres letras quedaría marcado.
 */
export function repuestoEnSku(sku) {
  const s = String(sku ?? '').toUpperCase()
  return /(^|[._\-/])REP([._\-/]|$)/.test(s) ? 'REP en el SKU' : null
}

/**
 * ¿Alguno de los dos nombres dice ser parte del otro?
 *
 * Se mira en los DOS sentidos: da lo mismo cuál de los dos registros describa
 * el repuesto, el par es igualmente inseguro. Devuelve la dureza de la señal,
 * porque no todas pesan lo mismo: `RIV503 JAWS` contra `RIV503 REMACHADORA`
 * es exactamente el error que ya cometimos, y `CARGADOR PARA BATERIAS` no.
 */
export function pareceParteDelOtro(nombreA, nombreB) {
  const a = String(nombreA ?? '').toUpperCase()
  const b = String(nombreB ?? '').toUpperCase()
  for (const t of [a, b]) {
    const p = PALABRAS_DE_PARTE.find((x) => t.includes(x))
    if (p) return { palabra: p, dureza: 'dura' }
  }
  for (const t of [a, b]) {
    if (SUBORDINA.test(t)) return { palabra: 'PARA/COMPATIBLE', dureza: 'blanda' }
  }
  return null
}

/**
 * Las medidas que el nombre declara.
 *
 * Dos registros del mismo producto pueden escribirse distinto, pero no pueden
 * decir 20V uno y 12V el otro. Esto extrae los números CON unidad para poder
 * compararlos; los números sueltos no cuentan, porque un correlativo o un
 * part number los tiene a montones.
 */
export function medidasDelNombre(nombre) {
  const t = String(nombre ?? '').toUpperCase().replace(/,/g, '.')
  const out = new Set()
  const U = 'V|AH|MM|CM|KG|NM|W|RPM|BAR|PSI'
  // «DE 6 A 14 NM»: el primer número no lleva unidad, pero ES una medida. Sin
  // esto el rango se leía como un solo valor —14— y un par idéntico salía
  // contradictorio contra «DE 6 NM A 12 NM».
  for (const m of t.matchAll(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:A|-|–|HASTA)\\s*(\\d+(?:\\.\\d+)?)\\s*(${U})\\b`, 'g'))) {
    out.add(`${Number(m[1])}${m[3]}`)
    out.add(`${Number(m[2])}${m[3]}`)
  }
  for (const m of t.matchAll(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${U})\\b`, 'g'))) {
    out.add(`${Number(m[1])}${m[2]}`)
  }
  return [...out].sort()
}

/**
 * ¿Las medidas de los dos nombres se contradicen?
 *
 * Contradicción es que los dos declaren la MISMA unidad en rangos que **no se
 * tocan**. Comparar valor contra valor no sirve: casi todos estos nombres
 * declaran un rango, y lo declaran distinto.
 *
 *   «PISTOLA DE 6 A 14 NM»  vs  «DE 6 NM A 12 NM»
 *
 * Es el mismo modelo con la especificación escrita de dos maneras, no dos
 * productos. Comparando valores sueltos daba contradicción —14 no está en
 * {6,12}— y así se caían 8 pares buenos. Comparando intervalos, [6,14] y
 * [6,12] se solapan y no hay nada que reportar.
 *
 * Que uno diga «20V» y el otro no diga nada tampoco es contradicción: es que
 * uno está menos descrito. Y un hueco de 1 Nm entre 271 y 270 tampoco: para
 * que cuente, los rangos tienen que separarse más de un 10 %.
 */
const HUECO_MINIMO = 0.1

export function medidasSeContradicen(nombreA, nombreB) {
  const rangos = (n) => {
    const m = new Map()
    for (const x of medidasDelNombre(n)) {
      const u = x.replace(/^[\d.]+/, '')
      const v = Number(x.slice(0, x.length - u.length))
      const r = m.get(u) ?? { min: v, max: v }
      m.set(u, { min: Math.min(r.min, v), max: Math.max(r.max, v) })
    }
    return m
  }
  const a = rangos(nombreA)
  const b = rangos(nombreB)
  for (const [u, ra] of a) {
    const rb = b.get(u)
    if (!rb) continue
    const hueco = ra.max < rb.min ? rb.min - ra.max : rb.max < ra.min ? ra.min - rb.max : 0
    if (hueco === 0) continue
    const escala = Math.max(ra.max, rb.max)
    if (escala > 0 && hueco / escala <= HUECO_MINIMO) continue
    return `${u}: ${ra.min}–${ra.max} vs ${rb.min}–${rb.max}`
  }
  return null
}

/**
 * Sobre qué evidencia se apoya el par.
 *
 * Devuelve la base MÁS dura que se pueda demostrar, y null si ninguna: un par
 * sin base demostrable no se fusiona por más que la ficha del canónico sea
 * mejor.
 */
export function baseDelCruce(dup, canon) {
  const refCanon = new Set([sinPrefijo(canon.sku), normRef(canon.model_code)].filter((x) => x.length >= 4))
  if (refCanon.has(sinPrefijo(dup.sku))) return 'sku_identico_sin_prefijo'
  if (normRef(dup.model_code).length >= 4 && refCanon.has(normRef(dup.model_code))) return 'model_code_identico'
  const enNombre = referenciasEnNombre(dup.name).filter((r) => refCanon.has(r))
  if (enNombre.length > 0) return 'referencia_en_el_nombre'
  return null
}

/** El part number del fabricante que se pudo leer en el duplicado. */
export function partNumberDetectado(dup, canon) {
  const refCanon = new Set([sinPrefijo(canon.sku), normRef(canon.model_code)].filter((x) => x.length >= 4))
  if (refCanon.has(sinPrefijo(dup.sku))) return sinPrefijo(dup.sku)
  if (refCanon.has(normRef(dup.model_code))) return normRef(dup.model_code)
  return referenciasEnNombre(dup.name).find((r) => refCanon.has(r)) ?? null
}

/** Cuántas señales de ficha técnica tiene un producto. */
export function riquezaTecnica(p) {
  if (!p) return 0
  const attrs = p.attributes && typeof p.attributes === 'object' ? Object.keys(p.attributes).length : 0
  return (
    (p.brand_id ? 2 : 0) + (attrs > 0 ? 2 : 0) + (p.series ? 1 : 0) +
    (p.product_type ? 1 : 0) + ((p.product_images ?? []).length > 0 ? 2 : 0) +
    (p.description_long ? 1 : 0) + (p.ncm_code ? 1 : 0)
  )
}

/** `null` = sin saldo registrado, que NO es cero (Fase 21 · E3.1). */
export function stockDe(p) {
  const filas = p?.stock_balances ?? []
  if (filas.length === 0) return null
  return filas.reduce(
    (a, f) => ({ real: a.real + f.on_hand, virtual: a.virtual + (f.on_hand - f.reserved) }),
    { real: 0, virtual: 0 },
  )
}

/** ¿El canónico tiene hoja de catálogo? (`lib/hojaCatalogo.ts`, las dos fuentes) */
export function tieneHojaDeCatalogo(p) {
  if ((p?.product_images ?? []).some((i) => i.kind === 'shared_diagram')) return true
  const a = p?.attributes ?? {}
  return Boolean(a.catalogo_id && a.catalogo_pagina)
}

/**
 * La clasificación de §5.
 *
 * SAFE_TO_MERGE es el único que la migración va a mirar, así que sus
 * condiciones son todas necesarias. El stock NO descalifica —lo pidió Juan
 * explícitamente— pero sube el riesgo y queda a la vista.
 */
export function clasificar({ dup, canon, duplicadosDelCanonico, docsDup, stockDup }) {
  const duras = []
  const blandas = []

  if (!dup || !canon) return { clase: 'DO_NOT_MERGE', riesgo: 'alto', confianza: 0, razones: ['falta un lado del par'] }

  // 1:1. Si el canónico recibe varios, es el patrón repuesto→máquina.
  if (duplicadosDelCanonico > 1) duras.push(`el canónico absorbe ${duplicadosDelCanonico} duplicados: no es 1:1`)

  // Mismo producto demostrado.
  const base = baseDelCruce(dup, canon)
  if (!base) duras.push('no hay referencia común demostrable entre los dos registros')

  // No es un repuesto de.
  const parte = pareceParteDelOtro(dup.name, canon.name)
  if (parte?.dureza === 'dura') duras.push(`un nombre es de un repuesto/accesorio («${parte.palabra}»)`)
  else if (parte) blandas.push(`un nombre dice «${parte.palabra}»: verificar que no sea un accesorio`)

  // Y el SKU también habla. Que UNO solo de los dos se declare repuesto es la
  // señal: si los dos lo hacen, son dos repuestos y el par sigue en pie.
  const repDup = repuestoEnSku(dup.sku)
  const repCanon = repuestoEnSku(canon.sku)
  if (Boolean(repDup) !== Boolean(repCanon)) {
    duras.push(`sólo uno de los dos se declara repuesto (${repDup ?? repCanon})`)
  }

  // Medidas que no coinciden.
  //
  // Esto NO descarta el par, y la distinción importa: el part number del
  // fabricante es el mismo en los dos registros, así que una medida distinta
  // en el texto libre prueba que una de las dos fichas está mal escrita, no
  // que sean dos productos. Lo que hace falta es que alguien la mire — que es
  // exactamente lo que significa REVIEW.
  const choque = medidasSeContradicen(dup.name, canon.name)
  if (choque) blandas.push(`mismo part number pero las medidas del texto no coinciden (${choque}): una de las dos fichas está mal`)

  if (dup.brand_id && canon.brand_id && dup.brand_id !== canon.brand_id) {
    duras.push('los dos tienen marca y son marcas distintas')
  }

  // El canónico tiene que ser el registro mejor.
  const rDup = riquezaTecnica(dup)
  const rCanon = riquezaTecnica(canon)
  if (rCanon <= rDup) duras.push(`el canónico no tiene mejor ficha (${rCanon} vs ${rDup})`)
  if (canon.status !== 'active') duras.push(`el canónico no está activo (status=${canon.status})`)

  const conStock = stockDup !== null && (stockDup.real !== 0 || stockDup.virtual !== 0)
  const razones = [...duras, ...blandas]
  const riesgo = duras.length > 0 ? 'alto' : blandas.length > 0 ? 'medio' : conStock ? 'medio' : docsDup > 0 ? 'bajo-con-historia' : 'bajo'

  if (razones.length > 0) {
    return { clase: duras.length > 0 ? 'DO_NOT_MERGE' : 'REVIEW', riesgo, confianza: 0, razones, base }
  }

  // Confianza: la base del cruce manda; la ficha del canónico la refuerza.
  const porBase = { sku_identico_sin_prefijo: 0.9, model_code_identico: 0.85, referencia_en_el_nombre: 0.75 }[base]
  const confianza = Math.min(0.99, porBase + (rCanon >= 6 ? 0.05 : 0) + (canon.brand_id ? 0.03 : 0))
  return {
    clase: 'SAFE_TO_MERGE',
    riesgo,
    confianza: Number(confianza.toFixed(2)),
    base,
    razones: [
      `1:1; ${base}; el canónico tiene mejor ficha (${rCanon} vs ${rDup}) y está activo`,
      conStock ? 'ATENCIÓN: el duplicado tiene saldo de stock' : 'el duplicado no tiene saldo de stock',
      docsDup > 0 ? `${docsDup} línea(s) histórica(s) lo nombran` : 'sin historia comercial',
    ],
  }
}

// ── Lectura ────────────────────────────────────────────────────────────────

const COLUMNAS = `
  id, sku, name, model_code, status, attributes, series, product_type,
  description_long, ncm_code, brand_id, category_id, external_source,
  brands ( name, is_active ),
  product_images ( id, kind ),
  stock_balances ( on_hand, reserved )
`

async function porSkus(sb, skus) {
  const filas = []
  for (let i = 0; i < skus.length; i += 200) {
    const { data, error } = await sb.from('products').select(COLUMNAS).in('sku', skus.slice(i, i + 200)).is('deleted_at', null)
    if (error) throw new Error(error.message)
    filas.push(...(data ?? []))
  }
  return new Map(filas.map((f) => [f.sku, f]))
}

/** Las líneas históricas de cada producto, con el estado de su snapshot. */
async function lineas(sb, ids) {
  const vacio = () => ({ cotizaciones: 0, pedidos: 0, remitos: 0, conSnapshot: 0, sinSnapshot: 0 })
  const cuenta = new Map(ids.map((id) => [id, vacio()]))
  const tablas = [['sales_quote_lines', 'cotizaciones'], ['sales_order_lines', 'pedidos'], ['delivery_lines', 'remitos']]
  for (const [tabla, clave] of tablas) {
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await sb
        .from(tabla)
        .select('product_id, sku_snapshot, name_snapshot')
        .in('product_id', ids.slice(i, i + 200))
      if (error) throw new Error(`${tabla}: ${error.message}`)
      for (const r of data ?? []) {
        const c = cuenta.get(r.product_id)
        if (!c) continue
        c[clave]++
        const completo = Boolean(r.sku_snapshot?.trim()) && Boolean(r.name_snapshot?.trim())
        if (completo) c.conSnapshot++
        else c.sinSnapshot++
      }
    }
  }
  return cuenta
}

const COLS_CSV = [
  'duplicate_product_id', 'duplicate_sku', 'duplicate_name', 'duplicate_brand', 'duplicate_status',
  'canonical_product_id', 'canonical_sku', 'canonical_name', 'canonical_brand', 'canonical_status',
  'match_basis', 'manufacturer_part_number_detected', 'technical_model_detected',
  'duplicate_stock_real', 'duplicate_stock_virtual',
  'duplicate_quote_lines', 'duplicate_order_lines', 'duplicate_delivery_lines',
  'canonical_stock_real', 'canonical_stock_virtual',
  'canonical_has_attributes', 'canonical_attribute_count', 'canonical_has_image', 'canonical_has_catalog_page',
  'risk', 'confidence', 'reason', 'recommended_action',
]

async function main() {
  const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null)
  const BASE = process.env.VITE_SUPABASE_URL
  const SECRET = process.env.SUPABASE_SECRET_KEY
  if (!BASE || !SECRET) throw new Error('Faltan VITE_SUPABASE_URL y SUPABASE_SECRET_KEY')
  const sb = createClient(BASE, SECRET, { auth: { persistSession: false } })

  const todas = leerCsv(readFileSync(ORIGEN, 'utf8'))
  const candidatos = todas.filter((f) => f.clase === 'PAR_1_A_1' && f.decision_propuesta === 'retirar el de STEL')

  const skus = [...new Set(candidatos.flatMap((c) => [c.stel_sku, c.canonico_sku]))]
  const porSku = await porSkus(sb, skus)
  const ids = [...porSku.values()].map((p) => p.id)
  const hist = await lineas(sb, ids)

  // Cuántos duplicados apunta cada canónico, dentro de ESTA lista.
  const porCanonico = new Map()
  for (const c of candidatos) porCanonico.set(c.canonico_sku, (porCanonico.get(c.canonico_sku) ?? 0) + 1)

  const vacio = { cotizaciones: 0, pedidos: 0, remitos: 0, conSnapshot: 0, sinSnapshot: 0 }
  const filas = candidatos.map((c) => {
    const dup = porSku.get(c.stel_sku) ?? null
    const canon = porSku.get(c.canonico_sku) ?? null
    const h = (dup && hist.get(dup.id)) || vacio
    const hc = (canon && hist.get(canon.id)) || vacio
    const sDup = stockDe(dup)
    const sCanon = stockDe(canon)
    const docsDup = h.cotizaciones + h.pedidos + h.remitos
    const r = clasificar({
      dup, canon,
      duplicadosDelCanonico: porCanonico.get(c.canonico_sku) ?? 1,
      docsDup, stockDup: sDup,
    })
    const attrs = canon?.attributes && typeof canon.attributes === 'object' ? Object.keys(canon.attributes).length : 0
    return {
      duplicate_product_id: dup?.id ?? '', duplicate_sku: c.stel_sku,
      duplicate_name: dup?.name ?? c.stel_nombre, duplicate_brand: dup?.brands?.name ?? '',
      duplicate_status: dup?.status ?? '',
      canonical_product_id: canon?.id ?? '', canonical_sku: c.canonico_sku,
      canonical_name: canon?.name ?? c.canonico_nombre, canonical_brand: canon?.brands?.name ?? '',
      canonical_status: canon?.status ?? '',
      match_basis: r.base ?? 'sin_base_demostrable',
      manufacturer_part_number_detected: dup && canon ? (partNumberDetectado(dup, canon) ?? '') : '',
      technical_model_detected: canon?.model_code ?? '',
      duplicate_stock_real: sDup === null ? 'sin saldo registrado' : sDup.real,
      duplicate_stock_virtual: sDup === null ? 'sin saldo registrado' : sDup.virtual,
      duplicate_quote_lines: h.cotizaciones, duplicate_order_lines: h.pedidos, duplicate_delivery_lines: h.remitos,
      canonical_stock_real: sCanon === null ? 'sin saldo registrado' : sCanon.real,
      canonical_stock_virtual: sCanon === null ? 'sin saldo registrado' : sCanon.virtual,
      canonical_has_attributes: attrs > 0 ? 'si' : 'no', canonical_attribute_count: attrs,
      canonical_has_image: (canon?.product_images ?? []).length > 0 ? 'si' : 'no',
      canonical_has_catalog_page: tieneHojaDeCatalogo(canon) ? 'si' : 'no',
      risk: r.riesgo, confidence: r.confianza, reason: r.razones.join(' · '),
      recommended_action: r.clase,
      _snapshot: { con: h.conSnapshot, sin: h.sinSnapshot },
      _docsCanon: hc.cotizaciones + hc.pedidos + hc.remitos,
    }
  })

  const de = (clase) => filas.filter((f) => f.recommended_action === clase)
  const conStock = (f) => f.duplicate_stock_real !== 'sin saldo registrado' && (f.duplicate_stock_real !== 0 || f.duplicate_stock_virtual !== 0)
  const safe = de('SAFE_TO_MERGE')
  const review = de('REVIEW')
  const lineasDe = (arr) => arr.reduce((n, f) => n + f.duplicate_quote_lines + f.duplicate_order_lines + f.duplicate_delivery_lines, 0)

  const informe = {
    generado: new Date().toISOString(),
    ORIGEN,
    CANDIDATES_REVIEWED: filas.length,
    SAFE_TO_MERGE: safe.length,
    REVIEW: review.length,
    DO_NOT_MERGE: de('DO_NOT_MERGE').length,
    SAFE_WITH_STOCK: safe.filter(conStock).length,
    SAFE_WITHOUT_STOCK: safe.filter((f) => !conStock(f)).length,
    REVIEW_WITH_STOCK: review.filter(conStock).length,
    HISTORICAL_LINES_AFFECTED: lineasDe(filas),
    HISTORICAL_LINES_WITH_COMPLETE_SNAPSHOT: filas.reduce((n, f) => n + f._snapshot.con, 0),
    HISTORICAL_LINES_WITHOUT_COMPLETE_SNAPSHOT: filas.reduce((n, f) => n + f._snapshot.sin, 0),
    HISTORICAL_LINES_DE_LOS_SAFE: lineasDe(safe),
    CANONICAL_WITH_TECH_DATA: safe.filter((f) => f.canonical_has_attributes === 'si').length,
    CANONICAL_WITH_IMAGE: safe.filter((f) => f.canonical_has_image === 'si').length,
    CANONICAL_WITH_CATALOG_PAGE: safe.filter((f) => f.canonical_has_catalog_page === 'si').length,
    CANONICOS_DE_MARCA_INACTIVA: safe.filter((f) => {
      const canon = porSku.get(f.canonical_sku)
      return canon?.brand_id && canon?.brands && !canon.brands.is_active
    }).length,
    /*
     * El efecto que hay que mirar antes de aplicar (§13).
     *
     * Hoy el duplicado de STEL no tiene marca, y un producto sin marca no
     * tiene quién lo oculte: está VISIBLE en el catálogo. Su canónico, en
     * cambio, es de una marca desactivada y NO se ve. Retirar el duplicado
     * hace desaparecer el producto del catálogo, no lo reemplaza por otro.
     * Es coherente con haber desactivado la marca —Juan ya lo dijo— pero es
     * un número que tiene que estar a la vista antes de apretar el botón.
     */
    SAFE_QUE_DESAPARECEN_DEL_CATALOGO: safe.filter((f) => {
      const dup = porSku.get(f.duplicate_sku)
      const canon = porSku.get(f.canonical_sku)
      const dupVisible = !dup?.brand_id || dup?.brands?.is_active
      const canonVisible = !canon?.brand_id || canon?.brands?.is_active
      return dupVisible && !canonVisible
    }).length,
    SAFE_QUE_SIGUEN_VISIBLES_POR_EL_CANONICO: safe.filter((f) => {
      const canon = porSku.get(f.canonical_sku)
      return !canon?.brand_id || canon?.brands?.is_active
    }).length,
    MOTIVOS_DE_REVIEW: Object.fromEntries(
      Object.entries(review.reduce((m, f) => ({ ...m, [f.reason]: (m[f.reason] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]),
    ),
    MOTIVOS_DE_DO_NOT_MERGE: Object.fromEntries(
      Object.entries(de('DO_NOT_MERGE').reduce((m, f) => ({ ...m, [f.reason]: (m[f.reason] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]),
    ),
    DB_CHANGES_APPLIED: 0,
    PRODUCTS_CHANGED: 0,
    STOCK_CHANGED: 0,
  }
  console.log(JSON.stringify(informe, null, 2))

  const salidaCsv = arg('--csv')
  if (salidaCsv) {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    writeFileSync(salidaCsv, [COLS_CSV.join(','), ...filas.map((f) => COLS_CSV.map((c) => esc(f[c])).join(','))].join('\n'))
    console.error(`\n${filas.length} candidatos → ${salidaCsv}. NADA aplicado.`)
  }
  const salidaJson = arg('--json')
  if (salidaJson) writeFileSync(salidaJson, JSON.stringify({ informe, filas }, null, 2))
}

const esteArchivo = import.meta.url.replace(/^file:\/\/\/?/, '').replace(/\\/g, '/').toLowerCase()
const invocado = String(process.argv[1] ?? '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
if (invocado && esteArchivo.endsWith(invocado)) {
  main().catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
}
