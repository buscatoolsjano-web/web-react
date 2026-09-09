/**
 * Auditoría PRE-MIGRACIÓN del catálogo legacy.
 *
 * Lee productos-data.json del legacy (SOLO LECTURA, nunca lo modifica) y
 * produce el informe que decide qué se puede migrar y qué no.
 *
 * Regla: no inventa ni corrige datos. Lo que no mapea, lo reporta.
 *
 *   node scripts/audit-legacy-catalog.mjs <ruta-al-json> [--json salida.json]
 */
import { readFileSync, writeFileSync } from 'node:fs'

const RUTA = process.argv[2] ?? 'C:/Users/janog/AppData/Local/Temp/bta/legacy/productos-data.json'
const salidaJson = process.argv.includes('--json')
  ? process.argv[process.argv.indexOf('--json') + 1]
  : null

/** Las 26 claves declaradas en product_attribute_definitions. */
const CLAVES_DECLARADAS = new Set([
  'alimentacion', 'carcasa', 'catalogo_id', 'catalogo_pagina', 'categoria_full',
  'codigo', 'dim_balanceador', 'dim_caja', 'encastre', 'ergonomia', 'eslinga',
  'largo', 'longitud', 'longitud_raw', 'marca_disp', 'max_kg', 'medida',
  'min_kg', 'modelo', 'peso_embalado_kg', 'peso_kg', 'rpm', 'sufijos',
  'torq_max', 'torq_min', 'voltaje',
])

/** Campos que van a columnas propias de `products`, no a `attributes`. */
const COLUMNAS = new Set([
  'sku', 'nombre', 'base', 'marca', 'cat', 'tipo', 'serie', 'desc', 'descl',
  'origen', 'ncm', 'peso_g', 'volumen_cm3',
])

/** Metadatos del proceso de importación del legacy. NO son datos de negocio. */
const METADATOS = new Set([
  '_importOrigen', '_apexPageCatalog', '_apexFamilyTitle', '_apexEnriquecido',
])

/** Campos comerciales: se tratan aparte (precios y stock). */
const COMERCIALES = new Set(['pu', 'costo', 'precio_venta', 'fob_eur', 'sr', 'sv'])

/** Referencias a productos similares: no existen en el modelo de la Etapa 1. */
const SIMILARES = new Set(['sim_sp', 'sim_tc', 'sim_cp', 'sim_ir'])

