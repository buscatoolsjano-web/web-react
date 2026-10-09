/*
 * Carga el HISTORIAL de costos de SPEEDRILL desde sus facturas (Fase 55).
 *
 *   node scripts/fase55-cargar-costos-speedrill.mjs            (ensayo)
 *   node scripts/fase55-cargar-costos-speedrill.mjs --aplicar
 *
 * POR QUÉ. SPEEDRILL tenía UNA sola versión cargada —el Excel de 2026— mientras
 * Ingersoll tenía nueve, y la pregunta era por qué. La respuesta es que de
 * Ingersoll se cargó una factura por fecha y de SPEEDRILL sólo la lista actual.
 * Acá se cargan las 4 fechas que hay en el Drive, así la planilla muestra la
 * progresión del costo en vez de una sola columna.
 *
 * NO SE USA LA HOJA MAKE, y conviene que quede escrito. Tiene 9 fechas y es
 * tentadora, pero MEZCLA DOS MAGNITUDES: comparada contra el Excel 2026, las
 * puntas siguen el costo (VPPH2/50: 0,50 → 0,57 → costo 0,63) y el 2520/8B
 * sigue el PVP España (12,33 contra un costo de 6,20 y un PVP de 12,39). Es una
 * planilla mantenida a mano durante tres años desde fuentes distintas, y eso
 * explica los 79 precios 10-160× desfasados que ya se habían detectado.
 * Cargarla metería magnitudes mezcladas en una serie de costos y, con
 * PVP = costo × 3, la mitad saldría al doble.
 *
 * EL CÓDIGO LO DECIDE EL CATÁLOGO, igual que con Ingersoll. El lector devuelve
 * todos los tokens del tramo y acá se busca cuál existe como `SP.<código>`.
 * Si no existe ninguno, el renglón se guarda con `product_id` en null usando el
 * primer token: es un costo de algo que Buscatools compró y no tiene cargado
 * —repuestos como `6J5-006`—, y una referencia aproximada en una fila que no
 * puede generar precio no cuesta nada. Si existen DOS, no se carga.
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { leerFactura } from './lib/facturas-speedrill.mjs'

const aplicar = process.argv.includes('--aplicar')
const entrada = JSON.parse(fs.readFileSync('scripts/input/facturas-speedrill.json', 'utf8'))

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
})

const { data: emp } = await sb.from('companies').select('id').eq('slug', 'buscatools').single()
const { data: marca } = await sb
  .from('brands')
  .select('id, name, sku_prefix')
  .eq('company_id', emp.id)
  .eq('name', entrada.proveedor)
  .single()

if (!marca?.sku_prefix) {
  console.error(`✗ La marca ${entrada.proveedor} no tiene sku_prefix.`)
  process.exit(1)
}

// ── 1 · leer ────────────────────────────────────────────────────────────────

const leidas = []
for (const f of entrada.facturas) {
  const r = leerFactura(f.texto, f.suma)
  leidas.push({ ...f, ...r })
  console.log(
    `${f.numero} · ${f.fecha} · ${r.renglones.length} renglones · ${r.suma} de ${f.suma} EUR${r.valida ? '' : '  ⚠ NO VÁLIDA'}`,
  )
  for (const d of [...r.descartados, ...r.sinCodigo]) console.log(`   ${d}`)
}

const invalidas = leidas.filter((f) => !f.valida)
if (invalidas.length) {
  console.error(`\n✗ ${invalidas.length} facturas no válidas. No se escribe nada.`)
  process.exit(1)
}

// ── 2 · el catálogo decide el código ───────────────────────────────────────

const todos = [...new Set(leidas.flatMap((f) => f.renglones.flatMap((r) => r.candidatos)))]
const idPorSku = new Map()
for (let i = 0; i < todos.length; i += 150) {
  const skus = todos.slice(i, i + 150).map((c) => `${marca.sku_prefix}.${c}`)
  const { data, error } = await sb
    .from('products')
    .select('id, sku')
    .eq('company_id', emp.id)
    .is('deleted_at', null)
    .in('sku', skus)
  if (error) throw new Error(`productos: ${error.message}`)
  for (const p of data ?? []) idPorSku.set(p.sku, p.id)
}

let sinProducto = 0
let ambiguos = 0

const resueltas = leidas.map((f) => ({
  ...f,
  renglones: f.renglones.map((r) => {
    const hallados = [...new Set(r.candidatos.filter((c) => idPorSku.has(`${marca.sku_prefix}.${c}`)))]

    if (hallados.length === 1) {
      const codigo = hallados[0]
      return { ...r, codigo, productId: idPorSku.get(`${marca.sku_prefix}.${codigo}`) ?? null, ambiguo: false }
    }
    if (hallados.length > 1) {
      ambiguos += 1
      console.log(`   ⚠ ${f.numero} renglón ${r.orden}: ambiguo (${hallados.join(' / ')}). No se carga.`)
      return { ...r, codigo: null, productId: null, ambiguo: true }
    }
    /* Ninguno existe: es un costo de algo que no está cargado en el catálogo.
       Se guarda con el primer token y sin producto. */
    sinProducto += 1
    return { ...r, codigo: r.candidatos[0], productId: null, ambiguo: false }
  }),
}))

