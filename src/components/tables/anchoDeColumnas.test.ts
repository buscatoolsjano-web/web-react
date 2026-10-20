// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acotar,
  anchoInicial,
  anchosDe,
  aplicarArrastre,
  encogerParaQueEntre,
  guardarAnchos,
  leerAnchos,
  MAX_PX,
  MIN_PX,
  olvidarAnchos,
} from './anchoDeColumnas'
import type { Column } from './types'

const col = (p: Partial<Column<unknown>> & { key: string }): Column<unknown> => ({
  header: p.key,
  ...p,
})

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('el ancho de arranque', () => {
  /*
   * EL PROBLEMA QUE RESUELVE. Con `table-layout: fixed` y sin anchos, el
   * navegador reparte en partes IGUALES: una columna de fecha queda tan ancha
   * como una de nombre, que es exactamente «algunos quedan muy grandes y no va,
   * o algunos quedan muy chicos y tampoco va».
   */
  it('cada tipo de dato arranca con un ancho distinto', () => {
    const anchos = (['fecha', 'numero', 'estado', 'codigo', 'texto'] as const).map((tipo) =>
      anchoInicial(col({ key: tipo, tipo })),
    )
    expect(new Set(anchos).size).toBe(5)
    // Una fecha nunca más ancha que un texto libre.
    expect(anchoInicial(col({ key: 'f', tipo: 'fecha' }))).toBeLessThan(anchoInicial(col({ key: 't', tipo: 'texto' })))
  })

  it('un width en px declarado por la página manda sobre el tipo', () => {
    expect(anchoInicial(col({ key: 'x', tipo: 'fecha', width: '300px' }))).toBe(300)
    expect(anchoInicial(col({ key: 'x', width: ' 180px ' }))).toBe(180)
  })

  /* Un `width` en rem o % no se puede convertir a px sin medir la pantalla, así
     que se ignora y vale el tipo: inventar una conversión daría un ancho que no
     es el que la página pidió. */
  it('un width en rem o en porcentaje no se interpreta', () => {
    expect(anchoInicial(col({ key: 'x', tipo: 'fecha', width: '12rem' }))).toBe(
      anchoInicial(col({ key: 'x', tipo: 'fecha' })),
    )
    expect(anchoInicial(col({ key: 'x', width: '20%' }))).toBe(anchoInicial(col({ key: 'x' })))
  })

  // Sin tipo, la alineación es la pista que hay: a la derecha es un número.
  it('sin tipo usa la alineación como pista', () => {
    expect(anchoInicial(col({ key: 'x', align: 'right' }))).toBe(anchoInicial(col({ key: 'y', tipo: 'numero' })))
    expect(anchoInicial(col({ key: 'x', align: 'center' }))).toBe(anchoInicial(col({ key: 'y', tipo: 'estado' })))
    expect(anchoInicial(col({ key: 'x' }))).toBe(anchoInicial(col({ key: 'y', tipo: 'texto' })))
  })

  it('un width absurdo queda acotado', () => {
    expect(anchoInicial(col({ key: 'x', width: '5px' }))).toBe(MIN_PX)
    expect(anchoInicial(col({ key: 'x', width: '9000px' }))).toBe(MAX_PX)
  })
})

describe('acotar', () => {
  it('nunca deja una columna ilegible ni una que empuje al resto afuera', () => {
    expect(acotar(1)).toBe(MIN_PX)
    expect(acotar(99999)).toBe(MAX_PX)
    expect(acotar(200)).toBe(200)
  })

  it('redondea y sobrevive a un número que no es número', () => {
    expect(acotar(200.6)).toBe(201)
    expect(acotar(NaN)).toBeGreaterThanOrEqual(MIN_PX)
    expect(acotar(Infinity)).toBeGreaterThanOrEqual(MIN_PX)
  })
})

