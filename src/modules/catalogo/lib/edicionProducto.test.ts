import { describe, expect, it } from 'vitest'
import { dominioDeUrl, edicionDesdeProducto, puedeEditarProductos, validarEdicion } from './edicionProducto'
import type { ProductoDetalle } from '../types'

/**
 * Editar un producto desde su ficha (Fase 40).
 *
 * Hasta ahora un producto sólo se podía crear: corregirle el modelo o
 * completarle un atributo exigía entrar a la base.
 */
function producto(p: Partial<ProductoDetalle> = {}): ProductoDetalle {
  return {
    id: 'p1',
    sku: 'SP.2008',
    nombre: 'SPEEDRILL 2008',
    modelo: '2008',
    serie: 'Embocadura',
    tipo: 'Punta',
    esKit: false,
    necesitaRevision: false,
    enCatalogo: true,
    motivoFueraDelCatalogo: null,
    marca: { id: 'm1', nombre: 'SPEEDRILL' },
    categoria: { id: 'c1', nombre: 'Puntas', slug: 'puntas' },
    atributos: {},
    precio: null,
    stock: { real: 0, virtual: 0 },
    disponible: null,
    imagen: null,
    imagenes: [],
    descripcion: null,
    descripcionLarga: null,
    origen: null,
    ncm: null,
    pesoG: null,
    volumenCm3: null,
    notasPrivadas: null,
    linksDeCompra: null,
    ...p,
  } as ProductoDetalle
}

describe('El formulario arranca con lo que el producto tiene', () => {
  it('los campos simples, con vacío donde no hay dato', () => {
    const e = edicionDesdeProducto(producto({ modelo: '2008', pesoG: 120 }))
    expect(e.nombre).toBe('SPEEDRILL 2008')
    expect(e.modelo).toBe('2008')
    expect(e.pesoG).toBe('120')
    // Sin dato es cadena vacía, no «null» ni «0»: cero es un peso, la ausencia no.
    expect(e.volumenCm3).toBe('')
    expect(e.origen).toBe('')
  })

  /**
   * Lo importante de todo esto: en el maestro migrado hay productos con
   * atributos que su categoría actual no declara. El formulario muestra sólo
   * los declarados, pero LOS LLEVA TODOS: si mandara únicamente los que
   * muestra, guardar borraría los otros sin avisar.
   */
  it('se lleva TODOS los atributos, también los que la categoría no declara', () => {
    const e = edicionDesdeProducto(
      producto({ atributos: { encastre: '1/4 HEX', medida: '8', heredado_del_legacy: 'x' } }),
    )
    expect(e.atributos).toEqual({ encastre: '1/4 HEX', medida: '8', heredado_del_legacy: 'x' })
  })

  /** El código de barras vive dentro de los atributos, como en el alta. */
  it('el código de barras sale de los atributos y no se duplica', () => {
    const e = edicionDesdeProducto(producto({ atributos: { barcode: '779123', medida: '8' } }))
    expect(e.codigoBarras).toBe('779123')
    expect(e.atributos).toEqual({ medida: '8' })
  })

  it('un atributo numérico llega como texto editable', () => {
    const e = edicionDesdeProducto(producto({ atributos: { largo: 100 } as never }))
    expect(e.atributos['largo']).toBe('100')
  })

  it('los links y la observación privada, cuando los hay', () => {
    const e = edicionDesdeProducto(
      producto({
        notasPrivadas: 'Conviene pedirlo con dos semanas.',
        linksDeCompra: [{ id: 'l1', label: 'Mercado Libre', url: 'https://x.test/a', notas: 'USD 2' }],
      }),
    )
    expect(e.notasPrivadas).toBe('Conviene pedirlo con dos semanas.')
    expect(e.links).toEqual([{ label: 'Mercado Libre', url: 'https://x.test/a', notas: 'USD 2' }])
  })

  /** `null` es «no te corresponde verlo», no «está vacío». El form lo trata igual. */
  it('sin permiso para verlos, el formulario arranca vacío y no rompe', () => {
    const e = edicionDesdeProducto(producto({ notasPrivadas: null, linksDeCompra: null }))
    expect(e.notasPrivadas).toBe('')
    expect(e.links).toEqual([])
  })
})

describe('Qué se puede guardar', () => {
  const base = edicionDesdeProducto(producto())

  it('sin nombre no se guarda: la columna es NOT NULL', () => {
    expect(validarEdicion({ ...base, nombre: '   ' })).toContain('El nombre no puede quedar vacío.')
  })

  it('sin categoría tampoco', () => {
    expect(validarEdicion({ ...base, categoriaId: '' })[0]).toMatch(/categoría/)
  })

  /**
   * Lo que entra a la base vuelve a salir a un `href`. Un `javascript:` sería
   * un clic a una ejecución, y por eso lo rechazan la pantalla Y el CHECK de
   * la tabla.
   */
  it('un link que no es http o https se rechaza', () => {
    const errores = validarEdicion({
      ...base,
      links: [{ label: 'x', url: 'javascript:alert(1)', notas: '' }],
    })
    expect(errores[0]).toMatch(/http/)
  })

  it('un link vacío no es un error: es una fila que todavía no se llenó', () => {
    expect(validarEdicion({ ...base, links: [{ label: '', url: '  ', notas: '' }] })).toEqual([])
  })

  it('lo válido pasa', () => {
    expect(validarEdicion({ ...base, links: [{ label: 'ML', url: 'https://x.test', notas: '' }] })).toEqual([])
  })
})

describe('Detalles de presentación', () => {
  it('el dominio sirve de etiqueta cuando el link no tiene nombre', () => {
    expect(dominioDeUrl('https://www.mercadolibre.com.ar/x?y=1')).toBe('mercadolibre.com.ar')
  })

  it('lo que no es una URL se muestra tal cual, sin romper', () => {
    expect(dominioDeUrl('no es una url')).toBe('no es una url')
  })

  it('editan los mismos que crean; RLS lo vuelve a decidir', () => {
    expect(['admin', 'employee', 'salesperson', undefined].map(puedeEditarProductos)).toEqual([
      true,
      true,
      false,
      false,
    ])
  })
})
