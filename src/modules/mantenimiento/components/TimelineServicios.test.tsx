// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TimelineServicios } from './TimelineServicios'
import type { DocumentoFuente, ServicioHistorico } from '../types'

/**
 * El historial de servicio en la ficha del equipo (Fase 20 · E2).
 *
 * Lo que se prueba: que un servicio compartido por siete equipos se vea como
 * UN servicio y no como tres documentos, que el importe compartido no se
 * presente como plata de este equipo, y que no haya ni un botón para editar
 * historia.
 */
const doc = (p: Partial<DocumentoFuente> = {}): DocumentoFuente => ({
  id: 'd1',
  tipo: 'delivery_note',
  referencia: 'NTT00012',
  fecha: '2024-03-20',
  estadoStel: 'Facturada',
  moneda: 'ARS',
  total: 121000,
  pdf: 'https://app.stelorder.com/pdf/12',
  lineas: [],
  ...p,
})

const servicio = (p: Partial<ServicioHistorico> = {}): ServicioHistorico => ({
  id: 's1',
  cadenaId: 'c1',
  activoId: 'a1',
  referencia: 'NTT00012',
  estado: 'closed',
  cotizacion: 'approved',
  facturado: true,
  ingreso: '2024-03-01',
  entrega: '2024-03-20',
  titulo: 'SERVICIO DE MANTENIMIENTO',
  diagnostico: null,
  trabajo: 'CAMBIO DE RODAMIENTOS, PALETAS, LIMPIEZA Y ENGRASADO',
  cierre: null,
  tecnico: 'NICOLAS',
  moneda: 'ARS',
  importe: null,
  importeAtribuible: 'shared',
  estadoStel: 'Presupuesto Cerrada + Orden Cerrada + Remito Facturada',
  equiposEnElServicio: 7,
  importeDeLaCadena: 121000,
  documentos: [
    doc({ id: 'd0', tipo: 'estimate', referencia: 'COTI-T00012', fecha: '2024-03-01', estadoStel: 'Cerrada' }),
    doc({ id: 'd1', tipo: 'work_order', referencia: 'ORT00012', fecha: '2024-03-10', estadoStel: 'Cerrada' }),
    doc({ id: 'd2' }),
  ],
  ...p,
})

const montar = (servicios: ServicioHistorico[], cargando = false) =>
  render(
    <MemoryRouter>
      <TimelineServicios servicios={servicios} cargando={cargando} />
    </MemoryRouter>,
  )

describe('Un evento por servicio, no uno por documento', () => {
  it('tres documentos del mismo trabajo son UN evento', () => {
    montar([servicio()])
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('CAMBIO DE RODAMIENTOS, PALETAS, LIMPIEZA Y ENGRASADO')).toBeInTheDocument()
  })

  it('los documentos aparecen recién cuando se piden, y no duplicados', () => {
    montar([servicio()])
    expect(screen.queryByText('Orden de trabajo')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /3 documentos/ }))
    expect(screen.getByText('Presupuesto')).toBeInTheDocument()
    expect(screen.getByText('Orden de trabajo')).toBeInTheDocument()
    expect(screen.getByText('Remito de trabajo')).toBeInTheDocument()
    expect(screen.getAllByText('ORT00012')).toHaveLength(1)
  })

  it('el PDF del documento se abre afuera, sin traerse nada', () => {
    montar([servicio()])
    fireEvent.click(screen.getByRole('button', { name: /3 documentos/ }))
    const pdfs = screen.getAllByRole('link', { name: 'PDF' })
    expect(pdfs).toHaveLength(3)
    expect(pdfs[0]).toHaveAttribute('target', '_blank')
  })
})

describe('El importe compartido no se muestra como costo del equipo', () => {
  it('lo dice con palabras y deja el total como contexto', () => {
    montar([servicio()])
    expect(screen.getByText(/Importe compartido entre varios equipos/)).toBeInTheDocument()
    expect(screen.getByText(/total del servicio/)).toBeInTheDocument()
    expect(screen.getByText('Servicio compartido con otros 6 equipos')).toBeInTheDocument()
  })

  it('con un solo equipo sí es el importe del equipo', () => {
    montar([servicio({ importe: 50000, importeAtribuible: 'asset', equiposEnElServicio: 1 })])
    expect(screen.queryByText(/Importe compartido/)).toBeNull()
    expect(screen.queryByText(/Servicio compartido/)).toBeNull()
  })
})

describe('Es historia: se lee y no se toca', () => {
  it('no hay ninguna acción de editar, cerrar, cotizar ni borrar', () => {
    montar([servicio()])
    const botones = screen.getAllByRole('button').map((b) => b.textContent ?? '')
    for (const prohibido of ['Editar', 'Cerrar', 'Cotizar', 'Borrar', 'Torque', 'Guardar']) {
      expect(botones.some((t) => t.includes(prohibido))).toBe(false)
    }
  })

  it('se muestra el estado crudo de STEL para poder auditar la traducción', () => {
    montar([servicio()])
    expect(
      screen.getByText('En STEL: Presupuesto Cerrada + Orden Cerrada + Remito Facturada'),
    ).toBeInTheDocument()
  })

  it('un servicio sin remito no inventa una fecha de entrega', () => {
    montar([servicio({ estado: 'open_quote', entrega: null, facturado: false })])
    expect(screen.getByText('Sin remito registrado')).toBeInTheDocument()
    expect(screen.getByText('Presupuesto quedó pendiente en STEL')).toBeInTheDocument()
  })

  it('un equipo sin historial lo dice, en vez de mostrar una tabla vacía', () => {
    montar([])
    expect(screen.getByText('Este equipo no tiene servicios en el historial')).toBeInTheDocument()
  })

  it('mientras carga no muestra un vacío falso', () => {
    montar([], true)
    expect(screen.queryByText('Este equipo no tiene servicios en el historial')).toBeNull()
  })
})

describe('El detalle de un documento', () => {
  it('un repuesto emparejado enlaza al producto del catálogo', () => {
    montar([
      servicio({
        documentos: [
          doc({
            lineas: [
              {
                id: 'l1',
                tipo: 'product',
                sku: 'FI.REP.596500007',
                descripcion: 'FILTER',
                cantidad: 2,
                precioUnitario: 100,
                importe: 200,
                moneda: 'ARS',
                productoId: 'p-uuid',
              },
              {
                id: 'l2',
                tipo: 'product',
                sku: 'PRO09777',
                descripcion: 'ASW18-60-PC Reparada',
                cantidad: 1,
                precioUnitario: null,
                importe: null,
                moneda: 'ARS',
                productoId: null,
              },
            ],
          }),
        ],
      }),
    ])
    fireEvent.click(screen.getByRole('button', { name: /1 documento/ }))
    fireEvent.click(screen.getByRole('button', { name: /Ver detalle \(2\)/ }))
    expect(screen.getByRole('link', { name: 'FI.REP.596500007' })).toHaveAttribute(
      'href',
      '/catalogo?producto=p-uuid',
    )
    // El que no emparejó se muestra igual, como texto: no se esconde ni se
    // enlaza a un producto que no existe.
    expect(screen.getByText('PRO09777')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'PRO09777' })).toBeNull()
  })

  it('un documento sin líneas con contenido no ofrece un detalle vacío', () => {
    montar([servicio({ documentos: [doc({ lineas: [] })] })])
    fireEvent.click(screen.getByRole('button', { name: /1 documento/ }))
    expect(screen.queryByRole('button', { name: /Ver detalle/ })).toBeNull()
  })
})
