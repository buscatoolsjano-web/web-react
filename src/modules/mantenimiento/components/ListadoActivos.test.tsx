// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ActivoListado } from '../types'

const estado = vi.hoisted(() => ({ movil: false }))
vi.mock('@/hooks/useMediaQuery', () => ({
  useIsMobile: () => estado.movil,
  useMediaQuery: () => !estado.movil,
}))

const { ListadoActivos } = await import('./ListadoActivos')

/**
 * El listado de equipos, después de la importación (Fase 20 · E1).
 *
 * Los casos vienen de los datos reales: 358 equipos importados de STEL, 2 sin
 * cliente, 4 sin número de serie y ninguno con órdenes todavía.
 */
const activo = (p: Partial<ActivoListado> = {}): ActivoListado => ({
  id: 'a1',
  referencia: 'ACT00339',
  nombre: 'FIAM 26C8A S/N 2307232',
  identificador: 'P037 - ASM10-9 PC',
  imagen: null,
  serie: 'V00129',
  serieNormalizada: 'V00129',
  duenoId: 'c1',
  dueno: 'ZZ Mabe Argentina',
  productoId: null,
  productoSku: null,
  marca: 'TORERO',
  modelo: 'LTR-125H-4',
  tipo: null,
  ciudad: 'Parque Industrial Norte',
  bajoContrato: false,
  dadoDeBaja: false,
  ordenes: 0,
  creadoEn: '2026-09-21',
  ...p,
})

const montar = (filas: ActivoListado[], props: Partial<Parameters<typeof ListadoActivos>[0]> = {}) =>
  render(
    <MemoryRouter>
      <ListadoActivos
        filas={filas}
        orden="alta"
        direccion="desc"
        onOrdenar={vi.fn()}
        cargando={false}
        {...props}
      />
    </MemoryRouter>,
  )

beforeEach(() => {
  estado.movil = false
})

describe('La fila del equipo', () => {
  it('muestra con qué se lo identifica en el taller: referencia, etiqueta, marca, modelo y serie', () => {
    montar([activo()])
    expect(screen.getByRole('link', { name: 'ACT00339' })).toHaveAttribute(
      'href',
      '/mantenimiento/activos/a1',
    )
    expect(screen.getByText('P037 - ASM10-9 PC')).toBeInTheDocument()
    expect(screen.getByText('TORERO')).toBeInTheDocument()
    expect(screen.getByText('LTR-125H-4')).toBeInTheDocument()
    expect(screen.getByText('V00129')).toBeInTheDocument()
  })

  it('lleva el botón «Servicio», que es la acción del taller', () => {
    montar([activo()])
    expect(screen.getByRole('link', { name: 'Servicio' })).toHaveAttribute(
      'href',
      '/mantenimiento/ordenes/nueva?activo=a1',
    )
  })

  it('un equipo sin serie y sin dueño lo dice con palabras, no con un hueco', () => {
    montar([activo({ serie: null, serieNormalizada: null, dueno: null, duenoId: null })])
    expect(screen.getByText('sin número de serie')).toBeInTheDocument()
    expect(screen.getByText('sin dueño asignado')).toBeInTheDocument()
  })

  it('sin órdenes muestra 0, que es el dato: no se inventa un historial', () => {
    montar([activo({ ordenes: 0 })])
    const fila = screen.getByText('ACT00339').closest('tr')!
    expect(within(fila).getByText('0')).toBeInTheDocument()
  })
})

describe('La fila entera abre la ficha rápida', () => {
  it('un click en cualquier celda la abre', () => {
    const abrir = vi.fn()
    montar([activo()], { onAbrirFicha: abrir })
    fireEvent.click(screen.getByText('V00129'))
    expect(abrir).toHaveBeenCalledWith('a1')
  })

  it('el botón «Servicio» NO la abre: es del botón', () => {
    const abrir = vi.fn()
    montar([activo()], { onAbrirFicha: abrir })
    fireEvent.click(screen.getByRole('link', { name: 'Servicio' }))
    expect(abrir).not.toHaveBeenCalled()
  })

  it('Ctrl+click tampoco: se está abriendo en otra pestaña', () => {
    const abrir = vi.fn()
    montar([activo()], { onAbrirFicha: abrir })
    fireEvent.click(screen.getByText('V00129').closest('tr')!, { ctrlKey: true })
    expect(abrir).not.toHaveBeenCalled()
  })

  it('con el teclado: la fila se enfoca y Enter la abre', () => {
    const abrir = vi.fn()
    montar([activo()], { onAbrirFicha: abrir })
    const fila = screen.getByText('ACT00339').closest('tr')!
    expect(fila).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(fila, { key: 'Enter' })
    expect(abrir).toHaveBeenCalledWith('a1')
  })

  it('el equipo abierto queda marcado, y sólo uno', () => {
    montar([activo(), activo({ id: 'a2', referencia: 'ACT00340', serie: 'V00130' })], {
      abierto: 'a2',
      onAbrirFicha: vi.fn(),
    })
    expect(screen.getByText('ACT00340').closest('tr')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText('ACT00339').closest('tr')).not.toHaveAttribute('aria-current')
  })

  it('sin `onAbrirFicha` la fila no se vuelve clickeable ni enfocable', () => {
    montar([activo()])
    expect(screen.getByText('ACT00339').closest('tr')).not.toHaveAttribute('tabindex')
  })
})

describe('En el taller (mobile)', () => {
  it('son tarjetas, con la serie y el cliente legibles', () => {
    estado.movil = true
    montar([activo()], { onAbrirFicha: vi.fn() })
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('V00129')).toBeInTheDocument()
    expect(screen.getByText(/ZZ Mabe Argentina/)).toBeInTheDocument()
  })

  it('tocar la tarjeta abre la ficha rápida; la referencia sigue llevando a la ficha completa', () => {
    estado.movil = true
    const abrir = vi.fn()
    montar([activo()], { onAbrirFicha: abrir })

    // El cuerpo de la tarjeta: abre la ficha rápida.
    fireEvent.click(screen.getByText('V00129'))
    expect(abrir).toHaveBeenCalledWith('a1')

    // La referencia es un link y se comporta como link.
    expect(screen.getByRole('link', { name: 'ACT00339' })).toHaveAttribute(
      'href',
      '/mantenimiento/activos/a1',
    )
  })

  it('la tarjeta tiene «Servicio» a la vista: es a lo que se entra en el taller', () => {
    estado.movil = true
    montar([activo()], { onAbrirFicha: vi.fn() })
    expect(screen.getByRole('link', { name: 'Servicio' })).toHaveAttribute(
      'href',
      '/mantenimiento/ordenes/nueva?activo=a1',
    )
  })
})
