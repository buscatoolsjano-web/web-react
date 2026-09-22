import { describe, expect, it } from 'vitest'
import {
  abrirOverlay,
  cerrarOverlay,
  CLAVES_OVERLAY,
  escribirFiltrosInformes,
  filtrosActivos,
  FILTROS_INFORMES_INICIALES,
  leerFiltrosInformes,
  leerOverlay,
  type FiltrosInformes,
} from './filtrosInformes'

/**
 * El estado del informe en la URL (Fase 21 · E3).
 *
 * Dos contratos que se prueban acá:
 *
 *   1. ida y vuelta — lo que se escribe se vuelve a leer igual, para que un
 *      link compartido abra exactamente la misma pantalla;
 *   2. `cliente` y `producto` NO son filtros. Es el bug que ya tuvimos en
 *      Catálogo: `?producto=` se leyó como filtro y el overlay se abrió con
 *      la lista filtrada debajo.
 */
const url = (qs: string) => new URLSearchParams(qs)

describe('Leer', () => {
  it('sin parámetros son los valores iniciales', () => {
    expect(leerFiltrosInformes(url(''))).toEqual(FILTROS_INFORMES_INICIALES)
  })

  it('lee el informe completo', () => {
    expect(
      leerFiltrosInformes(
        url('vista=stock&mes=2026-09&moneda=USD&metrica=entregas&estado=shipped&serie=RT-ERP&origen=stel&dimension=productos&medida=cantidad&periodo=12m&pagina=3'),
      ),
    ).toEqual({
      vista: 'stock',
      mes: '2026-09',
      moneda: 'USD',
      metrica: 'entregas',
      estado: 'shipped',
      serie: 'RT-ERP',
      origen: 'stel',
      dimension: 'productos',
      medida: 'cantidad',
      periodo: '12m',
      pagina: 3,
    })
  })

  it('un valor inventado cae al por defecto en vez de romper', () => {
    const f = leerFiltrosInformes(url('vista=zzz&metrica=facturas&medida=lo-que-sea&periodo=siglo&pagina=-4'))
    expect(f.vista).toBe('comercial')
    expect(f.metrica).toBe('cotizaciones')
    expect(f.medida).toBe('importe')
    expect(f.periodo).toBe('mes')
    expect(f.pagina).toBe(1)
  })

  it.each(['2026-13', '26-09', 'ayer', '2026-00'])('«%s» no es un mes', (m) => {
    expect(leerFiltrosInformes(url(`mes=${m}`)).mes).toBeNull()
  })

  it('un texto absurdamente largo no entra como moneda', () => {
    expect(leerFiltrosInformes(url(`moneda=${'X'.repeat(60)}`)).moneda).toBeNull()
  })
})

describe('Escribir', () => {
  it('lo que ya es el valor por defecto no ensucia la URL', () => {
    expect(escribirFiltrosInformes(FILTROS_INFORMES_INICIALES).toString()).toBe('')
  })

  it('ida y vuelta: el link abre exactamente la misma vista', () => {
    const original: FiltrosInformes = {
      vista: 'comercial',
      mes: '2026-05',
      moneda: 'ARS',
      metrica: 'pedidos',
      estado: 'confirmed',
      serie: 'PDV-ERP',
      origen: 'stel',
      dimension: 'productos',
      medida: 'cantidad',
      periodo: '12m',
      pagina: 7,
    }
    expect(leerFiltrosInformes(escribirFiltrosInformes(original))).toEqual(original)
  })

  it('la página 1 no se escribe', () => {
    expect(escribirFiltrosInformes({ ...FILTROS_INFORMES_INICIALES, pagina: 1 }).has('pagina')).toBe(false)
    expect(escribirFiltrosInformes({ ...FILTROS_INFORMES_INICIALES, pagina: 2 }).get('pagina')).toBe('2')
  })
})

describe('`cliente` y `producto` NO son filtros (§2)', () => {
  it('no se leen como filtro ni por error', () => {
    const f = leerFiltrosInformes(url('cliente=abc-123&producto=def-456&moneda=USD'))
    expect(f.moneda).toBe('USD')
    // Ninguna clave de filtro puede haber tomado el valor del overlay.
    expect(Object.values(f)).not.toContain('abc-123')
    expect(Object.values(f)).not.toContain('def-456')
  })

  it('escribir filtros no borra la ficha abierta', () => {
    const previos = url('cliente=abc-123&moneda=USD')
    const p = escribirFiltrosInformes({ ...FILTROS_INFORMES_INICIALES, moneda: 'ARS' }, previos)
    expect(p.get('cliente')).toBe('abc-123')
    expect(p.get('moneda')).toBe('ARS')
  })

  it('cerrar la ficha conserva TODO el resto de la URL', () => {
    const p = cerrarOverlay(url('cliente=abc-123&mes=2026-05&moneda=USD&metrica=entregas&pagina=4'))
    expect(p.get('cliente')).toBeNull()
    expect(leerFiltrosInformes(p)).toMatchObject({
      mes: '2026-05',
      moneda: 'USD',
      metrica: 'entregas',
      pagina: 4,
    })
  })

  it('abrir una ficha no toca los filtros', () => {
    const antes = url('mes=2026-05&moneda=USD&metrica=entregas')
    const p = abrirOverlay(antes, 'producto', 'prod-1')
    expect(p.get('producto')).toBe('prod-1')
    expect(leerFiltrosInformes(p)).toEqual(leerFiltrosInformes(antes))
  })

  it('sólo hay UNA ficha abierta a la vez', () => {
    const p = abrirOverlay(url('cliente=abc'), 'producto', 'prod-1')
    expect(p.get('cliente')).toBeNull()
    expect(p.get('producto')).toBe('prod-1')
  })

  it('leerOverlay dice cuál está abierta', () => {
    expect(leerOverlay(url('cliente=abc'))).toEqual({ tipo: 'cliente', id: 'abc' })
    expect(leerOverlay(url('producto=def'))).toEqual({ tipo: 'producto', id: 'def' })
    expect(leerOverlay(url('moneda=USD'))).toBeNull()
    expect(leerOverlay(url('cliente='))).toBeNull()
  })

  it('las claves reservadas están declaradas, no repartidas por los componentes', () => {
    expect([...CLAVES_OVERLAY]).toEqual(['cliente', 'producto'])
  })
})

describe('Filtros activos', () => {
  it('sin filtros propios, ninguno', () => {
    expect(filtrosActivos(FILTROS_INFORMES_INICIALES)).toBe(0)
  })

  it('la métrica y la dimensión no cuentan: siempre valen algo', () => {
    expect(filtrosActivos({ ...FILTROS_INFORMES_INICIALES, metrica: 'entregas', dimension: 'productos' })).toBe(0)
  })

  it('moneda, estado, serie y origen sí', () => {
    expect(filtrosActivos({ ...FILTROS_INFORMES_INICIALES, moneda: 'USD', estado: 'sent' })).toBe(2)
  })
})
