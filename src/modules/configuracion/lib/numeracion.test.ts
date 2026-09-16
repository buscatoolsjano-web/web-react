import { describe, expect, it } from 'vitest'
import { alertas, etiquetaTipo, filasAutoridad, formatearNumero, normalizarEstado, presentarAutoridad, presentarEmision, presentarEstado, presentarFilaAutoridad, type AutoridadSerie, type SecuenciaDiagnostico } from './numeracion'

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
    expect(formatearNumero({ prefijo: 'NTEP', padding: 5 }, null)).toBe('—')
  })
  it('etiquetas de tipo conocidas y desconocidas', () => {
    expect(etiquetaTipo('quote')).toBe('Cotizaciones')
    expect(etiquetaTipo('otro_tipo')).toBe('otro_tipo')
  })
})

describe('autoridad por serie (Fase 14 E5)', () => {
  const ventas = [
    sec({ docType: 'quote', serie: 'COTI', prefijo: 'COTI', padding: 5, proximo: 'COTI02630', autoridad: 'ERP', autoridadConfigurada: true }),
    sec({ docType: 'sales_order', serie: 'PDV', prefijo: 'PDV', padding: 5, proximo: 'PDV01319', autoridad: 'ERP', autoridadConfigurada: true }),
    sec({ docType: 'delivery', serie: 'RT', proximo: 'RT0000001433', autoridad: 'ERP', autoridadConfigurada: true }),
  ]
  const rtml: AutoridadSerie = { docType: 'delivery', serie: 'RT-ML', autoridad: 'STEL', motivo: 'MercadoLibre sigue en STEL' }

  it('con todo en ERP muestra una fila por serie con su próximo número', () => {
    const filas = filasAutoridad(ventas, [])
    expect(filas.map((f) => [f.serie, f.autoridad, f.proximo])).toEqual([
      ['RT', 'ERP', 'RT0000001433'],
      ['COTI', 'ERP', 'COTI02630'],
      ['PDV', 'ERP', 'PDV01319'],
    ])
    expect(filas.every((f) => !f.porSerie && !f.soloImportacion)).toBe(true)
  })

  it('si el tipo es de STEL, la serie hereda y no ofrece número del ERP', () => {
    const [fila] = filasAutoridad([sec({ autoridad: 'STEL', autoridadConfigurada: true })], [])
    expect([fila!.autoridad, fila!.proximo, fila!.porSerie, fila!.soloImportacion]).toEqual(['STEL', null, false, true])
  })

  it('RT-ML aparece como excepción de serie, sin secuencia del ERP', () => {
    const filas = filasAutoridad(ventas, [rtml])
    const ml = filas.find((f) => f.serie === 'RT-ML')!
    expect([ml.autoridad, ml.porSerie, ml.soloImportacion, ml.proximo]).toEqual(['STEL', true, true, null])
    expect(ml.etiqueta).toBe('Remitos MercadoLibre')
    // …y la serie normal de remitos no se contagia.
    expect(filas.find((f) => f.serie === 'RT')!.autoridad).toBe('ERP')
  })

  it('una excepción de serie manda sobre la autoridad del tipo, en los dos sentidos', () => {
    const tipoStel = [sec({ autoridad: 'STEL', autoridadConfigurada: true })]
    const serieErp: AutoridadSerie = { docType: 'delivery', serie: 'RT', autoridad: 'ERP', motivo: 'la serie RT pasó al ERP' }
    const [fila] = filasAutoridad(tipoStel, [serieErp])
    expect([fila!.autoridad, fila!.porSerie, fila!.proximo]).toEqual(['ERP', true, 'RT0000001424'])
  })

  it('sin excepciones (o si la consulta falla) igual devuelve las filas por tipo', () => {
    expect(filasAutoridad(ventas, []).length).toBe(3)
  })

  it('no inventa filas para tipos sin semántica de autoridad', () => {
    const otros = [sec({ docType: 'customer', serie: 'CLI', prefijo: 'CLI', padding: 5, proximo: 'CLI01225' })]
    expect(filasAutoridad(otros, [])).toEqual([])
  })

  it('el texto explica el modo sin tecnicismos', () => {
    const filas = filasAutoridad(ventas, [rtml])
    const ml = presentarFilaAutoridad(filas.find((f) => f.serie === 'RT-ML')!)
    expect(ml.etiqueta).toBe('STEL · Solo importación')
    expect(ml.tono).toBe('alerta')
    expect(ml.detalle).toContain('sólo la importa')
    const rt = presentarFilaAutoridad(filas.find((f) => f.serie === 'RT')!)
    expect([rt.etiqueta, rt.tono]).toEqual(['ERP', 'ok'])
  })
})
