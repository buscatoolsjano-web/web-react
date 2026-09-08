/**
 * Muestreo estratificado de productos del catálogo legacy.
 *
 * Objetivo: 200 productos REPRESENTATIVOS, no "limpios". El dataset de
 * prueba tiene que contener los casos difíciles — sin marca, en la
 * categoría 'otros', sin precio, sin stock — porque son la mayoría del
 * catálogo real y es donde la UI se rompe.
 *
 * Uso:  node scripts/sample-products.mjs <ruta a productos-data.json> [salida.json]
 *
 * No toca Supabase. Sólo lee el archivo legacy y escribe un JSON local.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const src = process.argv[2]
const out = process.argv[3] ?? null
if (!src) {
  console.error('Uso: node scripts/sample-products.mjs <productos-data.json> [salida.json]')
  process.exit(1)
}

const all = JSON.parse(readFileSync(src, 'utf8'))
const vacio = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)
const tieneStock = (p) => Number(p.sr) > 0
const tienePrecio = (p) => typeof p.pu === 'number' && p.pu > 0
const atributosTecnicos = (p) =>
  ['encastre', 'largo', 'medida', 'min_kg', 'max_kg', 'rpm', 'torq_min', 'voltaje', 'carcasa']
    .filter((k) => !vacio(p[k])).length

// Estratos deliberados: cada uno ejercita un caso que la UI debe soportar.
const estratos = [
  { nombre: 'con stock (caso escaso: 378 en todo el catálogo)', n: 30, f: (p) => tieneStock(p) },
  { nombre: 'sin marca', n: 30, f: (p) => vacio(p.marca) },
  { nombre: 'categoria "otros"', n: 30, f: (p) => p.cat === 'otros' },
  { nombre: 'sin precio', n: 25, f: (p) => !tienePrecio(p) },
  { nombre: 'muchos atributos tecnicos (>=3)', n: 25, f: (p) => atributosTecnicos(p) >= 3 },
  { nombre: 'con equivalencias de competencia', n: 15, f: (p) => !vacio(p.sim_sp) },
  { nombre: 'con imagenes', n: 20, f: (p) => Array.isArray(p.imgs) && p.imgs.length > 0 },
  { nombre: 'completos (marca + precio + categoria != otros)', n: 25, f: (p) => !vacio(p.marca) && tienePrecio(p) && p.cat !== 'otros' },
]

// Determinista: mismo resultado en cada corrida, para que el dataset sea reproducible.
const elegidos = new Map()
const resumen = []
for (const e of estratos) {
  const candidatos = all.filter((p) => e.f(p) && !elegidos.has(p.sku))
  const paso = Math.max(1, Math.floor(candidatos.length / e.n))
  let sumados = 0
  for (let i = 0; i < candidatos.length && sumados < e.n; i += paso) {
    elegidos.set(candidatos[i].sku, candidatos[i])
    sumados++
  }
  resumen.push({ estrato: e.nombre, objetivo: e.n, disponibles: candidatos.length, tomados: sumados })
}

// Cobertura de marcas: al menos un producto por marca presente en el catálogo.
const marcasCubiertas = new Set([...elegidos.values()].map((p) => p.marca).filter(Boolean))
let agregadosPorMarca = 0
for (const p of all) {
  if (p.marca && !marcasCubiertas.has(p.marca) && !elegidos.has(p.sku)) {
    elegidos.set(p.sku, p); marcasCubiertas.add(p.marca); agregadosPorMarca++
  }
}

// Cobertura de categorías: al menos un producto por categoría del catálogo.
const catsCubiertas = new Set([...elegidos.values()].map((p) => p.cat).filter(Boolean))
let agregadosPorCat = 0
for (const p of all) {
  if (p.cat && !catsCubiertas.has(p.cat) && !elegidos.has(p.sku)) {
    elegidos.set(p.sku, p); catsCubiertas.add(p.cat); agregadosPorCat++
  }
}

const muestra = [...elegidos.values()]
console.log('=== MUESTREO ESTRATIFICADO ===\n')
console.log('catálogo de origen:', all.length, 'productos\n')
for (const r of resumen) {
  console.log(`  ${r.estrato.padEnd(48)} objetivo ${String(r.objetivo).padStart(3)}  disponibles ${String(r.disponibles).padStart(6)}  tomados ${r.tomados}`)
}
console.log(`  ${'+ cobertura de marcas faltantes'.padEnd(48)}                                    tomados ${agregadosPorMarca}`)
console.log(`  ${'+ cobertura de categorias faltantes'.padEnd(48)}                                    tomados ${agregadosPorCat}`)
console.log('\nTOTAL muestra:', muestra.length)

const pct = (n) => `${n} (${(n / muestra.length * 100).toFixed(0)}%)`
console.log('\n=== COMPOSICIÓN RESULTANTE ===')
console.log('  con stock          :', pct(muestra.filter(tieneStock).length))
console.log('  sin stock          :', pct(muestra.filter((p) => !tieneStock(p)).length))
console.log('  con precio         :', pct(muestra.filter(tienePrecio).length))
console.log('  sin precio         :', pct(muestra.filter((p) => !tienePrecio(p)).length))
console.log('  sin marca          :', pct(muestra.filter((p) => vacio(p.marca)).length))
console.log('  categoria "otros"  :', pct(muestra.filter((p) => p.cat === 'otros').length))
console.log('  con imagenes       :', pct(muestra.filter((p) => Array.isArray(p.imgs) && p.imgs.length).length))
console.log('  marcas distintas   :', new Set(muestra.map((p) => p.marca).filter(Boolean)).size)
console.log('  categorias         :', new Set(muestra.map((p) => p.cat)).size)
console.log('  tipos              :', new Set(muestra.map((p) => p.tipo).filter(Boolean)).size)

if (out) { writeFileSync(out, JSON.stringify(muestra, null, 2)); console.log('\nescrito:', out) }
