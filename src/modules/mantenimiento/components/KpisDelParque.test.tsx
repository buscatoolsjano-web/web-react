// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { KpisDelParque } from './KpisDelParque'
import type { ResumenActivos } from '../types'

/**
 * Los números del tablero de Mantenimiento (Fase 20 · E2).
 *
 * El riesgo concreto que cubren estos tests: que los 200 servicios importados
 * de STEL se lean como trabajo del taller. Hoy el trabajo actual es 0, y eso
 * tiene que verse tal cual.
 */
const resumen = (p: Partial<ResumenActivos> = {}): ResumenActivos => ({
  total: 358,
  sinCliente: 2,
  sinSerie: 4,
  ordenes: 0,
  historial: 200,
  conHistorial: 132,
  historialCerrado: 149,
  historialPresupuesto: 51,
  clientes: [{ id: 'c1', nombre: 'UN CLIENTE', equipos: 100 }],
  marcas: [{ valor: 'FEIN', equipos: 200 }],
  modelos: [{ valor: 'ASM18-12-PC', equipos: 30 }],
  ...p,
})

const valorDe = (kpi: string) =>
  document.querySelector(`[data-kpi="${kpi}"] p`)?.textContent ?? null

describe('Trabajo actual e historial importado son dos números', () => {
  it('no se suman: el taller tiene 0 abierto y el historial tiene 200', () => {
    render(<KpisDelParque resumen={resumen()} cargando={false} />)
    expect(valorDe('trabajo-actual')).toBe('0')
    expect(valorDe('historial')).toBe('200')
    // 200 sería el número equivocado para el trabajo del taller.
    expect(valorDe('trabajo-actual')).not.toBe('200')
  })

  it('cada uno dice qué cuenta', () => {
    render(<KpisDelParque resumen={resumen()} cargando={false} />)
    expect(screen.getByText('Trabajo actual')).toBeInTheDocument()
    expect(screen.getByText('Historial STEL')).toBeInTheDocument()
  })

  it('el historial aclara que los pendientes quedaron pendientes EN STEL', () => {
    render(<KpisDelParque resumen={resumen()} cargando={false} />)
    const detalle = document.querySelector('[data-kpi="historial"] p:last-child')?.textContent ?? ''
    expect(detalle).toContain('sobre 132 equipos')
    expect(detalle).toContain('149 entregados')
    expect(detalle).toContain('quedaron con presupuesto pendiente en STEL')
  })

  it('sin historial importado, el número es 0 y no desaparece la tarjeta', () => {
    render(
      <KpisDelParque
        resumen={resumen({ historial: 0, conHistorial: 0, historialCerrado: 0, historialPresupuesto: 0 })}
        cargando={false}
      />,
    )
    expect(valorDe('historial')).toBe('0')
  })

  it('mientras carga no muestra un cero que después cambia', () => {
    render(<KpisDelParque resumen={undefined} cargando />)
    expect(valorDe('historial')).toBe('')
    expect(valorDe('trabajo-actual')).toBe('')
  })
})
