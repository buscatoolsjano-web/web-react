// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  ACENTOS,
  APARIENCIA_ORIGINAL,
  PRESETS,
  aplicarApariencia,
  aplicarAparienciaInicial,
  esOriginal,
  guardarAparienciaLocal,
  leerAparienciaGuardada,
  moduloDeRuta,
  normalizarApariencia,
  olvidarAparienciaLocal,
} from './opciones'

beforeEach(() => {
  localStorage.clear()
  for (const k of ['theme', 'apariencia', 'acento', 'tamano', 'fuente', 'modulo']) delete document.documentElement.dataset[k]
})

describe('catálogo', () => {
  it('17 presets del ERP HTML (9 oscuros), 8 acentos, ids únicos; el original es Claro naranja', () => {
    expect(PRESETS).toHaveLength(17)
    expect(PRESETS.filter((p) => p.modo === 'oscuro')).toHaveLength(9)
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(17)
    expect(ACENTOS.map((a) => a.id)).toContain('tema')
    expect(APARIENCIA_ORIGINAL).toEqual({ version: 1, preset: 'claro-naranja', acento: 'tema', tamano: 'normal', fuente: 'sistema' })
    expect(PRESETS.map((p) => p.nombre)).toEqual([
      'Claro naranja', 'Oscuro naranja', 'Turquesa marino', 'Violeta claro', 'Azul marino', 'Verde menta claro', 'Azul cielo oscuro', 'Azul noche',
      'Azul corporativo', 'Azul corporativo claro', 'Gris pizarra oscuro', 'Verde esmeralda', 'Azul eléctrico', 'Verde industrial', 'Grafito', 'Naranja oscuro', 'Cian oscuro',
    ])
  })
})

describe('normalizar', () => {
  it('valor válido pasa tal cual; inválido cae al original campo por campo', () => {
    expect(normalizarApariencia({ version: 1, preset: 'grafito', acento: 'verde', tamano: 'grande', fuente: 'serif' })).toEqual({ version: 1, preset: 'grafito', acento: 'verde', tamano: 'grande', fuente: 'serif' })
    expect(normalizarApariencia({ preset: 'hacker', acento: 'verde', tamano: 40, fuente: 'Comic Sans' })).toEqual({ ...APARIENCIA_ORIGINAL, acento: 'verde' })
    for (const basura of [null, undefined, 'grafito', 42, [], ['grafito']]) expect(normalizarApariencia(basura)).toEqual(APARIENCIA_ORIGINAL)
    expect(esOriginal(normalizarApariencia(null))).toBe(true)
  })
})

describe('aplicar al <html>', () => {
  it('preset oscuro → data-theme dark; acento del tema no deja atributo; tamaño y fuente', () => {
    aplicarApariencia({ version: 1, preset: 'grafito', acento: 'tema', tamano: 'grande', fuente: 'clasica' })
    const d = document.documentElement.dataset
    expect([d.theme, d.apariencia, d.acento, d.tamano, d.fuente]).toEqual(['dark', 'grafito', undefined, 'grande', 'clasica'])
    aplicarApariencia({ ...APARIENCIA_ORIGINAL, acento: 'rosa' })
    expect([d.theme, d.apariencia, d.acento]).toEqual(['light', 'claro-naranja', 'rosa'])
  })

  it('caché local por usuario: la de A no se aplica a B; al cerrar sesión se borra', () => {
    const grafito = { ...APARIENCIA_ORIGINAL, preset: 'grafito' as const }
    guardarAparienciaLocal('usuario-a', grafito)
    expect(leerAparienciaGuardada('usuario-a')).toEqual(grafito)
    expect(leerAparienciaGuardada('usuario-b')).toBeNull()
    olvidarAparienciaLocal()
    expect(leerAparienciaGuardada('usuario-a')).toBeNull()
  })

  it('antes del primer render: sólo con sesión guardada se aplica la caché (sin sesión, original)', () => {
    guardarAparienciaLocal('usuario-a', { ...APARIENCIA_ORIGINAL, preset: 'azul-noche' })
    aplicarAparienciaInicial()
    expect(document.documentElement.dataset.apariencia).toBeUndefined()
    localStorage.setItem('bt-auth', '{}')
    aplicarAparienciaInicial()
    expect([document.documentElement.dataset.theme, document.documentElement.dataset.apariencia]).toEqual(['dark', 'azul-noche'])
  })
})

describe('módulo de la ruta', () => {
  it('sólo Ventas, Compras y Mantenimiento tienen color propio', () => {
    expect(['/ventas', '/ventas/pedidos/1', '/compras/facturas', '/mantenimiento/ordenes/x'].map(moduloDeRuta)).toEqual(['ventas', 'ventas', 'compras', 'mantenimiento'])
    expect(['/', '/catalogo', '/clientes/1', '/emails', '/informes', '/configuracion', '/ventasx', '/auth/login'].map(moduloDeRuta)).toEqual([null, null, null, null, null, null, null, null])
  })
})
