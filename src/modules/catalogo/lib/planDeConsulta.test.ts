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
  it('U1 · traduce filtros, paginación y orden', () => {
    const plan = construirPlanDeConsulta(
      filtros({ marca: 'm-1', categoria: 'c-1', serie: 'S9', pagina: 3, porPagina: 25 }),
      EMPRESA,
    )

    expect(plan.marca).toBe('m-1')
    expect(plan.categoria).toBe('c-1')
    expect(plan.serie).toBe('S9')
    expect(plan.limite).toBe(25)
    expect(plan.desplazamiento).toBe(50)
    expect(plan.orden).toBe('nombre')
  })

  it('U2 · SIEMPRE lleva companyId, y sin empresa activa falla en vez de consultar', () => {
    // Es la red de seguridad contra mezclar empresas: RLS deja ver TODAS
    // las del usuario, así que sin este filtro Jano vería las dos.
    expect(construirPlanDeConsulta(filtros(), EMPRESA).companyId).toBe(EMPRESA)
    expect(() => construirPlanDeConsulta(filtros(), '')).toThrow(/companyId/)
  })

  it('acota porPagina para que nadie pida el catálogo entero por la URL', () => {
    expect(construirPlanDeConsulta(filtros({ porPagina: 5000 }), EMPRESA).limite).toBe(
      MAX_POR_PAGINA,
    )
  })

  it('normaliza páginas inválidas a la primera', () => {
    expect(construirPlanDeConsulta(filtros({ pagina: 0 }), EMPRESA).desplazamiento).toBe(0)
    expect(construirPlanDeConsulta(filtros({ pagina: -3 }), EMPRESA).desplazamiento).toBe(0)
  })

  it('descarta atributos vacíos: un valor vacío no coincide con ningún producto', () => {
    const plan = construirPlanDeConsulta(
      filtros({ atributos: { encastre: ['1/2'], medida: [''], largo: [] } }),
      EMPRESA,
    )
    expect(plan.atributos).toEqual({ encastre: ['1/2'] })
  })

  it('conserva la multiselección: OR dentro de la clave', () => {
    const plan = construirPlanDeConsulta(
      filtros({ atributos: { encastre: ['1/4 HEX', '3/8 SQ'] } }),
      EMPRESA,
    )
    expect(plan.atributos).toEqual({ encastre: ['1/4 HEX', '3/8 SQ'] })
  })

  it('pasa los subtipos como array, o null si no hay ninguno', () => {
    expect(construirPlanDeConsulta(filtros(), EMPRESA).subtipos).toBeNull()
    expect(
      construirPlanDeConsulta(filtros({ subtipos: ['Torx', 'Allen'] }), EMPRESA).subtipos,
    ).toEqual(['Torx', 'Allen'])
  })

  it('descarta un rango sin ningún extremo, y conserva los que sí filtran', () => {
    const plan = construirPlanDeConsulta(
      filtros({
        rangos: {
          largo: { min: 25, max: 50 },
          max_kg: { min: null, max: null },
          torq_min: { min: null, max: 80 },
        },
      }),
      EMPRESA,
    )
    expect(plan.rangos).toEqual({ largo: { min: 25, max: 50 }, torq_min: { max: 80 } })
  })

  it('ordena por sku cuando se lo piden', () => {
    expect(construirPlanDeConsulta(filtros({ orden: 'sku' }), EMPRESA).orden).toBe('sku')
  })

  it('sólo manda texto de búsqueda si tiene al menos dos caracteres', () => {
    expect(construirPlanDeConsulta(filtros({ q: ' a ' }), EMPRESA).texto).toBeNull()
    expect(construirPlanDeConsulta(filtros({ q: '  punta ' }), EMPRESA).texto).toBe('punta')
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
        filtros({ marca: 'm', categoria: 'c', atributos: { encastre: ['1/2'], largo: [] } }),
      ),
    ).toBe(3)
  })

  it('cuenta cada valor elegido de una multiselección', () => {
    expect(
      contarFiltrosActivos(filtros({ atributos: { encastre: ['1/4 HEX', '3/8 SQ'] } })),
    ).toBe(2)
  })

  it('cuenta subtipos y rangos', () => {
    expect(
      contarFiltrosActivos(
        filtros({ subtipos: ['Torx'], rangos: { largo: { min: 25, max: null } } }),
      ),
    ).toBe(2)
  })

  it('no cuenta un rango sin extremos', () => {
    expect(contarFiltrosActivos(filtros({ rangos: { largo: { min: null, max: null } } }))).toBe(0)
  })
})
