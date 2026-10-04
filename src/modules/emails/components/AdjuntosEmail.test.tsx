// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import type { AdjuntoContenido, HiloIndice, MensajeContenido } from '../types'
import { AdjuntosEmail } from './AdjuntosEmail'

// El servicio habla con Cloud Run; acá sólo interesa el botón, no la descarga.
vi.mock('../services/contenido', () => ({
  traerAdjunto: vi.fn(() => Promise.resolve(new Blob(['x']))),
  guardarEnDisco: vi.fn(),
}))

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
  tamano: 51_200,
  contentId: null,
  inline: false,
  ...p,
})

const mensaje = (adjuntos: AdjuntoContenido[]): MensajeContenido =>
  ({
    id: 'm1',
    de: 'compras@cliente.test',
    para: 'info@buscatools.com.ar',
    cc: '',
    fecha: '2026-10-02T12:00:00Z',
    adjuntos,
  }) as unknown as MensajeContenido

function montar(adjuntos: AdjuntoContenido[], onImportarOc?: () => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <AdjuntosEmail hilo={HILO} mensaje={mensaje(adjuntos)} onImportarOc={onImportarOc} />
    </QueryClientProvider>,
  )
}

/*
 * Fase 40: mandar el PDF de una orden de compra al importador sin salir del
 * correo. Lo que importa probar es CUÁNDO aparece el botón, porque importar
 * escribe una cotización: si aparece donde no corresponde, la base lo rechaza
 * y la persona se come un error que no podía prever.
 */
describe('<AdjuntosEmail> · importar una OC', () => {
  it('un PDF ofrece importarlo como orden de compra', () => {
    montar([adj()], vi.fn())
    expect(
      screen.getByRole('button', { name: /Importar OC-4800027238\.pdf como orden de compra/ }),
    ).toBeInTheDocument()
  })

  it('al apretarlo manda ESE adjunto y el mensaje donde estaba', () => {
    const onImportarOc = vi.fn()
    montar([adj(), adj({ partId: 'p2', nombre: 'remito.pdf' })], onImportarOc)
    fireEvent.click(screen.getByRole('button', { name: /Importar remito\.pdf como/ }))
    expect(onImportarOc).toHaveBeenCalledTimes(1)
    expect(onImportarOc).toHaveBeenCalledWith(
      expect.objectContaining({ partId: 'p2', nombre: 'remito.pdf' }),
      'm1',
    )
  })

  it('SIN permiso de escritura en Ventas el botón no existe', () => {
    // La página no pasa la función cuando el rol no puede escribir. Es el
    // mismo criterio que la Fase 13 aplicó al resto de los botones: no se
    // muestra una acción que la base va a rechazar.
    montar([adj()])
    expect(screen.queryByRole('button', { name: /orden de compra/ })).toBeNull()
    // Descargar sí sigue estando: leer es de todos los internos.
    expect(screen.getByRole('button', { name: /Descargar/ })).toBeInTheDocument()
  })

  it('una planilla o una imagen no lo ofrecen', () => {
    montar(
      [
        adj({ partId: 'x', nombre: 'lista.xlsx', mime: 'application/vnd.ms-excel' }),
        adj({ partId: 'y', nombre: 'foto.png', mime: 'image/png' }),
      ],
      vi.fn(),
    )
    expect(screen.queryByRole('button', { name: /orden de compra/ })).toBeNull()
  })

  it('con varios adjuntos, sólo el PDF lo ofrece', () => {
    montar([adj(), adj({ partId: 'z', nombre: 'notas.txt', mime: 'text/plain' })], vi.fn())
    expect(screen.getAllByRole('button', { name: /orden de compra/ })).toHaveLength(1)
  })
})
