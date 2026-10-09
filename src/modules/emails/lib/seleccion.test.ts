import { describe, expect, it, vi } from 'vitest'
import {
  accionesPosibles,
  alternar,
  alternarTodas,
  elegidas,
  enTandas,
  estadoMaestra,
  resumenLote,
  VACIA,
} from './seleccion'
import type { FilaBandeja } from '../types'

const fila = (id: string, sinLeer = false, eliminado = false): FilaBandeja =>
  ({ id, accountId: 'a1', gmailThreadId: 'g-' + id, sinLeer, eliminado }) as FilaBandeja

const FILAS = [fila('1', true), fila('2'), fila('3', true)]

describe('marcar y desmarcar', () => {
  it('alterna una casilla', () => {
    const s = alternar(VACIA, '1')
    expect([...s]).toEqual(['1'])
    expect([...alternar(s, '1')]).toEqual([])
  })

  it('no muta el conjunto anterior', () => {
    const antes = new Set(['1'])
    alternar(antes, '2')
    expect([...antes]).toEqual(['1'])
  })

  /*
   * POR ID Y NO POR ÍNDICE. La bandeja se refresca sola —hay tiempo real— y
   * con índices, un correo nuevo que entra arriba correría todo y las casillas
   * terminarían marcando otros hilos.
   */
  it('lo elegido sigue siendo lo mismo aunque la lista cambie de orden', () => {
    const s = alternar(VACIA, '3')
    const alReves = [...FILAS].reverse()
    expect(elegidas(alReves, s).map((f) => f.id)).toEqual(['3'])
  })

  it('un hilo que ya no está en la lista no se cuenta', () => {
    const s = new Set(['1', 'se-fue'])
    expect(elegidas(FILAS, s).map((f) => f.id)).toEqual(['1'])
  })

  it('devuelve las elegidas en el orden de la lista, no en el de los clics', () => {
    const s = new Set(['3', '1'])
    expect(elegidas(FILAS, s).map((f) => f.id)).toEqual(['1', '3'])
  })
})

describe('la casilla de arriba', () => {
  it('refleja si no hay ninguna, algunas o todas', () => {
    expect(estadoMaestra(FILAS, VACIA)).toBe('ninguna')
    expect(estadoMaestra(FILAS, new Set(['1']))).toBe('algunas')
    expect(estadoMaestra(FILAS, new Set(['1', '2', '3']))).toBe('todas')
  })

  it('sin filas no está «todas»: una lista vacía no tiene todo elegido', () => {
    expect(estadoMaestra([], VACIA)).toBe('ninguna')
  })

  it('marca todas y, si ya estaban todas, las limpia', () => {
    const todas = alternarTodas(FILAS, VACIA)
    expect([...todas].sort()).toEqual(['1', '2', '3'])
    expect([...alternarTodas(FILAS, todas)]).toEqual([])
  })

  /* Con algunas marcadas completa en vez de limpiar, que es lo que hace Gmail
     y lo que uno espera: no perder lo que ya eligió. */
  it('con algunas marcadas, completa', () => {
    expect([...alternarTodas(FILAS, new Set(['2']))].sort()).toEqual(['1', '2', '3'])
  })

  /* Marcar todas en una página no puede borrar lo elegido en otra. */
  it('no toca lo elegido fuera de la lista visible', () => {
    const r = alternarTodas(FILAS, new Set(['de-otra-pagina']))
    expect(r.has('de-otra-pagina')).toBe(true)
  })
})

