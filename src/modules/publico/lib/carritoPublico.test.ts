import { describe, expect, it } from 'vitest'
import {
  cantidadDe,
  CLAVE_CARRITO_PUBLICO,
  escribirCarrito,
  leerCarrito,
  MAXIMO_CANTIDAD,
  MAXIMO_RENGLONES,
  ponerCantidad,
  quitar,
  restar,
  sumar,
  unidades,
  type CarritoPublico,
} from './carritoPublico'
import { CLAVE_CARRITO } from '@/modules/catalogo/lib/carrito'

const PH2 = {
  sku: 'SP.PH2',
  slug: 'speedrill-ph2-phillips',
  categoriaSlug: 'puntas-y-tubos',
  nombre: 'SPEEDRILL PH2 PHILLIPS',
}
const PH3 = { ...PH2, sku: 'SP.PH3', slug: 'speedrill-ph3-phillips' }

describe('no se mezcla con el carrito del ERP', () => {
  it('guarda en otra clave', () => {
    // Son dos carritos de dos personas distintas en el mismo navegador:
    // alguien de la casa puede estar cotizando en el ERP y mirar el sitio
    // público en otra pestaña.
    expect(CLAVE_CARRITO_PUBLICO).not.toBe(CLAVE_CARRITO)
  })
})

describe('agregar y sacar', () => {
  it('suma de a uno y acumula', () => {
    let c: CarritoPublico = []
    c = sumar(c, PH2)
    c = sumar(c, PH2)
    expect(cantidadDe(c, 'SP.PH2')).toBe(2)
    expect(c).toHaveLength(1)
  })

  it('poner una cantidad exacta pisa la anterior', () => {
    const c = ponerCantidad(sumar([], PH2), PH2, 10)
    expect(cantidadDe(c, 'SP.PH2')).toBe(10)
  })

  it('llegar a cero saca el renglón: no existe «está con cantidad 0»', () => {
    const c = restar(sumar([], PH2), 'SP.PH2')
    expect(c).toEqual([])
  })

  it('restar de más tampoco deja negativos', () => {
    expect(restar(sumar([], PH2), 'SP.PH2', 99)).toEqual([])
  })

  it('restar algo que no está no rompe nada', () => {
    const c = sumar([], PH2)
    expect(restar(c, 'NO.EXISTE')).toBe(c)
  })

  it('quitar saca ese y deja los demás', () => {
    const c = quitar(sumar(sumar([], PH2), PH3), 'SP.PH2')
    expect(c.map((i) => i.sku)).toEqual(['SP.PH3'])
  })

  it('cuenta las unidades, que es el número del globito', () => {
    const c = ponerCantidad(sumar([], PH3), PH3, 4)
    expect(unidades(sumar(c, PH2, 3))).toBe(7)
  })
})

describe('los topes', () => {
  it('no entran más renglones que el máximo', () => {
    // Un pedido de doscientos renglones no es un pedido: del otro lado hay
    // una persona que lo tiene que leer.
    let c: CarritoPublico = []
    for (let i = 0; i < MAXIMO_RENGLONES + 10; i += 1) {
      c = sumar(c, { ...PH2, sku: `SKU.${i}` })
    }
    expect(c).toHaveLength(MAXIMO_RENGLONES)
  })

  it('pero sí se puede cambiar la cantidad de uno que ya está, con la lista llena', () => {
    // El tope es para AGREGAR: cambiarle la cantidad a uno que ya está nunca
    // hace crecer la lista, y bloquearlo dejaría el carrito congelado.
    let c: CarritoPublico = []
    for (let i = 0; i < MAXIMO_RENGLONES; i += 1) c = sumar(c, { ...PH2, sku: `SKU.${i}` })
    const despues = ponerCantidad(c, { ...PH2, sku: 'SKU.0' }, 7)
    expect(despues).toHaveLength(MAXIMO_RENGLONES)
    expect(cantidadDe(despues, 'SKU.0')).toBe(7)
  })

  it('la cantidad por renglón también tiene techo', () => {
    expect(cantidadDe(ponerCantidad([], PH2, 1e9), 'SP.PH2')).toBe(MAXIMO_CANTIDAD)
  })

  it('una cantidad con coma se redondea para abajo', () => {
    expect(cantidadDe(ponerCantidad([], PH2, 3.9), 'SP.PH2')).toBe(3)
  })
})

describe('lo que se leyó del navegador', () => {
  it('va y vuelve igual, con la foto incluida', () => {
    // La foto se guarda al agregar, para dibujar el carrito sin volver a
    // pedir la ficha de cada renglón (Fase 87 · E3b).
    const conFoto = { ...PH2, imagen: 'https://x/y.jpg' }
    const c = ponerCantidad(sumar([], conFoto), conFoto, 5)
    expect(leerCarrito(escribirCarrito(c))).toEqual(c)
  })

  it('sin foto, el renglón vuelve con imagen null', () => {
    const c = ponerCantidad(sumar([], PH2), PH2, 5)
    expect(leerCarrito(escribirCarrito(c))[0]?.imagen).toBeNull()
  })

  it('sin nada guardado, carrito vacío', () => {
    expect(leerCarrito(null)).toEqual([])
    expect(leerCarrito('')).toEqual([])
  })

  it('lo que no es JSON no rompe la pantalla', () => {
    expect(leerCarrito('{roto')).toEqual([])
    expect(leerCarrito('"una cadena"')).toEqual([])
  })

  it('descarta el renglón malo y conserva los buenos', () => {
    // Lo guardado lo pudo editar cualquiera a mano. Perder un renglón es
    // molesto; perder la lista entera porque uno estaba mal es peor.
    const crudo = JSON.stringify([
      { sku: 'SP.PH2', nombre: 'Punta', slug: 'x', categoriaSlug: 'y', cantidad: 2 },
      { nombre: 'sin sku', cantidad: 3 },
      { sku: 'SP.PH3', cantidad: 'muchos' },
      { sku: 'SP.PH4', nombre: 'Otra', slug: 'z', categoriaSlug: 'y', cantidad: 1 },
    ])
    expect(leerCarrito(crudo).map((i) => i.sku)).toEqual(['SP.PH2', 'SP.PH4'])
  })

  it('sin nombre, el SKU hace de nombre', () => {
    const crudo = JSON.stringify([{ sku: 'SP.PH2', cantidad: 1 }])
    expect(leerCarrito(crudo)[0]?.nombre).toBe('SP.PH2')
  })

  it('una lista larguísima se recorta al tope', () => {
    const crudo = JSON.stringify(
      Array.from({ length: 500 }, (_, i) => ({ sku: `S${i}`, nombre: 'x', cantidad: 1 })),
    )
    expect(leerCarrito(crudo)).toHaveLength(MAXIMO_RENGLONES)
  })
})