describe('arrastrar', () => {
  it('suma el desplazamiento al ancho que tenía al empezar', () => {
    expect(aplicarArrastre({ a: 200 }, 'a', 200, 50)).toEqual({ a: 250 })
    expect(aplicarArrastre({ a: 200 }, 'a', 200, -50)).toEqual({ a: 150 })
  })

  /*
   * Al ancho DE CUANDO EMPEZÓ el gesto, no al actual. Si se sumara al actual,
   * cada `pointermove` acumularía sobre el anterior y la columna se escaparía
   * mucho más rápido que el mouse.
   */
  it('dos movimientos del mismo gesto no acumulan', () => {
    const a = aplicarArrastre({ x: 200 }, 'x', 200, 30)
    const b = aplicarArrastre(a, 'x', 200, 60)
    expect(b).toEqual({ x: 260 })
  })

  it('sólo toca la columna arrastrada', () => {
    expect(aplicarArrastre({ a: 100, b: 300 }, 'a', 100, 40)).toEqual({ a: 140, b: 300 })
  })

  it('un arrastre enorme hacia la izquierda no deja la columna en cero', () => {
    expect(aplicarArrastre({ a: 100 }, 'a', 100, -5000)).toEqual({ a: MIN_PX })
  })
})

describe('mezclar lo guardado con las columnas de ahora', () => {
  const COLUMNAS = [col({ key: 'nombre' }), col({ key: 'fecha', tipo: 'fecha' })]

  it('lo guardado gana sobre el inicial', () => {
    expect(anchosDe(COLUMNAS, { nombre: 400 })).toEqual({
      nombre: 400,
      fecha: anchoInicial(COLUMNAS[1]!),
    })
  })

  /* Cambiar las columnas de una pantalla no puede dejar la tabla con huecos ni
     con el ancho de una columna que ya no está. */
  it('una columna nueva estrena su ancho y una clave vieja se descarta', () => {
    const r = anchosDe(COLUMNAS, { nombre: 400, columna_que_se_fue: 999 })
    expect(Object.keys(r).sort()).toEqual(['fecha', 'nombre'])
  })

  it('devuelve un ancho para TODAS las columnas: con fixed, una sin ancho rompe el reparto', () => {
    const r = anchosDe(COLUMNAS, {})
    for (const c of COLUMNAS) expect(r[c.key]).toBeGreaterThanOrEqual(MIN_PX)
  })

  it('un ancho guardado fuera de rango se acota al leerlo', () => {
    expect(anchosDe(COLUMNAS, { nombre: 99999 }).nombre).toBe(MAX_PX)
  })
})

describe('lo que queda guardado en el navegador', () => {
  it('se guarda y se vuelve a leer', () => {
    guardarAnchos('catalogo', { nombre: 300, fecha: 120 })
    expect(leerAnchos('catalogo')).toEqual({ nombre: 300, fecha: 120 })
  })

  it('cada tabla tiene lo suyo', () => {
    guardarAnchos('catalogo', { a: 100 })
    guardarAnchos('usuarios', { a: 200 })
    expect(leerAnchos('catalogo')).toEqual({ a: 100 })
    expect(leerAnchos('usuarios')).toEqual({ a: 200 })
  })

  it('sin nada guardado devuelve vacío, no undefined', () => {
    expect(leerAnchos('nunca-usada')).toEqual({})
  })

  it('olvidar los anchos los vuelve a los iniciales', () => {
    guardarAnchos('catalogo', { a: 100 })
    olvidarAnchos('catalogo')
    expect(leerAnchos('catalogo')).toEqual({})
  })

  /*
   * Lo guardado lo puede editar cualquiera desde las herramientas del
   * navegador. Un `{"nombre": "borrado"}` que llegara al colgroup dejaría la
   * tabla sin columnas, así que se valida valor por valor.
   */
  it('descarta valores que no son números y se queda con los que sí', () => {
    localStorage.setItem('buscatools.anchos.x', '{"a":200,"b":"ancho","c":null,"d":[1]}')
    expect(leerAnchos('x')).toEqual({ a: 200 })
  })

  it('un JSON roto, o que no es un objeto, devuelve vacío', () => {
    for (const crudo of ['{no es json', '[1,2,3]', 'null', '"texto"', '42']) {
      localStorage.setItem('buscatools.anchos.x', crudo)
      expect(leerAnchos('x')).toEqual({})
    }
  })

  /*
   * En una ventana privada, con las cookies del sitio bloqueadas o con el
   * almacenamiento lleno, `localStorage` TIRA una excepción. Una tabla no se
   * puede quedar sin dibujar porque no se pudo recordar un ancho.
   */
  it('si el navegador no deja leer, la tabla igual se dibuja', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(leerAnchos('catalogo')).toEqual({})
  })

  it('si el navegador no deja guardar, no se rompe el arrastre', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => guardarAnchos('catalogo', { a: 100 })).not.toThrow()
  })

  it('si el navegador no deja borrar, tampoco se rompe', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(() => olvidarAnchos('catalogo')).not.toThrow()
  })
})

