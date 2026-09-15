// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

// El hook real guarda borradores en Gmail: acá se reemplaza entero. El test
// mira sólo la presentación (confirmación de descarte, estado del guardado).
const estado = vi.hoisted(() => ({ tieneContenido: true, guardado: 'guardado' }))
const acciones = vi.hoisted(() => ({ descartar: vi.fn(() => Promise.resolve()), enviarAhora: vi.fn(), guardarAhora: vi.fn() }))

vi.mock('../hooks/useComposer', () => ({
  nuevaClave: () => 'k',
  useComposer: () => ({
    campos: { para: ['cliente@ejemplo.test'], cc: [], cco: [], asunto: 'Consulta', texto: 'Hola', adjuntos: [], modo: 'nuevo', threadId: null, refMessageId: null, draftId: 'd1' },
    set: { para: vi.fn(), cc: vi.fn(), cco: vi.fn(), asunto: vi.fn(), texto: vi.fn(), adjuntos: vi.fn() },
    guardado: estado.guardado,
    errorGuardado: null,
    recreado: false,
    cargando: false,
    errorCarga: null,
    envio: { estado: 'idle' },
    tieneContenido: estado.tieneContenido,
    guardarAhora: acciones.guardarAhora,
    enviarAhora: acciones.enviarAhora,
    comprobar: vi.fn(),
    descartar: acciones.descartar,
  }),
}))
// Autocompleta contra la base: fuera del alcance de este test.
vi.mock('./CampoDestinatarios', () => ({
  CampoDestinatarios: ({ etiqueta }: { etiqueta: string }) => <div>{etiqueta}</div>,
}))

const { Composer } = await import('./Composer')

const OPCIONES = { accountId: 'a1', propia: 'buzon@ejemplo.test', modo: 'nuevo' as const, threadId: null, refMensaje: null, draftId: 'd1', clientRequestId: null, alCambiarUrl: () => {} }

beforeEach(() => {
  estado.tieneContenido = true
  estado.guardado = 'guardado'
  acciones.descartar.mockClear()
})

describe('<Composer> (presentación)', () => {
  it('descartar con contenido pide confirmación en un diálogo, no con window.confirm', async () => {
    const confirmar = vi.spyOn(window, 'confirm')
    const onCerrar = vi.fn()
    render(<Composer opciones={OPCIONES} titulo="Nuevo email" onCerrar={onCerrar} onEnviado={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    const dialogo = screen.getByRole('alertdialog', { name: '¿Descartar este borrador?' })
    expect(dialogo).toHaveTextContent('Se borra de Gmail y no se puede recuperar.')
    // Destructivo: el foco arranca en «Volver».
    expect(within(dialogo).getByRole('button', { name: 'Volver' })).toHaveFocus()
    expect(acciones.descartar).not.toHaveBeenCalled()
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Descartar borrador' }))
    await waitFor(() => expect(onCerrar).toHaveBeenCalled())
    expect(acciones.descartar).toHaveBeenCalledTimes(1)
    expect(confirmar).not.toHaveBeenCalled()
  })

  it('«Volver» cierra el diálogo sin descartar', () => {
    const onCerrar = vi.fn()
    render(<Composer opciones={OPCIONES} titulo="Nuevo email" onCerrar={onCerrar} onEnviado={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(acciones.descartar).not.toHaveBeenCalled()
    expect(onCerrar).not.toHaveBeenCalled()
  })

  it('sin contenido se descarta directo, como antes', async () => {
    estado.tieneContenido = false
    const onCerrar = vi.fn()
    render(<Composer opciones={OPCIONES} titulo="Nuevo email" onCerrar={onCerrar} onEnviado={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => expect(onCerrar).toHaveBeenCalled())
    expect(acciones.descartar).toHaveBeenCalledTimes(1)
  })

  it('el estado del autoguardado se anuncia con texto, no sólo con un ícono', () => {
    estado.guardado = 'guardando'
    const { rerender } = render(<Composer opciones={OPCIONES} titulo="Nuevo email" onCerrar={() => {}} onEnviado={() => {}} />)
    expect(screen.getAllByRole('status').some((s) => /Guardando…/.test(s.textContent ?? ''))).toBe(true)
    estado.guardado = 'guardado'
    rerender(<Composer opciones={OPCIONES} titulo="Nuevo email" onCerrar={() => {}} onEnviado={() => {}} />)
    expect(screen.getAllByRole('status').some((s) => /Borrador guardado/.test(s.textContent ?? ''))).toBe(true)
  })
})
