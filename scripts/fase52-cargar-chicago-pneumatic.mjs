/*
 * Carga la lista de precios de CHICAGO PNEUMATIC (Fase 52).
 *
 *   node scripts/fase52-cargar-chicago-pneumatic.mjs <json-del-drive> [--aplicar]
 *
 * Sin `--aplicar` sólo parsea, verifica y reporta. No escribe nada.
 *
 * ENTRADA: el contenido del .xlsx del Drive «2024 CHICAGO PNEUMATIC LISTA DE
 * PRECIOS NEUMAONCPD_CPV_Price_List_2024_01_USD_TORQUEAR.xlsx», tal como lo
 * devuelve el lector de Drive (JSON con `fileContent`).
 *
 * LA COLUMNA DEL COSTO es «NEW NET PRICE 2024 01 USD», que es el precio de
 * lista menos el descuento de distribuidor (−10 %). La de lista NO es el costo;
 * ese fue el error de la Fase 49 con SPEEDRILL y acá no se repite.
 *
 * Y ESTA LISTA YA ESTÁ EN USD, igual que la tarifa de venta: es la primera que
 * no mezcla monedas. Se deja constancia porque cambia lo que significa el ×3.
 *
 * EL CRUCE NO ES POR LA COLUMNA «Reference». Ahí va el número de parte interno
 * de CP (6151570700), que no está en el catálogo. El modelo que sí está es el
 * primer token de la descripción —«CP8681TC PACK 36V 2.5AH» → CP8681TC— y el
 * SKU se arma con el prefijo de la marca: CP.CP8681TC, que es la regla de la
 * Fase 45. Una referencia que no cruza se guarda igual con product_id en null:
 * el día que el producto exista, el histórico ya está.
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const ruta = process.argv[2]
const aplicar = process.argv.includes('--aplicar')
if (!ruta) {
  console.error('✗ Falta la ruta del JSON con el contenido del archivo del Drive.')
  process.exit(1)
}

const bruto = JSON.parse(fs.readFileSync(ruta, 'utf8')).fileContent

/*
 * EL PARSEO, EN DOS PASOS.
 *
 * Primero se corta el blob en renglones y después se parsea cada uno. Hacerlo
 * de una con un solo regex global no sirve: el archivo llega sin saltos de
 * línea, así que un `.*?` para la descripción puede cruzar el final de un
 * renglón y pegar las columnas de dos productos distintos. Pasó, y el renglón
 * resultante tenía una descripción que era «PLANETARY GEAR,SPARE,YR,2,,HU,1».
 *
 * El corte va entre un importe terminado en dos decimales y el número de parte
 * que abre el renglón siguiente, que es la única frontera inequívoca.
 *
 * EL NÚMERO DE PARTE NO ES SIEMPRE NUMÉRICO. Hay repuestos como `C112183`, con
 * letra adelante. Con un lookahead de sólo dígitos esos renglones no abrían uno
 * nuevo: se pegaban al anterior, y el parser terminaba leyendo la DESCRIPCIÓN
 * de un producto con los IMPORTES del siguiente. Eran 996 renglones, y el error
 * es invisible para la invariante del descuento —los importes del renglón
 * pegado son coherentes entre sí—, así que abajo se cuenta cuántos renglones
 * tiene el archivo y se exige que salgan todos.
 */
const PARTE = String.raw`[A-Z0-9][A-Z0-9./\-]{3,15}`

/*
 * Se descarta todo lo anterior al encabezado. El archivo abre con dos hojas de
 * códigos de estado y los datos bancarios de Buscatools, y el primer producto
 * viene pegado al último nombre de columna: sin este corte, el primer renglón
 * se perdía porque su «número de parte» era el final del encabezado.
 */
const CABECERA = 'NEW NET PRICE 2024 01 USD'
const desdeCabecera = bruto.indexOf(CABECERA)
if (desdeCabecera < 0) {
  console.error(`✗ No se encontró el encabezado «${CABECERA}». ¿Es el archivo correcto?`)
  process.exit(1)
}
const cuerpo = bruto.slice(desdeCabecera + CABECERA.length)

const trozos = cuerpo.split(new RegExp(String.raw`(?<=\.\d{2}"?)\s+(?=${PARTE},)`))

/*
 * La cola de cada renglón: marca y los tres importes. `Type` NO se fija en
 * «PRODUCT»: la lista trae también ACCESSORY y SPARE, y filtrar por PRODUCT
 * dejaba afuera 8.558 de los 9.413 renglones —los repuestos y accesorios, que
 * son justamente lo que más se cotiza—.
 */
