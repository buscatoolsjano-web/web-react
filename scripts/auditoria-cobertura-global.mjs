/**
 * Auditoría global de cobertura legacy → React. SÓLO LECTURA.
 *
 * Lee archivos locales: el respaldo del legacy (app.js, index.html,
 * firebase-messaging-sw.js) y el código React de este repo. No toca bases de
 * datos, no hace requests, no escribe nada salvo el JSON de salida si se pide.
 *
 *   node scripts/auditoria-cobertura-global.mjs <dir-legacy> [salida.json]
 *
 * Imprime un resumen; con `salida.json` vuelca el inventario completo.
 *
 * Nunca imprime literales de secretos: los tokens y claves se reportan sólo
 * como «presente en línea N».
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) { console.error('uso: node scripts/auditoria-cobertura-global.mjs <dir-legacy> [salida.json]'); process.exit(1) }
const salida = process.argv[3] ?? null

const app = readFileSync(join(dir, 'app.js'), 'utf8')
const html = readFileSync(join(dir, 'index.html'), 'utf8')
const lineas = app.split('\n')
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16)
const lineaDe = (idx) => app.slice(0, idx).split('\n').length

// ─── 1. Estructura de navegación ────────────────────────────────────────────
const bloqueSections = app.slice(app.indexOf('const SECTIONS = {'), app.indexOf('// MULTI-EMPRESA'))
const sections = {}
for (const m of bloqueSections.matchAll(/^\s{2}([a-z-]+):\s*\{\s*items:\s*\[([\s\S]*?)\]\s*\}/gm)) {
  sections[m[1]] = [...m[2].matchAll(/key:'([^']+)',\s*label:'([^']+)'/g)].map((x) => ({ key: x[1], label: x[2] }))
}
// Desde la primera rama de render: antes hay un `if` de estilos de mantenimientos que no renderiza.
const inicioRm = app.indexOf("if (state.section === 'inicio') m.innerHTML")
const rm = app.slice(inicioRm, inicioRm + 4000)
// Una rama puede ocupar varias líneas (mantenimientos): se toma el primer render de cada `if`.
const router = [...rm.matchAll(/if \(state\.section === '([a-z-]+)'\)([\s\S]*?)(?=\n\s*else|\n\s*\/\/ Refresh)/g)]
  .map((x) => ({ section: x[1], render: x[2].match(/m\.innerHTML = (render[A-Za-z]+)\(/)?.[1] ?? null }))
  .filter((r, i, a) => r.render && a.findIndex((y) => y.section === r.section) === i)
const permSecciones = (app.match(/const PERM_SECCIONES = \[([^\]]+)\]/)?.[1] ?? '').match(/'[^']+'/g)?.map((s) => s.slice(1, -1)) ?? []
const iLeft = html.indexOf('id="left-nav"')
const leftNav = (html.slice(iLeft, iLeft + 200000).replace(/<svg[\s\S]*?<\/svg>/g, '')
  .match(/<div class="ln-(?:item|group-label)[^>]*>[\s\S]*?<\/div>/g) ?? [])
  .map((d) => d.includes('ln-group-label') ? { grupo: d.replace(/<[^>]+>/g, '').trim() }
    : { section: d.match(/data-lnav-section="([a-z-]+)"/)?.[1] ?? null, label: (d.match(/ln-label">([^<]+)/)?.[1] ?? '').trim() })
const topnav = [...html.matchAll(/class="topnav-item[^"]*"[^>]*data-section="([a-z-]+)"/g)].map((x) => x[1])

// ─── 2. Funciones y regiones ────────────────────────────────────────────────
const banners = []
lineas.forEach((l, i) => {
  const m = l.match(/^\/\/\s*={3,}\s*(.+?)\s*={0,}\s*$/) ?? l.match(/^\/\/\s*[═=]{2,}\s*(.+?)\s*[═=]{2,}/)
  if (m && m[1].length > 2 && m[1].length < 90) banners.push({ linea: i + 1, titulo: m[1].replace(/[═=]+$/, '').trim() })
})
const funciones = []
for (const m of app.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) funciones.push({ nombre: m[1], linea: lineaDe(m.index) })
const conteoIdent = new Map()
for (const m of (app + '\n' + html).matchAll(/[A-Za-z_$][\w$]*/g)) conteoIdent.set(m[0], (conteoIdent.get(m[0]) ?? 0) + 1)
const region = (linea) => { let b = null; for (const x of banners) { if (x.linea <= linea) b = x; else break } return b?.titulo ?? '(sin banner)' }
for (const f of funciones) { f.referencias = (conteoIdent.get(f.nombre) ?? 1) - 1; f.region = region(f.linea) }

