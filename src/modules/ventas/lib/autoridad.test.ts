import { describe, expect, it } from 'vitest'
import {
  DOC_TYPE_DE,
  MENSAJE_AUTORIDAD_EXTERNA,
  esErrorAutoridadExterna,
  mapaAutoridad,
  mensajeErrorVentas,
  motivoBloqueo,
} from './autoridad'

describe('autoridad de numeración en Ventas', () => {
  it('sin filas, los tres tipos los numera el ERP', () => {
    expect(mapaAutoridad([])).toEqual({ quote: 'ERP', sales_order: 'ERP', delivery: 'ERP' })
  })

  it('toma sólo STEL explícito y descarta tipos o valores desconocidos', () => {
    expect(
      mapaAutoridad([
        { doc_type: 'quote', authority: 'STEL' },
        { doc_type: 'delivery', authority: 'ERP' },
        { doc_type: 'customer', authority: 'STEL' },
        { doc_type: 'sales_order', authority: 'stel' },
      ]),
    ).toEqual({ quote: 'STEL', sales_order: 'ERP', delivery: 'ERP' })
  })

  it('mapea cada pantalla a su doc_type', () => {
    expect(DOC_TYPE_DE).toEqual({ cotizacion: 'quote', pedido: 'sales_order', entrega: 'delivery' })
  })

  it('reconoce el código estable aunque venga envuelto por el servicio', () => {
    const e = new Error('No se pudo obtener el número: external_numbering_authority')
    expect(esErrorAutoridadExterna(e)).toBe(true)
    expect(mensajeErrorVentas(e)).toBe(MENSAJE_AUTORIDAD_EXTERNA)
    expect(MENSAJE_AUTORIDAD_EXTERNA).toBe(
      'La numeración de este documento todavía está administrada por STEL. No se puede emitir desde el ERP hasta completar la migración.',
    )
  })

  it('otros errores pasan tal cual', () => {
    expect(esErrorAutoridadExterna(new Error('Sin permiso'))).toBe(false)
    expect(mensajeErrorVentas(new Error('Sin permiso'))).toBe('Sin permiso')
    expect(mensajeErrorVentas(42)).toBe('Ocurrió un error inesperado.')
  })

  it('el motivo nombra el tipo bloqueado', () => {
    expect(motivoBloqueo('delivery')).toMatch(/STEL numera las notas de entrega de esta empresa/)
    expect(motivoBloqueo('sales_order')).toMatch(/STEL numera los pedidos/)
    expect(motivoBloqueo('quote', 'sales_order')).toBe(
      'Emisión desde el ERP bloqueada: STEL numera las cotizaciones y los pedidos de esta empresa.',
    )
  })
})
