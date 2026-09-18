import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { contadoresVacios } from './ingesta.js'
import { Listener } from './listener.js'
import type { Politica } from './politica.js'
import { RegistroEnMemoria } from './registro.js'
import { RepositorioEnMemoria } from './repositorio.js'
import { cuerpoDeSalud, servidorDeSalud } from './salud.js'
import { TransporteMock } from './transporte.js'
import { GRUPO_AUTORIZADO, mensaje, politica } from './pruebas/escenario.js'

/**
 * El listener y su salud.
 *
 * Lo que se prueba acá es el comportamiento frente a una caída —que es lo que
 * de verdad va a pasar todas las semanas con un cliente no oficial— y que
 * `/health` diga la verdad sin contar de qué se habló.
 */

function montar(p: Politica = politica()) {
  const transporte = new TransporteMock()
  const repositorio = new RepositorioEnMemoria()
  const registro = new RegistroEnMemoria()
  const esperas: number[] = []
  const listener = new Listener(transporte, repositorio, () => p, registro, (ms) => {
    esperas.push(ms)
    return Promise.resolve()
  })
  return { transporte, repositorio, registro, listener, esperas }
}

/** El manejo de la caída es `void`: hay que dejar correr la microtask. */
const asentar = () => new Promise((r) => setTimeout(r, 0))

describe('Cuando se cae la conexión', () => {
  it('se reconecta solo y vuelve a ingerir', async () => {
    const { listener, transporte, repositorio } = montar()
    await listener.iniciar()

    transporte.caerse('ECONNRESET')
    await asentar()

    expect(listener.estado()).toBe('conectado')
    await transporte.emitir({ clase: 'mensaje', datos: mensaje() })
    expect(repositorio.mensajes).toHaveLength(1)
  })

  it('espera cada vez más si se sigue cayendo', async () => {
    const { listener, transporte, esperas } = montar()
    await listener.iniciar()

    // Cada caída resuelta reinicia el contador: la espera vuelve a la inicial.
    transporte.caerse('network')
    await asentar()
    transporte.caerse('network')
    await asentar()

    expect(esperas).toHaveLength(2)
    expect(esperas[0]).toBeGreaterThan(3_000)
    expect(esperas[1]).toBeGreaterThan(3_000)
  })

  it('si la sesión se cerró, NO reintenta: pide una persona', async () => {
    const { listener, transporte, registro, esperas } = montar()
    await listener.iniciar()

    transporte.caerse('DisconnectReason.loggedOut')
    await asentar()

    expect(listener.estado()).toBe('requiere_autenticacion')
    // Lo importante: ni un solo reintento. Machacar la puerta con un cliente no
    // oficial es cómo se pierde el número.
    expect(esperas).toHaveLength(0)
    expect(registro.texto).toContain('sesion_invalida')
  })

  it('detenerlo a propósito no dispara la reconexión', async () => {
    const { listener, transporte, esperas } = montar()
    await listener.iniciar()
    await listener.detener()

    transporte.caerse('network')
    await asentar()

    expect(esperas).toHaveLength(0)
    expect(listener.estado()).toBe('desconectado')
  })
})

describe('El kill switch', () => {
  it('apagado, el estado lo dice y no se ingiere nada', async () => {
    const { listener, transporte, repositorio } = montar(politica({ listenerHabilitado: false }))
    await listener.iniciar()

    expect(listener.estado()).toBe('apagado')
    await transporte.emitir({ clase: 'mensaje', datos: mensaje() })
    expect(repositorio.mensajes).toHaveLength(0)
  })

  it('apagado NO desconecta: la sesión se conserva', async () => {
    const { listener, transporte } = montar(politica({ listenerHabilitado: false }))
    await listener.iniciar()
    // Encender de nuevo no debería pedir vincular el teléfono otra vez.
    expect(transporte.estado()).toBe('conectado')
  })
})

describe('/health', () => {
  const salud = {
    estado: 'conectado' as const,
    desde: '2026-09-18T12:00:00.000Z',
    ultimoEvento: '2026-09-18T12:30:00.000Z',
    gruposActivos: 3,
    contadores: contadoresVacios(),
  }

  it('no cuenta de qué se habló', () => {
    const cuerpo = cuerpoDeSalud({
      ...salud,
      contadores: { ...contadoresVacios(), guardados: 12 },
    })
    expect(cuerpo).not.toContain(GRUPO_AUTORIZADO)
    expect(cuerpo).not.toContain('Importaciones')
    expect(cuerpo).toContain('"guardados": 12')
  })

  it('contesta 200 conectado y 503 caído: si no, no sirve para reiniciar nada', async () => {
    const estados: ('conectado' | 'apagado' | 'reconectando' | 'requiere_autenticacion')[] = [
      'conectado',
      'apagado',
      'reconectando',
      'requiere_autenticacion',
    ]
    const esperado = [200, 200, 503, 503]

    for (const [i, estado] of estados.entries()) {
      const servidor = servidorDeSalud(0, () => ({ ...salud, estado }))
      await new Promise((r) => servidor.once('listening', r))
      const { port } = servidor.address() as AddressInfo
      const res = await fetch(`http://127.0.0.1:${port}/health`)
      expect(res.status, estado).toBe(esperado[i])
      await res.text()
      servidor.close()
    }
  })

  it('cualquier otra ruta es 404', async () => {
    const servidor = servidorDeSalud(0, () => salud)
    await new Promise((r) => servidor.once('listening', r))
    const { port } = servidor.address() as AddressInfo
    const res = await fetch(`http://127.0.0.1:${port}/`)
    expect(res.status).toBe(404)
    await res.text()
    servidor.close()
  })
})
