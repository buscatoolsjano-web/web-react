// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { ChipsDeActivos } from './ChipsDeActivos'
import { FILTROS_ACTIVOS_INICIALES, type ResumenActivos } from '../types'

const resumen = (p: Partial<ResumenActivos> = {}): ResumenActivos => ({
  total: 358,
  sinCliente: 2,
  sinSerie: 4,
  ordenes: 0,
  historial: 200,
  conHistorial: 120,
  historialCerrado: 149,
  historialPresupuesto: 51,
  porEstadoServicio: { en_espera: 3, cotizacion_pendiente: 5, en_servicio: 7, ok: 343 },
  clientes: [],
  marcas: [],
  modelos: [],
  ...p,
})

const grupo = (nombre: string) => screen.getByRole('group', { name: nombre })

describe('Los chips del parque de equipos', () => {
  /**
   * Dos grupos y no uno: los de arriba son de calidad de dato —qué entró sin
   * serie o sin dueño— y los de abajo son del día del taller. Mezclarlos haría
   * que apretar uno pareciera deshacer el otro.
   */
  it('separa los atajos de datos de los de estado de servicio', () => {
    render(
      <ChipsDeActivos filtros={FILTROS_ACTIVOS_INICIALES} resumen={resumen()} onAplicar={vi.fn()} />,
    )
    expect(grupo('Atajos del listado')).toBeInTheDocument()
    expect(grupo('Estado de servicio')).toBeInTheDocument()
  })

  it('muestra los cuatro estados del panel anterior, con su cuenta', () => {
    render(
      <ChipsDeActivos filtros={FILTROS_ACTIVOS_INICIALES} resumen={resumen()} onAplicar={vi.fn()} />,
    )
    const g = grupo('Estado de servicio')
    for (const [etiqueta, cuenta] of [
      ['En espera', '3'],
      ['Cotiz. pendiente', '5'],
      ['En servicio', '7'],
      ['OK', '343'],
    ]) {
      const boton = within(g).getByRole('button', { name: new RegExp(etiqueta!) })
      expect(boton).toHaveTextContent(cuenta!)
    }
  })

  /** Un estado sin equipos muestra 0; no desaparece. Que no haya nada frenado es información. */
  it('un estado vacío se sigue mostrando, con cero', () => {
    render(
      <ChipsDeActivos
        filtros={FILTROS_ACTIVOS_INICIALES}
        resumen={resumen({ porEstadoServicio: { en_espera: 0, cotizacion_pendiente: 0, en_servicio: 0, ok: 358 } })}
        onAplicar={vi.fn()}
      />,
    )
    expect(within(grupo('Estado de servicio')).getByRole('button', { name: /En espera/ })).toHaveTextContent('0')
  })

  it('apretar un estado lo aplica como filtro', () => {
    const onAplicar = vi.fn()
    render(
      <ChipsDeActivos filtros={FILTROS_ACTIVOS_INICIALES} resumen={resumen()} onAplicar={onAplicar} />,
    )
    fireEvent.click(within(grupo('Estado de servicio')).getByRole('button', { name: /En espera/ }))
    expect(onAplicar).toHaveBeenCalledWith({ estadoServicio: 'en_espera' })
  })

  /** Es un filtro, no una pestaña: volver a apretarlo lo apaga. */
  it('apretar el que ya está encendido lo apaga', () => {
    const onAplicar = vi.fn()
    render(
      <ChipsDeActivos
        filtros={{ ...FILTROS_ACTIVOS_INICIALES, estadoServicio: 'en_espera' }}
        resumen={resumen()}
        onAplicar={onAplicar}
      />,
    )
    const boton = within(grupo('Estado de servicio')).getByRole('button', { name: /En espera/ })
    expect(boton).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(boton)
    expect(onAplicar).toHaveBeenCalledWith({ estadoServicio: '' })
  })

  /**
   * Los dos grupos se combinan, no se pisan: «sin cliente» Y «en espera» es
   * una pregunta legítima, y ninguno de los dos chips puede apagar al otro.
   */
  it('el estado de servicio no toca los atajos de datos', () => {
    const onAplicar = vi.fn()
    render(
      <ChipsDeActivos
        filtros={{ ...FILTROS_ACTIVOS_INICIALES, sinCliente: true }}
        resumen={resumen()}
        onAplicar={onAplicar}
      />,
    )
    fireEvent.click(within(grupo('Estado de servicio')).getByRole('button', { name: /En servicio/ }))
    expect(onAplicar).toHaveBeenCalledWith({ estadoServicio: 'en_servicio' })
    // No manda `sinCliente`, así que el filtro de arriba queda como estaba.
    expect(onAplicar.mock.calls[0]?.[0]).not.toHaveProperty('sinCliente')
  })

  it('sin resumen todavía, los chips salen sin número en vez de con cero', () => {
    render(
      <ChipsDeActivos filtros={FILTROS_ACTIVOS_INICIALES} resumen={undefined} onAplicar={vi.fn()} />,
    )
    expect(within(grupo('Estado de servicio')).getByRole('button', { name: 'En espera' })).toBeInTheDocument()
  })
})
