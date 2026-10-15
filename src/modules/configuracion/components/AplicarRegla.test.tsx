// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReglaCorreo } from '../lib/reglasCorreo'
import type * as Servicio from '../services/reglasCorreo'
import type { PasadaDeRegla } from '../services/reglasCorreo'

/**
 * Aplicar una regla a los correos que ya están (Fase 70 · E3).
 *
 * Lo que hay que probar es el orden: PRIMERO MIRA y recién después puede
 * hacer. Una regla mal escrita sobre dos mil correos es difícil de deshacer
 * —«sacarlo de la bandeja», sobre todo—, así que el botón de aplicar no puede
 * existir antes de que alguien haya visto qué va a pasar.
 *
 * Y que recorra TODAS las tandas: el servidor contesta de a doscientos porque
 * una regla con «es cliente» tarda 6,5 ms por hilo y no entra en una sola
 * consulta. Si la pantalla se quedara con la primera tanda, diría «listo»
 * habiendo mirado una décima parte del correo.
 */
const llamadas = vi.hoisted(() => ({ previas: [] as number[], aplicadas: [] as number[] }))

const tanda = (desde: number, mirados: number, total: number, coinciden: number): PasadaDeRegla => ({
  regla: 'Avisos de STEL',
  simulado: true,
  total,
  desde,
  mirados,
  quedan: Math.max(total - (desde + mirados), 0),
  coinciden,
  acciones: coinciden > 0 ? { etiquetar: coinciden } : {},
  ejemplos:
    coinciden > 0
      ? [
          {
            asunto: 'Nuevo dispositivo autorizado',
            de: 'no-reply@messaging.stelorder.com',
            fecha: '2026-10-15T16:02:40Z',
            que: [{ tipo: 'etiquetar', detalle: 'Avisos' }],
          },
        ]
      : [],
})

vi.mock('../services/reglasCorreo', async (original) => {
  const real = await original<typeof Servicio>()
  return {
    ...real,
    previsualizarRegla: (id: string, desde = 0) => {
      llamadas.previas.push(desde)
      const mirados = desde === 400 ? 100 : 200
      // 500 hilos en tres tandas de 200, 200 y 100. La regla «vacia» no
      // encuentra nada, que es el otro caso que hay que dibujar.
      const coinciden = id === 'vacia' ? 0 : desde === 0 ? 3 : desde === 200 ? 1 : 0
      return Promise.resolve(tanda(desde, mirados, 500, coinciden))
    },
    aplicarReglaAhora: (_id: string, desde = 0) => {
      llamadas.aplicadas.push(desde)
      return Promise.resolve({ ...tanda(desde, desde === 400 ? 100 : 200, 500, desde === 0 ? 3 : desde === 200 ? 1 : 0), simulado: false })
    },
  }
})

const { AplicarRegla } = await import('./AplicarRegla')

const REGLA: ReglaCorreo = {
  id: 'r1',
  nombre: 'Avisos de STEL',
  activa: true,
  orden: 10,
  condiciones: [{ campo: 'de', op: 'contiene', valor: 'stelorder.com' }],
  acciones: [{ tipo: 'etiquetar', labelId: 'l1' }],
}

function montar() {
  llamadas.previas.length = 0
  llamadas.aplicadas.length = 0
  render(<AplicarRegla regla={REGLA} onCerrar={() => {}} onAplicada={() => {}} />)
}

describe('AplicarRegla', () => {
  it('al abrir mira, recorre todas las tandas y no aplica nada', async () => {
    montar()

    expect(await screen.findByText(/Coinciden 4 de 500/)).toBeInTheDocument()
    // Las tres tandas, pedidas desde donde terminó la anterior.
    expect(llamadas.previas).toEqual([0, 200, 400])
    // Y ni una sola llamada a la que escribe.
    expect(llamadas.aplicadas).toEqual([])
  })

  it('dice qué va a pasar, con ejemplos, antes de que haya que decidir', async () => {
    montar()
    expect(await screen.findByText(/Se haría: 4 etiquetas/)).toBeInTheDocument()
    expect(screen.getByText('Nuevo dispositivo autorizado')).toBeInTheDocument()
    expect(screen.getByText(/no se pisa/i)).toBeInTheDocument()
  })

  it('recién después de mirar aparece el botón de aplicar, y dice a cuántos', async () => {
    montar()
    const boton = await screen.findByRole('button', { name: /Aplicar a 4 correos/ })

    fireEvent.click(boton)
    await waitFor(() => expect(screen.getByText(/Listo: 4 correos/)).toBeInTheDocument())
    expect(llamadas.aplicadas).toEqual([0, 200, 400])
    expect(screen.getByText(/Se hizo: 4 etiquetas/)).toBeInTheDocument()
  })

  /* Sin coincidencias no hay nada que aplicar: el botón no tiene que estar,
     porque un botón que no va a hacer nada igual se aprieta. */
  it('si no coincide ninguno, lo dice y no ofrece aplicar', async () => {
    llamadas.previas.length = 0
    render(<AplicarRegla regla={{ ...REGLA, id: 'vacia' }} onCerrar={() => {}} onAplicada={() => {}} />)

    expect(await screen.findByText(/Ningún correo coincide/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Aplicar a/ })).toBeNull()
  })
})
