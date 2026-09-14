import { describe, expect, it } from 'vitest'
import { alertas, etiquetaTipo, formatearNumero, normalizarEstado, presentarAutoridad, presentarEmision, presentarEstado, type SecuenciaDiagnostico } from './numeracion'

const sec = (p: Partial<SecuenciaDiagnostico>): SecuenciaDiagnostico => ({
  docType: 'delivery',
  serie: 'RT',
  prefijo: 'RT',
  padding: 10,
  esDefault: true,
  proximo: 'RT0000001424',
  proximoNumero: 1424,
  documentos: 182,
  fueraPatron: 0,
  maxNumero: 1423,
  maxSinAtipicos: 1423,
  atipicosPorEncima: 0,
  estado: 'OK',
  autoridad: 'ERP',
  autoridadConfigurada: false,
  ...p,
})

describe('estado de la secuencia', () => {
  it('mapea los estados del servidor y desconoce el resto', () => {
    expect(['OK', 'BEHIND', 'AHEAD', 'SIN_DOCUMENTOS', 'raro', ''].map(normalizarEstado)).toEqual(['OK', 'BEHIND', 'AHEAD', 'SIN_DOCUMENTOS', 'UNKNOWN', 'UNKNOWN'])
  })
  it('cada estado tiene etiqueta en texto (no sólo color) y tono', () => {
    expect(presentarEstado(sec({ estado: 'OK' }))).toMatchObject({ etiqueta: 'Al día', tono: 'ok' })
    const atrasada = sec({ estado: 'BEHIND', proximo: 'CLI00003', proximoNumero: 3, maxSinAtipicos: 5, prefijo: 'CLI', padding: 5 })
    expect(presentarEstado(atrasada)).toMatchObject({ etiqueta: 'Atrasada', tono: 'error' })
    expect(presentarEstado(atrasada).detalle).toMatch(/Colisión: ya existe CLI00005 y el próximo número sería CLI00003/)
    expect(presentarEstado(sec({ estado: 'AHEAD' }))).toMatchObject({ etiqueta: 'Adelantada', tono: 'alerta' })
    expect(presentarEstado(sec({ estado: 'SIN_DOCUMENTOS' })).etiqueta).toBe('Sin documentos')
    expect(presentarEstado(sec({ estado: 'UNKNOWN' })).etiqueta).toBe('Desconocido')
  })
})

describe('autoridad', () => {
  it('STEL avisa que «Al día» no descarta una colisión con STEL', () => {
    expect(presentarAutoridad('STEL').detalle).toMatch(/no descarta una colisión/)
    expect(presentarAutoridad('ERP').etiqueta).toBe('ERP')
  })
  it('STEL muestra la emisión desde ERP bloqueada; ERP, habilitada', () => {
    expect(presentarEmision('STEL')).toMatchObject({ etiqueta: 'Emisión desde ERP bloqueada', tono: 'error' })
    expect(presentarEmision('STEL').detalle).toMatch(/external_numbering_authority/)
    expect(presentarEmision('ERP').etiqueta).toBe('Emisión desde ERP habilitada')
  })
})

describe('alertas', () => {
  it('sin conflictos ni STEL no hay alertas', () => {
    expect(alertas([sec({})])).toEqual([])
  })
  it('conflicto, autoridad STEL y atípicos', () => {
    const a = alertas([
      sec({ docType: 'customer', estado: 'BEHIND' }),
      sec({ docType: 'delivery', autoridad: 'STEL' }),
      sec({ docType: 'sales_order', prefijo: 'PDV', padding: 5, autoridad: 'STEL', atipicosPorEncima: 9, maxNumero: 11292 }),
    ])
    expect(a[0]).toMatch(/1 secuencia\(s\) atrasada\(s\).*Clientes/)
    expect(a[1]).toMatch(/STEL es la autoridad de notas de entrega \(remitos\), pedidos de venta/)
    expect(a[2]).toMatch(/9 número\(s\) atípico\(s\).*PDV11292/)
  })
  it('lista vacía (0 secuencias)', () => {
    expect(alertas([])).toEqual([])
  })
  it('formatea números con el relleno de la secuencia', () => {
    expect(formatearNumero({ prefijo: 'RT', padding: 10 }, 1426)).toBe('RT0000001426')
    expect(formatearNumero({ prefijo: 'PDV', padding: 5 }, 11292)).toBe('PDV11292')
    expect(formatearNumero({ prefijo: 'NEP', padding: 5 }, null)).toBe('—')
  })
  it('etiquetas de tipo conocidas y desconocidas', () => {
    expect(etiquetaTipo('quote')).toBe('Cotizaciones')
    expect(etiquetaTipo('otro_tipo')).toBe('otro_tipo')
  })
})
