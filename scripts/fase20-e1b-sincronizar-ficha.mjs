/**
 * Fase 20 · E1b — Completar los equipos ya importados con lo que faltaba:
 * nombre, descripción, dirección y fotos.
 *
 * STEL: **sólo GET**. React: SELECT siempre; con `--aplicar`, UPDATE de tres
 * columnas en `maintenance_assets` e INSERT en `maintenance_asset_images`.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase20-e1b-sincronizar-ficha.mjs            # dry run
 *   node scripts/fase20-e1b-sincronizar-ficha.mjs --aplicar
 *
 * **No pisa nada escrito a mano.** Las tres columnas se completan sólo si
 * están vacías, y sólo en equipos cuyo origen es STEL. Si alguien editó el
 * nombre en el ERP, el nombre de STEL no vuelve a entrar: se cuenta aparte y
 * se reporta. Las fotos son idempotentes por `(asset_id, external_id)`.
 *
 * Las imágenes entran como **URL del servidor de STEL**, que es lo decidido
 * para esta entrega. Mientras `storage_path` sea nulo, la foto no es nuestra:
 * si STEL se da de baja o rota el token, se pierde. La copia a nuestro
 * almacenamiento queda para E2, y este script la deja preparada.
 */
import { createClient } from '@supabase/supabase-js'
import { crearCliente } from './lib/stel-api.mjs'
import { limpio } from './lib/fase20-mapeo.mjs'

const APLICAR = process.argv.includes('--aplicar')

const c = crearCliente({ maxLlamadas: 40, usarCache: !process.argv.includes('--sin-cache') })

console.log('═'.repeat(74))
console.log(`  FASE 20 · E1b — COMPLETAR LA FICHA ${APLICAR ? '(APLICA)' : '(DRY RUN)'}`)
console.log('═'.repeat(74))

const activos = await c.todos('assets', {}, { limite: 200, maxPaginas: 20 })
const direcciones = await c.todos('addresses', {}, { limite: 200, maxPaginas: 30 })
const direccionPorId = new Map(direcciones.map((d) => [d.id, d]))
console.log(`\n1 · STEL: ${activos.length} activos · ${direcciones.length} direcciones`)

const BASE = process.env.VITE_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !SECRET) throw new Error('Faltan VITE_SUPABASE_URL y SUPABASE_SECRET_KEY')
const sb = createClient(BASE, SECRET, { auth: { persistSession: false } })

const { data: enBase, error } = await sb
  .from('maintenance_assets')
  .select('id, company_id, external_id, name, description, address_text')
  .eq('external_source', 'stel')
if (error) throw new Error(error.message)
const porExterno = new Map(enBase.map((x) => [x.external_id, x]))
console.log(`2 · React: ${enBase.length} equipos con origen STEL`)

const { data: fotosEnBase } = await sb.from('maintenance_asset_images').select('asset_id, external_id')
const fotosYa = new Set((fotosEnBase ?? []).map((f) => `${f.asset_id}:${f.external_id}`))

// ── Qué hay para completar ────────────────────────────────────────────────
const cambios = []
const fotosNuevas = []
let sinEquipo = 0
let yaEscrito = 0

for (const a of activos) {
  const fila = porExterno.get(String(a.id))
  if (!fila) { sinEquipo++; continue }

  const dir = direccionPorId.get(a['address-id'])
  const deseado = {
    name: limpio(a.name),
    description: limpio(a.description),
    address_text: limpio(dir?.['address-data']),
  }
  const parche = {}
  for (const [k, v] of Object.entries(deseado)) {
    if (v === null) continue
    // Sólo se completa lo vacío: lo que alguien escribió en el ERP se queda.
    if (fila[k] === null || fila[k] === '') parche[k] = v
    else if (fila[k] !== v) yaEscrito++
  }
  if (Object.keys(parche).length > 0) cambios.push({ id: fila.id, parche })

  for (const [i, img] of (a['asset-images'] ?? []).entries()) {
    const externo = String(img['asset-image-id'] ?? i)
    if (fotosYa.has(`${fila.id}:${externo}`)) continue
    fotosNuevas.push({
      company_id: fila.company_id,
      asset_id: fila.id,
      external_id: externo,
      position: img.order ?? i,
      url: img['asset-image-path'],
      storage_path: null,
    })
  }
}

console.log('\n3 · Qué se completaría')
console.log(`   EQUIPOS_A_COMPLETAR      ${cambios.length}`)
console.log(`   CON_NOMBRE               ${cambios.filter((x) => x.parche.name).length}`)
console.log(`   CON_DESCRIPCION          ${cambios.filter((x) => x.parche.description).length}`)
console.log(`   CON_DIRECCION            ${cambios.filter((x) => x.parche.address_text).length}`)
console.log(`   FOTOS_NUEVAS             ${fotosNuevas.length}`)
console.log(`   EQUIPOS_CON_FOTO         ${new Set(fotosNuevas.map((f) => f.asset_id)).size}`)
console.log(`   CAMPOS_YA_ESCRITOS       ${yaEscrito}  (no se tocan)`)
console.log(`   ACTIVOS_DE_STEL_SIN_EQUIPO ${sinEquipo}`)

if (!APLICAR) {
  console.log('\n   DRY RUN: no se escribió nada. Con `--aplicar` completa.')
  console.log(`   llamadas a STEL: ${c.llamadas()} · escrituras en STEL: 0`)
  process.exit(0)
}

console.log('\n4 · Completando…')
let n = 0
for (const { id, parche } of cambios) {
  const { error: e } = await sb
    .from('maintenance_assets')
    .update({ ...parche, last_synced_at: new Date().toISOString() })
    .eq('id', id)
    .eq('external_source', 'stel')
  if (e) throw new Error(`update ${id}: ${e.message}`)
  n++
  if (n % 100 === 0) console.log(`   equipos ${n}/${cambios.length}`)
}
console.log(`   equipos ${n}/${cambios.length}`)

let f = 0
for (let i = 0; i < fotosNuevas.length; i += 200) {
  const lote = fotosNuevas.slice(i, i + 200)
  const { data, error: e } = await sb.from('maintenance_asset_images').insert(lote).select('id')
  if (e) throw new Error(`fotos ${i}: ${e.message}`)
  f += data.length
  console.log(`   fotos ${f}/${fotosNuevas.length}`)
}

console.log(`\n   completados: ${n} · fotos: ${f}`)
console.log(`   llamadas a STEL: ${c.llamadas()} · escrituras en STEL: 0`)
