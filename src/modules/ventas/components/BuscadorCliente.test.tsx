// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const estado = vi.hoisted(() => ({ resultados: [] as { id: string; nombre: string; dadoDeBaja: boolean }[], llamadas: [] as string[] }))

vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1', companyName: 'ZZ', rol: 'admin', esInterno: true }, cargando: false }),
}))
vi.mock('../services/clientes', () => ({
  buscarClientes: (_c: string, texto: string) => {
    estado.llamadas.push(texto)
    return Promise.resolve(estado.resultados)
  },
  nombreDeCliente: () => Promise.resolve({ id: 'k1', nombre: 'Cliente elegido', dadoDeBaja: false }),
}))

const { BuscadorCliente } = await import('./BuscadorCliente')

function montar(props: Partial<{ valor: string | null; editable: boolean; onElegir: (id: string | null) => void }> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onElegir = props.onElegir ?? vi.fn()
  render(
    <QueryClientProvider client={qc}>
      <BuscadorCliente valor={props.valor ?? null} editable={props.editable ?? true} onElegir={onElegir} />
    </QueryClientProvider>,
  )
  return { onElegir }
}

beforeEach(() => {
  estado.resultados = [{ id: 'k9', nombre: 'El Gitano', dadoDeBaja: false }]
  estado.llamadas = []
})

describe('BuscadorCliente en un documento nuevo', () => {
  // Regresión del cutover: en una cotización nueva el campo se mostraba pero la
  // búsqueda nunca se ejecutaba, así que no había forma de elegir cliente.
  it('busca y muestra resultados sin necesidad de tocar «Cambiar»', async () => {
    montar({ valor: null })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'gitano' } })
    expect(await screen.findByRole('button', { name: 'El Gitano' })).toBeInTheDocument()
    // Antes del arreglo la consulta ni se disparaba: la lista quedaba vacía
    // para siempre. Después del debounce llega el texto tipeado.
    expect(estado.llamadas.length).toBeGreaterThan(0)
    await waitFor(() => expect(estado.llamadas).toContain('gitano'))
  })

  it('elegir un resultado devuelve su id', async () => {
    const { onElegir } = montar({ valor: null })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'gitano' } })
    fireEvent.click(await screen.findByRole('button', { name: 'El Gitano' }))
    expect(onElegir).toHaveBeenCalledWith('k9')
  })

  it('sin resultados lo dice, en vez de quedarse mudo', async () => {
    estado.resultados = []
    montar({ valor: null })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nadie' } })
    expect(await screen.findByText('Ningún cliente activo coincide.')).toBeInTheDocument()
  })

  it('en sólo lectura no busca ni muestra el campo', async () => {
    montar({ valor: 'k1', editable: false })
    await waitFor(() => expect(screen.getByText('Cliente elegido')).toBeInTheDocument())
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(estado.llamadas).toHaveLength(0)
  })

  it('con cliente elegido no busca hasta que se toca «Cambiar»', async () => {
    montar({ valor: 'k1' })
    await waitFor(() => expect(screen.getByText('Cliente elegido')).toBeInTheDocument())
    expect(estado.llamadas).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /cambiar/i }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'gitano' } })
    expect(await screen.findByRole('button', { name: 'El Gitano' })).toBeInTheDocument()
  })
})
