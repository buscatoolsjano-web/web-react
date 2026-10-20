import { describe, expect, it } from 'vitest'
import {
  huellaDeOrigen,
  LARGOS,
  limpiar,
  limpiarItems,
  MAXIMO_CANTIDAD,
  MAXIMO_RENGLONES,
  pareceEmail,
  revisar,
} from './logica'

/**
 * Lo que decide si un pedido de la calle entra a la base (Fase 87 · E3).
 *
 * Esta función es lo único que escribe sin que haya una persona identificada
 * del otro lado, y corre con la clave de servicio, que saltea RLS. Lo que
 * justifica ese privilegio es exactamente lo que se prueba acá.
 */
const valido = {
  nombre: 'Juan Pérez',
  email: 'juan@metalurgica.com.ar',
  items: [{ sku: 'SP.PH2', nombre: 'SPEEDRILL PH2', cantidad: 10 }],
}

describe('la trampa para robots', () => {
  it('un campo escondido completado descarta el pedido', () => {
    const r = revisar({ ...valido, web: 'http://spam' })
    expect(r.ok).toBe(false)
  })

  it('y contesta que salió bien: decirle «te descubrí» le enseña a esquivarla', () => {
    const r = revisar({ ...valido, web: 'x' })
    expect(r.ok === false && r.mensaje).toMatch(/Recibimos/)
    expect(r.ok === false && r.motivo).toBe('trampa')
  })

  it('vacío o ausente no molesta a nadie', () => {
    expect(revisar({ ...valido, web: '' }).ok).toBe(true)
    expect(revisar(valido).ok).toBe(true)
  })
})

describe('lo que se exige', () => {
  it('nombre y correo', () => {
    expect(revisar({ ...valido, nombre: '   ' }).ok).toBe(false)
    expect(revisar({ ...valido, email: 'no-es-un-correo' }).ok).toBe(false)
  })

  it('con productos O con texto: una de las dos alcanza', () => {
    // Pedir las dos perdería consultas; no pedir ninguna deja pedidos que no
    // se pueden contestar.
    expect(revisar({ ...valido, items: [], mensaje: 'Necesito asesoramiento' }).ok).toBe(true)
    expect(revisar({ ...valido, items: valido.items, mensaje: '' }).ok).toBe(true)
    expect(revisar({ ...valido, items: [], mensaje: '' }).ok).toBe(false)
  })

  it('el resto es opcional: pedir más campos obligatorios es perder consultas', () => {
    const r = revisar(valido)
    expect(r.ok && r.pedido.empresa).toBeNull()
    expect(r.ok && r.pedido.telefono).toBeNull()
  })

  it('el correo se guarda en minúscula', () => {
    const r = revisar({ ...valido, email: '  JUAN@Metalurgica.COM.ar ' })
    expect(r.ok && r.pedido.email).toBe('juan@metalurgica.com.ar')
  })
})

describe('los largos', () => {
  it('un nombre de cuarenta mil caracteres no es un nombre', () => {
    const r = revisar({ ...valido, nombre: 'A'.repeat(40_000) })
    expect(r.ok && r.pedido.nombre.length).toBe(LARGOS.nombre)
  })

  it('el mensaje se recorta y no se descarta', () => {
    const r = revisar({ ...valido, mensaje: 'B'.repeat(10_000) })
    expect(r.ok && r.pedido.mensaje?.length).toBe(LARGOS.mensaje)
  })

  it('los caracteres de control se van, y los espacios se juntan', () => {
    expect(limpiar('hola\u0000\u0007   mundo\n\n', 100)).toBe('hola mundo')
  })
})

