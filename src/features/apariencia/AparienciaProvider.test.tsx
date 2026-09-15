// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Apariencia } from './opciones'

// La base se simula con un mapa por usuario: guardar sólo toca la fila de la
// sesión (como RLS profiles_update_own) y un valor fuera de la lista blanca se
// rechaza (como el CHECK profiles_appearance_valida).
interface BaseSimulada {
  filas: Map<string, unknown>
  fallarProximo: boolean
  guardados: [string, unknown][]
  pendiente: null | (() => void)
  demorar: boolean
}
const base = vi.hoisted<BaseSimulada>(() => ({ filas: new Map(), fallarProximo: false, guardados: [], pendiente: null, demorar: false }))
const auth = vi.hoisted<{ userId: string | null }>(() => ({ userId: 'usuario-a' }))

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({ session: auth.userId ? { user: { id: auth.userId } } : null, user: null, cargando: false, salir: vi.fn() }),
}))
vi.mock('@/services/apariencia/apariencia', async () => {
  const { normalizarApariencia } = await import('./opciones')
  return {
    leerApariencia: (userId: string) => Promise.resolve(normalizarApariencia(base.filas.get(userId) ?? null)),
    guardarApariencia: async (userId: string, a: Apariencia | null) => {
      if (base.demorar) await new Promise<void>((ok) => (base.pendiente = ok))
      if (base.fallarProximo) {
        base.fallarProximo = false
        throw new Error('No se pudo guardar la apariencia: new row violates check constraint "profiles_appearance_valida"')
      }
      base.guardados.push([userId, a])
      base.filas.set(userId, a)
    },
  }
})

const { AparienciaProvider } = await import('./AparienciaProvider')
const { useApariencia } = await import('./useApariencia')

function Consumidor() {
  const { apariencia, cambiar, restaurar, error, guardando } = useApariencia()
  return (
    <div>
      <output data-testid="actual">{`${apariencia.preset}|${apariencia.acento}|${apariencia.tamano}|${apariencia.fuente}`}</output>
      <output data-testid="error">{error ?? ''}</output>
      <output data-testid="guardando">{String(guardando)}</output>
      <button onClick={() => cambiar({ preset: 'grafito' })}>grafito</button>
      <button onClick={() => cambiar({ acento: 'verde', tamano: 'grande' })}>verde grande</button>
      <button onClick={restaurar}>restaurar</button>
    </div>
  )
}

const montar = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AparienciaProvider>
        <Consumidor />
      </AparienciaProvider>
    </QueryClientProvider>,
  )
const html = () => document.documentElement.dataset
const actual = () => screen.getByTestId('actual').textContent

beforeEach(() => {
  base.filas.clear()
  base.guardados = []
  base.fallarProximo = false
  base.demorar = false
  auth.userId = 'usuario-a'
  localStorage.clear()
  for (const k of ['theme', 'apariencia', 'acento', 'tamano', 'fuente']) delete document.documentElement.dataset[k]
})

