/**
 * Importador del catálogo legacy → Supabase.
 *
 * REPRODUCIBLE E IDEMPOTENTE. Correrlo dos veces no duplica nada: cada
 * tabla se escribe con upsert sobre su clave natural.
 *
 * | Tabla                | Clave de idempotencia                          |
 * |----------------------|------------------------------------------------|
 * | products             | UNIQUE (company_id, sku)                       |
 * | brands               | UNIQUE (company_id, name)                      |
 * | product_categories   | UNIQUE (company_id, slug)                      |
 * | product_prices       | UNIQUE (price_list_id, product_id, valid_from) |
 * | stock_movements      | índice parcial de apertura (ver PREPARACIÓN)   |
 *
 * SEGURIDAD
 * ---------
 * Necesita privilegio de escritura, así que usa la clave service_role.
 *   · Se lee de la variable de entorno SUPABASE_SECRET_KEY.
 *   · NUNCA se imprime, ni entera ni parcial.
 *   · NUNCA va en el repo, en src/, en el bundle ni en GitHub Pages.
 *   · Este script corre a mano, desde un entorno administrativo.
 *
 * USO
 * ---
 *   # simulacro: no escribe nada, sólo informa
 *   node scripts/import-catalog.mjs --file <json> --dry-run
 *
 *   # importación real
 *   SUPABASE_SECRET_KEY=... node scripts/import-catalog.mjs \
 *     --file <json> --execute [--batch 500] [--desde 0] [--precios <politica>]
 *
 * POLÍTICA DE PRECIOS (--precios)
 * -------------------------------
 *   solo-explicitos  (default)  Migra únicamente los 131 precio_venta reales.
 *   markup-legacy               Además materializa precio_venta = pu * 3
 *                               para los 12.123 con pu > 0. REQUIERE
 *                               autorización explícita: `pu` es el COSTO y
 *                               el 3× es una regla comercial, no un dato.
 *   ninguno                     No toca precios.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// ── Argumentos ───────────────────────────────────────────────
const arg = (n, def = null) => {
  const i = process.argv.indexOf(n)
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : def
}
const flag = (n) => process.argv.includes(n)

const ARCHIVO = arg('--file', 'C:/Users/janog/AppData/Local/Temp/bta/legacy/productos-data.json')
const EJECUTAR = flag('--execute')
const LOTE = Number(arg('--batch', '500'))
const DESDE = Number(arg('--desde', '0'))
const POLITICA_PRECIOS = arg('--precios', 'solo-explicitos')
const EMPRESA_SLUG = arg('--empresa', 'buscatools')
const ESTADO = arg('--estado', 'import-catalog.state.json')

const POLITICAS = ['solo-explicitos', 'markup-legacy', 'ninguno']
if (!POLITICAS.includes(POLITICA_PRECIOS)) {
  console.error(`--precios debe ser uno de: ${POLITICAS.join(', ')}`)
  process.exit(1)
}

// ── Mapeos aprobados ─────────────────────────────────────────

/** Categoría legacy → slug en product_categories. */
const CATEGORIA_SLUG = {
  otros: 'otros',
  punta: 'punta',
  balanceador: 'balanceador',
  atornillador: 'atornillador',
  accesorio: 'accesorio',
  'llave de impacto': 'llave-de-impacto',
  remachadora: 'remachadora',
  'llave dinamométrica': 'llave-dinamometrica',
}

/** Las 26 claves declaradas. Cualquier otra la rechaza el trigger. */
const CLAVES_ATRIBUTO = [
  'alimentacion', 'carcasa', 'catalogo_id', 'catalogo_pagina', 'categoria_full',
  'codigo', 'dim_balanceador', 'dim_caja', 'encastre', 'ergonomia', 'eslinga',
  'largo', 'longitud', 'longitud_raw', 'marca_disp', 'max_kg', 'medida',
  'min_kg', 'modelo', 'peso_embalado_kg', 'peso_kg', 'rpm', 'sufijos',
  'torq_max', 'torq_min', 'voltaje',
]