const vacio = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function contarPor(arr, fn) {
  const m = new Map()
  for (const x of arr) {
    const k = fn(x)
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

function duplicados(arr, fn) {
  const m = new Map()
  for (const x of arr) {
    const k = fn(x)
    if (vacio(k)) continue
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1])
}

// ─────────────────────────────────────────────────────────────

const productos = JSON.parse(readFileSync(RUTA, 'utf8'))
const N = productos.length
const informe = {}
const pct = (n) => `${((100 * n) / N).toFixed(1)}%`

const H = (t) => console.log(`\n${'═'.repeat(66)}\n${t}\n${'═'.repeat(66)}`)
const fila = (etiqueta, valor, extra = '') =>
  console.log(`  ${String(etiqueta).padEnd(38)} ${String(valor).padStart(8)} ${extra}`)

console.log(`AUDITORÍA PRE-MIGRACIÓN — catálogo legacy`)
console.log(`Archivo: ${RUTA}`)
console.log(`Fecha:   ${new Date().toISOString().slice(0, 10)}`)

// ── 1. TOTALES ───────────────────────────────────────────────
H('1. TOTAL')
fila('Productos', N)
const campos = new Map()
for (const p of productos) for (const k of Object.keys(p)) campos.set(k, (campos.get(k) ?? 0) + 1)
fila('Campos distintos', campos.size)
informe.total = N
informe.campos = Object.fromEntries(campos)

// ── 2. SKU ───────────────────────────────────────────────────
H('2. SKU')
const skuVacios = productos.filter((p) => vacio(p.sku))
const skuDup = duplicados(productos, (p) => p.sku)
const skuDupTotal = skuDup.reduce((s, [, n]) => s + n, 0)
fila('Presentes', N - skuVacios.length, pct(N - skuVacios.length))
fila('Vacíos', skuVacios.length, skuVacios.length ? '← NO MIGRABLES' : '')
fila('SKU distintos', new Set(productos.map((p) => p.sku)).size)
fila('SKU duplicados', skuDup.length, skuDup.length ? `(${skuDupTotal} filas afectadas)` : '')
if (skuDup.length) {
  console.log('\n  Los 10 más repetidos:')
  for (const [k, n] of skuDup.slice(0, 10)) console.log(`    ${String(n).padStart(3)}×  ${k}`)
}
console.log(
  '\n  NOTA: products tiene UNIQUE (company_id, sku). Todo duplicado bloquea\n' +
    '  la importación de las copias: se migra la primera y el resto se reporta.',
)
informe.sku = { vacios: skuVacios.length, duplicados: skuDup.length, filasDuplicadas: skuDupTotal }

// ── 3. NOMBRE ────────────────────────────────────────────────
H('3. NOMBRE')
const nomVacios = productos.filter((p) => vacio(p.nombre))
const nomDup = duplicados(productos, (p) => (p.nombre ?? '').trim().toLowerCase())
fila('Presentes', N - nomVacios.length, pct(N - nomVacios.length))
fila('Vacíos', nomVacios.length, nomVacios.length ? '← name es NOT NULL' : '')
fila('Nombres duplicados', nomDup.length, '(distinto SKU, mismo nombre: es legal)')
const largos = productos.map((p) => (p.nombre ?? '').length)
fila('Largo máximo', Math.max(...largos))
fila('Largo promedio', Math.round(largos.reduce((a, b) => a + b, 0) / N))
informe.nombre = { vacios: nomVacios.length, duplicados: nomDup.length }

// ── 4. MARCA ─────────────────────────────────────────────────
H('4. MARCA')
const conMarca = productos.filter((p) => !vacio(p.marca))
const marcas = contarPor(conMarca, (p) => String(p.marca).trim())
fila('Con marca', conMarca.length, pct(conMarca.length))
fila('Sin marca', N - conMarca.length, pct(N - conMarca.length) + ' ← brand_id NULL (permitido)')
fila('Marcas distintas', marcas.length)
console.log('\n  Top 15:')
for (const [m, n] of marcas.slice(0, 15)) console.log(`    ${String(n).padStart(6)}  ${m}`)
if (marcas.length > 15) console.log(`    … y ${marcas.length - 15} más`)
informe.marcas = { conMarca: conMarca.length, distintas: marcas.length, lista: marcas }

// ── 5. CATEGORÍA ─────────────────────────────────────────────
H('5. CATEGORÍA')
const cats = contarPor(productos, (p) => (vacio(p.cat) ? '(vacía)' : String(p.cat).trim()))
fila('Categorías distintas', cats.length)
console.log()
for (const [c, n] of cats) console.log(`    ${String(n).padStart(6)}  ${pct(n).padStart(6)}  ${c}`)
const enOtros = cats.find(([c]) => c.toLowerCase() === 'otros')?.[1] ?? 0
console.log(`\n  En "otros": ${enOtros} (${pct(enOtros)}) → se migran con needs_review = true`)
informe.categorias = { distintas: cats.length, lista: cats, enOtros }

// ── 6. PRECIOS ───────────────────────────────────────────────
H('6. PRECIOS')
for (const campo of ['pu', 'costo', 'precio_venta', 'fob_eur']) {
  const pres = productos.filter((p) => p[campo] !== undefined)
  const n = pres.map((p) => num(p[campo])).filter((v) => v !== null)
  const cero = n.filter((v) => v === 0).length
  const neg = n.filter((v) => v < 0).length
  const noNum = pres.length - n.length
  console.log(`\n  ${campo}`)
  fila('  presente', pres.length, pct(pres.length))
  fila('  numérico', n.length)
  fila('  no numérico', noNum, noNum ? '← revisar' : '')
  fila('  = 0', cero, cero ? '← ¿precio real o dato faltante?' : '')
  fila('  < 0', neg, neg ? '← ANÓMALO' : '')
  if (n.length) {
    const orden = [...n].sort((a, b) => a - b)
    fila('  mínimo', orden[0])
    fila('  mediana', orden[Math.floor(orden.length / 2)])
    fila('  máximo', orden.at(-1))
    const p99 = orden[Math.floor(orden.length * 0.99)]
    const atipicos = n.filter((v) => v > p99 * 10).length
    fila('  > 10× p99', atipicos, atipicos ? '← revisar' : '')
  }
  informe[`precio_${campo}`] = { presente: pres.length, numerico: n.length, cero, negativos: neg }
}
const conPV = productos.filter((p) => num(p.precio_venta) !== null).length
const conPU = productos.filter((p) => num(p.pu) !== null).length
const sinNada = productos.filter((p) => num(p.precio_venta) === null && num(p.pu) === null).length
console.log(`\n  ── Situación de precio de venta ──`)
fila('Con precio_venta explícito', conPV, pct(conPV))
fila('Sólo con pu (costo/base)', conPU - productos.filter((p) => num(p.precio_venta) !== null && num(p.pu) !== null).length)
fila('Sin ningún precio', sinNada, pct(sinNada))

// ── 7. STOCK ─────────────────────────────────────────────────
H('7. STOCK')
for (const campo of ['sr', 'sv']) {
  const pres = productos.filter((p) => p[campo] !== undefined)
  const n = pres.map((p) => num(p[campo])).filter((v) => v !== null)
  const noNum = pres.length - n.length
  const cero = n.filter((v) => v === 0).length
  const pos = n.filter((v) => v > 0).length
  const neg = n.filter((v) => v < 0).length
  const noEnteros = n.filter((v) => !Number.isInteger(v)).length
  console.log(`\n  ${campo} (${campo === 'sr' ? 'stock real' : 'stock virtual'})`)
  fila('  presente', pres.length, pct(pres.length))
  fila('  no numérico', noNum, noNum ? '← revisar' : '')
  fila('  > 0', pos)
  fila('  = 0', cero)
  fila('  < 0', neg, neg ? '← ANÓMALO: on_hand tiene CHECK >= 0' : '')
  fila('  no enteros', noEnteros, noEnteros ? '← revisar' : '')
  if (n.length) fila('  suma total', n.reduce((a, b) => a + b, 0))
  informe[`stock_${campo}`] = { presente: pres.length, positivos: pos, negativos: neg, noEnteros }
}
const svMayor = productos.filter((p) => num(p.sv) !== null && num(p.sr) !== null && p.sv > p.sr).length
console.log()
fila('sv > sr', svMayor, svMayor ? '← virtual mayor que real: revisar' : '(consistente)')

// ── 8. ATRIBUTOS ─────────────────────────────────────────────
H('8. ATRIBUTOS')
const otrasClaves = new Map()
for (const p of productos) {
  for (const k of Object.keys(p)) {
    if (COLUMNAS.has(k) || METADATOS.has(k) || COMERCIALES.has(k) || SIMILARES.has(k)) continue
    if (k === 'imgs' || k === 's') continue
    otrasClaves.set(k, (otrasClaves.get(k) ?? 0) + 1)
  }
}
const declaradas = [...otrasClaves.keys()].filter((k) => CLAVES_DECLARADAS.has(k))
const noDeclaradas = [...otrasClaves.keys()].filter((k) => !CLAVES_DECLARADAS.has(k))
fila('Claves candidatas a atributo', otrasClaves.size)
fila('Declaradas en la DB', declaradas.length)
fila('NO declaradas', noDeclaradas.length, noDeclaradas.length ? '← el trigger las RECHAZA' : '')
if (noDeclaradas.length) {
  console.log('\n  No declaradas (bloquean el INSERT si se intentan migrar):')
  for (const k of noDeclaradas) console.log(`    ${String(otrasClaves.get(k)).padStart(6)}  ${k}`)
}
console.log('\n  Tipos encontrados por clave declarada:')
for (const k of declaradas.sort()) {
  const vals = productos.map((p) => p[k]).filter((v) => v !== undefined && !vacio(v))
  const tipos = new Set(vals.map((v) => (Array.isArray(v) ? 'array' : typeof v)))
  const distintos = new Set(vals.map((v) => String(v))).size
  const marca = tipos.size > 1 ? ' ← MIXTO' : ''
  console.log(
    `    ${k.padEnd(20)} ${String(vals.length).padStart(6)} valores · ` +
      `${String(distintos).padStart(5)} distintos · ${[...tipos].join('/')}${marca}`,
  )
}
informe.atributos = {
  candidatas: otrasClaves.size,
  declaradas: declaradas.length,
  noDeclaradas,
}

// ── 8b. MATRIZ ATRIBUTO × CATEGORÍA (alimenta la relación N:N) ─
H('8b. MATRIZ ATRIBUTO × CATEGORÍA')
const matriz = new Map()
for (const p of productos) {
  const c = vacio(p.cat) ? '(vacía)' : String(p.cat).trim()
  for (const k of declaradas) {
    if (p[k] === undefined || vacio(p[k])) continue
    if (!matriz.has(k)) matriz.set(k, new Map())
    const m = matriz.get(k)
    m.set(c, (m.get(c) ?? 0) + 1)
  }
}
console.log('  Atributo             Cats  Categorías (productos)')
const filasMatriz = []
for (const [k, m] of [...matriz.entries()].sort((a, b) => b[1].size - a[1].size)) {
  const lista = [...m.entries()].sort((a, b) => b[1] - a[1])
  filasMatriz.push({ clave: k, categorias: lista })
  const txt = lista.slice(0, 4).map(([c, n]) => `${c}(${n})`).join(', ')
  console.log(
    `  ${k.padEnd(20)} ${String(m.size).padStart(4)}  ${txt}${lista.length > 4 ? `, +${lista.length - 4}` : ''}`,
  )
}
const multiCat = filasMatriz.filter((f) => f.categorias.length > 1).length
console.log(`\n  Atributos que aplican a MÁS DE UNA categoría: ${multiCat} de ${filasMatriz.length}`)
informe.matrizAtributoCategoria = filasMatriz

// ── 9. IMÁGENES ──────────────────────────────────────────────
H('9. IMÁGENES')
let conImg = 0, sinImg = 0, totalUrls = 0
const dominios = new Map()
const urls = new Map()
const invalidas = []
for (const p of productos) {
  const arr = Array.isArray(p.imgs) ? p.imgs.filter((u) => !vacio(u)) : []
  if (arr.length === 0) { sinImg++; continue }
  conImg++
  for (const u of arr) {
    totalUrls++
    urls.set(u, (urls.get(u) ?? 0) + 1)
    try {
      const h = new URL(u).hostname
      dominios.set(h, (dominios.get(h) ?? 0) + 1)
    } catch {
      if (invalidas.length < 5) invalidas.push(String(u).slice(0, 70))
      dominios.set('(URL inválida)', (dominios.get('(URL inválida)') ?? 0) + 1)
    }
  }
}
fila('Con al menos una imagen', conImg, pct(conImg))
fila('Sin imagen', sinImg, pct(sinImg))
fila('URLs totales', totalUrls)
fila('URLs distintas', urls.size)
const urlsDup = [...urls.values()].filter((n) => n > 1).length
fila('URLs duplicadas', urlsDup, '(la misma imagen en varios productos)')
fila('URLs inválidas', dominios.get('(URL inválida)') ?? 0)
console.log('\n  Dominios:')
for (const [d, n] of [...dominios.entries()].sort((a, b) => b[1] - a[1]))
  console.log(`    ${String(n).padStart(6)}  ${d}`)
if (invalidas.length) {
  console.log('\n  Ejemplos de URL inválida:')
  for (const u of invalidas) console.log(`    ${u}`)
}
informe.imagenes = { conImg, sinImg, totalUrls, distintas: urls.size, duplicadas: urlsDup,
  dominios: Object.fromEntries(dominios) }

// ── 10. METADATOS DE IMPORTACIÓN ─────────────────────────────
H('10. METADATOS DE IMPORTACIÓN — NO son datos de negocio')
for (const k of [...METADATOS, 's', 'sufijos']) {
  const pres = productos.filter((p) => p[k] !== undefined)
  if (!pres.length) continue
  const vals = pres.map((p) => p[k]).filter((v) => !vacio(v))
  const distintos = [...new Set(vals.map((v) => String(v)))]
  const tipos = [...new Set(vals.map((v) => (Array.isArray(v) ? 'array' : typeof v)))]
  console.log(`\n  ${k}`)
  fila('  presente', pres.length, pct(pres.length))
  fila('  valores distintos', distintos.length)
  fila('  tipo', tipos.join('/'))
  if (distintos.length <= 8) console.log(`    valores: ${distintos.slice(0, 8).join(' | ').slice(0, 150)}`)
  else console.log(`    ejemplos: ${distintos.slice(0, 3).map((v) => v.slice(0, 40)).join(' | ')}`)
}
console.log('\n  DECISIÓN: no se migran como atributos de negocio. `_importOrigen`')
console.log('  y `_apex*` describen de dónde salió el dato, no el producto.')

// ── 11. CAMPOS SIN DESTINO ───────────────────────────────────
H('11. CAMPOS SIN DESTINO EN EL MODELO ACTUAL')
const sinDestino = []
for (const [k, n] of campos) {
  if (COLUMNAS.has(k) || CLAVES_DECLARADAS.has(k) || COMERCIALES.has(k)) continue
  if (k === 'imgs') continue
  sinDestino.push([k, n])
}
for (const [k, n] of sinDestino.sort((a, b) => b[1] - a[1])) {
  let motivo = 'sin destino definido'
  if (METADATOS.has(k)) motivo = 'metadato de importación — no se migra'
  else if (SIMILARES.has(k)) motivo = 'producto similar — no existe tabla en Etapa 1'
  else if (k === 's') motivo = 'desconocido — requiere decisión'
  console.log(`  ${String(n).padStart(6)}  ${k.padEnd(20)} ${motivo}`)
}
informe.sinDestino = sinDestino

// ── 12. CLASIFICACIÓN DE MIGRACIÓN ───────────────────────────
H('12. CLASIFICACIÓN')
const vistos = new Set()
let migrado = 0, revisar = 0
const noMigrado = new Map()
for (const p of productos) {
  const motivos = []
  if (vacio(p.sku)) motivos.push('SKU vacío')
  else if (vistos.has(p.sku)) motivos.push('SKU duplicado')
  if (vacio(p.nombre)) motivos.push('nombre vacío')
  if (num(p.sr) !== null && p.sr < 0) motivos.push('stock negativo')

  if (motivos.length) {
    const k = motivos.join(' + ')
    noMigrado.set(k, (noMigrado.get(k) ?? 0) + 1)
    continue
  }
  if (!vacio(p.sku)) vistos.add(p.sku)

  const avisos =
    vacio(p.marca) ||
    String(p.cat ?? '').toLowerCase() === 'otros' ||
    (num(p.pu) === null && num(p.precio_venta) === null)
  if (avisos) revisar++
  else migrado++
}
const totalNoMigrado = [...noMigrado.values()].reduce((a, b) => a + b, 0)
fila('MIGRADO', migrado, pct(migrado))
fila('MIGRADO + NEEDS_REVIEW', revisar, pct(revisar))
fila('NO MIGRADO', totalNoMigrado, pct(totalNoMigrado))
if (noMigrado.size) {
  console.log('\n  Motivos:')
  for (const [m, n] of [...noMigrado.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`    ${String(n).padStart(6)}  ${m}`)
}
console.log(`\n  Suma de control: ${migrado + revisar + totalNoMigrado} de ${N}`)
informe.clasificacion = { migrado, revisar, noMigrado: Object.fromEntries(noMigrado), totalNoMigrado }

if (salidaJson) {
  writeFileSync(salidaJson, JSON.stringify(informe, null, 2))
  console.log(`\nInforme JSON escrito en ${salidaJson}`)
}
