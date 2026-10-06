import { describe, expect, it } from 'vitest'
import {
  agregarAlEquipo,
  hacerPrincipal,
  integrantes,
  quitarDelEquipo,
  type Equipo,
} from './equipo'

/**
 * Las tres operaciones del equipo de un documento (Fase 40).
 *
 * Sirven para los contactos del cliente y para los vendedores de la casa, y
 * por eso viven en un solo lugar: las reglas que importan son sutiles y
 * escribirlas dos veces esperando que salgan iguales es como terminan dos
 * pantallas comportándose distinto.
 */
const eq = (principal: string, acompanan: string[] = []): Equipo => ({ principal, acompanan })

describe('Quiénes están', () => {
  it('el principal primero y después los demás', () => {
    expect(integrantes(eq('a', ['b', 'c']))).toEqual(['a', 'b', 'c'])
  })

  it('sin principal, sólo los que acompañan', () => {
    expect(integrantes(eq('', ['b']))).toEqual(['b'])
  })

  it('vacío es vacío, no una lista con un hueco', () => {
    expect(integrantes(eq('', []))).toEqual([])
  })
})

describe('Agregar', () => {
  /**
   * Un documento con acompañantes y sin principal es una cabecera que se
   * imprime sin nadie, y eso no lo quiso nadie: lo quiso quien agregó al
   * primero de la lista.
   */
  it('el primero que entra es el principal', () => {
    expect(agregarAlEquipo(eq(''), 'a')).toEqual(eq('a', []))
  })

  it('los siguientes acompañan, en orden', () => {
    expect(agregarAlEquipo(eq('a', ['b']), 'c')).toEqual(eq('a', ['b', 'c']))
  })

  /** Un doble clic no es un error que valga la pena devolver. */
  it('agregar a alguien que ya está no hace nada', () => {
    const e = eq('a', ['b'])
    expect(agregarAlEquipo(e, 'a')).toBe(e)
    expect(agregarAlEquipo(e, 'b')).toBe(e)
  })

  it('un id vacío tampoco entra', () => {
    const e = eq('a')
    expect(agregarAlEquipo(e, '')).toBe(e)
  })
})

describe('Hacer principal', () => {
  /**
   * Es la operación que más se repite —«ahora lo lleva Juan»— y es UN
   * intercambio: quien guarda manda los dos valores juntos, y la base rechaza
   * el estado intermedio, con el principal figurando además como acompañante.
   */
  it('el que estaba baja a acompañar, al final', () => {
    expect(hacerPrincipal(eq('a', ['b', 'c']), 'b')).toEqual(eq('b', ['c', 'a']))
  })

  it('si no había principal, el ascendido no deja a nadie atrás', () => {
    expect(hacerPrincipal(eq('', ['b', 'c']), 'c')).toEqual(eq('c', ['b']))
  })

  it('ascender al que ya es principal no mueve nada', () => {
    const e = eq('a', ['b'])
    expect(hacerPrincipal(e, 'a')).toBe(e)
  })
})

describe('Quitar', () => {
  it('a un acompañante lo saca y deja al principal donde estaba', () => {
    expect(quitarDelEquipo(eq('a', ['b', 'c']), 'b')).toEqual(eq('a', ['c']))
  })

  /**
   * Dejar el documento con acompañantes y sin principal sería dejarlo peor de
   * como estaba: el primero que acompañaba ocupa el lugar.
   */
  it('al principal lo reemplaza el primero que lo acompañaba', () => {
    expect(quitarDelEquipo(eq('a', ['b', 'c']), 'a')).toEqual(eq('b', ['c']))
  })

  it('quitar al único deja el equipo vacío', () => {
    expect(quitarDelEquipo(eq('a', []), 'a')).toEqual(eq('', []))
  })

  it('quitar a alguien que no está no rompe nada', () => {
    expect(quitarDelEquipo(eq('a', ['b']), 'z')).toEqual(eq('a', ['b']))
  })
})
