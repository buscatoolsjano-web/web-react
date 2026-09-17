import { describe, expect, it } from 'vitest'
import {
  aPayloadRemito,
  agregarLineaRemito,
  cambiarCampoRemito,
  cambiarLineaRemito,
  crearBorradorRemito,
  faltaParaGuardarRemito,
  hayCambiosRemito,
  quitarLineaRemito,
  topeDeLinea,
} from './borradorRemito'
import type { DocumentoDetalle, LineaDocumento } from '../types'

const linea = (p: Partial<LineaDocumento> = {}): LineaDocumento => ({
  id: 'dl1',
  numeroLinea: 1,
  tipoLinea: 'item',
  productId: 'p1',
  sku: 'ZZ-1',
  nombre: 'Candado',
  descripcion: null,
  cantidad: 4,
  precioUnitario: 100,
  descuentoPct: 0,
  tratamientoImpuesto: 'vat_21',
  tasaImpuesto: 21,
  ordenLineaId: 'ol1',
  ...p,
})

const doc = (p: Partial<DocumentoDetalle> = {}): DocumentoDetalle =>
  ({
    id: 'd1',
    tipo: 'entrega',
    fecha: '2026-09-18',
    titulo: 'Original',
    notas: null,
    contactoId: 'ct1',
    actualizadoEn: '2026-09-18T12:00:00.000Z',
    ...p,
  }) as DocumentoDetalle

const base = () =>
  crearBorradorRemito(doc(), [linea(), linea({ id: 'dl2', numeroLinea: 2, ordenLineaId: 'ol2', cantidad: 1 })], {
    transporte: 'ZZ Transporte',
  })

describe('snapshot del remito', () => {
  it('captura cabecera, líneas y testigo, y ordena por número de línea', () => {
    const b = crearBorradorRemito(doc(), [linea({ id: 'dl2', numeroLinea: 2 }), linea({ id: 'dl1', numeroLinea: 1 })])
    expect(b.lineas.map((l) => l.id)).toEqual(['dl1', 'dl2'])
    expect(b.cabecera.fecha).toBe('2026-09-18')
    expect(b.cabecera.contactoId).toBe('ct1')
    expect(b.esperado).toBe('2026-09-18T12:00:00.000Z')
  })

  it('recién copiado no hay nada que guardar', () => {
    const b = base()
    expect(hayCambiosRemito(b, b)).toBe(false)
  })

  it('tocar una cantidad ya es un cambio', () => {
    const b = base()
    expect(hayCambiosRemito(cambiarLineaRemito(b, 'dl1', 'cantidad', '3'), b)).toBe(true)
  })
})

describe('payload de guardar_remito', () => {
  it('manda sólo la cabecera que cambió, con las columnas del remito', () => {
    const b = base()
    const cambiado = cambiarCampoRemito(cambiarCampoRemito(b, 'fecha', '2026-09-20'), 'seguimiento', 'ZZ-9')
    const { cabecera } = aPayloadRemito(cambiado, b)
    expect(cabecera).toEqual({ delivery_date: '2026-09-20', tracking: 'ZZ-9' })
  })

  it('un campo vaciado viaja como null, no como cadena vacía', () => {
    const b = base()
    const { cabecera } = aPayloadRemito(cambiarCampoRemito(b, 'transporte', ''), b)
    expect(cabecera).toEqual({ carrier: null })
  })

  it('nunca manda campos que el remito no decide', () => {
    const b = base()
    const claves = Object.keys(aPayloadRemito(cambiarCampoRemito(b, 'titulo', 'Otro'), b).cabecera)
    for (const prohibido of [
      'company_id', 'number', 'series_code', 'status', 'order_id', 'customer_id',
      'created_by', 'imported_at', 'external_id', 'subtotal', 'total', 'unit_price',
    ]) {
      expect(claves).not.toContain(prohibido)
    }
  })

  it('las líneas viajan enteras, con su id y su línea del pedido', () => {
    const b = base()
    const { lineas } = aPayloadRemito(cambiarLineaRemito(b, 'dl1', 'cantidad', '3'), b)
    expect(lineas).toHaveLength(2)
    expect(lineas[0]).toEqual({
      id: 'dl1', order_line_id: 'ol1', quantity: 3, description_snapshot: null,
    })
  })

  it('una línea nueva va sin id y con la línea del pedido', () => {
    const b = agregarLineaRemito(base(), { orderLineId: 'ol3', sku: 'ZZ-3', nombre: 'Nueva', cantidad: 2 })
    const { lineas } = aPayloadRemito(b, base())
    expect(lineas[2]).toEqual({ order_line_id: 'ol3', quantity: 2, description_snapshot: null })
    expect('id' in lineas[2]!).toBe(false)
  })

  it('quitar una línea la saca del payload: el servidor la borra', () => {
    const b = quitarLineaRemito(base(), 'dl2')
    const { lineas } = aPayloadRemito(b, base())
    expect(lineas.map((l) => l.id)).toEqual(['dl1'])
  })

  it('la coma decimal se entiende como decimal', () => {
    const b = cambiarLineaRemito(base(), 'dl1', 'cantidad', '2,5')
    expect(aPayloadRemito(b, base()).lineas[0]!.quantity).toBe(2.5)
  })

  it('el texto del remito es propio y puede vaciarse', () => {
    const b = cambiarLineaRemito(base(), 'dl1', 'descripcion', 'ZZ texto del remito')
    expect(aPayloadRemito(b, base()).lineas[0]!.description_snapshot).toBe('ZZ texto del remito')
  })
})

describe('qué falta para guardar', () => {
  it('con todo cargado, nada', () => {
    expect(faltaParaGuardarRemito(base())).toEqual([])
  })

  it('sin líneas, lo dice', () => {
    const b = quitarLineaRemito(quitarLineaRemito(base(), 'dl1'), 'dl2')
    expect(faltaParaGuardarRemito(b)[0]).toMatch(/sin líneas/)
  })

  it('una cantidad en cero o vacía no pasa', () => {
    expect(faltaParaGuardarRemito(cambiarLineaRemito(base(), 'dl1', 'cantidad', '0'))[0]).toMatch(/mayores que cero/)
    expect(faltaParaGuardarRemito(cambiarLineaRemito(base(), 'dl1', 'cantidad', ''))[0]).toMatch(/mayores que cero/)
    expect(faltaParaGuardarRemito(cambiarLineaRemito(base(), 'dl1', 'cantidad', '-2'))[0]).toMatch(/mayores que cero/)
  })

  it('sin fecha tampoco', () => {
    expect(faltaParaGuardarRemito(cambiarCampoRemito(base(), 'fecha', ''))).toContain('Falta la fecha del remito.')
  })
})

describe('tope de cada línea', () => {
  const pendientes = new Map([['ol1', { pendiente: 6, enEsteRemito: 4 }]])

  it('es el pendiente MÁS lo que este remito ya tenía tomado', () => {
    expect(topeDeLinea(base().lineas[0]!, pendientes)).toBe(10)
  })

  it('sin pedido de origen no hay tope que calcular', () => {
    const suelta = { ...base().lineas[0]!, orderLineId: null }
    expect(topeDeLinea(suelta, pendientes)).toBeNull()
  })
})
