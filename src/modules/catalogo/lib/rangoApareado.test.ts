import { describe, expect, it } from 'vitest'
import { aFiltrosPorClave, desdeFiltrosPorClave, solapa } from './rangoApareado'
import type { RangoNumerico } from '../types'

const TORQUE = { claveMin: 'torq_min', claveMax: 'torq_max' }

/** Atornilladores reales del catálogo, con su rango de trabajo en Nm. */
const PRODUCTOS = [
  { sku: 'A · 0,4 a 2', min: 0.4, max: 2 },
  { sku: 'B · 4 a 12', min: 4, max: 12 },
  { sku: 'C · 20 a 45', min: 20, max: 45 },
  { sku: 'D · 50 a 120', min: 50, max: 120 },
]

/** Los que la traducción va a traer, aplicando los dos filtros por clave. */
function losQueTrae(pedido: RangoNumerico) {
  const f = aFiltrosPorClave(TORQUE, pedido)
  return PRODUCTOS.filter((p) => {
    const porMin = f.torq_min
    const porMax = f.torq_max
    if (porMin?.max !== null && porMin?.max !== undefined && p.min > porMin.max) return false
    if (porMax?.min !== null && porMax?.min !== undefined && p.max < porMax.min) return false
    return true
  }).map((p) => p.sku)
}

describe('un rango sobre dos atributos', () => {
  /*
   * EL CASO QUE JUSTIFICA TODO. «Necesito uno que sirva para 10 Nm» son los que
   * PUEDEN dar 10: el de 4 a 12 sí, el de 0,4 a 2 no, el de 20 a 45 tampoco.
   */
  it('pedir un valor puntual trae los que lo alcanzan', () => {
    expect(losQueTrae({ min: 10, max: 10 })).toEqual(['B · 4 a 12'])
  })

  it('pedir un rango trae todo lo que se solapa, no sólo lo contenido', () => {
    // De 10 a 30 toca al de 4-12 (por arriba) y al de 20-45 (por abajo).
    expect(losQueTrae({ min: 10, max: 30 })).toEqual(['B · 4 a 12', 'C · 20 a 45'])
  })

  it('sólo un desde: todo lo que llegue hasta ahí o más', () => {
    expect(losQueTrae({ min: 45, max: null })).toEqual(['C · 20 a 45', 'D · 50 a 120'])
  })

  it('sólo un hasta: todo lo que arranque ahí o antes', () => {
    expect(losQueTrae({ min: null, max: 4 })).toEqual(['A · 0,4 a 2', 'B · 4 a 12'])
  })

  it('sin extremos no filtra nada', () => {
    expect(losQueTrae({ min: null, max: null })).toHaveLength(PRODUCTOS.length)
  })

  /* La traducción tiene que coincidir con lo que significa «solaparse». Si
     alguna vez dejan de coincidir, una de las dos está mal. */
  it('la traducción hace exactamente lo mismo que solapar', () => {
    const pedidos: RangoNumerico[] = [
      { min: 10, max: 10 },
      { min: 10, max: 30 },
      { min: 45, max: null },
      { min: null, max: 4 },
      { min: 0, max: 1000 },
      { min: 13, max: 19 },
    ]
    for (const p of pedidos) {
      expect(losQueTrae(p)).toEqual(PRODUCTOS.filter((x) => solapa(x, p)).map((x) => x.sku))
    }
  })

  it('un hueco entre dos productos no trae ninguno', () => {
    expect(losQueTrae({ min: 13, max: 19 })).toEqual([])
  })
})

