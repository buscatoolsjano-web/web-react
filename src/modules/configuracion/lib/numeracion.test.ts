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

// ── Editar la numeración (Fase 58 · E3) ─────────────────────────────────────

import { mensajeErrorNumeracion, validarSerie, vistaPreviaNumero, type FormularioSerie } from './numeracion'

const form = (p: Partial<FormularioSerie> = {}): FormularioSerie => ({
  docType: 'quote',
  serie: 'COT-2026',
  prefijo: 'COT-2026',
  relleno: '5',
  proximo: '1',
  esDefault: false,
  seleccionable: true,
  ...p,
})

describe('validarSerie', () => {
  it('un formulario bien lleno pasa, y normaliza a mayúsculas', () => {
    const r = validarSerie(form({ serie: ' cot-2026 ', prefijo: ' cot-2026 ' }), null)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.valor.serie).toBe('COT-2026')
      expect(r.valor.prefijo).toBe('COT-2026')
      expect(r.valor.relleno).toBe(5)
      expect(r.valor.proximo).toBe(1)
    }
  })

  /*
   * EL ERROR QUE IMPORTA. Si el próximo número no está por encima del mayor ya
   * emitido, el ERP emitiría un número repetido. Y el mensaje dice CUÁL es el
   * número ocupado: sin eso, el usuario no sabe a qué subirlo.
   */
  it('rechaza un próximo número que ya se emitió, y dice cuál', () => {
    const r = validarSerie(form({ prefijo: 'COTI', proximo: '2585' }), 2585)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errores.proximo).toContain('02585')
      expect(r.errores.proximo).toContain('2585')
    }
  })

  it('el siguiente al mayor emitido sí pasa', () => {
    expect(validarSerie(form({ prefijo: 'COTI', proximo: '2586' }), 2585).ok).toBe(true)
  })

  // Sin documentos emitidos cualquier número sirve: no hay nada que repetir.
  it('sin nada emitido acepta el 1', () => {
    expect(validarSerie(form({ proximo: '1' }), null).ok).toBe(true)
  })

  it('rechaza un prefijo con espacios o con acento', () => {
    for (const p of ['CO TI', 'COTÍ', '-COT', '']) {
      const r = validarSerie(form({ prefijo: p }), null)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errores.prefijo).toBeDefined()
    }
  })

  it('rechaza relleno y próximo fuera de rango, y lo no entero', () => {
    expect(validarSerie(form({ relleno: '21' }), null).ok).toBe(false)
    expect(validarSerie(form({ relleno: '-1' }), null).ok).toBe(false)
    expect(validarSerie(form({ relleno: '2,5' }), null).ok).toBe(false)
    expect(validarSerie(form({ proximo: '0' }), null).ok).toBe(false)
    expect(validarSerie(form({ proximo: 'ocho' }), null).ok).toBe(false)
  })

  // Relleno 0 es válido: RT usa 10, pero una serie sin ceros a la izquierda
  // también es legítima.
  it('acepta relleno 0', () => {
    expect(validarSerie(form({ relleno: '0' }), null).ok).toBe(true)
  })

  it('rechaza una serie vacía y un tipo que no existe', () => {
    expect(validarSerie(form({ serie: '  ' }), null).ok).toBe(false)
    expect(validarSerie(form({ docType: 'inventado' }), null).ok).toBe(false)
  })

  it('rechaza más de 20 caracteres en serie y prefijo', () => {
    expect(validarSerie(form({ serie: 'A'.repeat(21) }), null).ok).toBe(false)
    expect(validarSerie(form({ prefijo: 'A'.repeat(21) }), null).ok).toBe(false)
  })
})

describe('vistaPreviaNumero', () => {
  it('muestra cómo va a salir el número', () => {
    expect(vistaPreviaNumero({ prefijo: 'cot-2026', relleno: '5', proximo: '7' })).toBe('COT-202600007')
    expect(vistaPreviaNumero({ prefijo: 'RT', relleno: '10', proximo: '1434' })).toBe('RT0000001434')
  })

  it('sin un número todavía no inventa nada', () => {
    expect(vistaPreviaNumero({ prefijo: 'COT', relleno: '5', proximo: '' })).toBe('—')
    expect(vistaPreviaNumero({ prefijo: 'COT', relleno: '5', proximo: 'ocho' })).toBe('—')
  })

  // Mientras se escribe, el relleno puede estar en un estado inválido y la
  // vista previa no tiene que romperse ni mentir: muestra sin relleno.
  it('con un relleno inválido no se rompe', () => {
    expect(vistaPreviaNumero({ prefijo: 'COT', relleno: '99', proximo: '7' })).toBe('COT7')
  })
})

describe('mensajeErrorNumeracion', () => {
  it('numero_ocupado y serie_con_documentos traen el número pegado y lo muestran', () => {
    expect(mensajeErrorNumeracion('numero_ocupado:2585')).toContain('2585')
    expect(mensajeErrorNumeracion('serie_con_documentos:2585')).toContain('2585')
  })

  it('cada código tiene su texto y el desconocido no queda vacío', () => {
    for (const c of ['sin_permiso', 'autoridad_externa', 'tipo_invalido', 'serie_invalida',
                     'prefijo_invalido', 'relleno_invalido', 'numero_invalido',
                     'sin_predeterminada', 'es_predeterminada', 'no_encontrado', 'sin_red', 'raro']) {
      expect(mensajeErrorNumeracion(c).length).toBeGreaterThan(10)
    }
  })
})