const COLA = /,Chicago Pneumatic,"?USD\s?([\d,]+\.\d{2})"?,(-?\d+)%,"?USD\s?([\d,]+\.\d{2})"?\s*$/

/** Corta por comas respetando las comillas del Excel. */
function celdas(linea) {
  const salida = []
  let actual = ''
  let enComillas = false
  for (let i = 0; i < linea.length; i += 1) {
    const c = linea[i]
    if (c === '"') {
      if (enComillas && linea[i + 1] === '"') {
        actual += '"'
        i += 1
      } else enComillas = !enComillas
    } else if (c === ',' && !enComillas) {
      salida.push(actual)
      actual = ''
    } else actual += c
  }
  salida.push(actual)
  return salida
}

const num = (s) => Number(String(s).replace(/,/g, ''))

/* Entre la descripción y la marca hay 7 columnas fijas:
   Type, Rate Group, PRIO, Status, ORIG_CRY, WEIGHT, DUTYNO. */
const COLUMNAS_FIJAS = 7

const filas = []
let sinCola = 0
for (const trozo of trozos) {
  const linea = trozo.trim()
  const m = linea.match(COLA)
  if (!m) {
    sinCola += 1
    continue
  }
  const cabeza = linea.slice(0, linea.length - m[0].length)
  const partes = celdas(cabeza)
  if (partes.length < 2 + COLUMNAS_FIJAS) continue

  const parte = partes[0]?.trim() ?? ''
  if (!new RegExp(`^${PARTE}$`).test(parte)) continue

  // La descripción es todo lo que queda entre el número de parte y las 7
  // columnas fijas: así una descripción con comas no corre los campos.
  const desc = partes.slice(1, partes.length - COLUMNAS_FIJAS).join(',').trim()
  const tipo = partes[partes.length - COLUMNAS_FIJAS]?.trim() ?? ''
  const origen = partes[partes.length - 3]?.trim() ?? ''

  const limpia = desc.replace(/^"+|"+$/g, '').trim()
  // El modelo es el primer token de la descripción.
  const modelo = limpia.split(/\s+/)[0]?.replace(/^"+/, '').trim() ?? ''
  if (modelo === '') continue

  filas.push({
    parte,
    modelo,
    tipo,
    descripcion: limpia,
    origen: origen || null,
    lista: num(m[1]),
    descuentoPct: Number(m[2]),
    neto: num(m[3]),
  })
}

console.log(`Trozos: ${trozos.length} · renglones parseados: ${filas.length} · sin importes: ${sinCola}`)

/*
 * GUARDIA DE COMPLETITUD, y es la que importa más.
 *
 * El archivo tiene un renglón por cada vez que aparece la marca seguida de un
 * importe. Si salen menos filas que ésas, hay renglones pegados: el parser leyó
 * la descripción de uno con los importes de otro, y eso cargaría precios
 * cruzados sin que ninguna otra verificación lo note. Pasó —996 renglones— y es
 * la razón por la que esta cuenta existe.
 */
const esperados = (cuerpo.match(/,Chicago Pneumatic,"?USD/g) ?? []).length
console.log(`Renglones que tiene el archivo: ${esperados}`)
if (filas.length !== esperados) {
  console.error(`✗ Faltan ${esperados - filas.length} renglones. Hay renglones pegados y los precios saldrían cruzados.`)
  const pegados = trozos.filter((t) => (t.match(/,Chicago Pneumatic,"?USD/g) ?? []).length > 1)
  if (pegados[0]) console.error(`   ej. de trozo con dos renglones: ${pegados[0].slice(0, 200)}`)
  process.exit(1)
}

/*
 * GUARDIA DE INVARIANTE.
 *
 * NO se exige que el neto sea exactamente la lista menos el descuento: la
 * columna `Discount` viene REDONDEADA A ENTERO. Un «−18 %» es en realidad
 * −17,5 % —2.414,94 × 0,825 = 1.992,33 exacto—, y exigir el entero marcaba
 * como error 158 renglones que estaban perfectos. El dato bueno es el NETO,
 * que es justo la columna que se usa como costo.
 *
 * Lo que sí se exige: que el neto sea un descuento plausible sobre la lista, y
 * que coincida con el entero declarado dentro de un punto porcentual. Eso
 * detecta columnas pegadas al corrido, que es el error que importa.
 */
let malas = 0
let ejemplo = null
for (const f of filas) {
  const ratio = f.lista > 0 ? f.neto / f.lista : 0
  const declarado = 1 + f.descuentoPct / 100
  const plausible = ratio > 0.4 && ratio <= 1.0001
  const coincide = Math.abs(ratio - declarado) <= 0.0101
  if (!plausible || !coincide) {
    malas += 1
    if (!ejemplo) ejemplo = f
  }
}
const pctMalas = filas.length === 0 ? 100 : (malas / filas.length) * 100
console.log(`Neto coherente con el dto. declarado: ${filas.length - malas}/${filas.length} (${(100 - pctMalas).toFixed(2)} %)`)

if (filas.length < 1000) {
  console.error(`✗ Sólo ${filas.length} renglones y el archivo tiene ~9.400: el parseo falló. No se escribe nada.`)
  process.exit(1)
}
if (pctMalas > 1) {
  console.error(`✗ ${malas} renglones donde el neto no cierra. El parseo pegó mal las columnas.`)
  if (ejemplo) console.error(`   ej.: ${ejemplo.modelo} lista ${ejemplo.lista} dto ${ejemplo.descuentoPct}% neto ${ejemplo.neto}`)
  process.exit(1)
}

const descuentos = [...new Set(filas.map((f) => f.descuentoPct))].sort((a, b) => a - b)
console.log(`Descuentos distintos: ${descuentos.join(', ')} %`)
const tipos = [...new Set(filas.map((f) => f.tipo))].sort()
console.log(`Tipos: ${tipos.join(', ')}`)
console.log(`Costo neto → min ${Math.min(...filas.map((f) => f.neto)).toFixed(2)} · max ${Math.max(...filas.map((f) => f.neto)).toFixed(2)} USD`)

for (const f of filas.slice(0, 5)) {
  console.log(`  ${f.modelo.padEnd(18)} lista ${f.lista.toFixed(2)} ${f.descuentoPct}% → neto ${f.neto.toFixed(2)}`)
}

if (!aplicar) {
  console.log('\n(ensayo: no se escribió nada. Agregá --aplicar para cargar.)')
  process.exit(0)
}

// ── la carga ────────────────────────────────────────────────────────────────

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
})

const { data: emp } = await sb.from('companies').select('id').eq('slug', 'buscatools').single()
const { data: marca } = await sb
  .from('brands')
  .select('id, name, sku_prefix')
  .eq('company_id', emp.id)
  .eq('name', 'CHICAGO PNEUMATIC')
  .single()

if (!marca?.sku_prefix) {
  console.error('✗ La marca CHICAGO PNEUMATIC no tiene sku_prefix. Sin eso no se puede cruzar.')
  process.exit(1)
}

// 1 · la fuente
let { data: fuente } = await sb
  .from('price_list_sources')
  .select('id')
  .eq('company_id', emp.id)
  .eq('name', 'CHICAGO PNEUMATIC')
  .maybeSingle()

if (!fuente) {
  const r = await sb
    .from('price_list_sources')
    .insert({ company_id: emp.id, name: 'CHICAGO PNEUMATIC', brand_id: marca.id, kind: 'marca' })
    .select('id')
    .single()
  if (r.error) throw new Error(`fuente: ${r.error.message}`)
  fuente = r.data
}

// 2 · la versión. La fecha sale del propio nombre de las columnas: 2024-01.
const FECHA = '2024-01-01'
let { data: version } = await sb
  .from('price_list_versions')
  .select('id')
  .eq('company_id', emp.id)
  .eq('source_id', fuente.id)
  .eq('issued_on', FECHA)
  .maybeSingle()

if (version) {
  console.log('La versión ya estaba cargada: se borran sus renglones y se recargan.')
  await sb.from('price_list_items').delete().eq('version_id', version.id)
} else {
  const r = await sb
    .from('price_list_versions')
    .insert({
      company_id: emp.id,
      source_id: fuente.id,
      issued_on: FECHA,
      currency: 'USD',
      anchor_column: 'NEW PRICE LIST 2024 01 USD',
      origin: 'drive',
      file_name: '2024 CHICAGO PNEUMATIC LISTA DE PRECIOS NEUMAONCPD_CPV_Price_List_2024_01_USD_TORQUEAR.xlsx',
      file_url: 'https://drive.google.com/file/d/1JJu57F3y2l6OIMMjr2Tw5RNodGRRZsn7/view',
      notes: 'Lista oficial de CP en USD. El costo es NEW NET PRICE (lista menos el dto. de distribuidor). Cruce por el modelo de la descripcion, no por la columna Reference.',
    })
    .select('id')
    .single()
  if (r.error) throw new Error(`version: ${r.error.message}`)
  version = r.data
}

// 3 · el cruce con el catálogo, por SKU = prefijo + '.' + modelo
const skus = filas.map((f) => `${marca.sku_prefix}.${f.modelo}`)
const porSku = new Map()
for (let i = 0; i < skus.length; i += 200) {
  const { data, error } = await sb
    .from('products')
    .select('id, sku')
    .eq('company_id', emp.id)
    .in('sku', skus.slice(i, i + 200))
  if (error) throw new Error(`productos: ${error.message}`)
  for (const p of data ?? []) porSku.set(p.sku, p.id)
}

/*
 * 4 · los renglones.
 *
 * LA REFERENCIA ES EL NÚMERO DE PARTE DE CP, no el modelo.
 *
 * La primera versión usaba el modelo y descartaba 7.082 renglones «repetidos».
 * Está mal: para un ACCESSORY o un SPARE el primer token de la descripción no
 * es un modelo sino una palabra genérica —MOTOR, ROTOR, PLANETARY—, así que
 * deduplicar por ahí juntaba repuestos distintos bajo una misma referencia y se
 * quedaba con el precio del que viniera primero. El número de parte es único y
 * es la identidad real de CP, así que entran los 9.413.
 *
 * El modelo se sigue guardando, porque es lo que cruza con el catálogo.
 */
const items = []
for (const f of filas) {
  items.push({
    company_id: emp.id,
    version_id: version.id,
    reference: f.parte,
    description: f.descripcion,
    anchor: f.lista,
    prices: {
      lista_usd: f.lista,
      descuento_pct: f.descuentoPct,
      neto_usd: f.neto,
      modelo: f.modelo,
      tipo: f.tipo,
      origen: f.origen,
    },
    product_id: porSku.get(`${marca.sku_prefix}.${f.modelo}`) ?? null,
  })
}

/*
 * Un modelo puede repetirse entre renglones —el mismo equipo con dos números
 * de parte— y entonces dos referencias apuntarían al mismo producto. La vista
 * `product_pvp` toma una sola fila por producto, así que el PVP saldría de la
 * que Postgres devuelva primero. Se avisa cuando pasa, en vez de dejarlo
 * silencioso.
 */
const porProducto = new Map()
for (const i of items) {
  if (i.product_id === null) continue
  porProducto.set(i.product_id, (porProducto.get(i.product_id) ?? 0) + 1)
}
const ambiguos = [...porProducto.values()].filter((n) => n > 1).length
if (ambiguos > 0) {
  console.log(`⚠ ${ambiguos} productos tienen más de un renglón: su PVP sale de uno de ellos.`)
}

for (let i = 0; i < items.length; i += 500) {
  const { error } = await sb.from('price_list_items').insert(items.slice(i, i + 500))
  if (error) throw new Error(`items: ${error.message}`)
}

const cruzan = items.filter((i) => i.product_id !== null).length
console.log(`\nCargados ${items.length} renglones.`)
console.log(`Cruzan con el catálogo: ${cruzan} · sin producto: ${items.length - cruzan}`)

/*
 * 5 · la fórmula de esta lista. El ×3 va sobre el NETO, que es el costo.
 *
 * No se usa `upsert` con `onConflict`: las unique de `price_formulas` son
 * PARCIALES —una para la regla general y otra para la de cada lista— y
 * PostgREST no puede apuntar a un índice parcial. Se busca y se decide.
 */
const FORMULA = {
  multiplier: 3,
  base_key: 'neto_usd',
  base_is_cost: true,
  notes: 'Costo = NEW NET PRICE (lista CP menos dto. de distribuidor). Ya esta en USD: no se mezcla moneda.',
}

const { data: yaHay } = await sb
  .from('price_formulas')
  .select('id')
  .eq('company_id', emp.id)
  .eq('source_id', fuente.id)
  .maybeSingle()

const eF = yaHay
  ? (await sb.from('price_formulas').update({ ...FORMULA, updated_at: new Date().toISOString() }).eq('id', yaHay.id)).error
  : (await sb.from('price_formulas').insert({ company_id: emp.id, source_id: fuente.id, ...FORMULA })).error

if (eF) throw new Error(`formula: ${eF.message}`)
console.log('Fórmula cargada: PVP = neto_usd × 3.')