/*
 * ── QUE LA TABLA ENTRE (Fase 86) ────────────────────────────────────────────
 *
 * «Necesito poder ver todas las columnas de una, no tener que ir achicando.
 * Que sí o sí, en cada categoría, siempre pueda ver hasta el carrito.»
 */
describe('encogerParaQueEntre', () => {
  const suma = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0)

  it('si ya entra, no toca nada: el ancho medido vale', () => {
    const anchos = { modelo: 120, marca: 100, serie: 80 }
    expect(encogerParaQueEntre(anchos, 400)).toEqual(anchos)
  })

  it('y tampoco si todavía no se sabe cuánto hay', () => {
    // Antes de la primera medición no hay caja: encoger contra un cero
    // dejaría todas las columnas en el mínimo por un instante y la tabla
    // pegaría un salto al pintarse.
    const anchos = { modelo: 120, marca: 100 }
    expect(encogerParaQueEntre(anchos, 0)).toEqual(anchos)
    expect(encogerParaQueEntre(anchos, Number.NaN)).toEqual(anchos)
  })

  it('cuando no entra, encoge hasta el ancho justo', () => {
    const r = encogerParaQueEntre({ a: 300, b: 300, c: 300 }, 600)
    expect(suma(r)).toBe(600)
  })

  it('reparte a prorrata: la que pedía más sigue teniendo más', () => {
    // Es lo que distingue esto de «todas iguales»: «Modelo» necesita ancho y
    // «Medida» no, y recortar no puede borrar esa diferencia.
    const r = encogerParaQueEntre({ modelo: 400, medida: 100 }, 250)
    expect(r['modelo']).toBeGreaterThan(r['medida']!)
    expect(suma(r)).toBe(250)
  })

  it('ninguna baja del mínimo legible', () => {
    const r = encogerParaQueEntre({ a: 400, b: 100, c: 100 }, 300)
    for (const v of Object.values(r)) expect(v).toBeGreaterThanOrEqual(MIN_PX)
  })

  it('la que caería por debajo se clava en el mínimo y el resto lo ponen las otras', () => {
    // Con una sola multiplicación, `chica` quedaría en 30 px —ilegible— y el
    // total seguiría sin dar. Por rondas, se clava en el mínimo y `ancha`
    // absorbe lo que falta.
    const r = encogerParaQueEntre({ ancha: 600, chica: 60 }, 400)
    expect(r['chica']).toBe(MIN_PX)
    expect(r['ancha']).toBe(400 - MIN_PX)
    expect(suma(r)).toBe(400)
  })

  it('si ni todas en el mínimo entran, todas en el mínimo', () => {
    // Más no se puede hacer desde acá. Mejor que el scroll empiece lo más
    // tarde posible que dejar columnas de diez píxeles.
    const r = encogerParaQueEntre({ a: 300, b: 300, c: 300 }, 100)
    expect(Object.values(r)).toEqual([MIN_PX, MIN_PX, MIN_PX])
  })

  it('el caso real: nueve columnas de «Puntas y tubos» en una caja de 900', () => {
    const anchos = {
      modelo: 150, marca: 140, categoria: 130, serie: 120, tipo: 110,
      'attr:encastre': 160, 'attr:medida': 90, 'attr:largo': 100, 'attr:sufijos': 95,
    }
    expect(suma(anchos)).toBeGreaterThan(900)

    const r = encogerParaQueEntre(anchos, 900)

    expect(suma(r)).toBe(900)
    for (const v of Object.values(r)) expect(v).toBeGreaterThanOrEqual(MIN_PX)
    // El orden relativo se conserva: la que más pedía sigue siendo la más ancha.
    expect(r['attr:encastre']).toBeGreaterThan(r['attr:medida']!)
  })

  it('sin columnas no hace nada', () => {
    expect(encogerParaQueEntre({}, 500)).toEqual({})
  })

  it('un ancho por debajo del mínimo se trata como el mínimo', () => {
    expect(encogerParaQueEntre({ a: 10, b: 10 }, 500)).toEqual({ a: MIN_PX, b: MIN_PX })
  })
})
