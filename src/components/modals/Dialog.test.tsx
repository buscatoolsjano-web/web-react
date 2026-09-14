// @vitest-environment jsdom
import { useRef, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Dialog } from './Dialog'
import { ConfirmDialog } from './ConfirmDialog'

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>'
  document.body.style.overflow = ''
})

const renderEnRoot = (ui: React.ReactElement) => render(ui, { container: document.getElementById('root')! })

function Demo({ onClose = vi.fn(), busy = false, closeOnOverlay = true }: { onClose?: () => void; busy?: boolean; closeOnOverlay?: boolean }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <>
      <button onClick={() => setAbierto(true)}>Abrir</button>
      <Dialog
        open={abierto}
        onClose={() => {
          onClose()
          setAbierto(false)
        }}
        title="Nueva marca"
        description="Se usa en el catálogo."
        busy={busy}
        closeOnOverlay={closeOnOverlay}
        footer={
          <>
            <button>Cancelar</button>
            <button>Guardar</button>
          </>
        }
      >
        <label>
          Nombre <input />
        </label>
      </Dialog>
    </>
  )
}

const tab = (shift = false) => fireEvent.keyDown(document, { key: 'Tab', shiftKey: shift })

describe('Dialog', () => {
  it('cerrado no renderiza nada', () => {
    renderEnRoot(<Demo />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('rol, aria-modal, nombre y descripción accesibles', () => {
    renderEnRoot(<Demo />)
    fireEvent.click(screen.getByText('Abrir'))
    const d = screen.getByRole('dialog', { name: 'Nueva marca' })
    expect(d).toHaveAttribute('aria-modal', 'true')
    expect(d).toHaveAccessibleDescription('Se usa en el catálogo.')
  })

  it('foco inicial en el primer control del cuerpo', () => {
    renderEnRoot(<Demo />)
    fireEvent.click(screen.getByText('Abrir'))
    expect(screen.getByLabelText('Nombre')).toHaveFocus()
  })

  it('Tab y Shift+Tab quedan atrapados dentro', () => {
    renderEnRoot(<Demo />)
    fireEvent.click(screen.getByText('Abrir'))
    const guardar = screen.getByText('Guardar')
    guardar.focus()
    tab()
    // El primer enfocable del diálogo es «Cerrar» (encabezado).
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus()
    tab(true)
    expect(guardar).toHaveFocus()
  })

  it('si el foco quedó fuera (fondo), Tab lo devuelve adentro', () => {
    renderEnRoot(<Demo />)
    fireEvent.click(screen.getByText('Abrir'))
    ;(document.activeElement as HTMLElement).blur()
    tab()
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })

  it('Escape cierra y el foco vuelve al disparador', () => {
    const onClose = vi.fn()
    renderEnRoot(<Demo onClose={onClose} />)
    const abrir = screen.getByText('Abrir')
    abrir.focus()
    fireEvent.click(abrir)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(abrir).toHaveFocus()
  })

  it('ocupado: ni Escape, ni fondo, ni «Cerrar»', () => {
    const onClose = vi.fn()
    renderEnRoot(<Demo onClose={onClose} busy />)
    fireEvent.click(screen.getByText('Abrir'))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!)
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeDisabled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true')
  })

  it('fondo cierra; click dentro no cierra', () => {
    const onClose = vi.fn()
    renderEnRoot(<Demo onClose={onClose} />)
    fireEvent.click(screen.getByText('Abrir'))
    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closeOnOverlay=false: el fondo no cierra', () => {
    const onClose2 = vi.fn()
    renderEnRoot(<Demo onClose={onClose2} closeOnOverlay={false} />)
    fireEvent.click(screen.getByText('Abrir'))
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!)
    expect(onClose2).not.toHaveBeenCalled()
  })

  it('la app queda inert y sin scroll mientras está abierto; se restaura al cerrar', () => {
    renderEnRoot(<Demo />)
    const root = document.getElementById('root')!
    fireEvent.click(screen.getByText('Abrir'))
    expect(root).toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('hidden')
    // El diálogo vive fuera de #root (portal), así que no queda inert.
    expect(root.contains(screen.getByRole('dialog'))).toBe(false)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(root).not.toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('')
  })

  it('anidados: Escape cierra sólo el de arriba y el inert se libera con el último', () => {
    function Anidados() {
      const [a, setA] = useState(true)
      const [b, setB] = useState(true)
      return (
        <>
          <Dialog open={a} onClose={() => setA(false)} title="Primero">
            <button>uno</button>
          </Dialog>
          <Dialog open={b} onClose={() => setB(false)} title="Segundo">
            <button>dos</button>
          </Dialog>
        </>
      )
    }
    renderEnRoot(<Anidados />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Segundo' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Primero' })).toBeInTheDocument()
    expect(document.getElementById('root')).toHaveAttribute('inert')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.getElementById('root')).not.toHaveAttribute('inert')
  })

  it('initialFocusRef manda sobre el primer control', () => {
    function ConRef() {
      const ref = useRef<HTMLButtonElement>(null)
      return (
        <Dialog open onClose={() => undefined} title="T" initialFocusRef={ref} footer={<button ref={ref}>Aceptar</button>}>
          <input aria-label="campo" />
        </Dialog>
      )
    }
    renderEnRoot(<ConRef />)
    expect(screen.getByText('Aceptar')).toHaveFocus()
  })
})

describe('ConfirmDialog', () => {
  it('peligro: alertdialog, consecuencia, foco en Cancelar y no cierra con el fondo', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    renderEnRoot(
      <ConfirmDialog open tone="danger" title="¿Eliminar COTI-00020?" description="No se puede deshacer." confirmLabel="Eliminar" onCancel={onCancel} onConfirm={onConfirm} />,
    )
    const d = screen.getByRole('alertdialog', { name: '¿Eliminar COTI-00020?' })
    expect(d).toHaveAccessibleDescription('No se puede deshacer.')
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    fireEvent.mouseDown(d.parentElement!)
    expect(onCancel).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('normal: dialog con foco en confirmar; ocupado bloquea', () => {
    const onCancel = vi.fn()
    const { rerender } = renderEnRoot(
      <ConfirmDialog open title="¿Enviar?" description="Se envía al cliente." confirmLabel="Enviar" onCancel={onCancel} onConfirm={() => undefined} />,
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar' })).toHaveFocus()
    act(() => {
      rerender(<ConfirmDialog open busy title="¿Enviar?" description="Se envía al cliente." confirmLabel="Enviar" onCancel={onCancel} onConfirm={() => undefined} />)
    })
    const enviar = screen.getByRole('button', { name: 'Enviar' })
    expect(enviar).toBeDisabled()
    expect(enviar).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
  })
})
