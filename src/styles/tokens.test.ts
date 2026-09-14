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
const tokens = sinComentarios(fs.readFileSync(`${SRC}/styles/tokens.css`, 'utf8'))
const TODOS_LOS_CSS = Object.fromEntries(archivosCss(SRC).map((p) => [p.slice(SRC.length + 1), fs.readFileSync(p, 'utf8')]))

// Valores del tema claro (sin el bloque oscuro), resolviendo var() encadenados.
const claro = sinComentarios(tokens.split(":root[data-theme='dark']")[0]!)
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
