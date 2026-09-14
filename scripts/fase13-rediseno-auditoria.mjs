/**
 * Fase 13 · Rediseño — Entrega 0: auditoría estática de estilos y componentes.
 *
 * SÓLO LECTURA. No toca la base, no cambia archivos, no instala nada. Lee
 * `src/` (CSS Modules, TSX, tokens) y, si existe, `dist/` (tamaños del build).
 *
 * Mide lo que la revisión visual después confirma en pantalla:
 *   · colores literales fuera de tokens y variables CSS usadas pero no definidas;
 *   · escalas reales: font-size, radius, shadow, min-height, z-index, breakpoints;
 *   · clases duplicadas entre módulos (botones, chips, cards, paginadores…);
 *   · patrones repetidos en TSX: diálogos, paginadores, títulos, vacíos,
 *     «Cargando…», errores, estilos inline, íconos (emoji/unicode/svg);
 *   · contraste WCAG de los pares de la paleta actual;
 *   · tamaño del bundle.
 *
 *   node scripts/fase13-rediseno-auditoria.mjs            → resumen legible
 *   node scripts/fase13-rediseno-auditoria.mjs --json     → todo en JSON
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const RAIZ = process.cwd()
const SRC = join(RAIZ, 'src')
const JSON_OUT = process.argv.includes('--json')

const archivos = (dir, ext) => {
  const out = []
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...archivos(p, ext))
    else if (ext.some((e) => n.endsWith(e))) out.push(p)
  }
  return out
}
const rel = (p) => relative(RAIZ, p).replaceAll('\\', '/')
const modulo = (p) => {
  const r = rel(p)
  const m = r.match(/^src\/modules\/([^/]+)/)
  if (m) return m[1]
  if (r.startsWith('src/layouts')) return 'layouts'
  if (r.startsWith('src/components')) return 'components'
  if (r.startsWith('src/features')) return 'features'
  if (r.startsWith('src/styles')) return 'styles'
  if (r.startsWith('src/app')) return 'app'
  return 'otros'
}
const contar = (arr) => Object.entries(arr.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1])
const sinComentarios = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const css = archivos(SRC, ['.css'])
const tsx = archivos(SRC, ['.tsx']).filter((p) => !/\.test\.tsx$/.test(p))

// ── Tokens definidos ────────────────────────────────────────────────────────
const tokensCss = readFileSync(join(SRC, 'styles', 'tokens.css'), 'utf8')
const definidos = new Set([...tokensCss.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]))
const tokenValor = Object.fromEntries([...sinComentarios(tokensCss).split(':root[data-theme=\'dark\']')[0].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)].map((m) => [m[1], m[2].trim()]))

// ── CSS ─────────────────────────────────────────────────────────────────────
const r = {
  archivosCss: css.length,
  lineasCss: 0,
  cssPorModulo: {},
  coloresLiterales: [],
  varsNoDefinidas: [],
  fontSize: [],
  fontWeight: [],
  radius: [],
  shadow: [],
  minHeight: [],
  zIndex: [],
  media: [],
  transiciones: [],
  clases: {},
}
for (const f of css) {
  const txt = readFileSync(f, 'utf8')
  const limpio = sinComentarios(txt)
  const lineas = txt.split('\n').length
  r.lineasCss += lineas
  const mod = modulo(f)
  r.cssPorModulo[mod] = (r.cssPorModulo[mod] ?? 0) + lineas
  const esTokens = rel(f) === 'src/styles/tokens.css'
  const locales = new Set([...limpio.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]))
  if (!esTokens) {
    for (const m of limpio.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi)) r.coloresLiterales.push({ archivo: rel(f), valor: m[0].toLowerCase() })
  }
  for (const m of limpio.matchAll(/var\((--[a-z0-9-]+)/gi)) if (!definidos.has(m[1]) && !locales.has(m[1])) r.varsNoDefinidas.push({ archivo: rel(f), var: m[1] })
  for (const m of limpio.matchAll(/font-size:\s*([^;]+);/gi)) r.fontSize.push(m[1].trim())
  for (const m of limpio.matchAll(/font-weight:\s*([^;]+);/gi)) r.fontWeight.push(m[1].trim())
  for (const m of limpio.matchAll(/border-radius:\s*([^;]+);/gi)) r.radius.push(m[1].trim())
  for (const m of limpio.matchAll(/box-shadow:\s*([^;]+);/gi)) r.shadow.push(m[1].trim())
  for (const m of limpio.matchAll(/min-height:\s*([^;]+);/gi)) r.minHeight.push(m[1].trim())
  for (const m of limpio.matchAll(/z-index:\s*([^;]+);/gi)) r.zIndex.push(m[1].trim())
  for (const m of limpio.matchAll(/@media\s*([^{]+)\{/gi)) r.media.push(m[1].replace(/\s+/g, ' ').trim())
  for (const m of limpio.matchAll(/transition:\s*([^;]+);/gi)) r.transiciones.push(m[1].trim())
  if (!esTokens) for (const m of limpio.matchAll(/^\s*\.([a-zA-Z][a-zA-Z0-9_]*)\s*[,{:]/gm)) (r.clases[m[1]] ??= new Set()).add(rel(f))
}

// ── TSX ─────────────────────────────────────────────────────────────────────
const t = { archivosTsx: tsx.length, dialogos: [], paginadores: [], inline: [], iconos: [], svg: [], cargando: [], alertas: 0, vacios: [], tabs: [], botonNativo: 0, botonComponente: 0, h1: [], toasts: [], windowConfirm: [], selects: 0, inputsDate: 0, statusMessage: 0, responsiveTable: 0, tablasNativas: [] }
const ICONO = /[←-⇿⌀-⏿─-➿⬀-⯿\u{1F300}-\u{1FAFF}]|&#9776;|&times;|&larr;|&rarr;/gu
for (const f of tsx) {
  const txt = readFileSync(f, 'utf8')
  const r2 = rel(f)
  if (/role="dialog"|role=\{?'dialog'|<dialog/.test(txt)) t.dialogos.push(r2)
  if (/Paginador|paginador|Anterior<\/|'Anterior'|>\s*Anterior\s*</.test(txt)) t.paginadores.push(r2)
  const inl = (txt.match(/style=\{\{/g) ?? []).length
  if (inl) t.inline.push([r2, inl])
  const ico = [...txt.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '').matchAll(ICONO)].map((m) => m[0])
  if (ico.length) t.iconos.push([r2, [...new Set(ico)].join(' ')])
  if (/<svg/.test(txt)) t.svg.push(r2)
  if (/Cargando/.test(txt)) t.cargando.push(r2)
  t.alertas += (txt.match(/role="alert"/g) ?? []).length
  if (/emptyMessage|styles\.vacio|className=\{styles\.empty|No hay |todavía no tiene|Ningún/.test(txt)) t.vacios.push(r2)
  if (/role="tablist"|role="tab"/.test(txt)) t.tabs.push(r2)
  t.botonNativo += (txt.match(/<button\b/g) ?? []).length
  t.botonComponente += (txt.match(/<Button\b/g) ?? []).length
  for (const m of txt.matchAll(/<h1[^>]*className=\{([^}]+)\}/g)) t.h1.push(`${modulo(f)}:${m[1].trim()}`)
  if (/toast|Toast|snackbar/i.test(txt)) t.toasts.push(r2)
  if (/window\.confirm\(|window\.alert\(|\balert\(/.test(txt)) t.windowConfirm.push(r2)
  t.selects += (txt.match(/<select\b/g) ?? []).length
  t.inputsDate += (txt.match(/type="date"/g) ?? []).length
  t.statusMessage += (txt.match(/<StatusMessage\b/g) ?? []).length
  t.responsiveTable += (txt.match(/<ResponsiveTable\b/g) ?? []).length
  if (/<table\b/.test(txt)) t.tablasNativas.push(r2)
}

// ── Contraste (WCAG 2.1) ────────────────────────────────────────────────────
const hex = (v) => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v ?? '')
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
}
const lum = (rgb) => { const [R, G, B] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * R + 0.7152 * G + 0.0722 * B }
const ratio = (a, b) => { const A = hex(a), B = hex(b); if (!A || !B) return null; const [x, y] = [lum(A), lum(B)].sort((p, q) => q - p); return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100 }
const pares = [
  ['--text', '--bg'], ['--text', '--surface'], ['--text-soft', '--surface'], ['--text-soft', '--bg'], ['--text-muted', '--surface'], ['--text-muted', '--bg'],
  ['#ffffff', '--primary'], ['#ffffff', '--primary-hover'], ['--primary', '--surface'], ['--primary-text', '--primary-light'], ['--primary-text', '--surface'],
  ['--warning-text', '--warning-light'], ['--success', '--surface'], ['--success', '--success-light'], ['--text', '--success-light'], ['--danger', '--surface'],
  ['#ffffff', '--danger'], ['--topnav-text-soft', '--topnav-bg'], ['--text-soft', '--surface-alt'], ['--border', '--surface'], ['--border-strong', '--surface'],
]
const contraste = pares.map(([a, b]) => {
  const va = a.startsWith('--') ? tokenValor[a] : a
  const vb = b.startsWith('--') ? tokenValor[b] : b
  const c = ratio(va, vb)
  return { par: `${a} sobre ${b}`, valores: `${va} / ${vb}`, ratio: c, aaTexto: c !== null && c >= 4.5, aaGrande: c !== null && c >= 3 }
})

// ── Bundle ──────────────────────────────────────────────────────────────────
let bundle = null
const DIST = join(RAIZ, 'dist', 'assets')
if (existsSync(DIST)) {
  const fs = readdirSync(DIST).map((n) => ({ n, b: statSync(join(DIST, n)).size }))
  const js = fs.filter((x) => x.n.endsWith('.js'))
  const cssB = fs.filter((x) => x.n.endsWith('.css'))
  bundle = {
    jsTotalKB: Math.round(js.reduce((s, x) => s + x.b, 0) / 1024),
    cssTotalKB: Math.round(cssB.reduce((s, x) => s + x.b, 0) / 1024),
    chunksJs: js.length,
    chunksCss: cssB.length,
    mayores: js.sort((a, b) => b.b - a.b).slice(0, 8).map((x) => `${x.n.replace(/-[A-Za-z0-9_-]{8}\.js$/, '')} ${Math.round(x.b / 1024)} kB`),
  }
}

const duplicadas = Object.entries(r.clases).filter(([, s]) => s.size >= 4).map(([k, s]) => [k, s.size]).sort((a, b) => b[1] - a[1])
const resumen = {
  css: {
    archivos: r.archivosCss,
    lineas: r.lineasCss,
    porModulo: Object.entries(r.cssPorModulo).sort((a, b) => b[1] - a[1]),
    coloresLiteralesFueraDeTokens: r.coloresLiterales.length,
    coloresTop: contar(r.coloresLiterales.map((c) => c.valor)).slice(0, 15),
    archivosConColoresLiterales: contar(r.coloresLiterales.map((c) => c.archivo)).slice(0, 12),
    varsNoDefinidas: contar(r.varsNoDefinidas.map((v) => v.var)),
    archivosConVarsNoDefinidas: contar(r.varsNoDefinidas.map((v) => v.archivo)).slice(0, 15),
    fontSize: contar(r.fontSize),
    fontWeight: contar(r.fontWeight),
    radius: contar(r.radius),
    shadow: contar(r.shadow),
    minHeight: contar(r.minHeight),
    zIndex: contar(r.zIndex),
    media: contar(r.media),
    transiciones: contar(r.transiciones).slice(0, 10),
    clasesRepetidasEn4oMasArchivos: duplicadas.slice(0, 30),
  },
  tsx: {
    archivos: t.archivosTsx,
    dialogos: t.dialogos,
    paginadores: t.paginadores,
    estilosInline: t.inline.sort((a, b) => b[1] - a[1]),
    iconosUnicode: t.iconos,
    svgInline: t.svg,
    textoCargando: t.cargando.length,
    roleAlert: t.alertas,
    vacios: t.vacios.length,
    tabs: t.tabs,
    botonesNativos: t.botonNativo,
    botonesComponente: t.botonComponente,
    clasesDeH1: contar(t.h1),
    toasts: t.toasts,
    windowConfirmAlert: t.windowConfirm,
    selects: t.selects,
    inputsDate: t.inputsDate,
    statusMessage: t.statusMessage,
    responsiveTable: t.responsiveTable,
    tablasNativas: t.tablasNativas,
  },
  contraste,
  bundle,
}

if (JSON_OUT) {
  console.log(JSON.stringify(resumen, null, 2))
} else {
  const L = (t, v) => console.log(`  ${t.padEnd(38)} ${typeof v === 'string' ? v : JSON.stringify(v)}`)
  console.log('\n  CSS')
  L('archivos / líneas', `${resumen.css.archivos} / ${resumen.css.lineas}`)
  L('líneas por módulo', resumen.css.porModulo.map(([m, n]) => `${m} ${n}`).join(' · '))
  L('colores literales fuera de tokens', resumen.css.coloresLiteralesFueraDeTokens)
  L('colores más usados', resumen.css.coloresTop.map(([c, n]) => `${c}×${n}`).join(' '))
  L('variables usadas y NO definidas', resumen.css.varsNoDefinidas.map(([v, n]) => `${v}×${n}`).join(' '))
  L('font-size distintos', `${resumen.css.fontSize.length}: ${resumen.css.fontSize.map(([v, n]) => `${v}×${n}`).join(' ')}`)
  L('font-weight distintos', resumen.css.fontWeight.map(([v, n]) => `${v}×${n}`).join(' '))
  L('border-radius distintos', `${resumen.css.radius.length}: ${resumen.css.radius.map(([v, n]) => `${v}×${n}`).join(' ')}`)
  L('box-shadow distintos', `${resumen.css.shadow.length}: ${resumen.css.shadow.map(([v, n]) => `${v}×${n}`).join(' | ')}`)
  L('min-height distintos', resumen.css.minHeight.map(([v, n]) => `${v}×${n}`).join(' '))
  L('z-index distintos', resumen.css.zIndex.map(([v, n]) => `${v}×${n}`).join(' '))
  L('media queries distintas', `${resumen.css.media.length}: ${resumen.css.media.map(([v, n]) => `${v}×${n}`).join(' | ')}`)
  L('clases repetidas (≥4 archivos)', resumen.css.clasesRepetidasEn4oMasArchivos.map(([c, n]) => `.${c}×${n}`).join(' '))
  console.log('\n  TSX')
  L('archivos', resumen.tsx.archivos)
  L('diálogos propios', `${resumen.tsx.dialogos.length}: ${resumen.tsx.dialogos.join(', ')}`)
  L('paginadores', `${resumen.tsx.paginadores.length}: ${resumen.tsx.paginadores.join(', ')}`)
  L('window.confirm / alert', resumen.tsx.windowConfirmAlert.join(', ') || '0')
  L('botones nativos / <Button>', `${resumen.tsx.botonesNativos} / ${resumen.tsx.botonesComponente}`)
  L('<ResponsiveTable> / <table> nativas', `${resumen.tsx.responsiveTable} / ${resumen.tsx.tablasNativas.length} (${resumen.tsx.tablasNativas.join(', ')})`)
  L('<StatusMessage>', resumen.tsx.statusMessage)
  L('estilos inline (archivo×n)', resumen.tsx.estilosInline.map(([a, n]) => `${a.replace('src/', '')}×${n}`).join(' '))
  L('íconos unicode/emoji', resumen.tsx.iconosUnicode.map(([a, i]) => `${a.replace('src/', '')}[${i}]`).join(' '))
  L('SVG inline', resumen.tsx.svgInline.join(', ') || '0')
  L('tabs (role=tab)', resumen.tsx.tabs.join(', ') || '0')
  L('toasts', resumen.tsx.toasts.join(', ') || '0')
  L('clases de h1', resumen.tsx.clasesDeH1.map(([c, n]) => `${c}×${n}`).join(' '))
  console.log('\n  CONTRASTE (WCAG AA texto normal ≥ 4.5 · grande/UI ≥ 3)')
  for (const c of resumen.contraste) console.log(`  ${c.par.padEnd(46)} ${String(c.ratio).padStart(5)}  ${c.aaTexto ? 'AA' : c.aaGrande ? 'sólo grande/UI' : 'NO'}  (${c.valores})`)
  if (resumen.bundle) {
    console.log('\n  BUNDLE (dist/)')
    L('JS total / chunks', `${resumen.bundle.jsTotalKB} kB / ${resumen.bundle.chunksJs}`)
    L('CSS total / chunks', `${resumen.bundle.cssTotalKB} kB / ${resumen.bundle.chunksCss}`)
    L('mayores', resumen.bundle.mayores.join(' · '))
  }
  console.log('')
}
