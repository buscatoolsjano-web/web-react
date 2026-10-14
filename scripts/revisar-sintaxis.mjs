/**
 * Revisa que todos los scripts de `scripts/` PARSEEN.
 *
 *   npm run scripts:check
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 *
 * ESLint sólo mira `**\/*.{ts,tsx}`, así que los 160 y pico de `.mjs` de esta
 * carpeta no los valida nada. En la Fase 67 commiteé uno con un `const`
 * declarado dos veces —un error de SINTAXIS, no de lógica— y no se enteró
 * nadie: el script no lo corre ningún test y su mitad interesante está detrás
 * de un token, así que parecía estar bien.
 *
 * Esto no reemplaza a un lint: no mira variables sin usar ni promesas sin
 * esperar. Sólo responde «¿esto arranca?», que es la pregunta que me habría
 * ahorrado el commit roto, y corre en dos segundos.
 *
 * Es portable a propósito: un `for` de bash en un script de npm no corre en
 * Windows, donde npm usa cmd.exe.
 */
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const CARPETA = 'scripts'
const archivos = readdirSync(CARPETA)
  .filter((n) => n.endsWith('.mjs') || n.endsWith('.js'))
  .sort()

let malos = 0
for (const nombre of archivos) {
  const ruta = `${CARPETA}/${nombre}`
  const r = spawnSync(process.execPath, ['--check', ruta], { encoding: 'utf8' })
  if (r.status !== 0) {
    malos++
    console.error(`✗ ${ruta}`)
    console.error((r.stderr ?? '').trim().split('\n').slice(0, 4).join('\n'))
  }
}

console.log(`${archivos.length} scripts revisados, ${malos} con error de sintaxis`)
process.exit(malos === 0 ? 0 : 1)
