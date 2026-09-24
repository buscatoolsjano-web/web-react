import { describe, expect, it } from 'vitest'
import { CATALOGOS, hojaDeCatalogo, urlDeHoja } from './hojaCatalogo'
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
 * La hoja del catálogo (Fase 21 · E1, reescrita en Fase 25 · E6).
 *
 * Dos fuentes reales y ninguna inventada. Lo que estos tests fijan es que no
 * se invente una tercera: un producto sin ninguna de las dos **no tiene**
 * hoja, y decirlo es parte del trabajo. Y fijan la precedencia, que es lo que
 * cambió: la página del catálogo impreso le gana a la lámina compartida.
 */
describe('De dónde sale la hoja del catálogo', () => {
  it('la página del catálogo impreso le gana a la lámina compartida', () => {
    const hoja = hojaDeCatalogo({ catalogo_id: 'speedrill', catalogo_pagina: 93 }, [
      imagen('shared_diagram', '/diagrams/page-022-fam-0.png'),
    ])
    expect(hoja?.catalogo).toBe('speedrill')
    expect(hoja?.pagina).toBe(93)
    expect(hoja?.imagenUrl).toBe('https://janoguarini.github.io/catalogos-buscatools/speedrill-093.jpg')
  })

  it('SPEEDRILL rellena la página a tres dígitos; el resto, a dos', () => {
    expect(urlDeHoja('speedrill', 7)).toBe('https://janoguarini.github.io/catalogos-buscatools/speedrill-007.jpg')
    expect(urlDeHoja('nogravity', 3)).toBe('https://janoguarini.github.io/catalogos-buscatools/nogravity-03.jpg')
    expect(urlDeHoja('torero', 1)).toBe('https://janoguarini.github.io/catalogos-buscatools/torero-01.jpg')
  })

  it('DUROFIX sale de esta app: sus páginas no están publicadas en ninguna otra parte', () => {
    expect(urlDeHoja('durofix', 1)).toBe(`${import.meta.env.BASE_URL}catalogos/durofix-01.jpg`)
  })

  it('una página que el catálogo no tiene no pide una imagen que va a dar 404', () => {
    // durofix tiene 12 páginas; el 93 venía de un dato viejo mal copiado.
    expect(urlDeHoja('durofix', 93)).toBeNull()
    expect(urlDeHoja('speedrill', 0)).toBeNull()
    expect(urlDeHoja('speedrill', 169)).toBeNull()
  })

  it('un catálogo que no conocemos no inventa una URL, pero el dato se sigue mostrando', () => {
    const hoja = hojaDeCatalogo({ catalogo_id: 'un-catalogo-nuevo', catalogo_pagina: 4 }, [])
    expect(hoja).toEqual({
      catalogo: 'un-catalogo-nuevo',
      etiqueta: null,
      pagina: 4,
      familia: null,
      imagenUrl: null,
    })
  })

  it('el catálogo conocido trae su nombre para el encabezado', () => {
    expect(hojaDeCatalogo({ catalogo_id: 'food', catalogo_pagina: 5 }, [])?.etiqueta).toBe('Food Industry')
  })

  it('la página puede venir como texto o como número, y una basura no es página', () => {
    expect(hojaDeCatalogo({ catalogo_id: 'durofix', catalogo_pagina: '12' }, [])?.pagina).toBe(12)
    expect(hojaDeCatalogo({ catalogo_id: 'durofix', catalogo_pagina: 12 }, [])?.pagina).toBe(12)
    expect(hojaDeCatalogo({ catalogo_id: 'durofix', catalogo_pagina: 'tapa' }, [])?.pagina).toBeNull()
    expect(hojaDeCatalogo({ catalogo_id: 'durofix', catalogo_pagina: 0 }, [])?.pagina).toBeNull()
  })

  it('sin catálogo impreso, la página sale del nombre del archivo de la lámina', () => {
    const hoja = hojaDeCatalogo({}, [
      imagen('shared_diagram', 'https://apexbits.com.ar/buscador/images/diagrams/page-022-fam-0.png'),
    ])
    expect(hoja).toEqual({
      catalogo: null,
      etiqueta: null,
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

  it('una lámina con otro nombre sigue siendo la hoja, sin número de página', () => {
    const hoja = hojaDeCatalogo({}, [imagen('shared_diagram', '/diagrams/otra-cosa.png')])
    expect(hoja?.imagenUrl).toBe('/diagrams/otra-cosa.png')
    expect(hoja?.pagina).toBeNull()
  })

  it('una foto del producto NO es la hoja del catálogo', () => {
    expect(hojaDeCatalogo({}, [imagen('product_image', '/fotos/sp-2520.jpg')])).toBeNull()
  })

  it('sin ninguna de las dos fuentes, no hay hoja: no se inventa', () => {
    expect(hojaDeCatalogo({ encastre: '1/4 HEX' }, [])).toBeNull()
  })

  it('los seis catálogos del legacy están, con su cantidad de páginas', () => {
    expect(Object.keys(CATALOGOS).sort()).toEqual(['durofix', 'food', 'generale', 'nogravity', 'speedrill', 'torero'])
    expect(CATALOGOS['speedrill']?.paginas).toBe(168)
    expect(CATALOGOS['torero']?.paginas).toBe(1)
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