describe('cómo se guarda y se vuelve a leer', () => {
  /*
   * Está CRUZADO y por eso vive acá: el HASTA del usuario acota el extremo
   * MÍNIMO del producto, y el DESDE acota el MÁXIMO.
   */
  it('el hasta del usuario limita el extremo mínimo del producto', () => {
    expect(aFiltrosPorClave(TORQUE, { min: null, max: 20 })).toEqual({
      torq_min: { min: null, max: 20 },
      torq_max: null,
    })
  })

  it('el desde del usuario limita el extremo máximo del producto', () => {
    expect(aFiltrosPorClave(TORQUE, { min: 5, max: null })).toEqual({
      torq_min: null,
      torq_max: { min: 5, max: null },
    })
  })

  /* Null y no un rango vacío: un `{min:null,max:null}` puesto haría que el
     contador de filtros activos cuente uno que no filtra nada. */
  it('un extremo sin valor saca el filtro, no deja uno vacío', () => {
    expect(aFiltrosPorClave(TORQUE, { min: null, max: null })).toEqual({
      torq_min: null,
      torq_max: null,
    })
  })

  it('lo guardado se vuelve a leer igual', () => {
    for (const pedido of [
      { min: 5, max: 20 },
      { min: 5, max: null },
      { min: null, max: 20 },
      { min: null, max: null },
    ]) {
      const guardado: Record<string, RangoNumerico> = {}
      for (const [k, v] of Object.entries(aFiltrosPorClave(TORQUE, pedido))) {
        if (v !== null) guardado[k] = v
      }
      expect(desdeFiltrosPorClave(TORQUE, guardado)).toEqual(pedido)
    }
  })
})

import { aparearFacetas } from './rangoApareado'
import type { FacetaAtributo } from '../types'

const op = (v: string, n = 1) => ({ valor: v, etiqueta: v, cantidad: n })

const faceta = (key: string, label: string, unidad: string | null, vals: string[]): FacetaAtributo => ({
  key,
  label,
  unidad,
  clase: 'range',
  opciones: vals.map((v) => op(v)),
  min: Math.min(...vals.map(Number)),
  max: Math.max(...vals.map(Number)),
})

const DEFS = [
  { key: 'torq_min', rango: { grupo: 'torque', rol: 'min' as const, label: 'Torque' } },
  { key: 'torq_max', rango: { grupo: 'torque', rol: 'max' as const, label: 'Torque' } },
  { key: 'encastre', rango: null },
]

describe('aparear las facetas de un rango', () => {
  const fMin = faceta('torq_min', 'Torque mín.', 'Nm', ['0.4', '4', '20'])
  const fMax = faceta('torq_max', 'Torque máx.', 'Nm', ['2', '12', '45'])
  const otra: FacetaAtributo = {
    key: 'encastre', label: 'Encastre', unidad: null, clase: 'enum',
    opciones: [op('1/4"')], min: null, max: null,
  }

  /* El caso: cuatro controles pasan a dos. */
  it('dos facetas se vuelven una', () => {
    const r = aparearFacetas([fMin, fMax, otra], DEFS)
    expect(r.map((f) => f.key)).toEqual(['torq_min', 'encastre'])
    expect(r[0]?.label).toBe('Torque')
    expect(r[0]?.par).toEqual({ claveMin: 'torq_min', claveMax: 'torq_max' })
  })

  it('respeta el orden del extremo que venía primero', () => {
    const r = aparearFacetas([otra, fMin, fMax], DEFS)
    expect(r.map((f) => f.key)).toEqual(['encastre', 'torq_min'])
  })

  /* Las opciones de los DOS lados: sin esto no se podría pedir «hasta 45»,
     porque 45 sólo existe como máximo de un producto. */
  it('ofrece los valores de los dos extremos, ordenados', () => {
    const r = aparearFacetas([fMin, fMax], DEFS)
    expect(r[0]?.opciones.map((o) => o.valor)).toEqual(['0.4', '2', '4', '12', '20', '45'])
    expect(r[0]?.min).toBe(0.4)
    expect(r[0]?.max).toBe(45)
  })

  /*
   * Un par incompleto NO se aparea. Si en una categoría sólo hay datos de un
   * extremo, mostrar «Torque desde … hasta …» prometería un filtro por solape
   * que no se puede cumplir con un solo lado.
   */
  it('con un solo extremo presente, no aparea', () => {
    const r = aparearFacetas([fMin, otra], DEFS)
    expect(r.map((f) => f.key)).toEqual(['torq_min', 'encastre'])
    expect(r[0]?.par).toBeUndefined()
    expect(r[0]?.label).toBe('Torque mín.')
  })

  it('las facetas sin par pasan intactas', () => {
    const r = aparearFacetas([otra], DEFS)
    expect(r).toEqual([otra])
  })

  it('sin definiciones con rango no cambia nada', () => {
    const r = aparearFacetas([fMin, fMax, otra], [{ key: 'encastre', rango: null }])
    expect(r.map((f) => f.key)).toEqual(['torq_min', 'torq_max', 'encastre'])
  })
})
