import { describe, expect, it } from 'vitest'
import { hojaDeCatalogo } from './hojaCatalogo'
import { nombreDeMovimiento, saldosHaciaAtras } from './movimientos'
import type { ImagenProducto } from '../types'

const imagen = (kind: ImagenProducto['kind'], url: string): ImagenProducto => ({
  url,
  thumbUrl: null,
  kind,
  posicion: 0,
  esPrincipal: false,
})

/**
 * La hoja del catálogo (Fase 21 · E1).
 *
 * Dos fuentes reales y ninguna inventada. Lo que estos tests fijan es que no
 * se invente una tercera: un producto sin ninguna de las dos **no tiene**
 * hoja, y decirlo es parte del trabajo.
 */
describe('De dónde sale la hoja del catálogo', () => {
  it('la página sale del nombre del archivo del diagrama compartido', () => {
    const hoja = hojaDeCatalogo({}, [
      imagen('shared_diagram', 'https://apexbits.com.ar/buscador/images/diagrams/page-022-fam-0.png'),
    ])
    expect(hoja).toEqual({
      catalogo: null,
      pagina: 22,
      familia: 0,
      imagenUrl: 'https://apexbits.com.ar/buscador/images/diagrams/page-022-fam-0.png',
    })
  })

  it('los ceros a la izquierda no convierten la página en un número raro', () => {
    const hoja = hojaDeCatalogo({}, [imagen('shared_diagram', '/diagrams/page-008-fam-3.png')])
    expect(hoja?.pagina).toBe(8)
    expect(hoja?.familia).toBe(3)
  })

  it('un diagrama con otro nombre sigue siendo la hoja, sin número de página', () => {
    const hoja = hojaDeCatalogo({}, [imagen('shared_diagram', '/diagrams/otra-cosa.png')])
    expect(hoja?.imagenUrl).toBe('/diagrams/otra-cosa.png')
    expect(hoja?.pagina).toBeNull()
  })

  it('sin diagrama, vale el dato que traía el sistema anterior', () => {
    const hoja = hojaDeCatalogo({ catalogo_id: 'durofix', catalogo_pagina: '93' }, [])
    expect(hoja).toEqual({ catalogo: 'durofix', pagina: 93, familia: null, imagenUrl: null })
  })

  it('la página también puede venir como número', () => {
    expect(hojaDeCatalogo({ catalogo_id: 'durofix', catalogo_pagina: 12 }, [])?.pagina).toBe(12)
  })

  it('una foto del producto NO es la hoja del catálogo', () => {
    expect(hojaDeCatalogo({}, [imagen('product_image', '/fotos/sp-2520.jpg')])).toBeNull()
  })

  it('sin ninguna de las dos fuentes, no hay hoja: no se inventa', () => {
    expect(hojaDeCatalogo({ encastre: '1/4 HEX' }, [])).toBeNull()
  })
})

/**
 * Los saldos del historial se reconstruyen hacia atrás desde el saldo de hoy:
 * la tabla guarda el movimiento, no el saldo.
 */
describe('Los saldos del historial de stock', () => {
  const movs = [
    { cantidad: 2 }, // el más nuevo
    { cantidad: -3 },
    { cantidad: 15 },
  ]

  it('la fila más nueva muestra el saldo actual, y las viejas van restando', () => {
    expect(saldosHaciaAtras(movs, 14).map((f) => f.resultante)).toEqual([14, 12, 15])
  })

  it('sin saldo actual —un rol que no ve stock— no se inventa ninguno', () => {
    expect(saldosHaciaAtras(movs, null).map((f) => f.resultante)).toEqual([null, null, null])
  })

  it('sin movimientos no hay filas', () => {
    expect(saldosHaciaAtras([], 5)).toEqual([])
  })

  it('un tipo desconocido se muestra crudo en vez de desaparecer', () => {
    expect(nombreDeMovimiento('opening_balance')).toBe('Saldo inicial')
    expect(nombreDeMovimiento('algo_nuevo')).toBe('algo_nuevo')
  })
})
