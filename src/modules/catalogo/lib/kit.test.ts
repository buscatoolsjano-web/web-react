import { describe, expect, it } from 'vitest'
import { componentesUtiles, filaVacia, kitsArmables, type ComponenteElegido } from './kit'

const linea = (id: string | null, cantidad: string): ComponenteElegido => ({
  fila: `f-${id ?? 'vacia'}-${cantidad}`,
  producto: id === null ? null : { id, sku: `SKU-${id}`, nombre: `Producto ${id}` },
  cantidad,
})

describe('Las líneas que de verdad se guardan', () => {
  it('deja pasar las completas', () => {
    expect(componentesUtiles([linea('p1', '4'), linea('p2', '1')])).toEqual([
      { productoId: 'p1', cantidad: 4 },
      { productoId: 'p2', cantidad: 1 },
    ])
  })

  /**
   * Agregar una línea y no completarla es lo más normal del mundo mientras se
   * arma una receta: se descarta, no se convierte en un error que frena el alta.
   */
  it('descarta la línea sin producto en vez de fallar', () => {
    expect(componentesUtiles([linea('p1', '2'), linea(null, '1')])).toEqual([
      { productoId: 'p1', cantidad: 2 },
    ])
  })

  it('descarta cantidades que no son un número mayor que cero', () => {
    expect(componentesUtiles([linea('p1', '0'), linea('p2', ''), linea('p3', 'dos')])).toEqual([])
  })

  /** Media pata no existe, pero media hora de servicio sí: los decimales pasan. */
  it('acepta decimales', () => {
    expect(componentesUtiles([linea('p1', '0.5')])).toEqual([{ productoId: 'p1', cantidad: 0.5 }])
  })

  it('una fila nueva nace vacía y con cantidad 1', () => {
    const f = filaVacia()
    expect(f.producto).toBeNull()
    expect(f.cantidad).toBe('1')
    expect(filaVacia().fila).not.toBe(f.fila)
  })
})

describe('Cuántos kits se pueden armar', () => {
  /** El ejemplo de la mesa: 4 patas y 1 tablón. */
  it('manda el componente que primero se acaba', () => {
    expect(kitsArmables([{ cantidad: 4, stock: 9 }, { cantidad: 1, stock: 1 }])).toBe(1)
    expect(kitsArmables([{ cantidad: 4, stock: 8 }, { cantidad: 1, stock: 3 }])).toBe(2)
  })

  it('un componente sin stock deja el kit en cero, aunque sobre el resto', () => {
    expect(kitsArmables([{ cantidad: 4, stock: 999 }, { cantidad: 1, stock: 0 }])).toBe(0)
  })

  /** No se arma medio kit: 9 patas con receta de 4 son 2 kits, no 2,25. */
  it('redondea para abajo', () => {
    expect(kitsArmables([{ cantidad: 4, stock: 9 }])).toBe(2)
  })

  /**
   * Un kit sin receta da 0 y no «infinito». Es la misma decisión que toma
   * `public.stock_de_kit` en la base, que es la autoridad: sin componentes no
   * hay nada que armar.
   */
  it('sin componentes da cero', () => {
    expect(kitsArmables([])).toBe(0)
  })
})
