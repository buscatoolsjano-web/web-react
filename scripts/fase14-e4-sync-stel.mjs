/**
 * Fase 14 · Entrega 4 — sync incremental STEL → React (CLI).
 *
 *   node scripts/fase14-e4-sync-stel.mjs productos --desde 2026-08-16T00:00:00Z            (sólo lectura)
 *   node scripts/fase14-e4-sync-stel.mjs productos --desde ... --aplicar [--crear-nuevos]
 *   node scripts/fase14-e4-sync-stel.mjs documentos --desde 2026-09-01                     (sólo lectura)
 *   node scripts/fase14-e4-sync-stel.mjs documentos --desde 2026-09-01 --aplicar
 *   node scripts/fase14-e4-sync-stel.mjs estado
 *
 * Sin `--aplicar` no escribe nada y el checkpoint no avanza. `--desde` sólo hace
 * falta la primera vez: después arranca del checkpoint guardado en la base.
 *
 * Presupuesto: el incremental de productos es 1-2 llamadas por corrida; el delta
 * de documentos ~12. Cupo compartido con Make: no hacer full scan diario.
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { leerReactEmpresa, leerStel } from './fase14-stel-api-auditoria.mjs'
import { crearCliente, limpiar } from './lib/stel-api.mjs'
import { CATEGORIA_REVISION } from './lib/stel-reconciliacion.mjs'
import { sincronizarDocumentos, sincronizarProductos } from './lib/stel-sync.mjs'

const [, , comando] = process.argv
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null }
const bandera = (n) => process.argv.includes(n)
const SALIDA = path.resolve('scripts/output/e4')
const EMPRESA = arg('--empresa') ?? 'buscatools'

const BASE = process.env.VITE_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !SECRET) { console.error('✗ Faltan VITE_SUPABASE_URL / SUPABASE_SECRET_KEY'); process.exit(1) }
const sb = createClient(BASE, SECRET, { auth: { persistSession: false } })
const guardar = (nombre, datos) => { fs.mkdirSync(SALIDA, { recursive: true }); const f = path.join(SALIDA, nombre); fs.writeFileSync(f, JSON.stringify(datos, null, 1)); return path.relative(process.cwd(), f) }

async function contexto() {
  const { data: emp, error } = await sb.from('companies').select('id').eq('slug', EMPRESA).single()
  if (error || !emp) throw new Error(`empresa ${EMPRESA} no encontrada`)
  const { data: cat } = await sb.from('product_categories').select('id, needs_review').eq('company_id', emp.id).eq('slug', CATEGORIA_REVISION.slug).maybeSingle()
  if (cat && cat.needs_review !== true) throw new Error('la categoría de revisión no está marcada como revisión')
  const { data: listas } = await sb.from('price_lists').select('id, name, currency_code, is_default').eq('company_id', emp.id)
  const base = (listas ?? []).filter((l) => l.is_default)
  if (base.length !== 1) throw new Error('la empresa no tiene exactamente una lista de precios por defecto')
  return { company: emp.id, categoriaRevisionId: cat?.id ?? null, lista: base[0] }
}

/** Un dueño legible para el candado; sin datos del entorno. */
const dueño = () => `${comando}@${new Date().toISOString().slice(0, 19)}`

async function productos() {
  const { company, categoriaRevisionId, lista } = await contexto()
  const aplicar = bandera('--aplicar')
  const conPrecios = !bandera('--sin-precios')
  const c = crearCliente({ maxLlamadas: Number(arg('--max-llamadas') ?? 20), usarCache: false, log: () => {} })
  console.log(`  empresa ${EMPRESA} · ${aplicar ? 'APLICA' : 'sólo lectura'} · precios → ${conPrecios ? `${lista.name} (${lista.currency_code})` : 'no'}`)
  const { run, resumen } = await sincronizarProductos(sb, c, {
    company, owner: dueño(), categoriaRevisionId,
    listaPreciosId: conPrecios ? lista.id : null,
    crearNuevos: bandera('--crear-nuevos'),
    maxNuevos: Number(arg('--max-nuevos') ?? 50),
    desde: arg('--desde'),
    forzarFullSync: bandera('--full-sync'),
    soloLectura: !aplicar,
    log: (m) => console.log(m),
  })
  const f = guardar(`sync-productos-${run}.json`, { run, llamadas: c.llamadas(), resumen })
  console.log(JSON.stringify({ run, llamadas: c.llamadas(), ...resumen }, null, 1))
  console.log(`  detalle: ${f}`)
}

async function documentos() {
  const { company, categoriaRevisionId, lista } = await contexto()
  const aplicar = bandera('--aplicar')
  const c = crearCliente({ maxLlamadas: Number(arg('--max-llamadas') ?? 40), usarCache: false, log: () => {} })
  console.log(`  empresa ${EMPRESA} · ${aplicar ? 'APLICA' : 'sólo lectura'}`)
  const { run, resumen } = await sincronizarDocumentos(sb, c, {
    company, empresaSlug: EMPRESA, owner: dueño(), categoriaRevisionId, listaPreciosId: lista.id,
    desde: arg('--desde'), soloLectura: !aplicar,
    leerStel, leerReact: leerReactEmpresa,
    log: (m) => console.log(m),
  })
  const f = guardar(`sync-documentos-${run}.json`, { run, llamadas: c.llamadas(), resumen })
  console.log(JSON.stringify({ run, llamadas: c.llamadas(), ...resumen }, null, 1))
  console.log(`  detalle: ${f}`)
}

async function estado() {
  const { company } = await contexto()
  const { data, error } = await sb.from('stel_sync_state').select('*').eq('company_id', company)
  if (error) throw new Error(error.message)
  console.log(JSON.stringify((data ?? []).map((s) => ({
    entidad: s.entity, estado: s.last_status, checkpoint: s.cursor_modified_at,
    inicio: s.last_started_at, fin: s.last_finished_at, llamadas: s.last_calls,
    error: s.last_error, bloqueado: Boolean(s.locked_at), resumen: s.last_summary,
  })), null, 1))
}

const acciones = { productos, documentos, estado }
if (!acciones[comando]) { console.error('uso: productos | documentos | estado  [--desde X] [--aplicar] [--crear-nuevos]'); process.exit(1) }
acciones[comando]().catch((e) => { console.error('✗', limpiar(e.message)); process.exit(1) })