describe('qué se puede hacer con lo elegido', () => {
  it('marcar como leído sólo si hay alguno sin leer', () => {
    expect(accionesPosibles(FILAS, new Set(['1'])).marcarLeido).toBe(true)
    // El '2' ya está leído: el botón mandaría llamadas para no cambiar nada.
    expect(accionesPosibles(FILAS, new Set(['2'])).marcarLeido).toBe(false)
  })

  it('cuenta cuántas y cuántas sin leer', () => {
    const a = accionesPosibles(FILAS, new Set(['1', '2', '3']))
    expect(a.cuantas).toBe(3)
    expect(a.sinLeer).toBe(2)
  })

  /*
   * SALE DE LAS FILAS Y NO DE LA CARPETA. Cada fila sabe si está eliminada,
   * así que la pantalla no tiene que contarlo y no hay nada que se pueda
   * desincronizar.
   */
  it('ofrece eliminar lo que está en la bandeja y restaurar lo que está en Eliminados', () => {
    const enBandeja = accionesPosibles(FILAS, new Set(['1']))
    expect([enBandeja.eliminar, enBandeja.restaurar]).toEqual([true, false])

    const papelera = [fila('9', false, true)]
    const enPapelera = accionesPosibles(papelera, new Set(['9']))
    expect([enPapelera.eliminar, enPapelera.restaurar]).toEqual([false, true])
  })

  /* Una selección mezclada no debería poder armarse —cada carpeta muestra una
     clase— pero si pasa, cada botón toca SU parte en vez de hacer algo
     equivocado con la otra mitad. */
  it('con una selección mezclada, cada acción cuenta lo suyo', () => {
    const mezcla = [fila('1'), fila('2', false, true)]
    const a = accionesPosibles(mezcla, new Set(['1', '2']))
    expect([a.aEliminar, a.aRestaurar]).toEqual([1, 1])
    expect([a.eliminar, a.restaurar]).toEqual([true, true])
  })

  it('sin nada elegido no se puede nada', () => {
    const a = accionesPosibles(FILAS, VACIA)
    expect([a.cuantas, a.marcarLeido, a.eliminar, a.restaurar]).toEqual([0, false, false, false])
  })
})

describe('enTandas', () => {
  it('las hace todas', async () => {
    const hechas: number[] = []
    await enTandas([1, 2, 3, 4, 5], 2, (n) => {
      hechas.push(n)
      return Promise.resolve()
    })
    expect(hechas.sort()).toEqual([1, 2, 3, 4, 5])
  })

  /*
   * NO MÁS DE `ancho` A LA VEZ. 25 llamadas simultáneas a la misma RPC es la
   * forma de que el servidor empiece a rechazar; de a seis, 25 hilos tardan
   * ~1 s en vez de los 5,5 que tardarían en fila.
   */
  it('nunca corre más de las permitidas a la vez', async () => {
    let enVuelo = 0
    let pico = 0
    await enTandas(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      enVuelo++
      pico = Math.max(pico, enVuelo)
      await new Promise((r) => setTimeout(r, 1))
      enVuelo--
    })
    expect(pico).toBeLessThanOrEqual(4)
    expect(pico).toBeGreaterThan(1)
  })

  /*
   * UN ERROR NO CORTA EL LOTE. Dejar 24 hilos sin tocar porque el tercero
   * falló es peor que hacer los 24 e informar que uno falló.
   */
  it('sigue después de un error y devuelve los que fallaron', async () => {
    const hechas: number[] = []
    const fallaron = await enTandas([1, 2, 3, 4], 2, (n) => {
      if (n === 2) return Promise.reject(new Error('no anduvo'))
      hechas.push(n)
      return Promise.resolve()
    })
    expect(hechas.sort()).toEqual([1, 3, 4])
    expect(fallaron).toEqual([2])
  })

  it('con la lista vacía no llama a nadie y no se cuelga', async () => {
    const tarea = vi.fn()
    expect(await enTandas([], 5, tarea)).toEqual([])
    expect(tarea).not.toHaveBeenCalled()
  })
})

describe('el resumen de lo que pasó', () => {
  it('todo bien, en singular y en plural', () => {
    expect(resumenLote(1, 0, 'marcados como leídos')).toBe('1 hilo marcados como leídos.')
    expect(resumenLote(5, 0, 'eliminados')).toBe('5 hilos eliminados.')
  })

  // Lo que importa: que diga CUÁNTOS se hicieron, no sólo que algo falló.
  it('con algunos fallados dice cuántos salieron bien', () => {
    expect(resumenLote(5, 2, 'eliminados')).toContain('3 de 5')
    expect(resumenLote(5, 2, 'eliminados')).toContain('2 fallaron')
  })

  it('si fallaron todos lo dice sin fingir un éxito parcial', () => {
    expect(resumenLote(3, 3, 'eliminados')).toMatch(/^No se pudo/)
  })
})
