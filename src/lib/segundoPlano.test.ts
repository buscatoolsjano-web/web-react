import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { enSegundoPlano, META_SEGUNDO_PLANO, vigilarPrimerPlano } from './segundoPlano'

/** Una promesa que se resuelve a mano. */
function diferida<T = void>() {
  let resolver!: (v: T) => void
  const promesa = new Promise<T>((r) => (resolver = r))
  return { promesa, resolver }
}

describe('la cola de segundo plano', () => {
  let qc: QueryClient

  beforeEach(() => {
    vi.useFakeTimers()
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vigilarPrimerPlano(qc)
  })

  afterEach(() => {
    qc.clear()
    vi.useRealTimers()
  })

  it('espera a que la pantalla termine de pedir lo suyo', async () => {
    const pantalla = diferida<number>()
    qc.fetchQuery({ queryKey: ['pantalla'], queryFn: () => pantalla.promesa }).catch(() => {})

    const tarea = vi.fn(() => Promise.resolve('campana'))
    const resultado = enSegundoPlano(tarea)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(tarea).not.toHaveBeenCalled()

    pantalla.resolver(1)
    await vi.advanceTimersByTimeAsync(299)
    expect(tarea).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(10)
    expect(tarea).toHaveBeenCalledTimes(1)
    await expect(resultado).resolves.toBe('campana')
  })

  it('no corre más de dos a la vez', async () => {
    await vi.advanceTimersByTimeAsync(400)
    const bloqueos = [diferida(), diferida(), diferida()]
    const tareas = bloqueos.map((b) => vi.fn(() => b.promesa))
    tareas.forEach((t) => void enSegundoPlano(t))

    await vi.advanceTimersByTimeAsync(10)
    expect(tareas.map((t) => t.mock.calls.length)).toEqual([1, 1, 0])

    bloqueos[0]!.resolver()
    await vi.advanceTimersByTimeAsync(10)
    expect(tareas[2]).toHaveBeenCalledTimes(1)
  })

  it('una tarea colgada devuelve su lugar a los 10 s', async () => {
    await vi.advanceTimersByTimeAsync(400)
    const colgadas = [
      vi.fn(() => new Promise<void>(() => {})),
      vi.fn(() => new Promise<void>(() => {})),
    ]
    colgadas.forEach((t) => void enSegundoPlano(t))
    const tercera = vi.fn(async () => {})
    void enSegundoPlano(tercera)

    await vi.advanceTimersByTimeAsync(9_000)
    expect(tercera).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_100)
    expect(tercera).toHaveBeenCalledTimes(1)
  })

  it('nadie espera para siempre: a los 6 s sale aunque la pantalla siga pidiendo', async () => {
    qc.fetchQuery({ queryKey: ['pantalla-lenta'], queryFn: () => new Promise(() => {}) }).catch(
      () => {},
    )
    const tarea = vi.fn(async () => {})
    void enSegundoPlano(tarea)

    await vi.advanceTimersByTimeAsync(5_900)
    expect(tarea).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(tarea).toHaveBeenCalledTimes(1)
  })

  it('si la pantalla adopta una consulta encolada, sale en el acto', async () => {
    // La pantalla tiene algo en vuelo: el precalentado queda en la cola.
    qc.fetchQuery({ queryKey: ['otra-cosa'], queryFn: () => new Promise(() => {}) }).catch(() => {})

    const llamada = vi.fn(() => Promise.resolve(['fila']))
    void qc.prefetchQuery({
      queryKey: ['catalogo', 'pagina-1'],
      queryFn: ({ queryKey }) => enSegundoPlano(llamada, queryKey),
      meta: META_SEGUNDO_PLANO,
    })
    await vi.advanceTimersByTimeAsync(50)
    expect(llamada).not.toHaveBeenCalled()

    // Ahora la pantalla del catálogo se monta y mira esa misma clave.
    const observador = new QueryObserver(qc, {
      queryKey: ['catalogo', 'pagina-1'],
      queryFn: llamada,
    })
    const desuscribir = observador.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(10)
    expect(llamada).toHaveBeenCalledTimes(1)
    desuscribir()
  })
})
