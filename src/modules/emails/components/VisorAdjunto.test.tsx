// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AdjuntoContenido, HiloIndice } from '../types'
import { VisorAdjunto } from './VisorAdjunto'

const espias = vi.hoisted(() => ({
  traer: vi.fn(() => Promise.resolve(new Blob(['%PDF-1.4']))),
}))

vi.mock('../services/contenido', () => ({
  traerAdjunto: espias.traer,
  guardarEnDisco: vi.fn(),
}))

/**
 * Los bytes que NUNCA llegan.
 *
 * Una promesa que no se resuelve es la única forma honesta de probar el visor
 * «todavía en blanco». Con la respuesta inmediata de arriba, los bytes llegan
 * en el microtask siguiente al cuerpo del test —después de la afirmación y
 * antes del `cleanup`—, el `setState` cae afuera de `act` y React lo canta.
 * No es un bug del visor: es que el test afirmaba sobre un estado y se iba
 * sin esperar al siguiente.
 */
const nuncaLlegan = () => {
  espias.traer.mockImplementationOnce(() => new Promise<Blob>(() => {}))
}

// jsdom no implementa estas dos y el visor las usa para mostrar el blob.
URL.createObjectURL = vi.fn(() => 'blob:prueba')
URL.revokeObjectURL = vi.fn()

const HILO: HiloIndice = {
  id: 'h1',
  accountId: 'a1',
  gmailThreadId: 'g1',
  asunto: 'OC 4800027238',
  participantes: ['compras@cliente.test'],
  ultimoMensajeEn: '2026-10-02T12:00:00Z',
  cantidadMensajes: 1,
  tieneAdjuntos: true,
}

const adj = (p: Partial<AdjuntoContenido> = {}): AdjuntoContenido => ({
  partId: 'p1',
  nombre: 'OC-4800027238.pdf',
  mime: 'application/pdf',
  tamano: 337_000,
  contentId: null,
  inline: false,
  ...p,
})

function montar(adjunto = adj(), onImportarOc?: (a: File) => void) {
  const onCerrar = vi.fn()
  render(
    <VisorAdjunto
      hilo={HILO}
      mensajeId="m1"
      adjunto={adjunto}
      onImportarOc={onImportarOc}
      onCerrar={onCerrar}
    />,
  )
  return { onCerrar }
}

/*
 * La vista previa (Fase 28 · E8) con el botón de importar adentro (Fase 40).
 *
 * El pedido fue poder MIRAR el PDF adjunto —como la vista previa de impresión,
 * sin bajarlo— y tener ahí mismo el botón que lo manda a cotizar. Lo que vale
 * probar es que el archivo que sale del visor sirve para el importador, y que
 * el botón no aparece donde no corresponde.
 */
describe('<VisorAdjunto> · importar desde la vista previa', () => {
  it('con un PDF ofrece importarlo como OC', async () => {
    montar(adj(), vi.fn())
    expect(await screen.findByRole('button', { name: 'Importar como OC' })).toBeEnabled()
  })

  it('entrega un File armado con los bytes que YA tenía a la vista', async () => {
    const onImportarOc = vi.fn()
    montar(adj(), onImportarOc)
    fireEvent.click(await screen.findByRole('button', { name: 'Importar como OC' }))
    await waitFor(() => expect(onImportarOc).toHaveBeenCalledTimes(1))

    const archivo = onImportarOc.mock.calls[0]![0] as File
    expect(archivo).toBeInstanceOf(File)
    expect(archivo.name).toBe('OC-4800027238.pdf')
    expect(archivo.type).toBe('application/pdf')
  })

  it('una imagen se mira pero no se ofrece importar', async () => {
    // El visor también abre imágenes; el importador sólo lee PDF.
    montar(adj({ nombre: 'foto.png', mime: 'image/png' }), vi.fn())
    await screen.findByRole('button', { name: /Descargar/ })
    expect(screen.queryByRole('button', { name: 'Importar como OC' })).toBeNull()
  })

  it('SIN permiso de escritura en Ventas el botón no existe', async () => {
    // La página no pasa la función cuando el rol no puede escribir.
    montar(adj())
    // Se espera a que el adjunto esté a la vista: lo que se afirma es que el
    // botón no está NUNCA, ni con el archivo cargado.
    await screen.findByRole('button', { name: /Descargar/ })
    expect(screen.queryByRole('button', { name: 'Importar como OC' })).toBeNull()
  })

  it('mientras los bytes no llegaron, no se puede importar nada', () => {
    // Sin blob el visor está en blanco: importar ahí mandaría un archivo vacío.
    nuncaLlegan()
    montar(adj(), vi.fn())
    expect(screen.getByRole('button', { name: 'Importar como OC' })).toBeDisabled()
  })
})
