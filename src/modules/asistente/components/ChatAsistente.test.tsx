// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type * as ServicioAsistente from '../services/asistente'
import type { RespuestaAsistente } from '../services/asistente'

/**
 * El chat del asistente (Fase 31 · E4, movido al cajón del header en la 33).
 *
 * Se prueban las tres cosas que la hacen confiable, que son justo las que la
 * web vieja no tenía: que el hilo ENTERO viaja —sin eso, «¿y de ese cliente?»
 * llega sin saber de quién—, que la traza deja ver de dónde salió el dato, y
 * que el cartel de «IA apagada» dice la verdad en vez de prometer respuestas
 * que no son respuestas.
 */
const estado = vi.hoisted(() => ({
  listo: true,
  respuesta: null as RespuestaAsistente | null,
  error: null as Error | null,
  /** Lo último que se le mandó a la función. */
  enviado: null as Record<string, unknown> | null,
}))

vi.mock('@/services/supabase/client', () => ({ supabase: {} }))
// El saludo usa el nombre de quien pregunta (Fase 35).
vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'juan@buscatools.com.ar', user_metadata: { full_name: 'Juan Manuel Mocciaro' } } }),
}))
vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1', companyName: 'ZZ', rol: 'admin', esInterno: true, customerId: null } }),
}))
vi.mock('../services/asistente', async (original) => {
  const real = await original<typeof ServicioAsistente>()
  return {
    ...real,
    estadoAsistente: () =>
      Promise.resolve({
        proveedor: estado.listo ? 'openai' : 'falso',
        listo: estado.listo,
        agentes: [
          { id: 'general', titulo: 'Asistente', paraQue: '' },
          { id: 'catalogo', titulo: 'Catálogo', paraQue: '' },
          { id: 'ventas', titulo: 'Ventas', paraQue: '' },
        ],
      }),
    preguntar: (p: Record<string, unknown>) => {
      estado.enviado = p
      if (estado.error) return Promise.reject(estado.error)
      return Promise.resolve(
        estado.respuesta ?? { texto: 'Listo.', pasos: [], llamadas: 1, corte: 'ninguno', propuesta: null },
      )
    },
  }
})

const { ChatAsistente } = await import('./ChatAsistente')

function montar() {
  estado.enviado = null
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ChatAsistente />
    </QueryClientProvider>,
  )
}

const escribirYEnviar = (texto: string) => {
  fireEvent.change(screen.getByLabelText('Tu pregunta'), { target: { value: texto } })
  fireEvent.click(screen.getByRole('button', { name: /preguntar/i }))
}

describe('El chat del asistente', () => {
  it('muestra la respuesta y deja ver a quién consultó', async () => {
    estado.listo = true
    estado.error = null
    estado.respuesta = {
      texto: 'Sí: SP.2008VP/100, 4 disponibles.',
      pasos: [
        { agente: 'general', tipo: 'consulta', nombre: 'catalogo' },
        { agente: 'catalogo', tipo: 'herramienta', nombre: 'buscar_productos' },
      ],
      llamadas: 3,
      corte: 'ninguno',
      propuesta: null,
    }
    montar()

    escribirYEnviar('¿tenemos punta PH2?')
    expect(await screen.findByText('Sí: SP.2008VP/100, 4 disponibles.')).toBeInTheDocument()

    // La traza usa el TÍTULO del agente, no su id: «Catálogo», no «catalogo».
    expect(screen.getByText(/Consultó a Catálogo/)).toBeInTheDocument()
    fireEvent.click(screen.getByText(/Consultó a Catálogo/))
    expect(screen.getByText('buscar_productos')).toBeInTheDocument()
  })

  /**
   * Los agentes no guardan nada entre llamadas: la conversación ES el
   * contexto. Sin mandar el hilo entero, «¿y de ese cliente?» llega sin saber
   * de quién se está hablando.
   */
  it('manda el hilo ENTERO, no sólo el último mensaje', async () => {
    estado.listo = true
    estado.error = null
    estado.respuesta = { texto: 'Mirgor compró 8 cosas.', pasos: [], llamadas: 1, corte: 'ninguno', propuesta: null }
    montar()

    escribirYEnviar('¿qué le vendimos a Mirgor?')
    await screen.findByText('Mirgor compró 8 cosas.')

    escribirYEnviar('¿y qué tiene pendiente?')
    await waitFor(() => {
      const p = estado.enviado as unknown as { mensajes: { rol: string; texto: string }[] }
      expect(p.mensajes.map((m) => m.rol)).toEqual(['usuario', 'agente', 'usuario'])
      expect(p.mensajes[0]?.texto).toBe('¿qué le vendimos a Mirgor?')
      expect(p.mensajes[2]?.texto).toBe('¿y qué tiene pendiente?')
    })
  })

  /**
   * Un asistente que contesta siempre lo mismo sin decir que está apagado
   * manda a probar y a no entender por qué. El aviso viaja con el chat y no
   * con el header, así que sigue estando ahora que el chat vive en un cajón.
   */
  it('avisa cuando la IA está apagada', async () => {
    estado.listo = false
    estado.error = null
    estado.respuesta = null
    montar()

    expect(await screen.findByText(/todavía no está encendida/i)).toBeInTheDocument()
  })

  it('un fallo se muestra en el hilo y no rompe la pantalla', async () => {
    estado.listo = true
    estado.respuesta = null
    const { FalloAsistente } = await import('../services/asistente')
    estado.error = new FalloAsistente('limite', 'Se alcanzó el límite del proveedor de IA.')
    montar()

    escribirYEnviar('algo')
    expect(await screen.findByText('Se alcanzó el límite del proveedor de IA.')).toBeInTheDocument()
    // Y se puede seguir preguntando.
    expect(screen.getByLabelText('Tu pregunta')).not.toBeDisabled()
  })

  /** Un corte no puede pasar por una respuesta completa. */
  it('avisa cuando la consulta se cortó por llegar a su tope', async () => {
    estado.listo = true
    estado.error = null
    estado.respuesta = { texto: 'Con lo que junté…', pasos: [], llamadas: 24, corte: 'presupuesto', propuesta: null }
    montar()

    escribirYEnviar('algo largo')
    expect(await screen.findByText(/llegó a su tope/i)).toBeInTheDocument()
  })

  it('los ejemplos de arranque preguntan al tocarlos', async () => {
    estado.listo = true
    estado.error = null
    estado.respuesta = { texto: 'ok', pasos: [], llamadas: 1, corte: 'ninguno', propuesta: null }
    montar()

    const ejemplo = await screen.findByRole('button', { name: /mejor cliente del mes pasado/i })
    fireEvent.click(ejemplo)
    await waitFor(() => {
      const p = estado.enviado as unknown as { mensajes: { texto: string }[] }
      expect(p.mensajes[0]?.texto).toMatch(/mejor cliente del mes pasado/i)
    })
  })
})