/** Campos que NO se migran, y por qué. Se reportan, no se descartan en silencio. */
const NO_MIGRADOS = {
  imgs: 'las imágenes siguen apuntando a URLs externas — fase aparte',
  s: 'cadena de búsqueda precalculada del legacy — la reemplaza search_vector',
  _importOrigen: 'metadato de importación, no describe al producto',
  _apexPageCatalog: 'metadato de importación',
  _apexFamilyTitle: 'metadato de importación',
  _apexEnriquecido: 'metadato de importación',
  sim_sp: 'producto similar — no existe tabla en la Etapa 1',
  sim_tc: 'producto similar — no existe tabla en la Etapa 1',
  sim_cp: 'producto similar — no existe tabla en la Etapa 1',
  sim_ir: 'producto similar — no existe tabla en la Etapa 1',
  costo: 'costo de compra — pertenece a Compras (Fase 5), con su propia RLS',
  fob_eur: 'valor FOB — pertenece a Compras',
  sv: 'stock virtual = on_hand - reserved, se deriva; no se migra como dato',
}

const FECHA_APERTURA = '2026-01-01'

// ── Utilidades ───────────────────────────────────────────────
const vacio = (v) =>
  v === null || v === undefined ||
  (typeof v === 'string' && v.trim() === '') ||
  (Array.isArray(v) && v.filter((x) => x !== null && String(x).trim() !== '').length === 0)

const txt = (v) => (vacio(v) ? null : String(v).trim())
const ent = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null)
const dec = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

const log = (...a) => console.log(...a)
const seccion = (t) => log(`\n${'═'.repeat(64)}\n${t}\n${'═'.repeat(64)}`)

/**
 * Trae TODAS las filas paginando, con orden ESTABLE.
 *
 * Dos trampas, y las dos muerden en silencio:
 *
 * 1. PostgREST devuelve como máximo 1000 filas por request y no avisa. Un
 *    `select()` sin paginar sobre 21.772 productos devuelve 1000.
 *
 * 2. Paginar con `.range()` SIN `ORDER BY` no sirve: sin un orden total,
 *    Postgres puede devolver las filas en cualquier orden en cada página,
 *    así que las páginas se solapan y se saltean registros. Medido acá:
 *    21.772 filas devueltas pero sólo 16.998 SKU distintos. El mapa
 *    SKU→id quedaba incompleto y ~4.774 productos se quedaban sin precio.
 *
 * `orden` tiene que ser una columna ÚNICA para que el orden sea total.
 */
async function traerTodo(sb, tabla, select, filtro = (q) => q, orden = 'id', pagina = 1000) {
  const filas = []
  for (let desde = 0; ; desde += pagina) {
    const { data, error } = await filtro(sb.from(tabla).select(select))
      .order(orden, { ascending: true })
      .range(desde, desde + pagina - 1)
    if (error) throw new Error(`${tabla}: ${error.message}`)
    filas.push(...(data ?? []))
    if (!data || data.length < pagina) break
  }
  return filas
}

// ── Conexión ─────────────────────────────────────────────────
function conectar() {
  const url = process.env.SUPABASE_URL ?? 'https://uaxcfufvapzulqvynanp.supabase.co'
  const clave = process.env.SUPABASE_SECRET_KEY
  if (!clave) {
    console.error(
      'Falta SUPABASE_SECRET_KEY en el entorno.\n' +
        'Se pasa por variable de entorno y NO se commitea. Este script corre\n' +
        'a mano, fuera del frontend.',
    )
    process.exit(1)
  }
  // La clave nunca se imprime, ni siquiera truncada.
  return createClient(url, clave, { auth: { persistSession: false } })
}

