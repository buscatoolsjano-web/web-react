// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DialogoNombre } from './DialogoNombre'

const EXISTENTES = [
  { id: 'a', nombre: 'Chicago Pneumatic' },
  { id: 'b', nombre: 'FEIN' },
]

function montar(props: Partial<Parameters<typeof DialogoNombre>[0]> = {}) {
  const onGuardar = vi.fn()
  render(
    <DialogoNombre
      titulo="Nueva marca"
      etiqueta="Nombre de la marca"
      textoBoton="Crear marca"
      existentes={EXISTENTES}
      guardando={false}
      error={null}
      onGuardar={onGuardar}
      onCerrar={() => {}}
      {...props}
    />,
  )
  return { onGuardar, input: screen.getByLabelText('Nombre de la marca') }
}

describe('<DialogoNombre>', () => {
  it('avisa el duplicado (mayúsculas y espacios) asociado al campo y no envía', () => {
    const { onGuardar, input } = montar()
    fireEvent.change(input, { target: { value: '  chicago   PNEUMATIC ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear marca' }))
    const error = screen.getByRole('alert')
    expect(error).toHaveTextContent('Ya existe «Chicago Pneumatic».')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toContain(error.id)
    expect(onGuardar).not.toHaveBeenCalled()
  })

  it('vacío: error visible, sin envío', () => {
    const { onGuardar } = montar()
    fireEvent.click(screen.getByRole('button', { name: 'Crear marca' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Escribí un nombre.')
    expect(onGuardar).not.toHaveBeenCalled()
  })

  it('envía el nombre normalizado', () => {
    const { onGuardar, input } = montar()
    fireEvent.change(input, { target: { value: '   Nueva    Marca ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear marca' }))
    expect(onGuardar).toHaveBeenCalledWith('Nueva Marca')
  })

  it('renombrar: sin cambios el botón queda deshabilitado; el propio nombre no cuenta como duplicado', () => {
    const { onGuardar, input } = montar({ inicial: 'FEIN', excluirId: 'b', textoBoton: 'Renombrar' })
    const boton = screen.getByRole('button', { name: 'Renombrar' })
    expect(boton).toBeDisabled()
    fireEvent.change(input, { target: { value: 'Fein Tools' } })
    expect(boton).toBeEnabled()
    fireEvent.click(boton)
    expect(onGuardar).toHaveBeenCalledWith('Fein Tools')
  })

  it('muestra el error del servidor y bloquea mientras guarda', () => {
    montar({ error: 'Ya existe otra con ese nombre (sin distinguir mayúsculas ni espacios).', guardando: true })
    expect(screen.getByText(/Ya existe otra con ese nombre/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  })
})
