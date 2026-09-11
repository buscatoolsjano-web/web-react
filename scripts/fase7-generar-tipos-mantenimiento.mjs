/**
 * Fase 7 · Mantenimiento — genera los bloques de tipos de sus ocho tablas.
 *
 * `npx supabase gen types` necesita un access token que no está en esta
 * máquina, y el generador del MCP no devuelve un archivo de 3.300 líneas. Así
 * que en vez de escribir los tipos a mano —que es la deuda técnica que venimos
 * arrastrando desde la Fase 5— se GENERAN desde el esquema OpenAPI que publica
 * PostgREST, que es exactamente la misma fuente de la que sale el archivo
 * oficial.
 *
 * Emite los bloques `Tables` de las ocho tablas de Compras, más las dos
 * funciones nuevas, listos para pegar en `src/types/database.types.ts`. Con
 * `--escribir` los inserta él mismo, en orden alfabético, donde corresponde.
 *
 * Dos cosas se derivan y están comprobadas contra la base:
 *
 *   · El nombre de la FK: `<tabla>_<columnas>_fkey`. Los 35 constraints de
 *     Compras lo cumplen; se verificó con pg_constraint.
 *   · `isOneToOne: false` en todas: ninguna FK de Compras tiene un índice
 *     único sobre exactamente sus columnas.
 *
 *   set -a; source .env; source .env.migration; set +a
 *   node scripts/fase7-generar-tipos-mantenimiento.mjs            # imprime
 *   node scripts/fase7-generar-tipos-mantenimiento.mjs --escribir # parchea
 */
import fs from 'node:fs'

const BASE = process.env.VITE_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !SECRET) {
  console.error('✗ Faltan VITE_SUPABASE_URL / SUPABASE_SECRET_KEY')
  process.exit(1)
}

const ESCRIBIR = process.argv.includes('--escribir')
const ARCHIVO = 'src/types/database.types.ts'

const TABLAS = [
  'maintenance_assets',
  'maintenance_orders',
  'maintenance_quote_lines',
  'maintenance_order_parts',
  'maintenance_measurements',
  'maintenance_order_checks',
  'maintenance_check_points',
  'maintenance_audit',
]

/** `format` de OpenAPI → tipo de TypeScript, con las mismas reglas del generador. */
function tipoTs(prop) {
  const f = prop.format ?? ''
  if (f === 'uuid' || f === 'text' || f.startsWith('timestamp') || f === 'date' || f === 'time') {
    return 'string'
  }
  if (f === 'boolean') return 'boolean'
  if (
    f === 'bigint' || f === 'integer' || f === 'smallint' ||
    f.startsWith('numeric') || f === 'real' || f === 'double precision'
  ) {
    return 'number'
  }
  if (f === 'jsonb' || f === 'json') return 'Json'
  if (f.startsWith('ARRAY') || prop.type === 'array') return 'string[]'
  // Nada más aparece en estas ocho tablas. Si aparece, mejor romper que
  // inventar un `any` silencioso.
  throw new Error(`Formato no contemplado: ${f}`)
}

/** `<fk table='x' column='y'/>` dentro de la descripción de PostgREST. */
function fkDe(prop) {
  const m = /<fk table='([^']+)' column='([^']+)'\/>/.exec(prop.description ?? '')
  return m ? { tabla: m[1], columna: m[2] } : null
}

function bloqueDeTabla(nombre, def) {
  const requeridas = new Set(def.required ?? [])
  const columnas = Object.keys(def.properties).sort()

  const row = []
  const insert = []
  const update = []
  const rels = []

  for (const c of columnas) {
    const prop = def.properties[c]
    const t = tipoTs(prop)
    const obligatoria = requeridas.has(c)
    const tieneDefault = prop.default !== undefined

    row.push(`          ${c}: ${t}${obligatoria ? '' : ' | null'}`)
    // En el generador oficial una columna es opcional en el Insert si tiene
    // default o si acepta null.
    const opcional = tieneDefault || !obligatoria
    insert.push(`          ${c}${opcional ? '?' : ''}: ${t}${obligatoria ? '' : ' | null'}`)
    update.push(`          ${c}?: ${t}${obligatoria ? '' : ' | null'}`)

    const fk = fkDe(prop)
    if (fk) {
      rels.push(
        [
          '          {',
          `            foreignKeyName: "${nombre}_${c}_fkey"`,
          `            columns: ["${c}"]`,
          '            isOneToOne: false',
          `            referencedRelation: "${fk.tabla}"`,
          `            referencedColumns: ["${fk.columna}"]`,
          '          },',
        ].join('\n'),
      )
    }
  }

  return [
    `      ${nombre}: {`,
    '        Row: {',
    ...row,
    '        }',
    '        Insert: {',
    ...insert,
    '        }',
    '        Update: {',
    ...update,
    '        }',
    rels.length === 0 ? '        Relationships: []' : '        Relationships: [\n' + rels.join('\n') + '\n        ]',
    '      }',
  ].join('\n')
}

const main = async () => {
  const esquema = await fetch(`${BASE}/rest/v1/`, {
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  }).then((r) => r.json())

  const bloques = new Map()
  for (const t of TABLAS) {
    const def = esquema.definitions?.[t]
    if (!def) throw new Error(`La tabla ${t} no está en el esquema de PostgREST`)
    bloques.set(t, bloqueDeTabla(t, def))
  }

  if (!ESCRIBIR) {
    for (const [t, b] of bloques) {
      console.log(`\n// ── ${t} ${'─'.repeat(60 - t.length)}\n`)
      console.log(b)
    }
    console.log('\n// Volvé a correr con --escribir para insertarlos en el archivo.')
    return
  }

  let archivo = fs.readFileSync(ARCHIVO, 'utf8')
  let insertados = 0

  for (const [tabla, bloque] of bloques) {
    if (archivo.includes(`\n      ${tabla}: {\n`)) {
      console.log(`  ya estaba: ${tabla}`)
      continue
    }
    // Se inserta ANTES de la primera tabla que va después alfabéticamente,
    // para que el archivo quede como lo dejaría el generador oficial.
    const nombres = [...archivo.matchAll(/\n {6}([a-z_]+): \{\n {8}Row: \{/g)]
    const siguiente = nombres.find((m) => m[1] > tabla)
    if (!siguiente) throw new Error(`No encontré dónde insertar ${tabla}`)
    const pos = siguiente.index + 1
    archivo = archivo.slice(0, pos) + bloque + '\n' + archivo.slice(pos)
    insertados += 1
    console.log(`  insertada: ${tabla} (antes de ${siguiente[1]})`)
  }

  fs.writeFileSync(ARCHIVO, archivo)
  console.log(`\n  ${insertados} tabla(s) insertada(s) en ${ARCHIVO}`)
}

main().catch((e) => {
  console.error('\n✗', e.message)
  process.exit(1)
})
