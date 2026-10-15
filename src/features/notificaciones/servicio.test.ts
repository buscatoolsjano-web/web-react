import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/supabase/client', () => ({ supabase: {} }))

const bandeja = vi.hoisted(() => ({
  asignadosAMi: vi.fn(),
  avisosDeSincronizacion: vi.fn(),
}))
const chat = vi.hoisted(() => ({ listarChats: vi.fn() }))

vi.mock('@/modules/emails/services/bandeja', () => bandeja)
vi.mock('@/modules/chat/services/chat', () => chat)

const { misNotificaciones } = await import('./servicio')

const CORREO = {
  id: 'hilo-abc',
  de: 'no-responder@mercadolibre.com',
  asunto: '¡Vendiste con Mercado Envíos!',
  resumen: 'Venta #2000015538612061',
  cuando: '2026-10-14T18:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  bandeja.asignadosAMi.mockResolvedValue([])
  bandeja.avisosDeSincronizacion.mockResolvedValue([])
  chat.listarChats.mockResolvedValue([])
})

describe('a dónde lleva cada notificación', () => {
  /*
   * ── EL ARREGLO ────────────────────────────────────────────────────────────
   *
   * Llevaba a `/emails`, la bandeja entera. O sea que la notificación te
   * mostraba el correo, lo tocabas, y tenías que volver a buscarlo a mano
   * entre mil noventa hilos. El id es el de `email_threads`, el mismo que usa
   * cada fila del listado para enlazar: las dos cosas salen de
   * `listar_bandeja_email`.
   */
  it('un correo asignado abre ESE correo, no la bandeja', async () => {
    bandeja.asignadosAMi.mockResolvedValue([CORREO])

    const [n] = await misNotificaciones('c1', 'u1')

    expect(n?.destino).toBe('/emails/hilo-abc')
    expect(n?.destino).not.toBe('/emails')
  })

  /*
   * El aviso de sincronización SÍ va a la bandeja, y no es una inconsistencia:
   * no habla de un correo, habla de que dejaron de entrar todos.
   */
  it('un problema de sincronización sí lleva a la bandeja entera', async () => {
    bandeja.avisosDeSincronizacion.mockResolvedValue([
      {
        cuenta: 'info@buscatools.com.ar',
        nivel: 'critico',
        clave: 'push_vencido',
        titulo: 'El correo dejó de entrar',
        detalle: 'Hace 3 días que no llega nada.',
      },
    ])

    const [n] = await misNotificaciones('c1', 'u1')

    expect(n?.tipo).toBe('alerta')
    expect(n?.destino).toBe('/emails')
  })
})

describe('el orden', () => {
  it('los problemas van primero aunque no tengan fecha', async () => {
    bandeja.avisosDeSincronizacion.mockResolvedValue([
      { cuenta: 'x', nivel: 'critico', clave: 'k', titulo: 'Se cortó', detalle: 'd' },
    ])
    bandeja.asignadosAMi.mockResolvedValue([CORREO])

    const tipos = (await misNotificaciones('c1', 'u1')).map((n) => n.tipo)

    expect(tipos[0]).toBe('alerta')
  })

  it('y lo personal, lo más reciente arriba', async () => {
    bandeja.asignadosAMi.mockResolvedValue([
      { ...CORREO, id: 'viejo', cuando: '2026-10-10T10:00:00Z' },
      { ...CORREO, id: 'nuevo', cuando: '2026-10-14T10:00:00Z' },
    ])

    const destinos = (await misNotificaciones('c1', 'u1')).map((n) => n.destino)

    expect(destinos).toEqual(['/emails/nuevo', '/emails/viejo'])
  })
})

/*
 * Tres fuentes independientes. Que una se caiga no puede dejar el panel vacío:
 * mostrar dos de tres es mejor que no mostrar nada y que la persona crea que
 * no tiene nada pendiente.
 */
describe('cuando una fuente falla', () => {
  it('las otras se muestran igual', async () => {
    bandeja.asignadosAMi.mockRejectedValue(new Error('se cayó'))
    chat.listarChats.mockResolvedValue([
      { id: 'c', conQuien: 'Ana', sinLeer: 2, ultimoMensaje: 'hola', ultimoMensajeEn: '2026-10-14T10:00:00Z' },
    ])

    const n = await misNotificaciones('c1', 'u1')

    expect(n.map((x) => x.tipo)).toEqual(['chat'])
  })

  it('y si fallan todas, la lista queda vacía en vez de romper', async () => {
    bandeja.asignadosAMi.mockRejectedValue(new Error('x'))
    bandeja.avisosDeSincronizacion.mockRejectedValue(new Error('x'))
    chat.listarChats.mockRejectedValue(new Error('x'))

    await expect(misNotificaciones('c1', 'u1')).resolves.toEqual([])
  })
})
