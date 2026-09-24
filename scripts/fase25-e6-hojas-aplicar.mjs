/**
 * Fase 25 · E6 — Escribir en los productos la hoja del catálogo donde aparecen.
 *
 * El legacy sabía ubicar 1.716 productos en un catálogo impreso y la base sólo
 * tiene 48 (los de DUROFIX). Este script traslada el resto. Lo que escribe son
 * **dos claves dentro de `products.attributes`** —`catalogo_id` y
 * `catalogo_pagina`— y nada más: ni categoría, ni marca, ni stock, ni precio.
 *
 * Reglas, calcadas del legacy y en este orden:
 *
 *   1. El mapeo SKU → página de SPEEDRILL (`app.js:29`, 1.418 SKU).
 *   2. El mapeo SKU → catálogo + página de TECNA (`app.js:79`, 285 SKU).
 *   3. TECNA sin mapeo: el respaldo por serie (`app.js:89`) —«NO GRAVITY» o
 *      X-LIGHT → nogravity, «FOOD INDUSTRY» o terminado en IL/RL → food, el
 *      resto → generale— **sin página**, porque el legacy tampoco la sabía.
 *   4. TORERO serie LTR o LTU (`app.js:45`) → torero, página 1.
 *
 * Lo que NO hace, a propósito:
 *
 *   · **No pisa un dato que ya esté.** Un producto que ya tiene `catalogo_id`
 *     se deja como está y se cuenta aparte. Los 48 de DUROFIX no se tocan.
 *   · **No adivina.** Un SKU que no está en ningún mapeo ni cae en ninguna
 *     regla se queda sin hoja, y se reporta cuántos son.
 *   · **No borra ni cambia ninguna otra clave de `attributes`.** Lee el jsonb
 *     entero y lo vuelve a escribir con las dos claves agregadas.
 *
 * Es idempotente: correrlo dos veces no cambia nada la segunda vez.
 *
 *   node scripts/fase25-e6-hojas-legacy-extraer.mjs <ruta-al-legacy>   # primero
 *   set -a; source .env.migration; set +a
 *   node scripts/fase25-e6-hojas-aplicar.mjs                           # dry run
 *   node scripts/fase25-e6-hojas-aplicar.mjs --apply
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { catalogoTecnaPorSerie } from './fase25-e6-hojas-legacy-extraer.mjs'

const APLICAR = process.argv.includes('--apply')
const ENTRADA = 'scripts/output/fase25-hojas-catalogo.json'

/**
 * El cliente se crea cuando se lo usa, no al importar el módulo.
 *
 * `createClient` explota si la clave es undefined, y este archivo lo importa la
 * suite de `hojaPara`, que no toca la base. Un import no puede exigir
 * credenciales.
 */
let cliente = null
const sb = () => {
  cliente ??= createClient(
    process.env.SUPABASE_URL ?? 'https://uaxcfufvapzulqvynanp.supabase.co',
    process.env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false } },
  )
  return cliente
}

/**
 * Qué hoja le toca a un producto, o null si ninguna regla lo alcanza.
 *
 * Exportada para poder probarla sin base: es la única parte con decisiones.
 */
export function hojaPara(producto, porSku) {
  const directo = porSku[producto.sku]
  if (directo) return { catalogo: directo.catalogo, pagina: directo.pagina, regla: directo.regla }

  const marca = (producto.marca ?? '').toUpperCase()
  const serie = (producto.serie ?? '').toUpperCase()

  if (marca === 'TORERO' && (serie === 'LTR' || serie === 'LTU')) {
    return { catalogo: 'torero', pagina: 1, regla: 'regla TORERO LTR/LTU' }
  }
  // El respaldo de TECNA es sólo para balanceadores, como en el legacy
  // (`app.js:83` exige `p.cat === 'balanceador'`).
  if (marca === 'TECNA' && producto.categoria === 'balanceador') {
    return { catalogo: catalogoTecnaPorSerie(producto.serie, producto.sku), pagina: null, regla: 'respaldo TECNA por serie' }
  }
  return null
}

