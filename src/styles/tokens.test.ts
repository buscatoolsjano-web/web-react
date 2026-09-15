import { describe, expect, it } from 'vitest'

/**
 * Guardas de la Fase 13 sobre los tokens:
 *   · ningún CSS del proyecto usa una variable que no existe;
 *   · los pares texto/fondo de la paleta cumplen WCAG AA.
 *
 * Lee los CSS del disco. Vitest vacía los imports de CSS (también con `?raw`)
 * y el tsconfig de la app no carga los tipos de Node, así que el módulo `fs`
 * se pide con `process.getBuiltinModule` (Node ≥ 22.3, el de CI) y se tipa
 * sólo lo que se usa.
 */
interface FsMinimo {
  readFileSync(ruta: string, codificacion: 'utf8'): string
  readdirSync(ruta: string, opciones: { withFileTypes: true }): { name: string; isDirectory(): boolean }[]
}
const nodeProcess = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(nombre: string): unknown } }).process
const fs = nodeProcess.getBuiltinModule('node:fs') as FsMinimo
const SRC = `${nodeProcess.cwd().replaceAll('\\', '/')}/src`

function archivosCss(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`
    return e.isDirectory() ? archivosCss(p) : e.name.endsWith('.css') ? [p] : []
  })
}

const sinComentarios = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const TOKENS_CRUDO = fs.readFileSync(`${SRC}/styles/tokens.css`, 'utf8')
const tokens = sinComentarios(TOKENS_CRUDO)
const TODOS_LOS_CSS = Object.fromEntries(archivosCss(SRC).map((p) => [p.slice(SRC.length + 1), fs.readFileSync(p, 'utf8')]))

// Valores del tema claro original: capas 1, 1b y 2 (antes de la capa 3 de apariencia).
const MARCA_CAPA_3 = '/* ── 3. Apariencia'
const claro = sinComentarios(TOKENS_CRUDO.split(MARCA_CAPA_3)[0]!)
const crudo = new Map<string, string>()
// Gana la última definición del bloque claro (los alias van después de las escalas).
for (const m of claro.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) crudo.set(m[1]!, m[2]!.trim())

function valor(nombre: string, profundidad = 0): string {
  const v = crudo.get(nombre)
  if (v === undefined) throw new Error(`token no definido: ${nombre}`)
  const ref = /^var\((--[a-z0-9-]+)\)$/i.exec(v)
  if (ref && profundidad < 10) return valor(ref[1]!, profundidad + 1)
  return v
}

function luminancia(hex: string): number {
  const h = hex.replace('#', '')
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const [r, g, b] = c.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(valor(a)), luminancia(valor(b))].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}

describe('tokens', () => {
  it('ningún CSS usa una variable sin definir', () => {
    expect(Object.keys(TODOS_LOS_CSS).length).toBeGreaterThan(90)
    const definidas = new Set([...tokens.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]))
    const faltan: string[] = []
    for (const [f, crudo] of Object.entries(TODOS_LOS_CSS)) {
      const css = sinComentarios(crudo)
      const locales = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]))
      for (const m of css.matchAll(/var\((--[a-z0-9-]+)/gi)) if (!definidas.has(m[1]) && !locales.has(m[1])) faltan.push(`${f} → ${m[1]}`)
    }
    expect(faltan).toEqual([])
  })

  it('texto AA (≥ 4.5) sobre las superficies', () => {
    const pares: [string, string][] = [
      ['--color-text', '--color-bg'],
      ['--color-text-soft', '--color-surface'],
      ['--color-text-soft', '--color-bg'],
      ['--color-text-muted', '--color-surface'],
      ['--color-text-muted', '--color-bg'],
      ['--color-text-muted', '--color-surface-alt'],
      ['--color-text-muted', '--color-neutral-soft'],
      ['--color-on-primary', '--color-primary'],
      ['--color-on-primary', '--color-primary-hover'],
      ['--color-on-primary', '--color-danger'],
      ['--color-primary-text', '--color-surface'],
      ['--color-primary-text', '--color-primary-soft'],
      ['--color-primary', '--color-surface'],
      ['--color-success-text', '--color-success-soft'],
      ['--color-warning-text', '--color-warning-soft'],
      ['--color-danger-text', '--color-danger-soft'],
      ['--color-info-text', '--color-info-soft'],
      ['--color-neutral-text', '--color-neutral-soft'],
      ['--color-text-disabled', '--color-neutral-soft'],
      ['--color-topnav-text-soft', '--color-topnav-bg'],
    ]
    const fallan = pares.map(([t, f]) => [t, f, Math.round(contraste(t, f) * 100) / 100] as const).filter(([, , r]) => r < 4.5)
    expect(fallan).toEqual([])
  })

  it('Catálogo (E4): el contador de facetas cumple AA en chip normal y activo', () => {
    // Antes era `opacity: .75` sobre el chip activo: 3.56:1. Ahora sin opacidad,
    // con --color-text-muted en el chip normal y el color del chip en el activo.
    const css = sinComentarios(TODOS_LOS_CSS['modules/catalogo/components/PanelFacetas.module.css'] ?? '')
    const bloque = (selector: string) => new RegExp(`(^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[2] ?? ''
    expect(css).not.toMatch(/opacity/)
    expect(bloque('.cuenta')).toMatch(/color:\s*var\(--color-text-muted\)/)
    expect(bloque('.chipActivo .cuenta')).toMatch(/color:\s*inherit/)
    expect(css).toMatch(/\.chipActivo,\s*\.chipActivo:hover\s*\{[^}]*color:\s*var\(--color-on-primary\)[^}]*\}/)
    expect(contraste('--color-text-muted', '--color-surface')).toBeGreaterThanOrEqual(4.5)
    expect(contraste('--color-on-primary', '--color-primary')).toBeGreaterThanOrEqual(4.5)
  })

  it('límites de controles ≥ 3:1 (WCAG 1.4.11)', () => {
    expect(contraste('--color-border-strong', '--color-surface')).toBeGreaterThanOrEqual(3)
    expect(contraste('--color-primary', '--color-surface')).toBeGreaterThanOrEqual(3)
  })

  it('los alias viejos resuelven a la paleta nueva (compatibilidad)', () => {
    expect(valor('--primary')).toBe(valor('--color-primary'))
    expect(valor('--text-muted')).toBe(valor('--color-text-muted'))
    expect(valor('--success')).toBe(valor('--color-success-text'))
    expect(valor('--accent')).toBe(valor('--color-primary'))
    expect(valor('--on-primary')).toBe('#ffffff')
    expect(valor('--color-brand-500')).toBe('#f37021')
    expect(valor('--color-primary')).toBe('#c2410c')
  })
})

