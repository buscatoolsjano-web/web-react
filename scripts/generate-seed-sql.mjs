/**
 * Genera el SQL de carga del dataset de prueba a partir del catálogo legacy.
 *
 * Uso: node scripts/generate-seed-sql.mjs <productos-data.json> <salida.sql>
 *
 * No toca Supabase: sólo escribe un archivo .sql.
 * Los ids se resuelven por lookup (slug/nombre), nunca hardcodeados.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const [, , src, out] = process.argv
if (!src || !out) { console.error('Uso: node scripts/generate-seed-sql.mjs <in.json> <out.sql>'); process.exit(1) }

// Reusar exactamente el mismo muestreo determinista
const muestraJson = '.tmp-sample.json'
execSync(`node scripts/sample-products.mjs "${src}" ${muestraJson}`, { stdio: 'pipe' })
const muestra = JSON.parse(readFileSync(muestraJson, 'utf8'))

const q = (v) => v === null || v === undefined || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`
const n = (v) => (typeof v === 'number' && Number.isFinite(v)) ? String(v) : 'NULL'
// `description_long` no se carga en el dataset de prueba: es texto de
// marketing de hasta 1.500 caracteres, ninguna de las 41 verificaciones lo
// usa, y era un tercio del seed. En la carga real de los 21.772 se migra.
const trunc = () => null

// La `description` del legacy suele ser un bloque MULTILÍNEA
// ("MARCA: X\nMODELO: Y\nENCASTRE: Z"). Para el dataset de prueba se
// normaliza a una sola línea de 90 caracteres. Dos motivos:
//  1. La búsqueda full-text pondera sku/name/model_code (pesos A y B) por
//     encima de description (peso C), así que ningún test cambia.
//  2. Sin saltos de línea el seed es mucho menos frágil de transportar.
// La carga real de los 21.772 productos migra el texto completo.
const desc1 = (v) => {
  if (typeof v !== 'string' || !v) return null
  const linea = v.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
  return linea.length > 90 ? linea.slice(0, 90) : linea
}
const vacio = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)

// Sólo estas claves están declaradas en product_attribute_definitions.
// Cualquier otra haría fallar el trigger de validación — a propósito.
const CLAVES = ['encastre','largo','medida','sufijos','min_kg','max_kg','longitud','carcasa',
  'rpm','torq_min','torq_max','voltaje','alimentacion','ergonomia','dim_caja','dim_balanceador',
  'eslinga','peso_kg','peso_embalado_kg','catalogo_id','catalogo_pagina','codigo',
  'longitud_raw','categoria_full','marca_disp','modelo']

const CAT_SLUG = { 'otros':'otros','punta':'punta','balanceador':'balanceador',
  'atornillador':'atornillador','accesorio':'accesorio','llave de impacto':'llave-de-impacto',
  'remachadora':'remachadora','llave dinamométrica':'llave-dinamometrica',
  'llave dinamometrica':'llave-dinamometrica' }

const L = []
L.push('-- Dataset de prueba — 216 productos reales del catálogo legacy.')
L.push('-- Generado por scripts/generate-seed-sql.mjs (determinista).')
L.push('-- Muestreo estratificado: incluye los casos difíciles a propósito.')
L.push('')
L.push('-- El trigger de validación de attributes hace una consulta por fila.')
L.push('-- En una carga masiva se desactiva y se valida al final de una sola vez.')
L.push('ALTER TABLE products DISABLE TRIGGER trg_products_validate_attrs;')
L.push('')

let conAttrs = 0, conStock = 0, conPrecio = 0, revisar = 0
const filas = []
for (const p of muestra) {
  const attrs = {}
  for (const k of CLAVES) if (!vacio(p[k])) attrs[k] = p[k]
  if (Object.keys(attrs).length) conAttrs++

  const slug = CAT_SLUG[p.cat] ?? 'otros'
  const sinMarca = vacio(p.marca)
  const sinPrecio = !(typeof p.pu === 'number' && p.pu > 0)
  const needsReview = sinMarca || sinPrecio || slug === 'otros'
  if (needsReview) revisar++
  if (!sinPrecio) conPrecio++
  if (Number(p.sr) > 0) conStock++

  filas.push(`  (${q(p.sku)}, ${q(p.nombre)}, ${q(p.base)}, ${q(p.marca)}, ${q(slug)}, ` +
    `${q(p.tipo)}, ${q(p.serie)}, ${q(desc1(p.desc))}, ${q(trunc(p.descl))}, ${q(p.origen)}, ${q(p.ncm)}, ` +
    `${n(p.peso_g)}, ${n(p.volumen_cm3)}, ${q(JSON.stringify(attrs))}::jsonb, ${needsReview}, ` +
    `${n(typeof p.pu === 'number' ? p.pu : null)}, ${n(Number(p.sr) > 0 ? Number(p.sr) : null)})`)
}

L.push('WITH datos (sku, name, model_code, marca, cat_slug, product_type, series,')
L.push('            description, description_long, origin_country, ncm_code,')
L.push('            weight_g, volume_cm3, attributes, needs_review, precio, stock) AS (')
L.push('  VALUES')
L.push(filas.join(',\n'))
L.push('),')
L.push('emp AS (SELECT id FROM companies WHERE slug = \'buscatools\')')
L.push('INSERT INTO products (company_id, sku, name, model_code, brand_id, category_id,')
L.push('                      product_type, series, description, description_long,')
L.push('                      origin_country, ncm_code, weight_g, volume_cm3,')
L.push('                      attributes, needs_review, legacy_ref)')
L.push('SELECT emp.id, d.sku, d.name, d.model_code,')
L.push('       b.id, cat.id,')
L.push('       d.product_type, d.series, d.description, d.description_long,')
L.push('       d.origin_country, d.ncm_code, d.weight_g, d.volume_cm3,')
L.push('       d.attributes, d.needs_review, d.sku')
L.push('FROM datos d')
L.push('CROSS JOIN emp')
L.push('LEFT JOIN brands b             ON b.company_id = emp.id AND b.name = d.marca')
L.push('JOIN product_categories cat    ON cat.company_id = emp.id AND cat.slug = d.cat_slug')
L.push('ON CONFLICT (company_id, sku) DO NOTHING;')
L.push('')
L.push('ALTER TABLE products ENABLE TRIGGER trg_products_validate_attrs;')
L.push('')

writeFileSync(out, L.join('\n'))
console.log('productos          :', muestra.length)
console.log('con attributes     :', conAttrs)
console.log('con precio (pu>0)  :', conPrecio)
console.log('con stock (sr>0)   :', conStock)
console.log('needs_review       :', revisar)
console.log('escrito            :', out, `(${(L.join('\n').length/1024).toFixed(0)} KB)`)