async function traerProductos() {
  const filas = []
  for (let d = 0; ; d += 1000) {
    const { data, error } = await sb()
      .from('products')
      .select('id, sku, series, attributes, brands ( name ), product_categories ( slug )')
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(d, d + 999)
    if (error) throw new Error(`products: ${error.message}`)
    filas.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return filas.map((f) => ({
    id: f.id,
    sku: f.sku,
    serie: f.series,
    marca: f.brands?.name ?? null,
    categoria: f.product_categories?.slug ?? null,
    atributos: f.attributes && typeof f.attributes === 'object' && !Array.isArray(f.attributes) ? f.attributes : {},
  }))
}

async function main() {
  if (!process.env.SUPABASE_SECRET_KEY) {
    console.error('✗ Falta SUPABASE_SECRET_KEY (set -a; source .env.migration; set +a)')
    process.exit(1)
  }
  const { porSku, catalogos } = JSON.parse(readFileSync(ENTRADA, 'utf8'))
  console.log(`Mapeo: ${Object.keys(porSku).length} SKU · ${Object.keys(catalogos).length} catálogos`)

  const productos = await traerProductos()
  console.log(`Productos vivos: ${productos.length}`)

  const aEscribir = []
  const yaTenian = []
  let sinRegla = 0
  const porCatalogo = {}
  const porRegla = {}

  for (const p of productos) {
    const hoja = hojaPara(p, porSku)
    if (!hoja) { sinRegla++; continue }
    if (p.atributos['catalogo_id'] !== undefined) { yaTenian.push(p.sku); continue }
    const nuevos = { ...p.atributos, catalogo_id: hoja.catalogo }
    if (hoja.pagina !== null) nuevos['catalogo_pagina'] = hoja.pagina
    aEscribir.push({ id: p.id, sku: p.sku, attributes: nuevos })
    porCatalogo[hoja.catalogo] = (porCatalogo[hoja.catalogo] ?? 0) + 1
    porRegla[hoja.regla] = (porRegla[hoja.regla] ?? 0) + 1
  }

  console.log(`\nA escribir: ${aEscribir.length}`)
  for (const [k, v] of Object.entries(porRegla).sort((a, b) => b[1] - a[1])) console.log(`  · ${k}: ${v}`)
  console.log(`Por catálogo: ${JSON.stringify(porCatalogo)}`)
  console.log(`Ya tenían catalogo_id (no se tocan): ${yaTenian.length}`)
  console.log(`Sin ninguna regla (se quedan sin hoja): ${sinRegla}`)

  // Cuántos SKU del mapeo no existen en la base. No es un error —el legacy
  // tenía productos que no se migraron— pero si fueran muchos, el mapeo estaría
  // apuntando a otra cosa y hay que mirarlo antes de escribir.
  const skusEnBase = new Set(productos.map((p) => p.sku))
  const huerfanos = Object.keys(porSku).filter((s) => !skusEnBase.has(s))
  console.log(`SKU del mapeo que no existen en la base: ${huerfanos.length}`)
  for (const s of huerfanos.slice(0, 10)) console.log(`  · ${s}`)

  if (!APLICAR) {
    console.log('\nDRY RUN: no se escribió nada. Agregar --apply para aplicar.')
    return
  }

  // De a uno y por id: `attributes` es un jsonb entero por producto, así que no
  // hay nada que agrupar. 1.716 updates tardan, y es preferible a un upsert
  // masivo que podría pisar columnas que no leímos.
  let hechos = 0
  for (const u of aEscribir) {
    const { error } = await sb().from('products').update({ attributes: u.attributes }).eq('id', u.id)
    if (error) throw new Error(`${u.sku}: ${error.message}`)
    hechos++
    if (hechos % 200 === 0) console.log(`  ${hechos}/${aEscribir.length}`)
  }
  console.log(`\nEscritos: ${hechos}`)
}

const esteArchivo = import.meta.url.replace(/^file:\/\/\/?/, '').replace(/\\/g, '/').toLowerCase()
const invocado = String(process.argv[1] ?? '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
if (invocado && esteArchivo.endsWith(invocado)) {
  main().catch((e) => { console.error('✗', e.message); process.exit(1) })
}
