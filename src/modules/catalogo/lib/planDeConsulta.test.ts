import { describe, expect, it } from 'vitest'
import {
  construirPlanDeConsulta,
  contarFiltrosActivos,
  hayBusqueda,
  MAX_POR_PAGINA,
} from './planDeConsulta'
import { FILTROS_INICIALES, type FiltrosCatalogo } from '../types'

const EMPRESA = '11111111-1111-1111-1111-111111111111'

function filtros(over: Partial<FiltrosCatalogo> = {}): FiltrosCatalogo {
  return { ...FILTROS_INICIALES, ...over }
}

describe('construirPlanDeConsulta', () => {
  it('U1 · traduce filtros, rango y orden', () => {
    const plan = construirPlanDeConsulta(
      filtros({ marca: 'm-1', categoria: 'c-1', serie: 'S9', pagina: 3, porPagina: 25 }),
      EMPRESA,
    )

    expect(plan.eq).toEqual({ brand_id: 'm-1', category_id: 'c-1', series: 'S9' })
    expect(plan.rango).toEqual({ desde: 50, hasta: 74 })
    expect(plan.orden).toEqual({ columna: 'name', ascendente: true })
  })

  it('U2 · SIEMPRE lleva companyId, y sin empresa activa falla en vez de consultar', () => {
    // Es la red de seguridad contra mezclar empresas: RLS deja ver TODAS
    // las del usuario, así que sin este filtro Jano vería las dos.
    expect(construirPlanDeConsulta(filtros(), EMPRESA).companyId).toBe(EMPRESA)
    expect(() => construirPlanDeConsulta(filtros(), '')).toThrow(/companyId/)
  })

  it('acota porPagina para que nadie pida el catálogo entero por la URL', () => {
    const plan = construirPlanDeConsulta(filtros({ porPagina: 5000 }), EMPRESA)
    expect(plan.rango.hasta - plan.rango.desde + 1).toBe(MAX_POR_PAGINA)
  })

  it('normaliza páginas inválidas a la primera', () => {
    expect(construirPlanDeConsulta(filtros({ pagina: 0 }), EMPRESA).rango.desde).toBe(0)
    expect(construirPlanDeConsulta(filtros({ pagina: -3 }), EMPRESA).rango.desde).toBe(0)
  })

  it('descarta atributos vacíos: `attributes @> {"k":""}` no matchearía nunca', () => {
    const plan = construirPlanDeConsulta(
      filtros({ atributos: { encastre: '1/2', medida: '' } }),
      EMPRESA,
    )
    expect(plan.atributos).toEqual({ encastre: '1/2' })
  })

  it('ordena por sku cuando se lo piden', () => {
    expect(construirPlanDeConsulta(filtros({ orden: 'sku' }), EMPRESA).orden.columna).toBe('sku')
  })
})

describe('hayBusqueda', () => {
  it('ignora textos de menos de dos caracteres', () => {
    expect(hayBusqueda(filtros({ q: '' }))).toBe(false)
    expect(hayBusqueda(filtros({ q: ' a ' }))).toBe(false)
    expect(hayBusqueda(filtros({ q: 'punta' }))).toBe(true)
  })
})

describe('contarFiltrosActivos', () => {
  it('cuenta sólo lo que efectivamente filtra', () => {
    expect(contarFiltrosActivos(filtros())).toBe(0)
    expect(
      contarFiltrosActivos(
        filtros({ marca: 'm', categoria: 'c', atributos: { encastre: '1/2', largo: '' } }),
      ),
    ).toBe(3)
  })
})
