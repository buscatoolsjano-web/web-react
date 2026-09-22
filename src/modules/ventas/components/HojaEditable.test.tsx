// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { VistaImpresion, type EdicionEnHoja } from './VistaImpresion'
import type { DocumentoImprimible, EmpresaImpresion, OpcionesImpresion } from '../lib/impresion'

/**
 * La hoja como editor (Fase 22 · A3–A5).
 *
 * Lo que se prueba acá es la frontera: los controles existen cuando la hoja es
 * el editor y **no existen** cuando es el documento. Si esa frontera se rompe,
 * el «+ Agregar producto» termina impreso en una cotización que va a un
 * cliente.
 */
const EMPRESA: EmpresaImpresion = {
  nombre: 'Buscatools', razonSocial: null, cuit: null, direccion: null,
  telefono: null, email: null, web: null, color: '#1f2937',
}

const OPCIONES: OpcionesImpresion = { formato: 'valorado', preciosConImpuestos: false, papel: 'A4', conFotos: false }

const linea = (id: string, over: Record<string, unknown> = {}) => ({
  id, esCapitulo: false, numero: 1, sku: 'PRO04888', nombre: 'Destornillador EI3',
  descripcion: null, cantidad: 4, precio: 1350.69, descuentoPct: 10,
  subtotal: 4862.48, impuestoPct: 21, foto: null, ...over,
})

const doc = (lineas: unknown[]): DocumentoImprimible =>
  ({
    tipo: 'cotizacion', numero: null, fecha: '2026-09-22', titulo: null,
    cliente: 'Cliente X', clienteCuit: null, contacto: null, moneda: 'USD',
    formaPago: null, notas: null, lineas, subtotal: 4862.48, impuesto: null,
    total: null, descuentoPct: null, percepcionPct: null,
  }) as unknown as DocumentoImprimible

const edicion = (): EdicionEnHoja => ({
  onCantidad: vi.fn(), onPrecio: vi.fn(), onDescuento: vi.fn(),
  onEliminar: vi.fn(), onAgregar: vi.fn(),
})

describe('La hoja del documento: sin edición no hay ni un control', () => {
  it('imprimir NO muestra agregar, quitar ni campos', () => {
    render(<VistaImpresion doc={doc([linea('l1')])} empresa={EMPRESA} opciones={OPCIONES} />)
    expect(screen.queryByRole('button', { name: /Agregar producto/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Quitar/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Tocar para cambiar/ })).toBeNull()
    expect(document.querySelectorAll('input')).toHaveLength(0)
  })

  it('y los números se ven igual que siempre', () => {
    render(<VistaImpresion doc={doc([linea('l1')])} empresa={EMPRESA} opciones={OPCIONES} />)
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('10%')).toBeInTheDocument()
  })
})