const porPrefijo = (re) => funciones.filter((f) => re.test(f.nombre)).map((f) => `${f.nombre}:${f.linea}`)
const renders = porPrefijo(/^_?render[A-Z]/)
const modales = porPrefijo(/(Modal|Dialog|Drawer|Popup)$|^(abrir|open|mostrar|show)[A-Z].*(Modal|Panel|Form|Editor)/)
const wires = porPrefijo(/^_?wire[A-Z]/)

// Código muerto: definida y nunca referenciada (ni por nombre en app.js ni en index.html).
const muertas = funciones.filter((f) => f.referencias === 0)

// ─── 3. Exports, impresiones, backups ───────────────────────────────────────
const buscar = (re, max = 400) => {
  const r = []
  lineas.forEach((l, i) => { if (re.test(l) && r.length < max) r.push({ linea: i + 1, region: region(i + 1), texto: l.trim().slice(0, 140) }) })
  return r
}
const exportsCsv = buscar(/downloadCSV\(|text\/csv|\.csv['"`]/)
const exportsJson = buscar(/application\/json['"]|\.json['"`]\s*;?\s*a\.click|backup.*json|downloadJSON\(/i)
const impresiones = buscar(/window\.print\(|\.print\(\)|jsPDF|html2pdf|html2canvas/)
const importaciones = buscar(/type=["']file["'].*accept=["'][^"']*(json|csv|xlsx)|FileReader\(\)|XLSX\.read/i)

// ─── 4. Placeholders ────────────────────────────────────────────────────────
// «todo» es castellano: TODO/FIXME sólo en mayúsculas y dentro de un comentario.
const placeholders = buscar(/Próximamente|próximamente|proximamente|🚧|&#128679;|en construcción|coming soon|\bstub\b|no implementad|info-tab-placeholder|\bempty\(/i)
  .concat(buscar(/\/\/\s*(TODO|FIXME)\b\s*[:(-]/))
  .sort((a, b) => a.linea - b.linea)
const emptyFn = funciones.find((f) => f.nombre === 'empty')

// ─── 5. Persistencia ────────────────────────────────────────────────────────
const clavesLs = new Set()
for (const m of app.matchAll(/(?:localStorage\.(?:getItem|setItem|removeItem)\(|_ekey\(|_cachedJSONParse\()\s*['"]([a-zA-Z0-9_:-]+)['"]/g)) clavesLs.add(m[1])
const syncKeys = (app.match(/SUPA_SYNC_KEYS\s*=\s*\[([^\]]+)\]/)?.[1] ?? '').match(/'[^']+'/g)?.map((s) => s.slice(1, -1)) ?? []
const tablasRest = new Map()
for (const m of app.matchAll(/\/rest\/v1\/([a-z_]+)/g)) tablasRest.set(m[1], (tablasRest.get(m[1]) ?? 0) + 1)

// ─── 6. Integraciones (hosts) y secretos (sólo ubicación) ───────────────────
const hosts = new Map()
for (const m of (app + readFileSync(join(dir, 'firebase-messaging-sw.js'), 'utf8')).matchAll(/https:\/\/([a-zA-Z0-9.-]+\.[a-z]{2,})/g)) hosts.set(m[1], (hosts.get(m[1]) ?? 0) + 1)
const secretos = buscar(/bterp_|sk-[A-Za-z0-9]{10,}|AIza[0-9A-Za-z_-]{20}|service_role|private_key/).map((x) => ({ linea: x.linea, region: x.region })) // sin texto

// ─── 7. React ───────────────────────────────────────────────────────────────
const raiz = process.cwd()
const rutasTsx = readFileSync(join(raiz, 'src/app/routes.tsx'), 'utf8')
const rutasReact = [...rutasTsx.matchAll(/path: '([^']+)'/g)].map((x) => x[1])
const layout = readFileSync(join(raiz, 'src/layouts/AppLayout.tsx'), 'utf8')
const menuReact = [...layout.matchAll(/to: '([^']+)',\s*\n?\s*label: '([^']+)'/g)].map((x) => ({ to: x[1], label: x[2] }))
const modulos = readdirSync(join(raiz, 'src/modules')).map((m) => {
  const archivos = []
  const rec = (d) => readdirSync(d).forEach((e) => { const p = join(d, e); statSync(p).isDirectory() ? rec(p) : /\.tsx?$/.test(e) && !/\.test\./.test(e) && archivos.push(p) })
  rec(join(raiz, 'src/modules', m))
  const src = archivos.map((p) => readFileSync(p, 'utf8')).join('\n')
  return {
    modulo: m, archivos: archivos.length,
    tablas: [...new Set([...src.matchAll(/\.from\('([a-z_]+)'\)/g)].map((x) => x[1]))].sort(),
    rpcs: [...new Set([...src.matchAll(/\.rpc\('([a-z_]+)'/g)].map((x) => x[1]))].sort(),
  }
})

const inventario = {
  legacy: {
    app_js: { bytes: app.length, lineas: lineas.length, sha256: sha(app) },
    index_html: { bytes: html.length, sha256: sha(html) },
    sections, router, permSecciones, leftNav, topnav,
    funciones: funciones.length, renders, modales, wires, banners: banners.length,
    muertas: muertas.map((f) => `${f.nombre}:${f.linea} [${f.region}]`),
    exportsCsv, exportsJson, impresiones, importaciones, placeholders,
    empty: emptyFn ? `empty:${emptyFn.linea}` : null,
    clavesLocalStorage: [...clavesLs].sort(), syncKeys, tablasRest: Object.fromEntries(tablasRest),
    hosts: Object.fromEntries([...hosts].sort((a, b) => b[1] - a[1])),
    secretos_ubicacion: secretos,
  },
  react: { rutas: rutasReact, menu: menuReact, modulos },
}

console.log(`legacy app.js ${inventario.legacy.app_js.lineas} líneas · sha256 ${inventario.legacy.app_js.sha256}`)
console.log(`SECTIONS: ${Object.keys(sections).length} · router: ${router.length} · PERM_SECCIONES: ${permSecciones.length} · left-nav: ${leftNav.filter((x) => x.section).length} ítems`)
console.log(`secciones en SECTIONS sin render en el router: ${Object.keys(sections).filter((s) => !router.some((r) => r.section === s)).join(', ') || '—'}`)
console.log(`secciones del router fuera de SECTIONS: ${router.filter((r) => !sections[r.section]).map((r) => r.section).join(', ') || '—'}`)
console.log(`funciones: ${funciones.length} · render: ${renders.length} · modales: ${modales.length} · wire: ${wires.length} · sin referencias: ${muertas.length}`)
console.log(`exports CSV: ${exportsCsv.length} · JSON: ${exportsJson.length} · impresión/PDF: ${impresiones.length} · importaciones: ${importaciones.length} · placeholders: ${placeholders.length}`)
console.log(`localStorage: ${clavesLs.size} claves · SUPA_SYNC_KEYS: ${syncKeys.length} · tablas REST: ${tablasRest.size}`)
console.log(`hosts externos: ${hosts.size} · líneas con secretos (sin valor): ${secretos.length}`)
console.log(`react: ${rutasReact.length} rutas · ${menuReact.length} ítems de menú · módulos ${modulos.map((m) => `${m.modulo}(${m.archivos})`).join(' ')}`)
if (salida) { writeFileSync(salida, JSON.stringify(inventario, null, 2)); console.log(`inventario completo → ${salida}`) }
