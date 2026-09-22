// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { clickDeFicha } from './ficha'
import { enlaceFicha, fichaDeFila } from './rankings'

/**
 * Abrir una ficha desde el informe sin perder el informe (Fase 21 · E3).
 *
 * Lo que se prueba acá es la regla del click, que es donde está el riesgo: un
 * overlay que se queda con TODOS los clicks convierte un enlace en un botón
 * disfrazado, y el que quería abrir el cliente en otra pestaña para comparar
 * dos informes se queda sin poder hacerlo. La ficha en sí es el cajón de
 * Clientes y el modal de Catálogo, que ya tienen sus tests.
 */
const evento = (extra: Partial<React.MouseEvent> = {}) => {
  const preventDefault = vi.fn()
  const e = {
    button: 0,
    defaultPrevented: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault,
    ...extra,
  }
  // Se devuelve el espía aparte: leerlo desde el evento es un método suelto.
  return { e: e as unknown as React.MouseEvent, preventDefault }
}

const sinSeleccion = () => {
  vi.stubGlobal('getSelection', () => ({ toString: () => '' }))
}

describe('El click común abre encima', () => {
  it('se queda con el click y abre la ficha', () => {
    sinSeleccion()
    const abrir = vi.fn()
    const { e, preventDefault } = evento()
    clickDeFicha(abrir)(e)
    expect(abrir).toHaveBeenCalledOnce()
    expect(preventDefault).toHaveBeenCalledOnce()
  })
})

describe('Los clicks del navegador siguen siendo del navegador', () => {
  it.each([
    ['ctrl', { ctrlKey: true }],
    ['cmd', { metaKey: true }],
    ['shift', { shiftKey: true }],
    ['alt', { altKey: true }],
  ])('con %s no lo intercepta: abrir en otra pestaña tiene que seguir funcionando', (_, mod) => {
    sinSeleccion()
    const abrir = vi.fn()
    const { e, preventDefault } = evento(mod)
    clickDeFicha(abrir)(e)
    expect(abrir).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('el botón del medio tampoco', () => {
    sinSeleccion()
    const abrir = vi.fn()
    clickDeFicha(abrir)(evento({ button: 1 }).e)
    expect(abrir).not.toHaveBeenCalled()
  })

  it('si alguien ya lo manejó, no lo manejamos de nuevo', () => {
    sinSeleccion()
    const abrir = vi.fn()
    clickDeFicha(abrir)(evento({ defaultPrevented: true }).e)
    expect(abrir).not.toHaveBeenCalled()
  })

  it('seleccionar un nombre para copiarlo no abre nada', () => {
    vi.stubGlobal('getSelection', () => ({ toString: () => 'WHIRLPOOL ARGENTINA' }))
    const abrir = vi.fn()
    const { e, preventDefault } = evento()
    clickDeFicha(abrir)(e)
    expect(abrir).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })
})

describe('Una fila enlazable es una fila abrible, y al revés', () => {
  const fila = (x: Partial<Parameters<typeof fichaDeFila>[0]>) => ({
    cliente_id: null,
    producto_id: null,
    codigo: null,
    vinculado: true,
    ...x,
  })

  it('un cliente vinculado abre su ficha', () => {
    expect(fichaDeFila(fila({ cliente_id: 'cli-1' }))).toEqual({ tipo: 'cliente', id: 'cli-1' })
  })

  it('un producto del catálogo abre la suya', () => {
    expect(fichaDeFila(fila({ producto_id: 'prod-1', codigo: 'PRO05462' }))).toEqual({
      tipo: 'producto',
      id: 'prod-1',
    })
  })

  it('una línea histórica sin producto del catálogo no abre nada', () => {
    // El SKU existe pero no hay producto detrás: no hay ficha que mostrar.
    expect(fichaDeFila(fila({ producto_id: 'prod-1', codigo: 'VIEJO-1', vinculado: false }))).toBeNull()
  })

  it('un cliente sin vincular tampoco', () => {
    expect(fichaDeFila(fila({ cliente_id: null, vinculado: false }))).toBeNull()
  })

  it.each([
    ['cliente', fila({ cliente_id: 'cli-1' })],
    ['producto', fila({ producto_id: 'prod-1', codigo: 'PRO05462' })],
    ['línea histórica', fila({ producto_id: 'prod-1', codigo: 'VIEJO-1', vinculado: false })],
    ['sin nada', fila({})],
  ])('%s: enlazar y abrir coinciden, no puede haber una sin la otra', (_, f) => {
    expect(fichaDeFila(f) === null).toBe(enlaceFicha(f) === null)
  })
})
