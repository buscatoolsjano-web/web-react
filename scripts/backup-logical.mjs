/**
 * Backup lógico restaurable, previo a la importación del catálogo.
 *
 * Produce UN archivo .sql con:
 *   extensiones · esquemas · tablas · constraints · índices · funciones ·
 *   vistas · triggers · RLS · políticas · grants · DATOS de las tablas
 *
 * El esquema sale de la base VIVA (función temporal `public.dump_schema()`),
 * no de los archivos del repo: así el backup refleja lo que realmente hay.
 *
 * No hay pg_dump ni psql disponibles en este entorno, y el CLI de Supabase
 * necesitaría además la contraseña de Postgres. Este script cumple la misma
 * función usando la API con la clave administrativa.
 *
 * SEGURIDAD
 *   · La clave se lee de SUPABASE_SECRET_KEY y NUNCA se imprime.
 *   · El archivo se escribe FUERA del repositorio.
 *   · No se muestran datos por consola: sólo recuentos y tamaños.
 *
 * USO
 *   set -a; source .env.migration; set +a
 *   node scripts/backup-logical.mjs --out <ruta/fuera/del/repo/backup.sql>
 */
import { writeFileSync, statSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const arg = (n, d = null) => {
  const i = process.argv.indexOf(n)
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d
}

const SALIDA = arg('--out')
if (!SALIDA) {
  console.error('Falta --out <ruta>. Debe apuntar FUERA del repositorio.')
  process.exit(1)
}
if (/web-react[\\/](?!.*\.\.)/.test(SALIDA.replace(/\\/g, '/')) && !SALIDA.includes('..')) {
  console.error('La ruta parece estar dentro del repositorio. El backup va fuera de Git.')
  process.exit(1)
}

const PROYECTO = 'uaxcfufvapzulqvynanp'
const URL = process.env.SUPABASE_URL ?? `https://${PROYECTO}.supabase.co`
const CLAVE = process.env.SUPABASE_SECRET_KEY
if (!CLAVE) {
  console.error('Falta SUPABASE_SECRET_KEY en el entorno.')
  process.exit(1)
}
const sb = createClient(URL, CLAVE, { auth: { persistSession: false } })

/**
 * Orden de restauración (respeta las FK) y clave de paginación.
 *
 * La clave de orden tiene que ser ÚNICA para que el orden sea TOTAL. Sin
 * eso, `.range()` devuelve páginas que se solapan y saltean filas. No
 * todas las tablas tienen `id`: `currencies` va por `code`, y las de PK
 * compuesta necesitan las dos columnas.
 */
const TABLAS = [
  ['currencies', ['code']],
  ['companies', ['id']],
  ['profiles', ['id']],
  ['warehouses', ['id']],
  ['price_lists', ['id']],
  ['customers', ['id']],
  ['company_memberships', ['id']],
  ['product_categories', ['id']],
  ['brands', ['id']],
  ['product_attribute_definitions', ['id']],
  ['product_attribute_categories', ['attribute_definition_id', 'category_id']],
  ['products', ['id']],
  ['product_prices', ['id']],
  ['stock_movements', ['id']],
  ['stock_balances', ['product_id', 'warehouse_id']],
  ['stock_reservations', ['id']],
]

/** Literal SQL de un valor. Nunca se imprime por consola. */
function lit(v) {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (Array.isArray(v)) {
    if (v.length === 0) return `'{}'`
    if (v.every((x) => typeof x === 'string')) {
      return `ARRAY[${v.map((x) => `'${x.replace(/'/g, "''")}'`).join(',')}]::text[]`
    }
    return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
  }
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
  return `'${String(v).replace(/'/g, "''")}'`
}

async function traerTodo(tabla, orden = ['id'], pagina = 1000) {
  const filas = []
  for (let desde = 0; ; desde += pagina) {
    let q = sb.from(tabla).select('*')
    for (const col of orden) q = q.order(col, { ascending: true })
    const { data, error } = await q.range(desde, desde + pagina - 1)
    if (error) throw new Error(`${tabla}: ${error.message}`)
    filas.push(...(data ?? []))
    if (!data || data.length < pagina) break
  }
  return filas
}

