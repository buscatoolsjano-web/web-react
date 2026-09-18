// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Adjunto } from '../services/adjuntos'

/**
 * Adjuntos del documento (Fase 15 · E6).
 *
 * Se mockea lo que toca la red —listar, subir, borrar, firmar— y nada más: la
 * validación de tipo y tamaño, las etiquetas y los permisos son los de
 * producción. Lo que importa probar: que borrar PREGUNTE, que la URL firmada
 * se pida al hacer clic y no para toda la lista, y que quien no escribe no
 * vea el formulario.
 */
const estado = vi.hoisted((): { rol: string; lista: unknown[] } => ({ rol: 'admin', lista: [] }))

const espias = vi.hoisted(() => ({
  listar: vi.fn((_c: string, _t: string, _d: string) => Promise.resolve(estado.lista)),
  subir: vi.fn((_c: string, _t: string, _d: string, _a: File, _clase?: string) => Promise.resolve()),
  borrar: vi.fn((_id: string, _ruta: string) => Promise.resolve()),
  url: vi.fn((_ruta: string) => Promise.resolve('https://firmada.example/archivo?token=x')),
}))

vi.mock('@/services/supabase/client', () => ({ supabase: {} }))
vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({
    activa: { companyId: 'c1', companyName: 'ZZ', rol: estado.rol, esInterno: true, customerId: null },
  }),
}))
vi.mock('../services/adjuntos', async (real) => ({
  ...(await real<Record<string, unknown>>()),
  listarAdjuntos: espias.listar,
  subirAdjunto: espias.subir,
  borrarAdjunto: espias.borrar,
  urlDeDescarga: espias.url,
}))

const { PanelAdjuntos } = await import('./PanelAdjuntos')

const adjunto = (p: Partial<Adjunto> = {}): Adjunto => ({
  id: 'a1',
  nombre: 'orden-de-compra.pdf',
  tipoMime: 'application/pdf',
  bytes: 2048,
  clase: 'customer_po',
  ruta: 'c1/quote/q1/uuid-orden-de-compra.pdf',
  subidoEn: '2026-09-17T12:00:00.000Z',
  subidoPor: 'Lisandro',
  ...p,
})

const montar = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <PanelAdjuntos tipo="cotizacion" documentoId="q1" />
    </QueryClientProvider>,
  )

const archivo = (nombre = 'oc.pdf', tipo = 'application/pdf') =>
  new File(['contenido'], nombre, { type: tipo })

beforeEach(() => {
  estado.rol = 'admin'
  estado.lista = []
  espias.listar.mockClear()
  espias.subir.mockClear()
  espias.borrar.mockClear()
  espias.url.mockClear()
})

describe('Adjuntos · lista', () => {
  it('sin archivos lo dice, sin prometer nada más', async () => {
    montar()
    expect(await screen.findByText('Sin archivos adjuntos.')).toBeInTheDocument()
  })

  it('muestra nombre, tipo, para qué es, tamaño, fecha y quién lo subió', async () => {
    estado.lista = [adjunto()]
    montar()
    expect(await screen.findByRole('button', { name: 'Descargar orden-de-compra.pdf' })).toBeInTheDocument()
    expect(screen.getByText(/PDF · OC del cliente · 2 kB · 17\/09\/2026 · Lisandro/)).toBeInTheDocument()
  })

  it('NO pide una URL firmada por archivo: sólo al hacer clic', async () => {
    estado.lista = [adjunto(), adjunto({ id: 'a2', nombre: 'foto.png', ruta: 'c1/quote/q1/uuid-foto.png' })]
    montar()
    await screen.findByRole('button', { name: 'Descargar orden-de-compra.pdf' })
    expect(espias.url).not.toHaveBeenCalled()

    vi.spyOn(window, 'open').mockImplementation(() => null)
    fireEvent.click(screen.getByRole('button', { name: 'Descargar foto.png' }))
    await waitFor(() => expect(espias.url).toHaveBeenCalledTimes(1))
    expect(espias.url.mock.calls[0]![0]).toBe('c1/quote/q1/uuid-foto.png')
  })

  it('dos archivos con el mismo nombre se muestran los dos', async () => {
    estado.lista = [adjunto(), adjunto({ id: 'a2', ruta: 'c1/quote/q1/otro-uuid-orden-de-compra.pdf' })]
    montar()
    expect(await screen.findAllByRole('button', { name: 'Descargar orden-de-compra.pdf' })).toHaveLength(2)
  })
})

