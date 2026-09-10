import { describe, expect, it } from 'vitest'
import { aCsv, celda, facturasACsv, pedidosACsv, recepcionesACsv } from './csv'
import type {
  FacturaListado,
  PedidoCompraListado,
  ProveedorListado,
  RecepcionListado,
} from '../types'

const proveedor = (cambios: Partial<ProveedorListado> = {}): ProveedorListado => ({
  id: 'a1',
  referencia: 'PROV00008',
  razonSocial: 'Pinturerias REX S.A.',
  nombreComercial: null,
  pais: 'AR',
  telefono: '47247600',
  email: null,
  formaPago: 'FOB 180 DIAS',
  estado: 'active',
  esHistorico: true,
  necesitaRevision: false,
  motivosRevision: [],
  dadoDeBaja: false,
  ...cambios,
})

describe('celda', () => {
  it('entrecomilla lo que rompería el CSV', () => {
    expect(celda('50% adelanto; 50% contra entrega')).toBe('"50% adelanto; 50% contra entrega"')
    expect(celda('dice "hola"')).toBe('"dice ""hola"""')
    expect(celda('dos\nlíneas')).toBe('"dos\nlíneas"')
  })

  it('deja en paz lo que no', () => {
    expect(celda('FOB 180 DIAS')).toBe('FOB 180 DIAS')
    expect(celda(null)).toBe('')
    expect(celda(undefined)).toBe('')
  })
})

describe('aCsv', () => {
  it('encabezado y una fila', () => {
    const lineas = aCsv([proveedor()]).split('\r\n')
    expect(lineas[0]).toBe(
      'Referencia;Razon social;Nombre comercial;Pais;Telefono;Email;Forma de pago;Estado;Origen;Observaciones',
    )
    expect(lineas[1]).toBe(
      'PROV00008;Pinturerias REX S.A.;;AR;47247600;;FOB 180 DIAS;active;migrado;',
    )
  })

  it('un proveedor dado de baja se exporta como baja, no como activo', () => {
    const fila = aCsv([proveedor({ dadoDeBaja: true })]).split('\r\n')[1]
    expect(fila).toContain(';baja;')
  })

  it('un proveedor nuevo se distingue de uno migrado', () => {
    const fila = aCsv([proveedor({ esHistorico: false })]).split('\r\n')[1]
    expect(fila).toContain(';nuevo;')
  })

  it('los motivos de revisión van todos, separados', () => {
    const fila = aCsv([
      proveedor({ necesitaRevision: true, motivosRevision: ['LEGACY_EMAIL_EN_NOTAS', 'OTRO'] }),
    ]).split('\r\n')[1]
    expect(fila).toContain('LEGACY_EMAIL_EN_NOTAS | OTRO')
  })

  it('sin filas, sólo el encabezado', () => {
    expect(aCsv([]).split('\r\n')).toHaveLength(1)
  })
})

describe('los tres documentos del circuito', () => {
  const etiqueta = (e: string) => ({ draft: 'Borrador', confirmed: 'Confirmado', registered: 'Registrada' })[e] ?? e
  const recepcionEtiqueta = (e: string) => ({ pending: 'Sin recibir', received: 'Recibido' })[e] ?? e

  const unPedido = (c: Partial<PedidoCompraListado> = {}): PedidoCompraListado => ({
    id: 'p1', numero: 'PC00007', fecha: '2026-09-10', proveedorId: 's1',
    proveedor: 'Herramientas del Sur S.A.', moneda: 'USD', total: 1234.5,
    estado: 'confirmed', estadoRecepcion: 'pending', fechaEstimada: null,
    autor: 'Jano', lineas: 3, ...c,
  })

  const unaRecepcion = (c: Partial<RecepcionListado> = {}): RecepcionListado => ({
    id: 'r1', numero: 'NEP00003', fecha: '2026-09-10', proveedorId: 's1',
    proveedor: 'Herramientas del Sur S.A.', pedidoId: 'p1', pedidoNumero: 'PC00007',
    depositoId: 'd1', deposito: 'Principal', estado: 'confirmed', lineas: 3,
    unidades: 52, autor: 'Jano', ...c,
  })

  const unaFactura = (c: Partial<FacturaListado> = {}): FacturaListado => ({
    id: 'f1', numero: 'FP00005', numeroProveedor: 'A-0001-00012345', fecha: '2026-09-10',
    vencimiento: null, proveedorId: 's1', proveedor: 'Herramientas del Sur S.A.',
    moneda: 'USD', total: 2215.67, estado: 'registered', lineas: 1, recepciones: 1,
    autor: 'Jano', ...c,
  })

  it('el importe va con punto decimal y sin miles: una celda tiene que poder sumarse', () => {
    const csv = pedidosACsv([unPedido({ total: 1234567.5 })], etiqueta, recepcionEtiqueta)
    expect(csv.split('\r\n')[1]).toContain('1234567.50')
    expect(csv).not.toContain('1.234.567,50')
  })

  it('la moneda va en su propia columna: el archivo no suma monedas distintas', () => {
    const csv = pedidosACsv(
      [unPedido({ moneda: 'USD', total: 100 }), unPedido({ id: 'p2', moneda: 'ARS', total: 200 })],
      etiqueta, recepcionEtiqueta,
    )
    const filas = csv.split('\r\n')
    expect(filas[0]).toContain('Moneda')
    expect(filas[1]).toContain('USD')
    expect(filas[2]).toContain('ARS')
  })

  it('un pedido sin ETA deja la celda vacía en vez de inventar una fecha', () => {
    const csv = pedidosACsv([unPedido({ fechaEstimada: null })], etiqueta, recepcionEtiqueta)
    expect(csv.split('\r\n')[1]?.split(';')[2]).toBe('')
  })

  it('las recepciones NO tienen columna de importe: no están valorizadas', () => {
    const csv = recepcionesACsv([unaRecepcion()])
    const cabecera = csv.split('\r\n')[0] ?? ''
    expect(cabecera).not.toMatch(/total|importe|precio/i)
    expect(cabecera).toContain('Unidades')
  })

  it('en las facturas el número del proveedor va primero', () => {
    const csv = facturasACsv([unaFactura()], etiqueta)
    expect(csv.split('\r\n')[0]?.split(';')[0]).toBe('Numero del proveedor')
    expect(csv.split('\r\n')[1]?.split(';')[0]).toBe('A-0001-00012345')
    expect(csv.split('\r\n')[1]?.split(';')[1]).toBe('FP00005')
  })

  it('un punto y coma dentro de un nombre no parte la fila', () => {
    const csv = facturasACsv([unaFactura({ proveedor: 'Sur; S.A.' })], etiqueta)
    expect(csv).toContain('"Sur; S.A."')
    expect(csv.split('\r\n')).toHaveLength(2)
  })
})
