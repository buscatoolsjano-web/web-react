/*
 * Carga la lista de precios de TECNA (Fase 49).
 *
 *   set -a; . ./.env.local; . ./.env.migration; set +a
 *   node scripts/fase49-cargar-tecna.mjs
 *
 * ENTRADA: scripts/output/tecna-crudo.txt.
 *
 * ATENCIÓN: ese archivo está TRANSCRITO A MANO. El Drive entrega el contenido
 * en línea y no hay forma de bajarlo a disco desde acá, así que se copió. Por
 * eso el script empieza verificando que se cumpla Venta Arg = Venta España ×
 * 2,5, que es cierto en las 447 filas del original: un dígito mal tipeado
 * rompe esa proporción y el script corta antes de escribir nada.
 *
 * Esa comprobación ya sirvió una vez, y no por un error de tipeo sino de
 * parser: el primer intento con expresión regular se perdía en los importes
 * con miles entrecomillados. De ahí el tokenizador que hay más abajo.
 *
 * El cruce con el catálogo da 165 de 447. Los 282 que faltan son variantes
 * —sufijos .B, .F, G, AX— que TECNA vende y el catálogo no tiene cargadas.
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const crudo = fs.readFileSync('scripts/output/tecna-crudo.txt', 'utf8')

/*
 * Formato: Codice, Descrizione, Venta España €, Venta Arg €
 *
 * Dos cosas lo hacen incómodo y las dos rompieron el primer intento con regex:
 *
 *   · Los importes con miles vienen ENTRECOMILLADOS y con coma adentro:
 *     `" 1,034.80 € "`. Un regex que parte por comas se come la fila.
 *   · Las filas no están separadas por saltos de línea: el código de la
 *     siguiente viene pegado al último importe de la anterior,
 *     `… 92.50 € 9301,"BALANCER…`.
 *
 * Por eso un tokenizador y no un regex: parte por comas respetando comillas,
 * y después despega el código siguiente del último importe cortando por el
 * último «€» del campo.
 */
function porComas(texto) {
  const campos = []
  let actual = '', dentro = false
  for (const ch of texto) {
    if (ch === '"') { dentro = !dentro; continue }
    if (ch === ',' && !dentro) { campos.push(actual); actual = ''; continue }
    actual += ch
  }
  campos.push(actual)
  return campos
}

const importe = (s) => Number(s.replace(/€/g, '').replace(/,/g, '').trim())

const campos = porComas(crudo)
const vistos = new Set()
const filas = []

// El primer campo arrastra el encabezado: «Foglio1 Codice».
let ref = campos[0].replace(/^.*Codice\s*/s, '').trim()
for (let i = 1; i + 1 < campos.length; i += 3) {
  const desc = campos[i].trim()
  const esp = importe(campos[i + 1])
  const cuarto = campos[i + 2] ?? ''
  // El último importe trae pegado el código de la fila siguiente.
  const corte = cuarto.lastIndexOf('€')
  const arg = corte < 0 ? NaN : importe(cuarto.slice(0, corte + 1))
  const siguiente = corte < 0 ? '' : cuarto.slice(corte + 1).trim()

  if (ref !== '' && ref !== 'Descrizione' && Number.isFinite(esp) && Number.isFinite(arg)) {
    // El archivo repite códigos de accesorio (70477, 7010000017…) en cada
    // familia, siempre con el mismo precio. Se queda el primero.
    if (!vistos.has(ref)) {
      vistos.add(ref)
      filas.push({ ref, desc, esp, arg })
    }
  }
  ref = siguiente
}

/*
 * VERIFICACIÓN DE LA TRANSCRIPCIÓN.
 *
 * El crudo de este archivo se escribió a mano —el Drive lo entrega en línea y
 * no hay forma de bajarlo a disco—, así que un dígito mal tipeado sería un
 * precio mal cargado. La comprobación sale gratis del propio archivo: TODAS
 * las filas cumplen Venta Arg = Venta España x 2,5. Un error de tipeo rompe
 * esa proporción, salvo que casualmente respete el factor, que no pasa.
 */
{
  const malas = filas.filter((f) => Math.abs(f.arg - f.esp * 2.5) > 0.011)
  if (malas.length > 0) {
    console.error(malas.length + ' fila(s) no cumplen Arg = Espana x 2,5. No se carga nada.')
    for (const f of malas.slice(0, 10)) {
      console.error('   ' + f.ref + ': esp=' + f.esp + ' arg=' + f.arg + ' esperado=' + (f.esp * 2.5).toFixed(2))
    }
    process.exit(2)
  }
  console.log(filas.length + ' filas · proporcion Arg = Espana x 2,5 verificada en todas')
}

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const { data: emp } = await sb.from('companies').select('id').eq('slug', 'buscatools').single()
const { data: marca } = await sb.from('brands').select('id, sku_prefix').eq('company_id', emp.id).eq('name', 'TECNA').single()

let { data: fuente } = await sb.from('price_list_sources').select('id').eq('company_id', emp.id).eq('name', 'TECNA').maybeSingle()
if (!fuente) {
  const r = await sb.from('price_list_sources').insert({ company_id: emp.id, name: 'TECNA', brand_id: marca.id, kind: 'marca' }).select('id').single()
  if (r.error) throw new Error(r.error.message)
  fuente = r.data
}

const v = await sb.from('price_list_versions').upsert({
  company_id: emp.id, source_id: fuente.id,
  issued_on: '2026-05-12', currency: 'EUR', anchor_column: 'VENTA ESPANA EUR',
  factors: { venta_arg_sobre_venta_espana: 2.5 },
  origin: 'drive', file_name: 'TECNA EQUILIBRADORE Lista de precios 2026.xlsx',
  file_ref: '1aE44LJiZ9nMF52LtqWkNMtKup6e2UMv1',
  file_url: 'https://drive.google.com/file/d/1aE44LJiZ9nMF52LtqWkNMtKup6e2UMv1/view',
  notes: 'Equilibradores. Venta Arg = Venta Espana x 2,5. Codigos de accesorio repetidos: se queda el primero.',
}, { onConflict: 'source_id,issued_on,anchor_column' }).select('id').single()
if (v.error) throw new Error(v.error.message)

const porSku = new Map()
for (let d = 0; ; d += 1000) {
  const { data } = await sb.from('products').select('id, sku').eq('company_id', emp.id).is('deleted_at', null).range(d, d + 999)
  for (const p of data) porSku.set(p.sku.toUpperCase(), p.id)
  if (data.length < 1000) break
}

let cruzan = 0
const items = filas.map((f) => {
  const id = porSku.get(`${marca.sku_prefix}.${f.ref.toUpperCase()}`) ?? null
  if (id) cruzan++
  return {
    company_id: emp.id, version_id: v.data.id, reference: f.ref,
    description: f.desc || null, anchor: f.esp,
    prices: { venta_espana_eur: f.esp, venta_arg_eur: f.arg },
    product_id: id,
  }
})
await sb.from('price_list_items').delete().eq('version_id', v.data.id)
for (let i = 0; i < items.length; i += 500) {
  const r = await sb.from('price_list_items').insert(items.slice(i, i + 500))
  if (r.error) throw new Error(`fila ${i}: ${r.error.message}`)
}
console.log(`TECNA 2026 · ${items.length} renglones · cruzan ${cruzan} (${Math.round(cruzan / items.length * 100)} %)`)
