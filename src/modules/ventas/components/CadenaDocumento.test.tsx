// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CadenaDocumento } from './CadenaDocumento'
import type { CadenaDocumento as Cadena } from '../lib/cadena'

const eslabon = (numero: string, cuantos = 1) => ({ id: `id-${numero}`, numero, estado: 'x', cuantos })

const cadena = (p: Partial<Cadena> = {}): Cadena => ({
  cotizacion: eslabon('COT-BTS00001'),
  pedido: null,
  entrega: null,
  factura: null,
  ...p,
})

function montar(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

const circuito = () => screen.getByRole('navigation', { name: 'Circuito de la venta' })

describe('La cadena del documento', () => {
  it('muestra los cuatro pasos siempre, existan o no', () => {
    montar(<CadenaDocumento cadena={cadena()} actual="cotizacion" />)
    for (const paso of ['Cotización', 'Pedido', 'Entrega', 'Factura']) {
      expect(within(circuito()).getByText(paso)).toBeInTheDocument()
    }
  })

  /**
   * El paso donde estás parado no se enlaza: sería un enlace a la página que
   * ya estás mirando. Los otros sí, que es para lo que sirve la barra.
   */
  it('el paso actual no es un enlace y los demás sí', () => {
    montar(
      <CadenaDocumento
        cadena={cadena({ pedido: eslabon('PDV-ERP00007'), entrega: eslabon('RT-ERP00003') })}
        actual="pedido"
      />,
    )
    const n = circuito()
    expect(within(n).queryByRole('link', { name: 'PDV-ERP00007' })).toBeNull()
    expect(within(n).getByText('PDV-ERP00007')).toBeInTheDocument()
    expect(within(n).getByRole('link', { name: 'COT-BTS00001' })).toBeInTheDocument()
    expect(within(n).getByRole('link', { name: 'RT-ERP00003' })).toBeInTheDocument()
  })

  it('marca el paso actual para quien navega con lector de pantalla', () => {
    montar(<CadenaDocumento cadena={cadena()} actual="cotizacion" />)
    const actual = circuito().querySelector('[aria-current="step"]')
    expect(actual?.textContent).toContain('COT-BTS00001')
  })

  it('un paso que todavía no existe y no se puede generar muestra un guion', () => {
    montar(<CadenaDocumento cadena={cadena()} actual="cotizacion" />)
    // Tres pasos sin documento: pedido, entrega y factura.
    expect(within(circuito()).getAllByText('—')).toHaveLength(3)
  })

  it('ofrece «Generar» sólo donde la página dijo que se puede', () => {
    const onGenerar = vi.fn()
    montar(
      <CadenaDocumento cadena={cadena()} actual="cotizacion" generar={{ pedido: { onGenerar } }} />,
    )
    const boton = within(circuito()).getByRole('button', { name: /Generar/ })
    fireEvent.click(boton)
    expect(onGenerar).toHaveBeenCalledTimes(1)
    // Entrega y factura siguen sin ofrecer nada: sólo hay UN botón.
    expect(within(circuito()).getAllByRole('button')).toHaveLength(1)
  })

  /**
   * El motivo no es decorativo: es lo que evita el «no anda y no sé por qué».
   * Deshabilitado sin explicación sería peor que no mostrar el botón.
   */
  it('con motivo, el botón queda deshabilitado y el motivo se puede leer', () => {
    const onGenerar = vi.fn()
    montar(
      <CadenaDocumento
        cadena={cadena()}
        actual="cotizacion"
        generar={{ pedido: { onGenerar, motivo: 'Tu rol no genera pedidos' } }}
      />,
    )
    const boton = within(circuito()).getByRole('button', { name: /Generar/ })
    expect(boton).toBeDisabled()
    expect(boton).toHaveAttribute('title', 'Tu rol no genera pedidos')
    fireEvent.click(boton)
    expect(onGenerar).not.toHaveBeenCalled()
  })

  it('mientras genera lo dice y no deja apretar de nuevo', () => {
    montar(
      <CadenaDocumento
        cadena={cadena()}
        actual="cotizacion"
        generar={{ pedido: { onGenerar: vi.fn(), cargando: true } }}
      />,
    )
    expect(within(circuito()).getByRole('button', { name: /Generando/ })).toBeDisabled()
  })

  /**
   * Hoy la cadena es 1:1 en los datos reales, pero el esquema no lo impide.
   * Si hay más de uno, se dice — mostrar el primero como si fuera todo sería
   * mentir sobre lo que pasó con la venta.
   */
  it('avisa cuando hay más de un documento colgando del mismo paso', () => {
    montar(
      <CadenaDocumento cadena={cadena({ pedido: eslabon('PDV-ERP00007', 3) })} actual="cotizacion" />,
    )
    expect(within(circuito()).getByText('y 2 más')).toBeInTheDocument()
  })

  it('la factura no enlaza a ningún lado mientras no tenga pantalla', () => {
    montar(
      <CadenaDocumento cadena={cadena({ factura: eslabon('FAC-0001') })} actual="cotizacion" />,
    )
    const n = circuito()
    expect(within(n).getByText('FAC-0001')).toBeInTheDocument()
    expect(within(n).queryByRole('link', { name: 'FAC-0001' })).toBeNull()
  })
})
