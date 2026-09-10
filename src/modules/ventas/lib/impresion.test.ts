import { describe, expect, it } from 'vitest'
import {
  construirImprimible,
  nombreDeArchivo,
  queMostrar,
  type OpcionesImpresion,
} from './impresion'
import type { DocumentoDetalle, LineaDocumento } from '../types'

const linea = (p: Partial<LineaDocumento> = {}): LineaDocumento => ({
  id: 'l1',
  numeroLinea: 1,
  tipoLinea: 'item',
  productId: 'p1',
  sku: 'PRO12586',
  nombre: 'Balanceador',
  descripcion: null,
  cantidad: 2,
  precioUnitario: 100,
  descuentoPct: 10,
  tratamientoImpuesto: 'vat_21',
  tasaImpuesto: 21,
  ordenLineaId: null,
  ...p,
})

const doc = (p: Partial<DocumentoDetalle> = {}): DocumentoDetalle => ({
  id: 'd1',
  tipo: 'cotizacion',
  numero: 'COTI02251',
  numeroOriginal: 'COTI02251',
  numeroSospechado: null,
  fecha: '2026-01-06',
  clienteId: 'c1',
  clienteNombre: 'Grupo Mirgor',
  contactoNombre: null,
  titulo: 'Balanceadores',
  moneda: 'USD',
  tipoCambio: null,
  estado: 'sent',
  estadoSecundario: null,
  vendedor: null,
  serie: 'COTI',
  notas: null,
  formaPago: null,
  validaHasta: null,
  descuentoPct: null,
  percepcionPct: null,
  subtotal: 180,
  impuesto: 37.8,
  total: 217.8,
  necesitaRevision: false,
  motivosRevision: [],
  numeroFueraDeSerie: false,
  esHistorico: false,
  lineas: [linea()],
  origen: null,
  ...p,
})

const opts = (p: Partial<OpcionesImpresion> = {}): OpcionesImpresion => ({
  formato: 'valorado',
  preciosConImpuestos: false,
  papel: 'A4',
  ...p,
})

describe('queMostrar', () => {
  it('cada formato muestra lo suyo', () => {
    expect(queMostrar('valorado')).toMatchObject({ precios: true, impuestos: true, totales: true })
    expect(queMostrar('sin-valorar')).toMatchObject({
      precios: false,
      impuestos: false,
      totales: false,
    })
    expect(queMostrar('sin-impuestos')).toMatchObject({ precios: true, impuestos: false })
    expect(queMostrar('sin-totales')).toMatchObject({ precios: true, totales: false })
    expect(queMostrar('pro-forma').proForma).toBe(true)
    expect(queMostrar('ticket').ticket).toBe(true)
  })
})

describe('construirImprimible', () => {
  it('los totales salen TAL CUAL del documento, no se recalculan', () => {
    // Un histórico que no cierra: las líneas dan 180 pero el total dice 999.
    const d = construirImprimible(
      doc({ subtotal: 900, impuesto: 99, total: 999, esHistorico: true }),
      opts(),
    )
    expect(d.subtotal).toBe(900)
    expect(d.impuesto).toBe(99)
    expect(d.total).toBe(999)
  })

  it('el subtotal por línea es presentación: cantidad × precio − descuento', () => {
    const d = construirImprimible(doc(), opts())
    // 2 × 100 − 10 % = 180
    expect(d.lineas[0]?.subtotal).toBe(180)
  })

  it('«precios con impuestos» usa la alícuota DE LA LÍNEA, no un 21 % fijo', () => {
    const d = construirImprimible(
      doc({ lineas: [linea({ tasaImpuesto: 10.5, descuentoPct: 0, cantidad: 1 })] }),
      opts({ preciosConImpuestos: true }),
    )
    expect(d.lineas[0]?.precio).toBeCloseTo(110.5, 6)
  })

  it('una línea exenta no se infla al pedir precios con impuestos', () => {
    const d = construirImprimible(
      doc({ lineas: [linea({ tasaImpuesto: 0, descuentoPct: 0, cantidad: 1 })] }),
      opts({ preciosConImpuestos: true }),
    )
    expect(d.lineas[0]?.precio).toBe(100)
  })

  it('una línea sin precio no inventa un subtotal', () => {
    const d = construirImprimible(doc({ lineas: [linea({ precioUnitario: null })] }), opts())
    expect(d.lineas[0]?.precio).toBeNull()
    expect(d.lineas[0]?.subtotal).toBeNull()
  })

  it('el capítulo se marca como tal', () => {
    const d = construirImprimible(
      doc({ lineas: [linea({ tipoLinea: 'chapter', nombre: 'Accesorios' })] }),
      opts(),
    )
    expect(d.lineas[0]?.esCapitulo).toBe(true)
  })

  it('pro forma cambia el encabezado', () => {
    expect(construirImprimible(doc(), opts({ formato: 'pro-forma' })).titulo).toBe('PRO FORMA')
    expect(construirImprimible(doc(), opts()).titulo).toBe('COTIZACIÓN DE VENTA')
  })

  it('el pedido y la entrega tienen su propio encabezado', () => {
    expect(construirImprimible(doc({ tipo: 'pedido' }), opts()).titulo).toBe('PEDIDO DE VENTA')
    expect(construirImprimible(doc({ tipo: 'entrega' }), opts()).titulo).toBe('NOTA DE ENTREGA')
  })
})

describe('nombreDeArchivo', () => {
  it('fecha - número - cliente, igual que el legacy', () => {
    expect(nombreDeArchivo(construirImprimible(doc(), opts()), 'pdf')).toBe(
      '2026-01-06 - COTI02251 - Grupo Mirgor.pdf',
    )
  })

  it('saca los caracteres que no valen en un nombre de archivo', () => {
    const d = construirImprimible(doc({ clienteNombre: 'A/B: C*D?' }), opts())
    expect(nombreDeArchivo(d, 'csv')).not.toMatch(/[\\/:*?"<>|]/)
  })
})