async function main() {
  const t0 = Date.now()
  const tomado = new Date().toISOString()
  console.log(`Backup lógico — proyecto ${PROYECTO}`)
  console.log(`Tomado: ${tomado}`)

  const { data: esquema, error: eS } = await sb.rpc('dump_schema')
  if (eS) throw new Error(`dump_schema: ${eS.message}`)
  if (!esquema || esquema.length < 500) throw new Error('El volcado del esquema vino vacío o incompleto.')

  const partes = [
    '-- ═══════════════════════════════════════════════════════════════',
    '-- BACKUP LÓGICO — BUSCATOOLS',
    `-- Proyecto origen : ${PROYECTO}`,
    `-- Tomado (UTC)    : ${tomado}`,
    '-- Contenido       : esquema completo + datos de las tablas de Etapa 1',
    '--',
    '-- RESTAURACIÓN',
    '--   Sobre un proyecto Supabase VACÍO, ejecutar este archivo entero',
    '--   desde el SQL Editor del panel, o con:',
    `--     psql "<connection-string>" -f <este-archivo>`,
    '--   El orden de las tablas ya respeta las dependencias de FK.',
    '--',
    '--   ⚠ NO ES UN pg_dump. Es un backup lógico reconstruible. No incluye',
    '--   secuencias con su valor actual, propietarios y ACL exactos,',
    '--   comentarios, tipos personalizados, ni auth/storage/realtime.',
    '--',
    '--   ⚠ auth.users NO se incluye: lo administra Supabase Auth y las',
    '--   contraseñas no son exportables. Al recrear los usuarios en OTRO',
    '--   proyecto, Supabase les asigna UUID NUEVOS, así que los ids de este',
    '--   archivo dejan de servir: hace falta un REMAPEO explícito',
    '--   (email -> id nuevo) antes de ejecutarlo. Sobre el MISMO proyecto no',
    '--   hace falta, porque los ids se conservan.',
    '--   Procedimiento completo en docs/database/BACKUP_RESTORE_NOTES.md',
    '-- ═══════════════════════════════════════════════════════════════',
    '',
    'BEGIN;',
    '',
    esquema,
    '',
    '-- ══ DATOS ══',
  ]

  const resumen = []
  for (const [tabla, orden] of TABLAS) {
    const filas = await traerTodo(tabla, orden)
    resumen.push({ tabla, filas: filas.length })
    partes.push(`\n-- ${tabla}: ${filas.length} filas`)
    if (filas.length === 0) continue

    // search_vector es GENERATED: no se puede insertar.
    const columnas = Object.keys(filas[0]).filter((c) => c !== 'search_vector')
    for (let i = 0; i < filas.length; i += 200) {
      const lote = filas.slice(i, i + 200)
      partes.push(
        `INSERT INTO ${tabla} (${columnas.map((c) => `"${c}"`).join(', ')}) VALUES\n` +
          lote.map((f) => '  (' + columnas.map((c) => lit(f[c])).join(', ') + ')').join(',\n') +
          '\nON CONFLICT DO NOTHING;',
      )
    }
  }

  partes.push('', 'COMMIT;', '')
  writeFileSync(SALIDA, partes.join('\n'), 'utf8')

  const st = statSync(SALIDA)
  console.log('\nTabla                          Filas')
  for (const r of resumen) console.log(`  ${r.tabla.padEnd(30)} ${String(r.filas).padStart(6)}`)
  console.log(`\nArchivo : ${SALIDA}`)
  console.log(`Tamaño  : ${st.size} bytes`)
  console.log(`Duración: ${((Date.now() - t0) / 1000).toFixed(1)}s`)

  if (st.size === 0) {
    console.error('\n✗ El archivo quedó vacío.')
    process.exit(1)
  }
  console.log('\n✓ Backup completo.')
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}`)
  process.exit(1)
})
