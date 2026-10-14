/**
 * Corre las pruebas de punta a punta del servidor MCP pidiendo el token a mano.
 *
 *   node scripts/fase67-con-token.mjs
 *
 * ── Por qué existe, si ya está el e2e ───────────────────────────────────────
 *
 * Porque la forma documentada —`set -a; . ./.env; set +a; ERP_API_TOKEN=… node …`—
 * tiene tres problemas y los tres se cobraron un intento:
 *
 *   1. Es sintaxis de bash. La terminal de Windows es PowerShell y ahí `set -a`
 *      no existe: falla con un error que no se parece a la causa.
 *   2. El token va en la línea de comandos, así que queda en el historial del
 *      shell. Una credencial no tiene por qué quedar escrita en ningún lado.
 *   3. La consola del navegador imprime el token ENTRE COMILLAS, y al pegarlo
 *      dentro de otras comillas quedan adentro del valor. La cabecera sale
 *      `Bearer 'eyJ…'` y el servidor contesta 401 sin decir por qué.
 *
 * Acá el token se pega cuando el script lo pide, no queda en el historial, y
 * las comillas de más se sacan solas. El `.env` lo lee este script, así que no
 * hay que exportar nada.
 */
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

/** Lee `.env` sin depender del shell. Sólo `CLAVE=valor`, que es lo que hay. */
function cargarEnv(ruta = '.env') {
  let texto
  try {
    texto = readFileSync(ruta, 'utf8')
  } catch {
    console.error(`✗ No encontré ${ruta}. Corré esto parado en la carpeta del proyecto.`)
    process.exit(1)
  }
  for (const linea of texto.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(linea.trim())
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

function pedirToken() {
  return new Promise((resolver) => {
    process.stdout.write(
      '\nPegá el token del ERP y apretá Enter.\n' +
        'Lo sacás de la consola del navegador (Ctrl+Shift+J) con:\n' +
        "  copy(JSON.parse(localStorage.getItem('bt-auth')).access_token)\n\n> ",
    )
    process.stdin.setEncoding('utf8')
    let acumulado = ''
    process.stdin.on('data', (trozo) => {
      acumulado += trozo
      const corte = acumulado.indexOf('\n')
      if (corte === -1) return
      process.stdin.pause()
      resolver(acumulado.slice(0, corte))
    })
  })
}

cargarEnv()

const crudo = await pedirToken()
// Las comillas que agrega la consola del navegador, y los espacios de pegar.
const token = crudo.trim().replace(/^["']|["']$/g, '').trim()

if (token === '') {
  console.error('✗ No pegaste nada.')
  process.exit(1)
}
if (!/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) {
  // Un JWT son tres partes separadas por puntos y arranca con `eyJ`. Avisar acá
  // ahorra interpretar veinte 401 seguidos.
  console.error('✗ Eso no parece un token (tiene que empezar con «eyJ» y tener tres partes).')
  process.exit(1)
}

const vence = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp
const minutos = Math.round((vence - Date.now() / 1000) / 60)
if (minutos <= 0) {
  console.error(`✗ Ese token venció hace ${-minutos} minutos. Copiá uno nuevo.`)
  process.exit(1)
}
console.log(`\nToken válido por ${minutos} minutos más. Corriendo las pruebas…\n`)

const r = spawnSync(process.execPath, ['scripts/fase67-erp-mcp-e2e.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, ERP_API_TOKEN: token },
})
process.exit(r.status ?? 1)