const utiles = resueltas.flatMap((f) => f.renglones.filter((r) => !r.ambiguo))
const conProducto = utiles.filter((r) => r.productId !== null)

console.log(`\nRenglones leídos: ${utiles.length + ambiguos} · ambiguos descartados: ${ambiguos}`)
console.log(`Cruzan con el catálogo: ${conProducto.length} · sin producto cargado: ${sinProducto}`)
console.log(`Productos distintos con costo: ${new Set(conProducto.map((r) => r.productId)).size}`)

if (!aplicar) {
  console.log('\n(ensayo: no se escribió nada. Agregá --aplicar para cargar.)')
  process.exit(0)
}

// ── 3 · una versión por fecha ──────────────────────────────────────────────

const { data: fuente } = await sb
  .from('price_list_sources')
  .select('id')
  .eq('company_id', emp.id)
  .eq('name', entrada.proveedor)
  .single()

if (!fuente) {
  console.error('✗ No existe la fuente SPEEDRILL. Se esperaba la del Excel 2026.')
  process.exit(1)
}

/* Las facturas del mismo día van juntas: son el mismo costo. Hay tres días con
   dos facturas cada uno. */
const porFecha = new Map()
for (const f of resueltas) {
  const previo = porFecha.get(f.fecha)
  if (previo) {
    previo.numeros.push(f.numero)
    previo.renglones.push(...f.renglones)
    previo.suma += f.suma
  } else {
    porFecha.set(f.fecha, { fecha: f.fecha, numeros: [f.numero], renglones: [...f.renglones], suma: f.suma, archivo: f.archivo, driveId: f.driveId })
  }
}

/*
 * La columna ancla distingue estas versiones de la del Excel 2026.
 *
 * La unique es (fuente, fecha, columna ancla), y la del Excel usa
 * «PVP ESPANA EUR». Con una etiqueta distinta las dos conviven, y además queda
 * dicho de dónde salió cada número.
 */
const ANCLA = 'Importe de factura'

for (const f of porFecha.values()) {
  const numero = f.numeros.join(' + ')

  let { data: version } = await sb
    .from('price_list_versions')
    .select('id')
    .eq('company_id', emp.id)
    .eq('source_id', fuente.id)
    .eq('issued_on', f.fecha)
    .eq('anchor_column', ANCLA)
    .maybeSingle()

  if (version) {
    await sb.from('price_list_items').delete().eq('version_id', version.id)
  } else {
    const r = await sb
      .from('price_list_versions')
      .insert({
        company_id: emp.id,
        source_id: fuente.id,
        issued_on: f.fecha,
        currency: entrada.moneda,
        anchor_column: ANCLA,
        origin: 'factura',
        file_name: f.archivo,
        file_url: `https://drive.google.com/file/d/${f.driveId}/view`,
        notes: `Factura(s) de compra ${numero}. El costo es el importe del renglon dividido la cantidad: el precio impreso viene redondeado a dos decimales. Suma Importes verificada: ${f.suma} EUR.`,
      })
      .select('id')
      .single()
    if (r.error) throw new Error(`version ${numero}: ${r.error.message}`)
    version = r.data
  }

  /* Una referencia puede repetirse en el día. Se queda la primera y se avisa
     sólo si el costo unitario difiere de verdad: la factura redondea cada
     importe, así que `130,47 / 7 = 18,6386` y `18,64 / 1 = 18,64` son el mismo
     precio y no un conflicto. */
  const vistos = new Map()
  const items = []
  for (const r of f.renglones) {
    if (r.ambiguo) continue
    const ref = r.codigo
    if (!ref) continue
    const anterior = vistos.get(ref)
    if (anterior !== undefined) {
      if (Math.abs(anterior - r.unitario) > 0.01) {
        console.log(`   ⚠ ${f.fecha}: ${ref} con dos costos (${anterior} y ${r.unitario}). Se queda ${anterior}.`)
      }
      continue
    }
    vistos.set(ref, r.unitario)
    items.push({
      company_id: emp.id,
      version_id: version.id,
      reference: ref,
      description: null,
      anchor: r.importe,
      prices: {
        costo_eur: r.unitario,
        precio_impreso_eur: r.precioImpreso,
        importe_renglon_eur: r.importe,
        cantidad: r.cantidad,
        factura: r.facturaDe ?? numero,
      },
      product_id: r.productId,
    })
  }

  if (items.length > 0) {
    const { error } = await sb.from('price_list_items').insert(items)
    if (error) throw new Error(`items ${numero}: ${error.message}`)
  }
  console.log(`${f.fecha} (${numero}): ${items.length} renglones cargados.`)
}

console.log('\nListo. La fórmula de SPEEDRILL ya apunta a `costo_eur`, así que no se toca.')
