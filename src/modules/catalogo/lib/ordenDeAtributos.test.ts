import { describe, expect, it } from 'vitest'
import { atributosEnOrden, type AtributosCrudos } from './ordenDeAtributos'

/**
 * El caso real que lo motivó (Fase 43).
 *
 * En Balanceadores se leía «Cap. máx. · Medida · Cap. mín.». No es un orden
 * que alguien haya elegido: es el de las claves de un objeto jsonb, que
 * Postgres normaliza por LARGO y después por bytes. `max_kg`, `medida` y
 * `min_kg` miden seis letras, así que salen en alfabético.
 *
 * Los fixtures reproducen eso: el objeto está escrito EN EL ORDEN ROTO, que es
 * el que llegaba de verdad.
 */
const valores = [{ value: '1', count: 1 }]
const attr = (label: string, position?: number) => ({
  label,
  unit: null,
  ...(position === undefined ? {} : { position }),
  values: valores,
})

describe('el orden de los atributos del catálogo', () => {
  it('un array se respeta tal como viene, que es el orden de la RPC', () => {
    const bruto: AtributosCrudos = [
      { key: 'min_kg', label: 'Cap. mín.', unit: 'kg', position: 1, values: valores },
      { key: 'max_kg', label: 'Cap. máx.', unit: 'kg', position: 2, values: valores },
      { key: 'carcasa', label: 'Carcasa', unit: null, position: 11, values: valores },
    ]
    expect(atributosEnOrden(bruto).map((a) => a.key)).toEqual(['min_kg', 'max_kg', 'carcasa'])
  })

  /*
   * La forma vieja, que es lo que llega mientras la base no tenga la
   * migración y el frontend ya esté desplegado. Si trae `position`, se
   * ordena: no hay razón para mostrarlo mal pudiendo arreglarlo.
   */
  it('un objeto con posiciones se ordena: mínima antes que máxima', () => {
    const bruto: AtributosCrudos = {
      max_kg: attr('Cap. máx.', 2),
      medida: attr('Medida', 6),
      min_kg: attr('Cap. mín.', 1),
      carcasa: attr('Carcasa', 11),
    }
    expect(atributosEnOrden(bruto).map((a) => a.key)).toEqual([
      'min_kg',
      'max_kg',
      'medida',
      'carcasa',
    ])
  })

  /*
   * Sin `position` NO se reordena.
   *
   * Es el rato que hay entre el deploy del frontend y la corrida del SQL.
   * Ordenar por clave ahí cambiaría un orden malo —el del jsonb— por otro
   * distinto e igual de arbitrario, y encima parecería intencional. Lo que no
   * se puede ordenar bien se deja como vino.
   */
  it('sin posiciones no reordena: devuelve lo que vino', () => {
    const bruto: AtributosCrudos = {
      max_kg: attr('Cap. máx.'),
      medida: attr('Medida'),
      min_kg: attr('Cap. mín.'),
      carcasa: attr('Carcasa'),
    }
    expect(atributosEnOrden(bruto).map((a) => a.key)).toEqual([
      'max_kg',
      'medida',
      'min_kg',
      'carcasa',
    ])
  })

  // Mezcla: alguno con posición y alguno sin. Se ordena, y el que no tiene
  // queda primero (posición 0), que es visible y no se pierde entre el resto.
  it('con posiciones a medias ordena igual', () => {
    const bruto: AtributosCrudos = {
      max_kg: attr('Cap. máx.', 2),
      raro: attr('Raro'),
      min_kg: attr('Cap. mín.', 1),
    }
    expect(atributosEnOrden(bruto).map((a) => a.key)).toEqual(['raro', 'min_kg', 'max_kg'])
  })

  it('la clave del objeto se conserva al pasarla a array', () => {
    const [primero] = atributosEnOrden({ encastre: attr('Encastre', 5) })
    expect(primero).toMatchObject({ key: 'encastre', label: 'Encastre' })
  })

  // Sin facetas —una categoría vacía, o una respuesta que no llegó— la tabla
  // tiene que quedarse sin columnas dinámicas, no romperse.
  it('nada, null y undefined dan una lista vacía', () => {
    expect(atributosEnOrden([])).toEqual([])
    expect(atributosEnOrden({})).toEqual([])
    expect(atributosEnOrden(null)).toEqual([])
    expect(atributosEnOrden(undefined)).toEqual([])
  })

  it('no toca el array que recibe', () => {
    const bruto: AtributosCrudos = [
      { key: 'z', label: 'Z', unit: null, position: 9, values: valores },
      { key: 'a', label: 'A', unit: null, position: 1, values: valores },
    ]
    atributosEnOrden(bruto)
    expect((bruto as { key: string }[]).map((a) => a.key)).toEqual(['z', 'a'])
  })
})
