import { describe, expect, it } from 'vitest'
import { sumarMeses } from './formato'
import { aHojaDePresupuesto, asuntoDePresupuesto } from './hojaPresupuesto'
import { etiquetaDeMotivoPausa, etiquetaDeResultadoFinal } from './estados'
import type { LineaCotizacion, OrdenDetalle } from '../types'

describe('sumarMeses (próximo preventivo)', () => {
  it('suma meses comunes', () => {
    expect(sumarMeses('2026-11-19', 6)).toBe('2027-05-19')
    expect(sumarMeses('2026-01-15', 12)).toBe('2027-01-15')
  })
  it('si el día no existe en el mes de destino, queda el último', () => {
    expect(sumarMeses('2026-11-30', 3)).toBe('2027-02-28')
    expect(sumarMeses('2027-08-31', 6)).toBe('2028-02-29')
  })
})

describe('etiquetas nuevas', () => {
  it('motivo de pausa y resultado final, con nulo y valor desconocido', () => {
    expect(etiquetaDeMotivoPausa('sin_repuesto')).toBe('Sin repuesto')
    expect(etiquetaDeMotivoPausa(null)).toBeNull()
    expect(etiquetaDeMotivoPausa('raro')).toBe('raro')
    expect(etiquetaDeResultadoFinal('espera_repuesto')).toBe('En espera de repuesto')
  })
})

const orden = {
  id: 'o1',
  numero: 'OS00012',
  cliente: 'Whirlpool Argentina S.A.',
  clienteId: 'c1',
  activoReferencia: 'EQ00227',
  activoModelo: 'FEIN ASM18-8-PC',
  activoSerie: '000460',
  fechaIngreso: '2026-11-10',
  moneda: 'USD',
  tecnico: 'Facu',
  notasCotizacion: null,
  tipoServicio: 'corrective',
  motivoIngreso: null,
  subtotal: 100,
  total: 121,
} as unknown as OrdenDetalle

const linea = (posicion: number, d: Partial<LineaCotizacion>): LineaCotizacion => ({
  id: `l${posicion}`,
  posicion,
  tipo: 'part',
  productoId: null,
  sku: null,
  descripcion: null,
  cantidad: 1,
  precioUnitario: 10,
  total: 10,
  ...d,
})

describe('aHojaDePresupuesto', () => {
  it('ordena por posición, numera y nombra la línea sin descripción por su tipo', () => {
    const h = aHojaDePresupuesto(orden, [linea(2, { tipo: 'labour' }), linea(1, { descripcion: 'Embrague', sku: 'F-1' })])
    expect(h.lineas.map((l) => [l.numero, l.nombre])).toEqual([
      [1, 'Embrague'],
      [2, 'Mano de obra'],
    ])
    expect(h.subtitulo).toBe('FEIN ASM18-8-PC · N° de serie 000460')
    expect(h.impuesto).toBe(21)
    expect(h.rotulos?.bloqueDatos).toBe('Datos del servicio')
  })

  it('sin impuesto no muestra el renglón', () => {
    expect(aHojaDePresupuesto({ ...orden, total: 100 }, []).impuesto).toBeNull()
  })

  it('el asunto lleva el número y el modelo', () => {
    expect(asuntoDePresupuesto(orden)).toBe('Presupuesto de servicio OS00012 · FEIN ASM18-8-PC')
  })
})