// ── Fase 14 · E0: apariencia por usuario e identidad por módulo ────────────
//
// Simula la cascada de la capa 3 para cada combinación preset × acento ×
// módulo y mide TODOS los pares texto/fondo y límites de controles. Un preset
// que no llegue a AA no pasa el test, aunque el legacy lo usara así.

interface Bloque {
  attrs: Record<string, string>
  decls: Map<string, string>
}

const capa3 = sinComentarios(TOKENS_CRUDO.slice(TOKENS_CRUDO.indexOf(MARCA_CAPA_3)))
const BLOQUES: Bloque[] = [...capa3.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({
    attrs: Object.fromEntries([...m[1]!.matchAll(/\[data-([a-z]+)='([^']+)'\]/g)].map((a) => [a[1]!, a[2]!])),
    decls: new Map([...m[2]!.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)].map((d) => [d[1]!, d[2]!.trim()])),
  }))
  .filter((b) => b.decls.size > 0 && Object.keys(b.attrs).length > 0)

type Estado = Record<'theme' | 'apariencia' | 'acento' | 'modulo', string | undefined>

function valoresDe(estado: Estado): (nombre: string) => string {
  const mapa = new Map(crudo)
  // Especificidad: los bloques de 1 atributo van antes que los de 2 en el archivo.
  const aplican = BLOQUES.filter((b) => Object.entries(b.attrs).every(([k, v]) => estado[k as keyof Estado] === v)).sort(
    (a, b) => Object.keys(a.attrs).length - Object.keys(b.attrs).length,
  )
  for (const b of aplican) for (const [k, v] of b.decls) mapa.set(k, v)
  const resolver = (nombre: string, prof = 0): string => {
    const v = mapa.get(nombre)
    if (v === undefined) throw new Error(`token no definido: ${nombre}`)
    const ref = /^var\((--[a-z0-9-]+)\)$/i.exec(v)
    return ref && prof < 10 ? resolver(ref[1]!, prof + 1) : v
  }
  return resolver
}

const ratio = (v: (n: string) => string, a: string, b: string) => {
  const [x, y] = [luminancia(v(a)), luminancia(v(b))].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}

/** Pares de texto (≥ 4.5): cada uno es un uso real en CSS Modules o primitivas. */
const TEXTO: [string, string][] = [
  ['--color-text', '--color-bg'],
  ['--color-text', '--color-surface'],
  ['--color-text', '--color-surface-sunken'],
  ['--color-text-soft', '--color-surface'],
  ['--color-text-soft', '--color-bg'],
  ['--color-text-muted', '--color-surface'],
  ['--color-text-muted', '--color-bg'],
  ['--color-text-muted', '--color-surface-alt'],
  ['--color-text-muted', '--color-neutral-soft'],
  ['--color-text-disabled', '--color-neutral-soft'],
  ['--color-neutral-text', '--color-neutral-soft'],
  ['--color-on-primary', '--color-primary'],
  ['--color-on-primary', '--color-primary-hover'],
  ['--color-primary-text', '--color-surface'],
  ['--color-primary-text', '--color-bg'],
  ['--color-primary-text', '--color-primary-soft'],
  ['--color-primary-text', '--color-sidebar-bg'],
  ['--color-on-danger', '--color-danger'],
  ['--color-on-danger', '--color-danger-hover'],
  ['--color-on-danger', '--color-danger-text'],
  ['--color-danger', '--color-surface'],
  ['--color-success-text', '--color-success-soft'],
  ['--color-warning-text', '--color-warning-soft'],
  ['--color-danger-text', '--color-danger-soft'],
  ['--color-info-text', '--color-info-soft'],
  ['--color-topnav-text', '--color-topnav-bg'],
  ['--color-topnav-text', '--color-topnav-hover'],
  ['--color-topnav-text-soft', '--color-topnav-bg'],
  ['--color-on-brand', '--color-brand-500'],
]
/** Límites y foco (≥ 3, WCAG 1.4.11). */
const UI: [string, string][] = [
  ['--color-border-strong', '--color-surface'],
  ['--color-primary', '--color-surface'],
  ['--color-primary', '--color-bg'],
  ['--color-topnav-focus', '--color-topnav-bg'],
]

const PRESET_IDS = [...TOKENS_CRUDO.matchAll(/\[data-apariencia='([a-z-]+)'\]/g)].map((m) => m[1]!)
const MODO_OSCURO = new Set(['oscuro-naranja', 'azul-cielo-oscuro', 'azul-noche', 'gris-pizarra-oscuro', 'verde-esmeralda', 'verde-industrial', 'grafito', 'naranja-oscuro', 'cian-oscuro'])

describe('apariencia (Fase 14 · E0)', () => {
  // Importados con fs para no traer módulos de React al entorno node del test.
  const opciones = fs.readFileSync(`${SRC}/features/apariencia/opciones.ts`, 'utf8')
  const idsTs = (bloque: string) => {
    const desde = opciones.indexOf(`export const ${bloque} = [`)
    return [...opciones.slice(desde, opciones.indexOf('] as const', desde)).matchAll(/id: '([a-z-]+)'/g)].map((m) => m[1]!)
  }
  const PRESETS = idsTs('PRESETS')
  const ACENTOS = idsTs('ACENTOS')
  const modoTs = new Map([...opciones.matchAll(/id: '([a-z-]+)', nombre: '[^']+', modo: '(claro|oscuro)'/g)].map((m) => [m[1]!, m[2]!]))

  it('17 presets y 8 acentos; cada preset (salvo los dos originales) y cada acento tiene su bloque de tokens', () => {
    expect(PRESETS).toHaveLength(17)
    expect(ACENTOS).toHaveLength(8)
    const conBloque = new Set(PRESET_IDS)
    expect(PRESETS.filter((p) => p !== 'claro-naranja' && p !== 'oscuro-naranja' && !conBloque.has(p))).toEqual([])
    for (const a of ACENTOS.filter((x) => x !== 'tema')) {
      expect(TOKENS_CRUDO).toContain(`[data-theme='light'][data-acento='${a}']`)
      expect(TOKENS_CRUDO).toContain(`[data-theme='dark'][data-acento='${a}']`)
    }
    expect([...modoTs].filter(([, m]) => m === 'oscuro').map(([id]) => id).sort()).toEqual([...MODO_OSCURO].sort())
  })

  it('la lista blanca de la base acepta exactamente los mismos ids', () => {
    const sql = fs.readFileSync(`${nodeProcess.cwd().replaceAll('\\', '/')}/docs/database/PHASE_14_ENTREGA_0_APARIENCIA.sql`, 'utf8')
    const lista = (clave: string) => {
      const m = new RegExp(`\\(p ->> '${clave}'\\) in \\(([^)]*)\\)`).exec(sql)
      return [...(m?.[1] ?? '').matchAll(/'([a-z-]+)'/g)].map((x) => x[1]!).sort()
    }
    expect(lista('preset')).toEqual([...PRESETS].sort())
    expect(lista('acento')).toEqual([...ACENTOS].sort())
    expect(lista('tamano')).toEqual(['compacto', 'grande', 'normal'])
    expect(lista('fuente')).toEqual(['clasica', 'serif', 'sistema'])
  })

  it('el original (Claro naranja, acento del tema, sin módulo) es exactamente la paleta de la capa 1', () => {
    const v = valoresDe({ theme: 'light', apariencia: 'claro-naranja', acento: undefined, modulo: undefined })
    for (const t of ['--color-primary', '--color-bg', '--color-surface', '--color-text', '--color-topnav-bg', '--color-danger']) expect(v(t)).toBe(valor(t))
  })

  it('AA en TODAS las combinaciones: 17 presets × 8 acentos × (sin módulo, Ventas, Compras, Mantenimiento)', () => {
    const fallas = new Set<string>()
    let combinaciones = 0
    for (const preset of PRESETS) {
      for (const acento of ACENTOS) {
        for (const modulo of [undefined, 'ventas', 'compras', 'mantenimiento']) {
          combinaciones++
          const estado: Estado = { theme: MODO_OSCURO.has(preset) ? 'dark' : 'light', apariencia: preset, acento: acento === 'tema' ? undefined : acento, modulo }
          const v = valoresDe(estado)
          for (const [a, b] of TEXTO) if (ratio(v, a, b) < 4.5) fallas.add(`${preset}/${acento}/${modulo ?? '-'}: ${a} sobre ${b} = ${ratio(v, a, b).toFixed(2)}`)
          for (const [a, b] of UI) if (ratio(v, a, b) < 3) fallas.add(`${preset}/${acento}/${modulo ?? '-'}: ${a} vs ${b} = ${ratio(v, a, b).toFixed(2)}`)
          // El indicador de módulo y de acento elegido es señal de estado: ≥ 3.
          if (modulo || acento !== 'tema') {
            const r = ratio(v, '--color-indicator', '--color-sidebar-bg')
            if (r < 3) fallas.add(`${preset}/${acento}/${modulo ?? '-'}: indicador = ${r.toFixed(2)}`)
          }
        }
      }
    }
    expect(combinaciones).toBe(17 * 8 * 4)
    expect([...fallas]).toEqual([])
  })

  it('módulos: Ventas verde, Compras azul, Mantenimiento grafito — en claro y en oscuro, y pisan el acento del usuario', () => {
    const tono = (hex: string) => {
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16)) as [number, number, number]
      if (Math.max(r, g, b) - Math.min(r, g, b) < 40) return 'gris'
      return g >= r && g >= b ? 'verde' : b >= r && b >= g ? 'azul' : 'otro'
    }
    for (const [preset, theme] of [['claro-naranja', 'light'], ['violeta-claro', 'light'], ['grafito', 'dark'], ['oscuro-naranja', 'dark']] as const) {
      for (const acento of [undefined, 'rosa']) {
        const de = (modulo: string) => valoresDe({ theme, apariencia: preset, acento, modulo })('--color-primary')
        expect([tono(de('ventas')), tono(de('compras')), tono(de('mantenimiento'))], `${preset}/${acento ?? 'tema'}`).toEqual(['verde', 'azul', 'gris'])
      }
    }
    // En oscuro el grafito es claro con texto oscuro: nada de botón negro sobre fondo negro.
    const oscuro = valoresDe({ theme: 'dark', apariencia: 'grafito', acento: undefined, modulo: 'mantenimiento' })
    expect(luminancia(oscuro('--color-primary'))).toBeGreaterThan(luminancia(oscuro('--color-on-primary')))
  })

  it('los módulos NO tocan estados semánticos ni el aviso STEL (warning)', () => {
    for (const bloque of BLOQUES.filter((b) => b.attrs.modulo || b.attrs.acento)) {
      expect([...bloque.decls.keys()].filter((k) => /success|warning|danger|info|neutral/.test(k))).toEqual([])
    }
  })

  it('el header usa el foco propio y el logo va sobre placa clara fija', () => {
    const shell = sinComentarios(TODOS_LOS_CSS['layouts/Shell.module.css'] ?? '')
    expect(shell).not.toMatch(/outline:\s*2px solid var\(--color-brand-500\)/)
    expect(shell).toMatch(/\.logoFondo\s*\{[^}]*background:\s*var\(--color-logo-plate\)/)
    expect(valor('--color-logo-plate')).toBe('#ffffff')
  })
})

describe('tamaño «Grande» en tablas (Fase 14 · E0)', () => {
  const tabla = TODOS_LOS_CSS['components/tables/ResponsiveTable.module.css']!
  const config = TODOS_LOS_CSS['modules/configuracion/components/Configuracion.module.css']!
  const proveedores = TODOS_LOS_CSS['modules/compras/components/ListadoProveedores.module.css']!
  const bloque = (css: string, media: string, clase: string) =>
    new RegExp(`@media \\(${media.replace(/[()]/g, '\\$&')}\\) \\{[^@]*:root\\[data-tamano='grande'\\] \\.${clase}\\b`).test(sinComentarios(css))

  it('sigue siendo 18px (112,5%)', () => {
    expect(tokens).toMatch(/:root\[data-tamano='grande'\]\s*\{[^}]*font-size:\s*112\.5%/)
  })

  it('las columnas secundarias se ocultan con los cortes corridos, iguales en los tres listados', () => {
    for (const css of [tabla, proveedores]) {
      expect(bloque(css, 'max-width: 1619px', 'ocultaBajoXl')).toBe(true)
      expect(bloque(css, 'max-width: 1151px', 'ocultaBajoLg')).toBe(true)
    }
    expect(bloque(proveedores, 'max-width: 1619px', 'soloCompacta')).toBe(true)
    expect(bloque(proveedores, 'max-width: 1151px', 'soloAngosta')).toBe(true)
    // El dato oculto se repite en la columna principal en los mismos anchos.
    expect(bloque(config, 'min-width: 1280px) and (max-width: 1619px', 'soloTablaCompacta')).toBe(true)
    expect(bloque(config, 'min-width: 1024px) and (max-width: 1151px', 'soloTablaAngosta')).toBe(true)
  })
})
