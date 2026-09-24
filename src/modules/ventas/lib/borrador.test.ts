import { describe, expect, it } from 'vitest'
import {
  aPayload,
  aPayloadCreacion,
  aPayloadCreacionPedido,
  aPayloadPedido,
  agregarLinea,
  borradorNuevo,
  cambiarCampo,
  cambiarCliente,
  cambiarLinea,
  cambiarMoneda,
  comoLineasDocumento,
  crearBorrador,
  faltaParaCrear,
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

  /**
   * Fase 28 · E6. Elegir tres veces el mismo producto es pedir tres unidades,
   * no tres renglones: el documento impreso quedaba con la misma referencia
   * repetida y había que juntarla a mano.
   */
  describe('juntar líneas iguales', () => {
    const item = (over: Record<string, unknown> = {}) => ({
      tipoLinea: 'item' as const, productId: 'p9', sku: 'NUEVO', nombre: 'Nuevo', descripcion: null,
      cantidad: 1, precioUnitario: 70, descuentoPct: 0, tratamientoImpuesto: 'vat_21', tasaImpuesto: 21,
      ...over,
    })

    it('el mismo producto dos veces suma cantidad en UNA línea', () => {
      let b = agregarLinea(base(), item({ cantidad: 2 }))
      b = agregarLinea(b, item({ cantidad: 3 }))
      const suyas = b.lineas.filter((l) => l.productId === 'p9')
      expect(suyas).toHaveLength(1)
      expect(suyas[0]!.cantidad).toBe(5)
    })

    it('también suma sobre una línea que ya estaba guardada', () => {
      // `base()` trae dos líneas del MISMO producto a precios distintos (100 y
      // 50): se tiene que sumar a la de 100 y no tocar la otra.
      const b = agregarLinea(base(), item({ productId: 'p1', sku: 'PRO001', nombre: 'Candado', cantidad: 4, precioUnitario: 100 }))
      expect(b.lineas).toHaveLength(base().lineas.length)
      expect(b.lineas.find((l) => l.id === 'l1')!.cantidad).toBe(6)
      expect(b.lineas.find((l) => l.id === 'l2')!.cantidad).toBe(1)
    })

    // A otro precio es otra línea de verdad: juntarlas cambiaría el total.
    it.each([
      ['otro precio', { precioUnitario: 71 }],
      ['otro descuento', { descuentoPct: 10 }],
      ['otro impuesto', { tratamientoImpuesto: 'exempt' }],
      ['otra descripción', { descripcion: 'con grabado' }],
    ])('%s NO se junta', (_caso, distinto) => {
      let b = agregarLinea(base(), item())
      b = agregarLinea(b, item(distinto))
      expect(b.lineas.filter((l) => l.productId === 'p9')).toHaveLength(2)
    })

    it('una línea libre nunca se junta con otra, aunque estén las dos vacías', () => {
      const vacia = { tipoLinea: 'item' as const, productId: null, sku: null, nombre: null, descripcion: null,
        cantidad: 1, precioUnitario: 0, descuentoPct: 0, tratamientoImpuesto: 'vat_21', tasaImpuesto: 21 }
      let b = agregarLinea(base(), vacia)
      b = agregarLinea(b, vacia)
      expect(b.lineas.filter((l) => l.productId === null)).toHaveLength(2)
    })
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

describe('alta de cotización (Fase 15 · E3)', () => {
  it('el borrador nuevo nace vacío: sin moneda, sin cliente y sin líneas', () => {
    const b = borradorNuevo('2026-09-17', '30 DIAS')
    expect(b.cabecera.moneda).toBe('')
    expect(b.cabecera.customerId).toBe('')
    expect(b.cabecera.fecha).toBe('2026-09-17')
    expect(b.cabecera.formaPago).toBe('30 DIAS')
    expect(b.lineas).toEqual([])
    // Sin documento previo no hay testigo de concurrencia que controlar.
    expect(b.esperado).toBe('')
  })

  /**
   * Fase 27 · E1: el título se suma a lo obligatorio. Es el renglón que
   * sale impreso debajo de «COTIZACIÓN DE VENTA», así que un documento sin
   * él llega al cliente sin decir de qué es.
   */
  it('no se puede crear sin cliente, sin moneda ni sin título, y lo dice en palabras', () => {
    const b = borradorNuevo('2026-09-17')
    expect(faltaParaCrear(b)).toEqual([
      'Elegí un cliente.',
      'Elegí la moneda del documento.',
      'Escribí el título del documento.',
    ])
    const conCliente = cambiarCampo(b, 'customerId', 'c1')
    expect(faltaParaCrear(conCliente)).toEqual([
      'Elegí la moneda del documento.',
      'Escribí el título del documento.',
    ])
    const conMoneda = cambiarCampo(conCliente, 'moneda', 'USD')
    expect(faltaParaCrear(conMoneda)).toEqual(['Escribí el título del documento.'])
    expect(faltaParaCrear(cambiarCampo(conMoneda, 'titulo', 'Reposición de puntas'))).toEqual([])
  })

  it('un título de puros espacios no cuenta', () => {
    const b = cambiarCampo(cambiarCampo(cambiarCampo(borradorNuevo('2026-09-17'), 'customerId', 'c1'), 'moneda', 'USD'), 'titulo', '   ')
    expect(faltaParaCrear(b)).toEqual(['Escribí el título del documento.'])
  })

  it('el payload del alta lleva la cabecera COMPLETA, con null en lo vacío', () => {
    let b = borradorNuevo('2026-09-17')
    b = cambiarCampo(b, 'customerId', 'c1')
    b = cambiarCampo(b, 'moneda', 'USD')
    b = cambiarCampo(b, 'listaPrecioId', 'lista-mayorista')
    b = cambiarCampo(b, 'vendedorId', 'u1')
    const { cabecera } = aPayloadCreacion(b)
    expect(cabecera).toEqual({
      customer_id: 'c1',
      contact_id: null,
      salesperson_id: 'u1',
      price_list_id: 'lista-mayorista',
      title: null,
      quote_date: '2026-09-17',
      valid_until: null,
      currency_code: 'USD',
      exchange_rate: null,
      payment_terms: null,
      discount_pct: null,
      perception_pct: null,
      notes: null,
    })
  })

  it('las líneas del alta van sin id y renumeradas desde 1', () => {
    let b = borradorNuevo('2026-09-17')
    b = agregarLinea(b, {
      tipoLinea: 'item', productId: 'p1', sku: 'A', nombre: 'A', descripcion: null,
      cantidad: 2, precioUnitario: 10, descuentoPct: 0, tratamientoImpuesto: 'vat_21', tasaImpuesto: 21,
    })
    b = agregarLinea(b, {
      tipoLinea: 'item', productId: 'p2', sku: 'B', nombre: 'B', descripcion: null,
      cantidad: 1, precioUnitario: 5, descuentoPct: 0, tratamientoImpuesto: 'vat_21', tasaImpuesto: 21,
    })
    const { lineas } = aPayloadCreacion(b)
    expect(lineas.map((l) => l['line_no'])).toEqual([1, 2])
    expect(lineas.every((l) => !('id' in l))).toBe(true)
  })

  it('el alta tampoco manda campos de sistema', () => {
    const b = cambiarCampo(borradorNuevo('2026-09-17'), 'customerId', 'c1')
    const claves = Object.keys(aPayloadCreacion(b).cabecera)
    for (const prohibido of ['company_id', 'number', 'series_code', 'status', 'created_by', 'imported_at', 'external_id', 'subtotal', 'tax_amount', 'total']) {
      expect(claves).not.toContain(prohibido)
    }
  })
})

/**
 * El pedido (Fase 15 · E4) usa el MISMO borrador que la cotización, pero sus
 * columnas son las de `sales_orders`: la fecha es `order_date` y la validez no
 * existe. Que un solo mapa distinto alcance es el punto: lo demás se comparte.
 */
describe('payload del pedido', () => {
  it('traduce la fecha a order_date y nunca manda valid_until', () => {
    const b = base()
    const cambiado = cambiarCampo(cambiarCampo(b, 'fecha', '2026-10-01'), 'validaHasta', '2026-12-31')
    const { cabecera } = aPayloadPedido(cambiado, b)
    expect(cabecera).toEqual({ order_date: '2026-10-01' })
    expect(Object.keys(cabecera)).not.toContain('valid_until')
    expect(Object.keys(cabecera)).not.toContain('quote_date')
  })

  it('manda sólo lo que cambió, igual que la cotización', () => {
    const b = base()
    const { cabecera } = aPayloadPedido(cambiarCampo(b, 'titulo', 'Otro'), b)
    expect(cabecera).toEqual({ title: 'Otro' })
  })

  it('sin cambios de cabecera el payload va vacío, pero las líneas viajan enteras', () => {
    const b = base()
    const p = aPayloadPedido(b, b)
    expect(p.cabecera).toEqual({})
    expect(p.lineas).toHaveLength(2)
    expect(p.lineas[0]).toMatchObject({ id: 'l1', line_no: 1, quantity: 2, unit_price: 100 })
  })

  it('el alta del pedido manda la cabecera completa con las columnas del pedido', () => {
    let b = borradorNuevo('2026-09-17', '30 DIAS')
    b = cambiarCampo(b, 'customerId', 'c1')
    b = cambiarCampo(b, 'moneda', 'USD')
    b = cambiarCampo(b, 'listaPrecioId', 'pl-usd')
    const { cabecera } = aPayloadCreacionPedido(b)
    expect(cabecera).toEqual({
      customer_id: 'c1',
      contact_id: null,
      // Fase 17 · E3: el pedido manda a qué domicilio se entrega; sin elegir va
      // en null y el remito cae en el principal del cliente al emitirse.
      shipping_address_id: null,
      salesperson_id: null,
      price_list_id: 'pl-usd',
      title: null,
      order_date: '2026-09-17',
      currency_code: 'USD',
      exchange_rate: null,
      payment_terms: '30 DIAS',
      discount_pct: null,
      perception_pct: null,
      notes: null,
    })
  })

  it('el alta del pedido no manda campos de sistema ni el vínculo con la cotización', () => {
    const b = cambiarCampo(borradorNuevo('2026-09-17'), 'customerId', 'c1')
    const claves = Object.keys(aPayloadCreacionPedido(b).cabecera)
    for (const prohibido of [
      'company_id', 'number', 'series_code', 'status', 'commercial_status', 'created_by',
      'quote_id', 'source', 'imported_at', 'external_id', 'subtotal', 'tax_amount', 'total',
    ]) {
      expect(claves).not.toContain(prohibido)
    }
  })

  it('las líneas del alta del pedido van sin id y renumeradas desde 1', () => {
    let b = borradorNuevo('2026-09-17')
    b = agregarLinea(b, {
      tipoLinea: 'item', productId: 'p1', sku: 'A', nombre: 'A', descripcion: null,
      cantidad: 3, precioUnitario: 10, descuentoPct: 0, tratamientoImpuesto: 'vat_21', tasaImpuesto: 21,
    })
    b = agregarLinea(b, {
      tipoLinea: 'chapter', productId: null, sku: null, nombre: 'Capítulo', descripcion: null,
      cantidad: 1, precioUnitario: 0, descuentoPct: 0, tratamientoImpuesto: 'not_taxed', tasaImpuesto: 0,
    })
    const { lineas } = aPayloadCreacionPedido(b)
    expect(lineas.map((l) => l['line_no'])).toEqual([1, 2])
    expect(lineas.every((l) => !('id' in l))).toBe(true)
    expect(lineas[0]).toMatchObject({ quantity: 3, unit_price: 10 })
  })
})
