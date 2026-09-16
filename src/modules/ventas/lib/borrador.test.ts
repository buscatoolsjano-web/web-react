import { describe, expect, it } from 'vitest'
import {
  agregarLinea,
  aPayload,
  cambiarCampo,
  cambiarCliente,
  cambiarLinea,
  cambiarMoneda,
  comoLineasDocumento,
  crearBorrador,
  hayCambios,
  moverLinea,
  proximoNumero,
  quitarLinea,
} from './borrador'
import type { DocumentoDetalle, LineaDocumento } from '../types'

const linea = (p: Partial<LineaDocumento> = {}): LineaDocumento => ({
  id: 'l1',
  numeroLinea: 1,
  tipoLinea: 'item',
  productId: 'p1',
  sku: 'PRO001',
  nombre: 'Candado',
  descripcion: null,
  cantidad: 2,
  precioUnitario: 100,
  descuentoPct: 0,
  tratamientoImpuesto: 'vat_21',
  tasaImpuesto: 21,
  ordenLineaId: null,
  ...p,
})

const doc = (p: Partial<DocumentoDetalle> = {}): DocumentoDetalle =>
  ({
    id: 'q1',
    tipo: 'cotizacion',
    clienteId: 'c1',
    contactoId: 'ct1',
    vendedorId: null,
    listaPrecioId: 'pl-usd',
    titulo: 'Original',
    fecha: '2026-09-01',
    validaHasta: null,
    moneda: 'USD',
    tipoCambio: null,
    formaPago: '30 días',
    descuentoPct: null,
    percepcionPct: null,
    notas: null,
    actualizadoEn: '2026-09-16T12:00:00.000Z',
    ...p,
  }) as DocumentoDetalle

const base = () => crearBorrador(doc(), [linea(), linea({ id: 'l2', numeroLinea: 2, cantidad: 1, precioUnitario: 50 })])

describe('snapshot', () => {
  it('captura la cabecera, las líneas y el testigo de concurrencia', () => {
    const b = base()
    expect(b.cabecera.titulo).toBe('Original')
    expect(b.cabecera.contactoId).toBe('ct1')
    expect(b.cabecera.listaPrecioId).toBe('pl-usd')
    expect(b.lineas).toHaveLength(2)
    expect(b.esperado).toBe('2026-09-16T12:00:00.000Z')
  })

  it('ordena las líneas por su número, no por cómo llegaron', () => {
    const b = crearBorrador(doc(), [linea({ id: 'l2', numeroLinea: 2 }), linea({ id: 'l1', numeroLinea: 1 })])
    expect(b.lineas.map((l) => l.id)).toEqual(['l1', 'l2'])
  })
})

describe('cambios pendientes', () => {
  it('recién copiado no hay nada que guardar', () => {
    const b = base()
    expect(hayCambios(b, b)) .toBe(false)
  })

  it('cambiar y volver al valor original NO deja cambios', () => {
    const o = base()
    const b = cambiarCampo(cambiarCampo(o, 'titulo', 'otro'), 'titulo', 'Original')
    expect(hayCambios(b, o)).toBe(false)
  })

  it.each([
    ['la cabecera', (b: ReturnType<typeof base>) => cambiarCampo(b, 'titulo', 'nuevo')],
    ['una línea', (b: ReturnType<typeof base>) => cambiarLinea(b, 'l1', 'cantidad', 9)],
    ['agregar', (b: ReturnType<typeof base>) => agregarLinea(b, { tipoLinea: 'item', productId: 'p2', sku: 'X', nombre: 'X', descripcion: null, cantidad: 1, precioUnitario: 10, descuentoPct: 0, tratamientoImpuesto: 'vat_21', tasaImpuesto: 21 })],
    ['quitar', (b: ReturnType<typeof base>) => quitarLinea(b, 'l2')],
    ['reordenar', (b: ReturnType<typeof base>) => moverLinea(b, 'l1', 1)],
  ])('%s sí deja cambios', (_caso, fn) => {
    const o = base()
    expect(hayCambios(fn(o), o)).toBe(true)
  })
})

describe('cliente y contacto', () => {
  it('cambiar de cliente limpia el contacto y lo avisa', () => {
    const { borrador, contactoLimpiado } = cambiarCliente(base(), 'c2')
    expect(borrador.cabecera.customerId).toBe('c2')
    expect(borrador.cabecera.contactoId).toBe('')
    expect(contactoLimpiado).toBe(true)
  })

  it('elegir el mismo cliente no toca nada', () => {
    const b = base()
    const { borrador, contactoLimpiado } = cambiarCliente(b, 'c1')
    expect(borrador).toBe(b)
    expect(contactoLimpiado).toBe(false)
  })

  it('cambiar de cliente NO toca las líneas: los precios son del documento', () => {
    const o = base()
    const { borrador } = cambiarCliente(o, 'c2')
    expect(borrador.lineas).toEqual(o.lineas)
  })
})