describe('La hoja como editor', () => {
  it('cada línea se puede quitar y hay una fila para agregar', () => {
    render(<VistaImpresion doc={doc([linea('l1')])} empresa={EMPRESA} opciones={OPCIONES} edicion={edicion()} />)
    expect(screen.getByRole('button', { name: /Agregar producto/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Quitar Destornillador EI3/ })).toBeInTheDocument()
  })

  it('agregar avisa al borrador, no abre nada por su cuenta', () => {
    const e = edicion()
    render(<VistaImpresion doc={doc([linea('l1')])} empresa={EMPRESA} opciones={OPCIONES} edicion={e} />)
    fireEvent.click(screen.getByRole('button', { name: /Agregar producto/ }))
    expect(e.onAgregar).toHaveBeenCalled()
  })

  it('quitar manda el id de la línea', () => {
    const e = edicion()
    render(<VistaImpresion doc={doc([linea('l1'), linea('l2', { nombre: 'Otra cosa' })])} empresa={EMPRESA} opciones={OPCIONES} edicion={e} />)
    fireEvent.click(screen.getByRole('button', { name: /Quitar Otra cosa/ }))
    expect(e.onEliminar).toHaveBeenCalledWith('l2')
  })

  it('la cantidad se ve como número y sólo al tocarla aparece el campo', () => {
    const e = edicion()
    render(<VistaImpresion doc={doc([linea('l1')])} empresa={EMPRESA} opciones={OPCIONES} edicion={e} />)
    // Antes de tocar: es texto, no un input.
    expect(document.querySelectorAll('input[type=number]')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: /^Cantidad: 4/ }))
    const campo = screen.getByRole('spinbutton', { name: 'Cantidad' })
    fireEvent.change(campo, { target: { value: '7' } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    expect(e.onCantidad).toHaveBeenCalledWith('l1', 7)
    // Y vuelve a ser texto.
    expect(document.querySelectorAll('input[type=number]')).toHaveLength(0)
  })

  it('el precio y el descuento también', () => {
    const e = edicion()
    render(<VistaImpresion doc={doc([linea('l1')])} empresa={EMPRESA} opciones={OPCIONES} edicion={e} />)

    fireEvent.click(screen.getByRole('button', { name: /^Precio unitario/ }))
    const precio = screen.getByRole('spinbutton', { name: 'Precio unitario' })
    fireEvent.change(precio, { target: { value: '1500' } })
    fireEvent.blur(precio)
    expect(e.onPrecio).toHaveBeenCalledWith('l1', 1500)

    fireEvent.click(screen.getByRole('button', { name: /^Descuento por ciento/ }))
    const dto = screen.getByRole('spinbutton', { name: 'Descuento por ciento' })
    fireEvent.change(dto, { target: { value: '25' } })
    fireEvent.keyDown(dto, { key: 'Enter' })
    expect(e.onDescuento).toHaveBeenCalledWith('l1', 25)
  })

  it('Escape deja el valor que había', () => {
    const e = edicion()
    render(<VistaImpresion doc={doc([linea('l1')])} empresa={EMPRESA} opciones={OPCIONES} edicion={e} />)
    fireEvent.click(screen.getByRole('button', { name: /^Cantidad: 4/ }))
    const campo = screen.getByRole('spinbutton', { name: 'Cantidad' })
    fireEvent.change(campo, { target: { value: '99' } })
    fireEvent.keyDown(campo, { key: 'Escape' })
    expect(e.onCantidad).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /^Cantidad: 4/ })).toBeInTheDocument()
  })

  it('un descuento fuera de rango se acota en vez de guardarse mal', () => {
    const e = edicion()
    render(<VistaImpresion doc={doc([linea('l1')])} empresa={EMPRESA} opciones={OPCIONES} edicion={e} />)
    fireEvent.click(screen.getByRole('button', { name: /^Descuento por ciento/ }))
    const dto = screen.getByRole('spinbutton', { name: 'Descuento por ciento' })
    fireEvent.change(dto, { target: { value: '300' } })
    fireEvent.keyDown(dto, { key: 'Enter' })
    expect(e.onDescuento).toHaveBeenCalledWith('l1', 100)
  })

  it('un texto que no es número no cambia nada', () => {
    const e = edicion()
    render(<VistaImpresion doc={doc([linea('l1')])} empresa={EMPRESA} opciones={OPCIONES} edicion={e} />)
    fireEvent.click(screen.getByRole('button', { name: /^Cantidad: 4/ }))
    const campo = screen.getByRole('spinbutton', { name: 'Cantidad' })
    fireEvent.change(campo, { target: { value: 'abc' } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    expect(e.onCantidad).not.toHaveBeenCalled()
  })

  it('un documento sin líneas igual ofrece agregar la primera', () => {
    render(<VistaImpresion doc={doc([])} empresa={EMPRESA} opciones={OPCIONES} edicion={edicion()} />)
    expect(screen.getByRole('button', { name: /Agregar producto/ })).toBeInTheDocument()
  })

  it('33 líneas: todas editables y una sola fila para agregar', () => {
    const muchas = Array.from({ length: 33 }, (_, i) => linea(`l${i}`, { nombre: `Producto ${i}` }))
    render(<VistaImpresion doc={doc(muchas)} empresa={EMPRESA} opciones={OPCIONES} edicion={edicion()} />)
    expect(screen.getAllByRole('button', { name: /Quitar Producto/ })).toHaveLength(33)
    expect(screen.getAllByRole('button', { name: /Agregar producto/ })).toHaveLength(1)
  })

  it('un capítulo no tiene cantidad ni precio que tocar', () => {
    const capitulo = linea('c1', { esCapitulo: true, nombre: 'MANO DE OBRA' })
    render(<VistaImpresion doc={doc([capitulo])} empresa={EMPRESA} opciones={OPCIONES} edicion={edicion()} />)
    const fila = screen.getByText('MANO DE OBRA').closest('tr')!
    expect(within(fila).queryByRole('button', { name: /Cantidad/ })).toBeNull()
  })
})