describe('los renglones', () => {
  it('descarta los que no tienen SKU o cantidad usable', () => {
    const items = limpiarItems([
      { sku: 'SP.PH2', nombre: 'A', cantidad: 2 },
      { nombre: 'sin sku', cantidad: 1 },
      { sku: 'SP.PH3', cantidad: 0 },
      { sku: 'SP.PH4', cantidad: 'muchos' },
      { sku: 'SP.PH5', nombre: 'E', cantidad: 3 },
    ])
    expect(items.map((i) => i.sku)).toEqual(['SP.PH2', 'SP.PH5'])
  })

  it('no repite un SKU: dos renglones del mismo producto son uno', () => {
    const items = limpiarItems([
      { sku: 'SP.PH2', cantidad: 2 },
      { sku: 'SP.PH2', cantidad: 5 },
    ])
    expect(items).toHaveLength(1)
  })

  it('sin nombre, el SKU hace de nombre', () => {
    expect(limpiarItems([{ sku: 'SP.PH2', cantidad: 1 }])[0]?.nombre).toBe('SP.PH2')
  })

  it('corta en el tope de renglones', () => {
    const muchos = Array.from({ length: 300 }, (_, i) => ({ sku: `S${i}`, cantidad: 1 }))
    expect(limpiarItems(muchos)).toHaveLength(MAXIMO_RENGLONES)
  })

  it('y en el tope de cantidad', () => {
    expect(limpiarItems([{ sku: 'X', cantidad: 1e9 }])[0]?.cantidad).toBe(MAXIMO_CANTIDAD)
  })

  it('lo que no es una lista se trata como ninguna', () => {
    expect(limpiarItems('todo el catálogo')).toEqual([])
    expect(limpiarItems(null)).toEqual([])
  })

  it('NO guarda ningún id interno, aunque lo manden', () => {
    // El pedido tiene que seguir diciendo qué pidieron aunque el producto se
    // renombre o se dé de baja. Y un id interno no tiene por qué viajar.
    const items = limpiarItems([{ sku: 'SP.PH2', cantidad: 1, productId: 'uuid-secreto' }])
    expect(JSON.stringify(items)).not.toContain('uuid-secreto')
    expect(Object.keys(items[0] ?? {}).sort()).toEqual(['cantidad', 'nombre', 'sku'])
  })
})

describe('pareceEmail', () => {
  it('acepta lo que es una dirección', () => {
    for (const e of ['a@b.co', 'juan.perez@metalurgica.com.ar', 'x+y@z.io']) {
      expect(pareceEmail(e), e).toBe(true)
    }
  })

  it('rechaza lo que no se puede contestar', () => {
    for (const e of ['', 'juan', 'juan@', '@dominio.com', 'juan@dominio', 'a b@c.com']) {
      expect(pareceEmail(e), e).toBe(false)
    }
  })
})

describe('la huella de la conexión', () => {
  it('la misma IP da la misma huella', async () => {
    const a = await huellaDeOrigen('200.1.2.3', 'sal')
    const b = await huellaDeOrigen('200.1.2.3', 'sal')
    expect(a).toBe(b)
  })

  it('con otra sal, otra huella: sin el secreto no se puede revertir', async () => {
    // El espacio de direcciones IPv4 es tan chico que sin sal cualquiera con
    // la tabla podría probar las cuatro mil millones y descubrir cuál es cuál.
    const a = await huellaDeOrigen('200.1.2.3', 'sal')
    const b = await huellaDeOrigen('200.1.2.3', 'otra')
    expect(a).not.toBe(b)
  })

  it('no guarda la dirección', async () => {
    expect(await huellaDeOrigen('200.1.2.3', 'sal')).not.toContain('200.1.2.3')
  })

  it('de una cadena con varias toma la primera, que es la de origen', async () => {
    const encadenada = await huellaDeOrigen('200.1.2.3, 10.0.0.1, 10.0.0.2', 'sal')
    expect(encadenada).toBe(await huellaDeOrigen('200.1.2.3', 'sal'))
  })

  it('sin dirección, sin huella', async () => {
    expect(await huellaDeOrigen('', 'sal')).toBeNull()
  })
})
