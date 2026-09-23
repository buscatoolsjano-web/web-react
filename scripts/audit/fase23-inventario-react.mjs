/**
 * Fase 23 · Inventario del React, con el mismo criterio que el del legacy.
 *
 * Extrae rutas, páginas, servicios, hooks, RPCs llamadas, impresión,
 * exportaciones y tests. Sirve para cruzar contra el inventario legacy sin
 * depender de recorrer la UI a ojo.
 *
 *   node scripts/audit/fase23-inventario-react.mjs [--json out.json]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const RAIZ = 'src'

export function archivos(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) archivos(p, out)
    else if (/\.(ts|tsx|css)$/.test(e)) out.push(p)
  }
  return out
}

/** Las rutas declaradas, con su elemento. */
export function rutas(src) {
  const out = []
  for (const m of src.matchAll(/path:\s*'([^']*)'/g)) out.push(m[1])
  for (const m of src.matchAll(/<Route\s+[^>]*path="([^"]*)"/g)) out.push(m[1])
  return [...new Set(out)]
}

const SENALES = {
  imprimir: /window\.print\s*\(|@media\s+print|['"]print['"]/g,
  csv: /text\/csv|\.csv['"`]|ACsv|aCsv|toCsv/g,
  descarga: /createObjectURL|\.download\s*=/g,
  rpc: /\.rpc\(\s*['"`]([a-z_0-9]+)['"`]/g,
  tabla: /\.from\(\s*['"`]([a-z_0-9]+)['"`]/g,
  localStorage: /localStorage\.(getItem|setItem|removeItem)\(\s*['"`]([^'"`]+)/g,
  modal: /role="dialog"|useModalAccesible|Modal[A-Z]/g,
  subidaArchivo: /type="file"|FileReader|\.files\[/g,
  atajoTeclado: /e\.key\s*===|event\.key\s*===|ctrlKey|metaKey/g,
}

function main() {
  const todos = archivos(RAIZ)
  const fuente = todos.filter((f) => /\.tsx?$/.test(f))
  const tests = fuente.filter((f) => /\.test\.tsx?$/.test(f))
  const paginas = fuente.filter((f) => /[\\/]pages[\\/].*\.tsx$/.test(f) && !/\.test\./.test(f))
  const componentes = fuente.filter((f) => /[\\/]components[\\/].*\.tsx$/.test(f) && !/\.test\./.test(f))
  const servicios = fuente.filter((f) => /[\\/]services[\\/]/.test(f) && !/\.test\./.test(f))
  const hooks = fuente.filter((f) => /[\\/]hooks[\\/]/.test(f) && !/\.test\./.test(f))
  const css = todos.filter((f) => f.endsWith('.css'))

  const modulos = [...new Set(
    fuente.map((f) => (/src[\\/]modules[\\/]([^\\/]+)/.exec(f) ?? [])[1]).filter(Boolean),
  )].sort()

  let todoSrc = ''
  for (const f of todos) todoSrc += readFileSync(f, 'utf8') + '\n'

  const rutasDeclaradas = rutas(todoSrc).filter((r) => r !== '' && !r.startsWith('http')).sort()
  const rpcs = [...new Set([...todoSrc.matchAll(SENALES.rpc)].map((m) => m[1]))].sort()
  const tablas = [...new Set([...todoSrc.matchAll(SENALES.tabla)].map((m) => m[1]))].sort()
  const clavesLs = [...new Set([...todoSrc.matchAll(SENALES.localStorage)].map((m) => m[2]))].sort()
  const conPrint = css.filter((f) => /@media\s+print/.test(readFileSync(f, 'utf8'))).map((f) => relative('.', f))
  const conCsv = fuente.filter((f) => /text\/csv|ACsv|aCsv|toCsv/.test(readFileSync(f, 'utf8'))).map((f) => relative('.', f))

  const porModulo = Object.fromEntries(modulos.map((m) => {
    const de = (arr) => arr.filter((f) => f.includes(`modules${'\\'}${m}`) || f.includes(`modules/${m}`)).length
    return [m, {
      paginas: de(paginas), componentes: de(componentes), servicios: de(servicios),
      hooks: de(hooks), tests: de(tests),
    }]
  }))

  const informe = {
    generado: new Date().toISOString(),
    ARCHIVOS_TOTALES: todos.length,
    ARCHIVOS_FUENTE: fuente.length,
    ARCHIVOS_TEST: tests.length,
    PAGINAS: paginas.length,
    COMPONENTES: componentes.length,
    SERVICIOS: servicios.length,
    HOOKS: hooks.length,
    MODULOS: modulos,
    POR_MODULO: porModulo,
    RUTAS: rutasDeclaradas,
    RPCS_LLAMADAS: rpcs,
    TABLAS_LEIDAS: tablas,
    CLAVES_LOCALSTORAGE: clavesLs,
    CSS_CON_IMPRESION: conPrint,
    ARCHIVOS_CON_CSV: conCsv,
    LISTA_PAGINAS: paginas.map((f) => relative('.', f)).sort(),
  }

  const salida = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null
  if (salida) {
    writeFileSync(salida, JSON.stringify({ informe }, null, 2))
    console.error(`${salida} escrito.`)
  }
  const { LISTA_PAGINAS, ...resumen } = informe
  console.log(JSON.stringify(resumen, null, 2))
}

const esteArchivo = import.meta.url.replace(/^file:\/\/\/?/, '').replace(/\\/g, '/').toLowerCase()
const invocado = String(process.argv[1] ?? '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
if (invocado && esteArchivo.endsWith(invocado)) {
  try { main() } catch (e) { console.error(e.stack); process.exit(1) }
}