// ── Normalización de un producto ─────────────────────────────
function normalizar(p, ctx) {
  const motivos = []
  const avisos = []

  const sku = txt(p.sku)
  if (!sku) motivos.push('SKU vacío')

  const nombre = txt(p.nombre)
  if (!nombre) motivos.push('nombre vacío')

  const catLegacy = String(p.cat ?? '').trim().toLowerCase()
  const slug = CATEGORIA_SLUG[catLegacy]
  if (!slug) motivos.push(`categoría desconocida: "${catLegacy}"`)

  const sr = dec(p.sr)
  if (sr !== null && sr < 0) avisos.push('stock negativo — no se migra el saldo')

  if (motivos.length) return { ok: false, motivos }

  const marca = txt(p.marca)
  const atributos = {}
  for (const k of CLAVES_ATRIBUTO) {
    if (p[k] === undefined || vacio(p[k])) continue
    atributos[k] = p[k]
  }

  const pv = dec(p.precio_venta)
  const pu = dec(p.pu)

  // needs_review marca lo que necesita que UNA PERSONA mire la fila.
  //
  // Deliberadamente NO incluye "sin marca" ni "sin precio": son condiciones
  // masivas (5.456 y 9.518 productos) que ya se consultan directamente con
  // `brand_id IS NULL` o por ausencia de fila en product_prices. Marcarlas
  // acá pondría la bandera en el 98,4% del catálogo y la volvería inútil
  // como filtro. Van al informe de limpieza, que es su lugar.
  if (slug === 'otros') avisos.push('categoría "otros" — requiere recategorización')
  if (pu !== null && pu > ctx.umbralAnomalo) avisos.push('pu anómalo')
  // (el stock negativo ya se agregó arriba)

  // Procedencia del precio. Vive SÓLO en el reporte de migración: no se
  // agrega ninguna columna al schema para esto, y el frontend nunca la ve.
  //
  //   explicit_price → precio_venta real del legacy
  //   markup_legacy  → materializado como pu * 3
  //   anomaly        → pu desproporcionado, excluido a propósito
  //   no_price       → no hay dato utilizable
  let fuentePrecio = 'no_price'
  if (pv !== null && pv > 0) fuentePrecio = 'explicit_price'
  else if (pu !== null && pu > ctx.umbralAnomalo) fuentePrecio = 'anomaly'
  else if (pu !== null && pu > 0) fuentePrecio = 'markup_legacy'

  return {
    ok: true,
    avisos,
    fuentePrecio,
    // `pu` se conserva SÓLO en memoria, para calcular el precio. Nunca se
    // escribe en products, attributes, product_prices ni ninguna tabla del
    // catálogo: es el COSTO y pertenece a Compras.
    puSoloParaCalculo: pu,
    producto: {
      company_id: ctx.companyId,
      sku,
      name: nombre,
      model_code: txt(p.base),
      category_slug: slug,
      brand_name: marca,
      product_type: txt(p.tipo),
      series: txt(p.serie),
      description: txt(p.desc),
      description_long: txt(p.descl),
      origin_country: txt(p.origen),
      ncm_code: txt(p.ncm),
      weight_g: ent(p.peso_g),
      volume_cm3: ent(p.volumen_cm3),
      attributes: atributos,
      status: 'active',
      needs_review: avisos.length > 0,
      legacy_ref: sku,
    },
    precioVenta: pv !== null && pv > 0 ? pv : null,
    costo: pu,
    stock: sr !== null && sr > 0 ? Math.round(sr) : null,
    stockInvalido: sr !== null && sr < 0,
  }
}

