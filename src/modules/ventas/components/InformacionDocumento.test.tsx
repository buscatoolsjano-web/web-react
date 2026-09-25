// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { InformacionDocumento } from './InformacionDocumento'
import type { DocumentoDetalle } from '../types'

/**
 * La pestaña Información, ahora la misma para los tres documentos
 * (Fase 15 · E6).
 *
 * Lo que se prueba es la regla: un dato que **debería estar** y falta se
 * muestra como faltante; uno que **no corresponde** al tipo no se muestra; y
 * uno **opcional y vacío**, tampoco.
 */
const doc = (p: Partial<DocumentoDetalle> = {}): DocumentoDetalle => ({
    id: 'd1',
    tipo: 'cotizacion',
    numero: 'COTI00001',
    numeroOriginal: null,
    numeroSospechado: null,
    fecha: '2026-09-17',
    clienteId: 'c9',
    clienteNombre: 'ZZ Cliente SA',
    clienteCuit: null,
    contactoNombre: null,
    contactoId: null,
    contactoRol: null,
    contactoEmail: null,
    contactoTelefono: null,
    vendedorId: null,
    vendedor: null,
    listaPrecioId: null,
    listaPrecioNombre: null,
    titulo: null,
    moneda: 'USD',
    tipoCambio: null,
    estado: 'draft',
    estadoSecundario: null,
    serie: 'COTI',
    notas: null,
    formaPago: null,
    transporte: null,
    seguimiento: null,
    domicilioEntrega: null,
    domicilioElegido: null,
    validaHasta: null,
    descuentoPct: null,
    percepcionPct: null,
    subtotal: 100,
    impuesto: 21,
    total: 121,
    necesitaRevision: false,
    motivosRevision: [],
    numeroFueraDeSerie: false,
    esHistorico: false,
    externalSource: null,
    creadoPor: 'Lisandro',
    creadoEn: '2026-09-17T12:00:00.000Z',
    actualizadoEn: '2026-09-17T13:00:00.000Z',
    lineas: [],
    origen: null,
    ...p,
  })

const montar = (d: DocumentoDetalle) =>
  render(
    <MemoryRouter>
      <InformacionDocumento doc={d} />
    </MemoryRouter>,
  )

const etiquetas = () => screen.getAllByRole('term').map((t) => t.textContent)

describe('Información · cotización', () => {
  it('muestra lo comercial', () => {
    montar(doc({ validaHasta: '2026-10-17', listaPrecioNombre: 'Mayorista', formaPago: '30 días' }))
    // Fase 28 · E11: «Válida hasta» no aplica y no se muestra, ni siquiera
    // cuando el documento trae el dato cargado.
    expect(etiquetas()).not.toContain('Válida hasta')
    expect(screen.queryByText('17/10/2026')).toBeNull()
    expect(screen.getByText('Mayorista')).toBeInTheDocument()
    expect(screen.getByText('30 días')).toBeInTheDocument()
  })

  it('lo que falta y debería estar, se dice', () => {
    montar(doc())
    expect(screen.getByText('Sin contacto asignado')).toBeInTheDocument()
    expect(screen.getByText('Sin tarifa registrada')).toBeInTheDocument()
    expect(screen.getAllByText('Sin registrar').length).toBeGreaterThanOrEqual(1)
  })

  it('un opcional vacío no ocupa una fila', () => {
    montar(doc())
    expect(etiquetas()).not.toContain('Tipo de cambio')
    expect(etiquetas()).not.toContain('Observaciones')
  })
})

describe('Información · pedido', () => {
  it('muestra tarifa y forma de pago, pero no la validez', () => {
    montar(doc({ tipo: 'pedido', numero: 'PDV00001', serie: 'PDV', listaPrecioNombre: 'Lista base' }))
    expect(etiquetas()).toContain('Tarifa')
    expect(etiquetas()).toContain('Forma de pago')
    expect(etiquetas()).not.toContain('Válida hasta')
  })

  it('enlaza la cotización de origen, y dice cuándo es manual', () => {
    montar(doc({ tipo: 'pedido', origen: { tipo: 'cotizacion', id: 'q1', numero: 'COTI02558' } }))
    expect(screen.getByRole('link', { name: 'COTI02558' })).toHaveAttribute('href', '/ventas/cotizaciones/q1')

    montar(doc({ tipo: 'pedido' }))
    expect(screen.getByText('Sin cotización: pedido manual')).toBeInTheDocument()
  })
})

describe('Información · remito', () => {
  const remito = (p: Partial<DocumentoDetalle> = {}) =>
    doc({ tipo: 'entrega', numero: 'RT00001', serie: 'RT', ...p })

  it('no muestra lo que el remito no decide', () => {
    montar(remito())
    for (const ausente of ['Vendedor', 'Forma de pago', 'Tarifa', 'Válida hasta']) {
      expect(etiquetas()).not.toContain(ausente)
    }
  })

  it('muestra la dirección de entrega congelada', () => {
    montar(
      remito({
        domicilioEntrega: {
          street: 'Av. Siempreviva 742', city: 'Springfield', state: 'Buenos Aires',
          postal_code: 'B1636', country_code: 'AR',
        },
      }),
    )
    expect(screen.getByText(/Av. Siempreviva 742 · Springfield, Buenos Aires · B1636 AR/)).toBeInTheDocument()
  })

  it('sin domicilio registrado lo dice, y no pone el del cliente de hoy', () => {
    montar(remito())
    expect(etiquetas()).toContain('Dirección de entrega')
    expect(screen.getByText('Sin domicilio registrado')).toBeInTheDocument()
  })

  it('el transporte sólo aparece si existe', () => {
    montar(remito())
    expect(etiquetas()).not.toContain('Transporte')

    montar(remito({ transporte: 'Andreani', seguimiento: 'AR-993' }))
    expect(screen.getByText('Andreani')).toBeInTheDocument()
    expect(screen.getByText('AR-993')).toBeInTheDocument()
  })

  it('enlaza el pedido de origen, y dice cuándo no hay', () => {
    montar(remito({ origen: { tipo: 'pedido', id: 'o1', numero: 'PDV01321' } }))
    expect(screen.getByRole('link', { name: 'PDV01321' })).toHaveAttribute('href', '/ventas/pedidos/o1')

    montar(remito())
    expect(screen.getByText('Sin pedido relacionado')).toBeInTheDocument()
  })
})