describe('Adjuntos · subir', () => {
  it('sube el archivo con la clase elegida', async () => {
    montar()
    await screen.findByText('Sin archivos adjuntos.')

    fireEvent.change(screen.getByLabelText(/Qué es/), { target: { value: 'customer_po' } })
    fireEvent.change(screen.getByLabelText('Elegir archivo para adjuntar'), {
      target: { files: [archivo()] },
    })

    await waitFor(() => expect(espias.subir).toHaveBeenCalledTimes(1))
    const [companyId, tipo, docId, file, clase] = espias.subir.mock.calls[0]!
    expect([companyId, tipo, docId, clase]).toEqual(['c1', 'cotizacion', 'q1', 'customer_po'])
    expect(file.name).toBe('oc.pdf')
  })

  it('el campo sólo ofrece los tipos que el servidor acepta', async () => {
    montar()
    await screen.findByText('Sin archivos adjuntos.')
    const campo = screen.getByLabelText('Elegir archivo para adjuntar')
    expect(campo.getAttribute('accept')).toContain('application/pdf')
    expect(campo.getAttribute('accept')).not.toContain('application/x-msdownload')
  })

  it('si el servidor rechaza, lo dice en castellano', async () => {
    espias.subir.mockRejectedValueOnce(new Error('El archivo supera los 20 MB.'))
    montar()
    await screen.findByText('Sin archivos adjuntos.')
    fireEvent.change(screen.getByLabelText('Elegir archivo para adjuntar'), {
      target: { files: [archivo('grande.pdf')] },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('El archivo supera los 20 MB.')
  })
})

describe('Adjuntos · borrar', () => {
  it('pregunta antes de borrar, y cancelar no borra', async () => {
    estado.lista = [adjunto()]
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar orden-de-compra.pdf' }))

    const dialogo = await screen.findByRole('alertdialog', { name: '¿Eliminar este archivo?' })
    expect(within(dialogo).getByText(/orden-de-compra\.pdf/)).toBeInTheDocument()
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(espias.borrar).not.toHaveBeenCalled()
  })

  it('al confirmar, borra ese archivo', async () => {
    estado.lista = [adjunto()]
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar orden-de-compra.pdf' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Eliminar' }))

    await waitFor(() => expect(espias.borrar).toHaveBeenCalledTimes(1))
    expect(espias.borrar.mock.calls[0]).toEqual(['a1', 'c1/quote/q1/uuid-orden-de-compra.pdf'])
  })

  it('si el archivo queda en el almacenamiento, se avisa', async () => {
    estado.lista = [adjunto()]
    espias.borrar.mockRejectedValueOnce(
      new Error('El adjunto se quitó del documento, pero el archivo quedó en el almacenamiento. Avisá a soporte.'),
    )
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar orden-de-compra.pdf' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Eliminar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/quedó en el almacenamiento/)
  })
})

describe('Adjuntos · permisos', () => {
  it('quien no escribe ve la lista pero no sube ni borra', async () => {
    estado.rol = 'salesperson'
    estado.lista = [adjunto()]
    montar()
    expect(await screen.findByRole('button', { name: 'Descargar orden-de-compra.pdf' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Elegir archivo para adjuntar')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Eliminar orden-de-compra.pdf' })).toBeNull()
  })
})
