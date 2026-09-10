/**
 * Fase 5 · Clientes — ¿los tipos parcheados a mano dicen la verdad?
 *
 * `src/types/database.types.ts` está generado, pero las columnas que agregó la
 * Fase 5 y las funciones nuevas se escribieron a mano: regenerarlo necesita un
 * access token de Supabase que no está en esta máquina. Esto queda como deuda
 * técnica, y mientras tanto hay que poder comprobar que lo escrito coincide
 * con el schema real.
 *
 * El schema real se lee del **esquema OpenAPI que publica PostgREST**, que es
 * el mismo del que sale el archivo generado. No hace falta acceso a
 * `information_schema`.
 *
 *   set -a; source .env; source .env.migration; set +a
 *   node scripts/fase5-verificar-tipos.mjs
 */
import fs from 'node:fs'

const URL = process.env.VITE_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!URL || !SECRET) { console.error('✗ Faltan variables de entorno'); process.exit(1) }

let fallos = 0
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }

/** Las tablas y funciones que el módulo de Clientes usa de verdad. */
const TABLAS = [
  'customers',
  'customer_contacts',
  'customer_addresses',
  'customer_product_aliases',
]
const FUNCIONES = [
  'resolver_revision_cliente',
  'precios_historicos_cliente',
  'ultimo_precio_cliente',
  'resumen_cliente',
  'totales_por_moneda_cliente',
  'actividad_mensual_cliente',
]

/** Columnas del bloque `Row` de una tabla en el archivo de tipos. */
function columnasDelArchivo(texto, tabla) {
  const ini = texto.indexOf(`      ${tabla}: {`)
  if (ini < 0) return null
  const row = texto.indexOf('Row: {', ini)
  const fin = texto.indexOf('        }', row)
  if (row < 0 || fin < 0) return null
  return texto
    .slice(row + 'Row: {'.length, fin)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes(':'))
    .map((l) => l.slice(0, l.indexOf(':')).trim())
    .filter((l) => l !== '')
    .sort()
}

const main = async () => {
  const esquema = await fetch(`${URL}/rest/v1/`, {
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  }).then((r) => r.json())

  const archivo = fs.readFileSync('src/types/database.types.ts', 'utf8')

  console.log('='.repeat(74))
  console.log('  TIPOS PARCHEADOS A MANO vs SCHEMA REAL')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(74))
  console.log()

  for (const tabla of TABLAS) {
    const def = esquema.definitions?.[tabla]
    if (!def) { FAIL(`${tabla}: no está en el esquema del servidor`); continue }

    const reales = Object.keys(def.properties ?? {}).sort()
    const escritas = columnasDelArchivo(archivo, tabla)
    if (!escritas) { FAIL(`${tabla}: no se encontró su bloque Row en el archivo`); continue }

    const faltan = reales.filter((c) => !escritas.includes(c))
    const inventadas = escritas.filter((c) => !reales.includes(c))

    if (faltan.length === 0 && inventadas.length === 0) {
      PASS(`${tabla}: ${reales.length} columnas, exactamente las del servidor`)
    } else {
      if (faltan.length) FAIL(`${tabla}: faltan columnas`, faltan.join(', '))
      if (inventadas.length) FAIL(`${tabla}: columnas que no existen`, inventadas.join(', '))
    }
  }

  console.log()
  for (const fn of FUNCIONES) {
    // PostgREST publica las funciones como rutas POST /rpc/<nombre>.
    const existe = esquema.paths?.[`/rpc/${fn}`] !== undefined
    const declarada = archivo.includes(`      ${fn}: {`)
    if (existe && declarada) PASS(`${fn}: existe y está declarada`)
    else if (!existe) FAIL(`${fn}: NO existe en el servidor`)
    else FAIL(`${fn}: existe en el servidor pero no está declarada en los tipos`)
  }

  console.log()
  console.log('='.repeat(74))
  console.log(`  RESULTADO: ${fallos} fallo(s)`)
  console.log('='.repeat(74))
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch((e) => { console.error('✗', e.message); process.exit(1) })
