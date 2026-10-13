// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  /** Lo que el servidor va contando antes de contestar. */
  avisos: [] as ServicioAsistente.AvisoEnVivo[],
  /**
   * Para congelar la respuesta a mitad de camino.
   *
   * Sin esto no se puede probar lo único que importa de esta fase: lo que se
   * ve MIENTRAS espera. Los avisos y la respuesta llegarían en el mismo tick
   * y el test sólo vería el final, que es justo lo que ya andaba.
   */
  soltar: null as (() => void) | null,
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
    /*
     * Desde la Fase 65 el chat pide la respuesta EN VIVO: el servidor va
     * contando lo que hace y manda el texto mientras lo escribe. El doble
     * reproduce esa secuencia —los avisos primero, la respuesta al final—
     * porque lo que hay que probar es que la pantalla cuente lo correcto
     * mientras espera, no sólo que muestre bien el resultado.
     */
    preguntarEnVivo: (
      p: Record<string, unknown>,
      avisar: (a: ServicioAsistente.AvisoEnVivo) => void,
    ) => {
      for (const a of estado.avisos) avisar(a)
      estado.enviado = p
      if (estado.error) return Promise.reject(estado.error)
      const esperar = estado.soltar
        ? new Promise<void>((ok) => {
            estado.soltar = ok
          })
        : Promise.resolve()
      return esperar.then(() =>
        estado.respuesta ?? { texto: 'Listo.', pasos: [], llamadas: 1, corte: 'ninguno', propuesta: null, productos: [] },
      )
    },
  }
})

const { ChatAsistente } = await import('./ChatAsistente')

function montar() {
  estado.enviado = null
  estado.avisos = []
  estado.soltar = null
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
  /**
   * La traza NO se muestra (Fase 39), pero los pasos SÍ siguen llegando.
   *
   * La distinción es la que pidió Jano: que el asistente siga derivando a sus
   * especialistas, y que eso no se vea. Por eso el caso de prueba manda unos
   * pasos y verifica las dos mitades: que la respuesta esté, y que ni el
   * nombre del agente ni el de la herramienta aparezcan en pantalla.
   *
   * Si alguna vez se vuelve a dibujar la traza, esta prueba falla y obliga a
   * decidirlo a propósito en vez de que reaparezca por descuido.
   */
  it('muestra la respuesta y NO expone a quién consultó', async () => {
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
      productos: [],
    }
    montar()

    escribirYEnviar('¿tenemos punta PH2?')
    expect(await screen.findByText('Sí: SP.2008VP/100, 4 disponibles.')).toBeInTheDocument()

    // Los pasos llegaron —están en la respuesta de arriba— y aun así no se
    // ven: ni el agente al que derivó ni la herramienta que usó.
    expect(screen.queryByText(/Consultó a/)).not.toBeInTheDocument()
    expect(screen.queryByText(/buscar_productos/)).not.toBeInTheDocument()
    expect(screen.queryByText(/le preguntó a/)).not.toBeInTheDocument()
  })

  /**
   * Los agentes no guardan nada entre llamadas: la conversación ES el
   * contexto. Sin mandar el hilo entero, «¿y de ese cliente?» llega sin saber
   * de quién se está hablando.
   */
  it('manda el hilo ENTERO, no sólo el último mensaje', async () => {
    estado.listo = true
    estado.error = null
    estado.respuesta = { texto: 'Mirgor compró 8 cosas.', pasos: [], llamadas: 1, corte: 'ninguno', propuesta: null, productos: [] }
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
    estado.respuesta = { texto: 'Con lo que junté…', pasos: [], llamadas: 24, corte: 'presupuesto', propuesta: null, productos: [] }
    montar()

    escribirYEnviar('algo largo')
    expect(await screen.findByText(/llegó a su tope/i)).toBeInTheDocument()
  })

  it('los ejemplos de arranque preguntan al tocarlos', async () => {
    estado.listo = true
    estado.error = null
    estado.respuesta = { texto: 'ok', pasos: [], llamadas: 1, corte: 'ninguno', propuesta: null, productos: [] }
    montar()

    const ejemplo = await screen.findByRole('button', { name: /mejor cliente del mes pasado/i })
    fireEvent.click(ejemplo)
    await waitFor(() => {
      const p = estado.enviado as unknown as { mensajes: { texto: string }[] }
      expect(p.mensajes[0]?.texto).toMatch(/mejor cliente del mes pasado/i)
    })
  })
})

