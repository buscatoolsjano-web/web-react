// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ConfirmBorrado } from './ConfirmBorrado'

/*
 * El cliente de Supabase pide las variables de entorno AL IMPORTARSE, y acá
 * llega de arrastre: el componente importa un service y el service lo importa
 * a él. En local hay .env y no se nota; en CI el paso de tests no recibe
 * secrets y el deploy se cae. Lo detecta `npm run test:isolated`, que corre
 * la suite como si no existiera .env.
 *
 * El doble vacio alcanza porque este test no usa Supabase para nada.
 */
vi.mock('@/services/supabase/client', () => ({ supabase: {} }))


/**
 * Confirmar un borrado diciendo por qué (Fase 40).
 *
 * El motivo no es burocracia: es lo único que queda cuando la cosa ya no está.
 * Por eso lo que se prueba es que NO se pueda confirmar sin él, y que el texto
 * llegue limpio a quien lo va a guardar.
 */
function montar(props: Partial<React.ComponentProps<typeof ConfirmBorrado>> = {}) {
  const onConfirm = vi.fn()
  render(
    <ConfirmBorrado
      open
      que="la cotización COTI02581"
      onCancel={() => {}}
      onConfirm={onConfirm}
      {...props}
    />,
  )
  return { onConfirm }
}

const botonEliminar = () => screen.getByRole('button', { name: 'Eliminar' })

describe('Confirmar un borrado', () => {
  it('sin motivo no deja confirmar', () => {
    montar()
    expect(screen.getByRole('alertdialog')).toHaveTextContent('¿Eliminar la cotización COTI02581?')
    expect(botonEliminar()).toBeDisabled()
  })

  /** Cuatro caracteres es el mínimo que también exige la base. */
  it('un motivo de dos letras tampoco alcanza', () => {
    montar()
    fireEvent.change(screen.getByRole('textbox', { name: /motivo/i }), { target: { value: 'ok' } })
    expect(botonEliminar()).toBeDisabled()
  })

  it('con motivo confirma y lo entrega sin espacios de más', () => {
    const { onConfirm } = montar()
    fireEvent.change(screen.getByRole('textbox', { name: /motivo/i }), {
      target: { value: '  cargada dos veces  ' },
    })
    fireEvent.click(botonEliminar())
    expect(onConfirm).toHaveBeenCalledWith('cargada dos veces')
  })

  /**
   * Los motivos frecuentes existen para que el caso normal sean dos clics. Sin
   * ellos, la fricción se paga con basura: «a», «asd», «borrar».
   */
  it('los motivos frecuentes llenan la caja de una', () => {
    const { onConfirm } = montar()
    fireEvent.click(screen.getByRole('button', { name: 'Era una prueba' }))
    expect(screen.getByRole('textbox', { name: /motivo/i })).toHaveValue('Era una prueba')
    fireEvent.click(botonEliminar())
    expect(onConfirm).toHaveBeenCalledWith('Era una prueba')
  })

  /**
   * El motivo de la vez pasada no puede quedar escrito: se confirmaría sin
   * leerlo y el registro diría cualquier cosa, que es peor que no tenerlo.
   */
  it('al reabrirse, el motivo anterior no queda escrito', () => {
    const { rerender } = render(
      <ConfirmBorrado open que="el remito RT-ERP00002" onCancel={() => {}} onConfirm={() => {}} />,
    )
    fireEvent.change(screen.getByRole('textbox', { name: /motivo/i }), { target: { value: 'era una prueba' } })

    rerender(<ConfirmBorrado open={false} que="x" onCancel={() => {}} onConfirm={() => {}} />)
    rerender(<ConfirmBorrado open que="el pedido PDV01320" onCancel={() => {}} onConfirm={() => {}} />)

    expect(screen.getByRole('textbox', { name: /motivo/i })).toHaveValue('')
    expect(botonEliminar()).toBeDisabled()
  })
})