describe('moneda y tarifa', () => {
  it('cambiar a una moneda que la tarifa no maneja la limpia', () => {
    const { borrador, tarifaLimpiada } = cambiarMoneda(base(), 'ARS', 'USD')
    expect(borrador.cabecera.moneda).toBe('ARS')
    expect(borrador.cabecera.listaPrecioId).toBe('')
    expect(tarifaLimpiada).toBe(true)
  })

  it('si la tarifa es de la misma moneda, se queda', () => {
    const { borrador, tarifaLimpiada } = cambiarMoneda(base(), 'USD', 'USD')
    expect(borrador.cabecera.listaPrecioId).toBe('pl-usd')
    expect(tarifaLimpiada).toBe(false)
  })

  it('sin tarifa elegida no hay nada que limpiar', () => {
    const sin = cambiarCampo(base(), 'listaPrecioId', '')
    expect(cambiarMoneda(sin, 'ARS', null).tarifaLimpiada).toBe(false)
  })
})

describe('líneas', () => {
  it('una línea nueva no tiene id y toma el próximo número', () => {
    const b = agregarLinea(base(), {
      tipoLinea: 'item', productId: 'p9', sku: 'NUEVO', nombre: 'Nuevo', descripcion: null,
      cantidad: 3, precioUnitario: 70, descuentoPct: 0, tratamientoImpuesto: 'vat_21', tasaImpuesto: 21,
    })
    const nueva = b.lineas.at(-1)!
    expect(nueva.id).toBeNull()
    expect(nueva.numeroLinea).toBe(3)
    expect(proximoNumero(b)).toBe(4)
  })

  it('quitar una línea la saca del borrador; la fila sigue en la base', () => {
    const b = quitarLinea(base(), 'l1')
    expect(b.lineas.map((l) => l.id)).toEqual(['l2'])
  })

  it('mover intercambia los NÚMEROS, no sólo las posiciones', () => {
    const b = moverLinea(base(), 'l1', 1)
    expect(b.lineas.find((l) => l.id === 'l1')!.numeroLinea).toBe(2)
    expect(b.lineas.find((l) => l.id === 'l2')!.numeroLinea).toBe(1)
    expect(b.lineas.map((l) => l.id)).toEqual(['l2', 'l1'])
  })

  it('mover más allá de los extremos no hace nada', () => {
    const b = base()
    expect(moverLinea(b, 'l1', -1)).toBe(b)
    expect(moverLinea(b, 'l2', 1)).toBe(b)
  })

  it('la descripción se edita sin tocar el producto', () => {
    const b = cambiarLinea(base(), 'l1', 'descripcion', 'Texto comercial')
    const l = b.lineas.find((x) => x.clave === 'l1')!
    expect(l.descripcion).toBe('Texto comercial')
    expect(l.productId).toBe('p1')
    expect(l.nombre).toBe('Candado')
  })
})

describe('payload', () => {
  it('sin cambios de cabecera, la cabecera va vacía', () => {
    const o = base()
    expect(aPayload(o, o).cabecera).toEqual({})
  })

  it('sólo viajan los campos que cambiaron, con el nombre de su columna', () => {
    const o = base()
    const b = cambiarCampo(cambiarCampo(o, 'titulo', 'nuevo'), 'formaPago', 'Contado')
    expect(aPayload(b, o).cabecera).toEqual({ title: 'nuevo', payment_terms: 'Contado' })
  })

  it('un campo numérico vacío va como null, no como cero', () => {
    const o = crearBorrador(doc({ descuentoPct: 10 }), [linea()])
    const b = cambiarCampo(o, 'descuentoPct', '')
    expect(aPayload(b, o).cabecera).toEqual({ discount_pct: null })
  })

  it('vaciar el contacto va como null', () => {
    const o = base()
    const b = cambiarCampo(o, 'contactoId', '')
    expect(aPayload(b, o).cabecera).toEqual({ contact_id: null })
  })

  it('las líneas van SIEMPRE completas: el servidor deduce qué borrar', () => {
    const o = base()
    const b = quitarLinea(o, 'l2')
    const p = aPayload(b, o)
    expect(p.lineas).toHaveLength(1)
    expect(p.lineas[0]).toMatchObject({ id: 'l1', line_no: 1, quantity: 2, unit_price: 100 })
  })

  it('una línea nueva viaja con id nulo', () => {
    const o = base()
    const b = agregarLinea(o, {
      tipoLinea: 'item', productId: 'p9', sku: 'NUEVO', nombre: 'Nuevo', descripcion: 'desc',
      cantidad: 3, precioUnitario: 70, descuentoPct: 5, tratamientoImpuesto: 'vat_105', tasaImpuesto: 10.5,
    })
    expect(aPayload(b, o).lineas.at(-1)).toEqual({
      id: null, line_no: 3, line_type: 'item', product_id: 'p9',
      sku_snapshot: 'NUEVO', name_snapshot: 'Nuevo', description_snapshot: 'desc',
      quantity: 3, unit_price: 70, discount_pct: 5,
      tax_treatment: 'vat_105', tax_rate_snapshot: 10.5,
    })
  })

  it('el payload NUNCA lleva campos que el servidor rechaza', () => {
    const o = base()
    const b = cambiarCampo(o, 'titulo', 'x')
    const claves = Object.keys(aPayload(b, o).cabecera)
    for (const prohibido of ['company_id', 'number', 'status', 'imported_at', 'external_id', 'subtotal', 'total', 'created_by']) {
      expect(claves).not.toContain(prohibido)
    }
  })
})

describe('previsualización', () => {
  it('el borrador se puede dibujar con la tabla de lectura', () => {
    const b = cambiarLinea(base(), 'l1', 'cantidad', 7)
    const ls = comoLineasDocumento(b)
    expect(ls).toHaveLength(2)
    expect(ls[0]!.cantidad).toBe(7)
  })
})