describe('AparienciaProvider', () => {
  it('sin preferencia guardada: el original Buscatools', async () => {
    montar()
    await waitFor(() => expect(html().apariencia).toBe('claro-naranja'))
    expect([html().theme, actual()]).toEqual(['light', 'claro-naranja|tema|normal|sistema'])
  })

  it('carga la preferencia del servidor al iniciar sesión (otro dispositivo: misma apariencia)', async () => {
    base.filas.set('usuario-a', { version: 1, preset: 'azul-noche', acento: 'rosa', tamano: 'compacto', fuente: 'serif' })
    const primero = montar()
    await waitFor(() => expect(actual()).toBe('azul-noche|rosa|compacto|serif'))
    await waitFor(() => expect([html().theme, html().acento, html().tamano, html().fuente]).toEqual(['dark', 'rosa', 'compacto', 'serif']))
    primero.unmount()
    localStorage.clear() // «otro dispositivo»: sin caché local
    for (const k of ['theme', 'apariencia']) delete document.documentElement.dataset[k]
    montar()
    await waitFor(() => expect(html().apariencia).toBe('azul-noche'))
  })

  it('cambiar: se ve al instante (optimista) y se guarda en el servidor', async () => {
    base.demorar = true
    montar()
    await waitFor(() => expect(html().apariencia).toBe('claro-naranja'))
    fireEvent.click(screen.getByRole('button', { name: 'grafito' }))
    // Todavía no respondió el servidor: igual ya se aplicó.
    await waitFor(() => expect([html().theme, html().apariencia, screen.getByTestId('guardando').textContent]).toEqual(['dark', 'grafito', 'true']))
    await waitFor(() => expect(base.pendiente).not.toBeNull())
    act(() => {
      base.pendiente?.()
    })
    await waitFor(() => expect(screen.getByTestId('guardando').textContent).toBe('false'))
    expect(base.guardados).toEqual([['usuario-a', { version: 1, preset: 'grafito', acento: 'tema', tamano: 'normal', fuente: 'sistema' }]])
    expect((JSON.parse(localStorage.getItem('bt-apariencia')!) as { usuario: string }).usuario).toBe('usuario-a')
  })

  it('si el servidor rechaza: vuelve a lo confirmado y muestra el error', async () => {
    base.filas.set('usuario-a', { version: 1, preset: 'verde-esmeralda', acento: 'tema', tamano: 'normal', fuente: 'sistema' })
    montar()
    await waitFor(() => expect(html().apariencia).toBe('verde-esmeralda'))
    base.fallarProximo = true
    fireEvent.click(screen.getByRole('button', { name: 'verde grande' }))
    await waitFor(() => expect(screen.getByTestId('error').textContent).toMatch(/No se pudo guardar/))
    // El <html> se actualiza en un efecto: se espera a que corra.
    await waitFor(() => expect([actual(), html().acento, html().tamano]).toEqual(['verde-esmeralda|tema|normal|sistema', undefined, 'normal']))
  })

  it('restaurar original guarda NULL (la ausencia de preferencia) y aplica Claro naranja', async () => {
    base.filas.set('usuario-a', { version: 1, preset: 'grafito', acento: 'violeta', tamano: 'grande', fuente: 'clasica' })
    montar()
    await waitFor(() => expect(html().apariencia).toBe('grafito'))
    fireEvent.click(screen.getByRole('button', { name: 'restaurar' }))
    await waitFor(() => expect(base.guardados).toEqual([['usuario-a', null]]))
    await waitFor(() => expect([html().theme, html().apariencia, html().acento, html().tamano, html().fuente]).toEqual(['light', 'claro-naranja', undefined, 'normal', 'sistema']))
  })

  it('valor guardado inválido (preset retirado): se ignora y se ve el original', async () => {
    base.filas.set('usuario-a', { version: 1, preset: 'hacker', acento: 'neon', tamano: 'enorme', fuente: 'comic' })
    montar()
    await waitFor(() => expect(actual()).toBe('claro-naranja|tema|normal|sistema'))
  })

  it('aislamiento: el usuario B no ve ni pisa la preferencia de A', async () => {
    base.filas.set('usuario-a', { version: 1, preset: 'grafito', acento: 'tema', tamano: 'normal', fuente: 'sistema' })
    auth.userId = 'usuario-b'
    montar()
    await waitFor(() => expect(html().apariencia).toBe('claro-naranja'))
    fireEvent.click(screen.getByRole('button', { name: 'verde grande' }))
    await waitFor(() => expect(base.guardados).toHaveLength(1))
    expect(base.guardados[0]![0]).toBe('usuario-b')
    expect(base.filas.get('usuario-a')).toEqual({ version: 1, preset: 'grafito', acento: 'tema', tamano: 'normal', fuente: 'sistema' })
  })

  it('sin sesión: siempre el original, aunque haya caché de otra sesión', async () => {
    localStorage.setItem('bt-apariencia', JSON.stringify({ usuario: 'usuario-a', apariencia: { preset: 'grafito' } }))
    auth.userId = null
    montar()
    await waitFor(() => expect(html().apariencia).toBe('claro-naranja'))
    await waitFor(() => expect(html().theme).toBe('light'))
  })
})
