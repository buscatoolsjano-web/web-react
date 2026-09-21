import { describe, expect, it } from 'vitest'
import { revisarMotivos } from './revision'
import type { DocumentoDetalle, LineaDocumento } from '../types'

/**
 * Los avisos de la migración, contrastados con el documento (Fase 19 · E4).
 *
 * Los casos salen de producción: `PDV01315` avisaba «Sin moneda», «Algún
 * producto no está en el catálogo», «Los totales no cierran» y «Sin cotización
 * de origen» teniendo moneda USD, las dos líneas resueltas, los totales
 * cerrados y su cotización enlazada.
 */
const linea = (p: Partial<LineaDocumento> = {}): LineaDocumento => ({
  id: 'l1',
  numeroLinea: 1,
  tipoLinea: 'item',
  productId: 'p1',
  sku: 'PRO12600',
  nombre: 'Linterna de Inspección LED 900lm',
  descripcion: null,
  cantidad: 2,
  precioUnitario: 316.98,
  descuentoPct: null,
  tratamientoImpuesto: 'vat_21',
  tasaImpuesto: 21,
  ordenLineaId: null,
  ...p,
})

const doc = (p: Partial<DocumentoDetalle> = {}): DocumentoDetalle =>
  ({
    id: 'o1',
    tipo: 'pedido',
    numero: 'PDV01315',
    moneda: 'USD',
    tipoCambio: null,
    descuentoPct: null,
    percepcionPct: null,
    subtotal: 633.96,
    impuesto: 133.13,
    total: 767.09,
    motivosRevision: [],
    numeroFueraDeSerie: false,
    numeroSospechado: null,
    esHistorico: true,
    lineas: [linea()],
    origen: null,
    ...p,
  }) as DocumentoDetalle

describe('revisarMotivos', () => {
  it('sin motivos no inventa nada', () => {
    expect(revisarMotivos(doc())).toEqual({ vigentes: [], resueltos: [] })
  })

  it('la moneda que ahora está desmiente el aviso de que falta', () => {
    expect(revisarMotivos(doc({ motivosRevision: ['MISSING_CURRENCY'] })).resueltos).toEqual([
      'MISSING_CURRENCY',
    ])
    expect(revisarMotivos(doc({ moneda: null, motivosRevision: ['MISSING_CURRENCY'] })).vigentes).toEqual([
      'MISSING_CURRENCY',
    ])
  })

  it('un producto sin resolver mantiene el aviso; todos resueltos lo cierran', () => {
    const conHuerfana = doc({
      motivosRevision: ['UNRESOLVED_SKU'],
      lineas: [linea(), linea({ id: 'l2', productId: null })],
    })
    expect(revisarMotivos(conHuerfana).vigentes).toEqual(['UNRESOLVED_SKU'])
    expect(revisarMotivos(doc({ motivosRevision: ['UNRESOLVED_SKU'] })).resueltos).toEqual([
      'UNRESOLVED_SKU',
    ])
  })

  it('un capítulo no cuenta como producto sin resolver: es un título', () => {
    const conCapitulo = doc({
      motivosRevision: ['UNRESOLVED_SKU'],
      lineas: [linea(), linea({ id: 'l2', tipoLinea: 'chapter', productId: null, precioUnitario: null })],
    })
    expect(revisarMotivos(conCapitulo).resueltos).toEqual(['UNRESOLVED_SKU'])
  })

  it('el pedido que SÍ tiene cotización de origen no puede seguir diciendo que no', () => {
    const conOrigen = doc({
      motivosRevision: ['NO_QUOTE_LINK'],
      origen: { tipo: 'cotizacion', id: 'q1', numero: 'COTI02100' },
    })
    expect(revisarMotivos(conOrigen).resueltos).toEqual(['NO_QUOTE_LINK'])
    expect(revisarMotivos(doc({ motivosRevision: ['NO_QUOTE_LINK'] })).vigentes).toEqual(['NO_QUOTE_LINK'])
  })

  it('un origen de otro tipo no resuelve el aviso: no es la cotización', () => {
    const conRemito = doc({
      motivosRevision: ['NO_QUOTE_LINK'],
      origen: { tipo: 'pedido', id: 'o0', numero: 'PDV00001' },
    })
    expect(revisarMotivos(conRemito).vigentes).toEqual(['NO_QUOTE_LINK'])
  })

  describe('los totales', () => {
    it('cierran con la fórmula del ERP: el aviso ya no aplica', () => {
      const d = doc({ motivosRevision: ['TOTALS_DO_NOT_CLOSE'] })
      expect(revisarMotivos(d).resueltos).toEqual(['TOTALS_DO_NOT_CLOSE'])
    })

    it('no cierran: el aviso queda, y el total guardado no se toca', () => {
      const d = doc({ motivosRevision: ['TOTALS_DO_NOT_CLOSE'], total: 999 })
      expect(revisarMotivos(d).vigentes).toEqual(['TOTALS_DO_NOT_CLOSE'])
      expect(d.total).toBe(999)
    })

    /** Las 600 líneas de entrega históricas no tienen precio: no hay qué sumar. */
    it('sin precio en alguna línea NO se declara resuelto', () => {
      const d = doc({
        motivosRevision: ['TOTALS_DO_NOT_CLOSE'],
        lineas: [linea({ precioUnitario: null })],
      })
      expect(revisarMotivos(d).vigentes).toEqual(['TOTALS_DO_NOT_CLOSE'])
    })

    it('sin líneas tampoco: un documento vacío no prueba nada', () => {
      const d = doc({ motivosRevision: ['TOTALS_DO_NOT_CLOSE'], lineas: [] })
      expect(revisarMotivos(d).vigentes).toEqual(['TOTALS_DO_NOT_CLOSE'])
    })
  })

  it('lo que no se sabe verificar queda vigente, nunca resuelto', () => {
    const d = doc({ motivosRevision: ['DELIVERED_BY_ARRAY_INDEX', 'NUMBER_OUTLIER', 'INVENTADO'] })
    expect(revisarMotivos(d)).toEqual({
      vigentes: ['DELIVERED_BY_ARRAY_INDEX', 'NUMBER_OUTLIER', 'INVENTADO'],
      resueltos: [],
    })
  })

  it('el tipo de cambio que falta sigue faltando: 75 documentos en producción', () => {
    expect(revisarMotivos(doc({ motivosRevision: ['NO_EXCHANGE_RATE'] })).vigentes).toEqual([
      'NO_EXCHANGE_RATE',
    ])
    expect(revisarMotivos(doc({ tipoCambio: 1450, motivosRevision: ['NO_EXCHANGE_RATE'] })).resueltos).toEqual([
      'NO_EXCHANGE_RATE',
    ])
  })

  it('el caso real: PDV01315 avisaba cuatro cosas y ninguna pasa hoy', () => {
    const pdv01315 = doc({
      motivosRevision: ['MISSING_CURRENCY', 'UNRESOLVED_SKU', 'TOTALS_DO_NOT_CLOSE', 'NO_QUOTE_LINK'],
      origen: { tipo: 'cotizacion', id: 'q1', numero: 'COTI02280' },
    })
    expect(revisarMotivos(pdv01315).vigentes).toEqual([])
    expect(revisarMotivos(pdv01315).resueltos).toHaveLength(4)
  })
})
