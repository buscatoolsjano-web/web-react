// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Dialogo } from './Dialogo'

describe('<Dialogo> sobre el Dialog común', () => {
  it('modal con nombre, pie y cierre por Escape', () => {
    const onCerrar = vi.fn()
    render(
      <>
        <button type="button">Abrir</button>
        <Dialogo titulo="Suspender acceso" onCerrar={onCerrar} pie={<button type="button">Suspender</button>}>
          <p>No va a poder entrar.</p>
        </Dialogo>
      </>,
    )
    const dialogo = screen.getByRole('dialog', { name: 'Suspender acceso' })
    expect(dialogo).toHaveAttribute('aria-modal', 'true')
    expect(dialogo).toHaveTextContent('No va a poder entrar.')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCerrar).toHaveBeenCalledTimes(1)
  })

  it('bloqueado mientras guarda: Escape no cierra', () => {
    const onCerrar = vi.fn()
    render(
      <Dialogo titulo="Eliminar marca" onCerrar={onCerrar} bloqueado pie={<button type="button">Eliminar</button>}>
        <p>Se elimina.</p>
      </Dialogo>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCerrar).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true')
  })
})