// ── Programa ─────────────────────────────────────────────────
async function main() {
  seccion('IMPORTADOR DE CATÁLOGO')
  log(`Archivo:   ${ARCHIVO}`)
  log(`Modo:      ${EJECUTAR ? 'EJECUTAR (escribe en la base)' : 'SIMULACRO (no escribe nada)'}`)
  log(`Lote:      ${LOTE}`)
  log(`Precios:   ${POLITICA_PRECIOS}`)
  log(`Empresa:   ${EMPRESA_SLUG}`)

  if (POLITICA_PRECIOS === 'markup-legacy') {
    log(
      '\n  ⚠ POLÍTICA markup-legacy: se materializa precio = pu * 3.\n' +
        '    `pu` es el COSTO. El 3× es una regla comercial del legacy, no un\n' +
        '    dato. Sólo se usa con autorización explícita.',
    )
  }

  const productos = JSON.parse(readFileSync(ARCHIVO, 'utf8'))
  log(`\nProductos en el archivo: ${productos.length}`)

  const pus = productos.map((p) => dec(p.pu)).filter((v) => v !== null).sort((a, b) => a - b)
  const umbralAnomalo = pus[Math.floor(pus.length * 0.99)] * 10

  const sb = EJECUTAR ? conectar() : null
  let ctx = { companyId: '00000000-0000-0000-0000-000000000000', umbralAnomalo }
  let listaBaseId = null
  let depositoId = null

  if (EJECUTAR) {
    const { data: emp, error: e1 } = await sb
      .from('companies').select('id').eq('slug', EMPRESA_SLUG).single()
    if (e1) throw new Error(`No se encontró la empresa ${EMPRESA_SLUG}: ${e1.message}`)
    ctx.companyId = emp.id

    const { data: lista } = await sb
      .from('price_lists').select('id, currency_code')
      .eq('company_id', emp.id).eq('is_default', true).single()
    listaBaseId = lista?.id ?? null

    const { data: dep } = await sb
      .from('warehouses').select('id')
      .eq('company_id', emp.id).eq('is_default', true).single()
    depositoId = dep?.id ?? null

    log(`Empresa resuelta · lista base ${listaBaseId ? 'OK' : 'AUSENTE'} · depósito ${depositoId ? 'OK' : 'AUSENTE'}`)
  }

  // ── Normalizar todo antes de escribir nada ────────────────
  seccion('NORMALIZACIÓN')
  const validos = []
  const rechazados = new Map()
  const skusVistos = new Set()
  let conAvisos = 0
  let stockInvalidos = 0

  for (const p of productos) {
    const r = normalizar(p, ctx)
    if (!r.ok) {
      const k = r.motivos.join(' + ')
      rechazados.set(k, (rechazados.get(k) ?? 0) + 1)
      continue
    }
    if (skusVistos.has(r.producto.sku)) {
      rechazados.set('SKU duplicado', (rechazados.get('SKU duplicado') ?? 0) + 1)
      continue
    }
    skusVistos.add(r.producto.sku)
    if (r.avisos.length) conAvisos++
    if (r.stockInvalido) stockInvalidos++
    validos.push(r)
  }

  const sinMarca = validos.filter((v) => !v.producto.brand_name).length
  const enOtros = validos.filter((v) => v.producto.category_slug === 'otros').length
  const sinPrecio = validos.filter((v) => v.precioVenta === null && (v.costo === null || v.costo <= 0)).length
  const totalRechazado = [...rechazados.values()].reduce((a, b) => a + b, 0)
  log(`  Válidos                ${String(validos.length).padStart(6)}`)
  log(`  · con needs_review     ${String(conAvisos).padStart(6)}`)
  log(`  · limpios              ${String(validos.length - conAvisos).padStart(6)}`)
  log(`  Rechazados             ${String(totalRechazado).padStart(6)}`)
  for (const [m, n] of [...rechazados.entries()].sort((a, b) => b[1] - a[1])) {
    log(`    ${String(n).padStart(6)}  ${m}`)
  }
  log(`  Saldo de stock inválido (producto sí, stock no): ${stockInvalidos}`)
  log('\n  Condiciones masivas — al informe de limpieza, no a needs_review:')
  log(`    sin marca            ${String(sinMarca).padStart(6)}  (brand_id IS NULL)`)
  log(`    categoría "otros"    ${String(enOtros).padStart(6)}  (sí marca needs_review)`)
  log(`    sin ningún precio    ${String(sinPrecio).padStart(6)}  (sin fila en product_prices)`)

  // ── Marcas y categorías ───────────────────────────────────
  const marcas = [...new Set(validos.map((v) => v.producto.brand_name).filter(Boolean))]
  const slugs = [...new Set(validos.map((v) => v.producto.category_slug))]
  log(`\n  Marcas distintas       ${String(marcas.length).padStart(6)}`)
  log(`  Categorías usadas      ${String(slugs.length).padStart(6)}`)

  // ── Precios y stock previstos ─────────────────────────────
  const conPvExplicito = validos.filter((v) => v.precioVenta !== null).length
  const conCosto = validos.filter((v) => v.costo !== null && v.costo > 0 && v.costo <= umbralAnomalo).length
  const conStock = validos.filter((v) => v.stock !== null).length
  const sumaStock = validos.reduce((s, v) => s + (v.stock ?? 0), 0)

  seccion('PRECIOS — PROCEDENCIA')
  const porFuente = {}
  for (const v of validos) porFuente[v.fuentePrecio] = (porFuente[v.fuentePrecio] ?? 0) + 1
  for (const f of ['explicit_price', 'markup_legacy', 'anomaly', 'no_price']) {
    log(`  ${f.padEnd(16)} ${String(porFuente[f] ?? 0).padStart(6)}`)
  }
  let aInsertarPrecios = porFuente['explicit_price'] ?? 0
  if (POLITICA_PRECIOS === 'markup-legacy') aInsertarPrecios += porFuente['markup_legacy'] ?? 0
  if (POLITICA_PRECIOS === 'ninguno') aInsertarPrecios = 0
  log(`\n  → filas en product_prices ${String(aInsertarPrecios).padStart(4)}`)
  log(`  (anomaly y no_price nunca generan precio)`)

  seccion('NEEDS_REVIEW — DESGLOSE')
  const porMotivo = new Map()
  for (const v of validos) {
    for (const a of v.avisos) {
      if (!porMotivo.has(a)) porMotivo.set(a, [])
      porMotivo.get(a).push(v.producto.sku)
    }
  }
  log('  Un producto puede tener más de un motivo, así que la suma de')
  log('  motivos es mayor que la cantidad de productos marcados.\n')
  for (const [m, skus] of [...porMotivo.entries()].sort((a, b) => b[1].length - a[1].length)) {
    log(`  ${String(skus.length).padStart(6)}  ${m}`)
    if (skus.length <= 12) log(`          ${skus.join(', ')}`)
  }
  log(`\n  Productos marcados (distintos): ${conAvisos}`)

  log(`\n  Movimientos de apertura ${String(conStock).padStart(5)}  (suma ${sumaStock})`)

  if (!EJECUTAR) {
    seccion('SIMULACRO TERMINADO — no se escribió nada')
    log('  Para ejecutar de verdad:')
    log('    SUPABASE_SECRET_KEY=... node scripts/import-catalog.mjs --file <json> --execute')
    return
  }

  // ── Escritura por lotes ───────────────────────────────────
  const estado = existsSync(ESTADO) ? JSON.parse(readFileSync(ESTADO, 'utf8')) : { procesados: 0 }
  const arranque = Math.max(DESDE, estado.procesados)
  if (arranque > 0) log(`\nReanudando desde el producto ${arranque}`)

  const t0 = Date.now()
  const stats = { productos: 0, precios: 0, movimientos: 0, errores: 0, lotes: 0 }

  // 1. Marcas (idempotente por UNIQUE (company_id, name))
  seccion('IMPORTACIÓN')
  const { error: eM } = await sb.from('brands').upsert(
    marcas.map((name) => ({ company_id: ctx.companyId, name })),
    { onConflict: 'company_id,name', ignoreDuplicates: true },
  )
  if (eM) throw new Error(`Marcas: ${eM.message}`)
  log(`  Marcas          ${marcas.length} upserted`)

  // 2. Mapas de ids
  const { data: filasMarcas } = await sb
    .from('brands').select('id, name').eq('company_id', ctx.companyId)
  const idMarca = new Map((filasMarcas ?? []).map((b) => [b.name, b.id]))

  const { data: filasCats } = await sb
    .from('product_categories').select('id, slug').eq('company_id', ctx.companyId)
  const idCat = new Map((filasCats ?? []).map((c) => [c.slug, c.id]))

  // 3. Productos por lotes
  for (let i = arranque; i < validos.length; i += LOTE) {
    const lote = validos.slice(i, i + LOTE)
    const filas = lote.map((v) => {
      const { category_slug, brand_name, ...resto } = v.producto
      return {
        ...resto,
        category_id: idCat.get(category_slug),
        brand_id: brand_name ? (idMarca.get(brand_name) ?? null) : null,
      }
    })

    const { error } = await sb
      .from('products')
      .upsert(filas, { onConflict: 'company_id,sku' })

    if (error) {
      stats.errores++
      console.error(`  ✗ lote ${i}-${i + lote.length}: ${error.message}`)
      writeFileSync(ESTADO, JSON.stringify({ procesados: i }, null, 2))
      throw new Error('Importación detenida. Reanudable con --desde ' + i)
    }

    stats.productos += filas.length
    stats.lotes++
    writeFileSync(ESTADO, JSON.stringify({ procesados: i + lote.length }, null, 2))
    if (stats.lotes % 5 === 0) {
      const seg = ((Date.now() - t0) / 1000).toFixed(0)
      log(`  ${String(stats.productos).padStart(6)} productos · ${seg}s`)
    }
  }
  log(`  Productos       ${stats.productos} upserted`)

  // 4. Precios
  if (POLITICA_PRECIOS !== 'ninguno' && listaBaseId) {
    const idsProd = await traerTodo(sb, 'products', 'id, sku', (q) => q.eq('company_id', ctx.companyId))
    const idPorSku = new Map(idsProd.map((p) => [p.sku, p.id]))

    const precios = []
    for (const v of validos) {
      const pid = idPorSku.get(v.producto.sku)
      if (!pid) continue
      // Se respeta exactamente la clasificación calculada en normalizar():
      // `anomaly` y `no_price` NUNCA generan precio, sin importar la política.
      let monto = null
      if (v.fuentePrecio === 'explicit_price') {
        monto = v.precioVenta
      } else if (v.fuentePrecio === 'markup_legacy' && POLITICA_PRECIOS === 'markup-legacy') {
        // El COSTO se usa acá y sólo acá. No se guarda en ninguna tabla.
        monto = v.puSoloParaCalculo * 3
      }
      if (monto === null) continue
      precios.push({
        company_id: ctx.companyId,
        price_list_id: listaBaseId,
        product_id: pid,
        amount: Number(monto.toFixed(4)),
        valid_from: FECHA_APERTURA,
      })
    }

    for (let i = 0; i < precios.length; i += LOTE) {
      const { error } = await sb.from('product_prices').upsert(precios.slice(i, i + LOTE), {
        onConflict: 'price_list_id,product_id,valid_from',
      })
      if (error) throw new Error(`Precios lote ${i}: ${error.message}`)
      stats.precios += Math.min(LOTE, precios.length - i)
    }
    log(`  Precios         ${stats.precios} upserted`)
  }

  // 5. Stock inicial: UN movimiento de apertura por producto con saldo.
  //    stock_balances lo mantiene el trigger; nunca se escribe a mano.
  if (depositoId) {
    const idsProd = await traerTodo(sb, 'products', 'id, sku', (q) => q.eq('company_id', ctx.companyId))
    const idPorSku = new Map(idsProd.map((p) => [p.sku, p.id]))

    const movimientos = validos
      .filter((v) => v.stock !== null)
      .map((v) => ({
        company_id: ctx.companyId,
        product_id: idPorSku.get(v.producto.sku),
        warehouse_id: depositoId,
        movement_type: 'opening_balance',
        quantity: v.stock,
        source_type: 'migration',
        notes: 'Saldo inicial migrado del catálogo legacy',
      }))
      .filter((m) => m.product_id)

    // NO se puede usar upsert con onConflict acá.
    //
    // El índice de idempotencia es PARCIAL:
    //   UNIQUE (company_id, product_id, warehouse_id)
    //     WHERE movement_type = 'opening_balance'
    //
    // Postgres exige repetir el predicado en la cláusula
    // `ON CONFLICT (cols) WHERE ...` para poder inferir un índice parcial,
    // y `onConflict` de supabase-js sólo acepta la lista de columnas. Sin
    // el predicado, Postgres responde "there is no unique or exclusion
    // constraint matching the ON CONFLICT specification".
    //
    // Se resuelve leyendo qué aperturas ya existen e insertando sólo las
    // que faltan. Idempotente por construcción, y el índice parcial queda
    // como red de seguridad por si dos ejecuciones corrieran a la vez.
    const yaAbiertos = new Set(
      (
        await traerTodo(sb, 'stock_movements', 'product_id', (q) =>
          q.eq('company_id', ctx.companyId).eq('movement_type', 'opening_balance'),
        )
      ).map((r) => r.product_id),
    )
    const faltantes = movimientos.filter((m) => !yaAbiertos.has(m.product_id))
    log(`  Aperturas ya existentes: ${yaAbiertos.size} · a insertar: ${faltantes.length}`)

    for (let i = 0; i < faltantes.length; i += LOTE) {
      const { error } = await sb.from('stock_movements').insert(faltantes.slice(i, i + LOTE))
      if (error) throw new Error(`Movimientos lote ${i}: ${error.message}`)
      stats.movimientos += Math.min(LOTE, faltantes.length - i)
    }
    log(`  Movimientos     ${stats.movimientos} de apertura insertados`)
  }

  // ── Informe ───────────────────────────────────────────────
  const segundos = ((Date.now() - t0) / 1000).toFixed(1)
  seccion('RESULTADO')
  log(`  Productos       ${stats.productos}`)
  log(`  Precios         ${stats.precios}`)
  log(`  Movimientos     ${stats.movimientos}`)
  log(`  Lotes           ${stats.lotes}`)
  log(`  Errores         ${stats.errores}`)
  log(`  Duración        ${segundos}s`)
  writeFileSync(ESTADO, JSON.stringify({ procesados: validos.length, completado: true }, null, 2))
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}`)
  process.exit(1)
})