/*
 * ── LO QUE SE VE MIENTRAS ESPERA (Fase 65) ──────────────────────────────────
 *
 * Medido: la consulta tarda 21 s. Antes no se veía nada hasta el final, y eso
 * se tapaba con una barra que avanzaba sola —una animación que no sabía
 * cuánto faltaba porque nadie lo sabía—. Ahora el servidor va contando.
 */
describe('El chat mientras espera', () => {
  /** Congela la respuesta para poder mirar la pantalla a mitad de camino. */
  const congelar = (avisos: ServicioAsistente.AvisoEnVivo[]) => {
    estado.soltar = () => {}
    estado.avisos = avisos
  }

  it('dice a quién consultó, con el nombre de pantalla del colega', async () => {
    montar()
    congelar([{ tipo: 'paso', clase: 'consulta', nombre: 'catalogo' }])
    escribirYEnviar('puntas PH2')

    expect(await screen.findByText(/Consultando a Catálogo/)).toBeInTheDocument()
    await act(() => Promise.resolve(estado.soltar?.()))
  })

  it('dice qué está buscando, en castellano y no por el id de la herramienta', async () => {
    montar()
    congelar([{ tipo: 'paso', clase: 'herramienta', nombre: 'buscar_productos' }])
    escribirYEnviar('puntas PH2')

    expect(await screen.findByText(/Buscando en el catálogo/)).toBeInTheDocument()
    expect(screen.queryByText(/buscar_productos/)).toBeNull()
    await act(() => Promise.resolve(estado.soltar?.()))
  })

  it('muestra la respuesta mientras se escribe', async () => {
    montar()
    congelar([
      { tipo: 'turno' },
      { tipo: 'delta', texto: 'Sí, hay ' },
      { tipo: 'delta', texto: 'tres puntas.' },
    ])
    escribirYEnviar('puntas PH2')

    expect(await screen.findByText(/Sí, hay tres puntas\./)).toBeInTheDocument()
    await act(() => Promise.resolve(estado.soltar?.()))
  })

  /*
   * EL CASO QUE JUSTIFICA EL EVENTO «turno». Un agente empieza a redactar y
   * después decide usar una herramienta: lo que escribió NO era la respuesta
   * y no puede quedar en pantalla, porque quien mira no tiene cómo saber que
   * se descartó.
   */
  it('lo que el agente descarta no queda en pantalla', async () => {
    montar()
    congelar([
      { tipo: 'delta', texto: 'Voy a fijarme en el stock' },
      { tipo: 'paso', clase: 'herramienta', nombre: 'stock_actual' },
    ])
    escribirYEnviar('hay stock?')

    expect(await screen.findByText(/Mirando el stock/)).toBeInTheDocument()
    expect(screen.queryByText(/Voy a fijarme/)).toBeNull()
    await act(() => Promise.resolve(estado.soltar?.()))
  })

  /* Y cuando llega, manda el texto del final: el de los deltas era provisorio. */
  it('la respuesta final reemplaza a lo que se vino mostrando', async () => {
    montar()
    estado.respuesta = {
      texto: 'La respuesta de verdad.',
      pasos: [],
      llamadas: 3,
      corte: 'ninguno',
      propuesta: null,
      productos: [],
    }
    estado.avisos = [{ tipo: 'delta', texto: 'algo provisorio' }]
    escribirYEnviar('x')

    expect(await screen.findByText('La respuesta de verdad.')).toBeInTheDocument()
    expect(screen.queryByText(/algo provisorio/)).toBeNull()
    estado.respuesta = null
  })
})
