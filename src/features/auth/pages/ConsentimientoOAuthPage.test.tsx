// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Decision, Pedido } from '@/services/auth/oauthConsentimiento'
import type * as Servicio from '@/services/auth/oauthConsentimiento'

/* El servicio se reemplaza y el test mira la pantalla. El SDK no se toca. */
const servicio = vi.hoisted(() => ({
  leerPedido: vi.fn<(id: string) => Promise<Pedido>>(),
  aprobar: vi.fn<(id: string) => Promise<Decision>>(),
  rechazar: vi.fn<(id: string) => Promise<Decision>>(),
}))

/* El servicio real importa el cliente de Supabase, que valida el entorno al
   cargarse, y acá se carga de verdad para usar sus funciones puras. Sin este
   mock el test exige variables VITE_* y falla en la suite aislada y en CI,
   donde no existen. Ver ADR-019. */
vi.mock('@/services/supabase/client', () => ({ supabase: {} }))

vi.mock('@/services/auth/oauthConsentimiento', async () => {
  // `idDeLaUrl` y `alcancesDe` son puras: se usan DE VERDAD, así que el test
  // también comprueba que la página lea bien el id de la URL.
  const real = await vi.importActual<typeof Servicio>('@/services/auth/oauthConsentimiento')
  return { ...real, ...servicio }
})

const { ConsentimientoOAuthPage } = await import('./ConsentimientoOAuthPage')

/** `window.location.replace` no existe de verdad en jsdom. */
const irA = vi.fn<(url: string) => void>()

function enLaUrl(href: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href, replace: irA, origin: 'https://app.buscatools.com' },
  })
}

const PEDIDO: Pedido = {
  clase: 'consentir',
  id: 'auth-1',
  cliente: { nombre: 'ChatGPT', uri: 'https://chatgpt.com', logo: '' },
  alcances: ['erp'],
  correo: 'jano@buscatools.com.ar',
  destino: 'https://chatgpt.com/aip/g-abc123/oauth/callback',
}

beforeEach(() => {
  vi.clearAllMocks()
  enLaUrl('https://app.buscatools.com/#/oauth/consent?authorization_id=auth-1')
  servicio.leerPedido.mockResolvedValue(PEDIDO)
  servicio.aprobar.mockResolvedValue({ ok: true, url: 'https://chatgpt.com/cb?code=xyz' })
  servicio.rechazar.mockResolvedValue({ ok: true, url: 'https://chatgpt.com/cb?error=denied' })
})

describe('la pantalla de consentimiento', () => {
  it('lee el id de adentro del hash y pide el pedido', async () => {
    render(<ConsentimientoOAuthPage />)
    await waitFor(() => expect(servicio.leerPedido).toHaveBeenCalledWith('auth-1'))
  })

  /* La app usa un router de hash, pero Supabase puede mandar el query afuera. */
  it('también lo lee del query de verdad', async () => {
    enLaUrl('https://app.buscatools.com/oauth/consent?authorization_id=auth-2')
    render(<ConsentimientoOAuthPage />)
    await waitFor(() => expect(servicio.leerPedido).toHaveBeenCalledWith('auth-2'))
  })

  it('dice quién pide y con qué cuenta', async () => {
    render(<ConsentimientoOAuthPage />)
    expect(await screen.findByRole('heading')).toHaveTextContent('ChatGPT quiere entrar con tu cuenta')
    expect(screen.getByText(/jano@buscatools\.com\.ar/)).toBeInTheDocument()
  })

  /*
   * ── EL TEST QUE IMPORTA ───────────────────────────────────────────────────
   *
   * El nombre y el logo los elige quien registra el cliente: una app que se
   * llame «ChatGPT» con su logo se registra en dos minutos. Lo único que no se
   * puede falsificar es a DÓNDE vuelve, así que tiene que estar a la vista y
   * completo, no detrás de un «ver detalles».
   */
  it('muestra el destino completo, que es el único dato que no se puede falsificar', async () => {
    render(<ConsentimientoOAuthPage />)
    expect(
      await screen.findByText('https://chatgpt.com/aip/g-abc123/oauth/callback'),
    ).toBeInTheDocument()
    expect(screen.getByText(/no es la aplicación que estabas usando, cancelá/i)).toBeInTheDocument()
  })

  it('dice que va a poder leer lo mismo que vos, no «acceder a tu cuenta»', async () => {
    render(<ConsentimientoOAuthPage />)
    expect(await screen.findByText(/leer lo mismo que vos/i)).toBeInTheDocument()
  })

  it('al conectar, aprueba y se va a donde dijo Supabase', async () => {
    render(<ConsentimientoOAuthPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Conectar' }))

    await waitFor(() => expect(servicio.aprobar).toHaveBeenCalledWith('auth-1'))
    expect(irA).toHaveBeenCalledWith('https://chatgpt.com/cb?code=xyz')
    expect(servicio.rechazar).not.toHaveBeenCalled()
  })

  it('al cancelar, rechaza y también vuelve', async () => {
    render(<ConsentimientoOAuthPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))

    await waitFor(() => expect(servicio.rechazar).toHaveBeenCalledWith('auth-1'))
    expect(irA).toHaveBeenCalledWith('https://chatgpt.com/cb?error=denied')
    expect(servicio.aprobar).not.toHaveBeenCalled()
  })

  /*
   * Preguntar de nuevo por algo que ya se aprobó enseña a aprobar sin leer,
   * que es justo lo que no se quiere de una pantalla de consentimiento.
   */
  it('si ya había consentido, se va derecho sin pintar nada', async () => {
    servicio.leerPedido.mockResolvedValue({ clase: 'listo', url: 'https://chatgpt.com/cb?code=ya' })
    render(<ConsentimientoOAuthPage />)

    await waitFor(() => expect(irA).toHaveBeenCalledWith('https://chatgpt.com/cb?code=ya'))
    expect(screen.queryByRole('button', { name: 'Conectar' })).not.toBeInTheDocument()
  })

  it('sin id en la URL explica que no hay nada que aprobar', async () => {
    enLaUrl('https://app.buscatools.com/#/oauth/consent')
    render(<ConsentimientoOAuthPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/no hay nada que aprobar/i)
    expect(servicio.leerPedido).not.toHaveBeenCalled()
  })

  it('un pedido vencido se explica en castellano, no con un código', async () => {
    servicio.leerPedido.mockResolvedValue({ clase: 'error', mensaje: 'Ya lo resolviste o venció.' })
    render(<ConsentimientoOAuthPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Ya lo resolviste o venció.')
  })

  /* Si falla el aprobado, la persona se queda en la pantalla y puede reintentar. */
  it('si no se pudo autorizar, lo dice y no redirige', async () => {
    servicio.aprobar.mockResolvedValue({ ok: false, mensaje: 'No se pudo autorizar. Probá de nuevo.' })
    render(<ConsentimientoOAuthPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Conectar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo autorizar')
    expect(irA).not.toHaveBeenCalled()
    // Y el botón vuelve a estar disponible.
    expect(screen.getByRole('button', { name: 'Conectar' })).toBeEnabled()
  })

  /* Dos clics seguidos no pueden mandar dos aprobados. */
  it('mientras decide, los dos botones quedan bloqueados', async () => {
    let soltar: (d: Decision) => void = () => {}
    servicio.aprobar.mockReturnValue(
      new Promise<Decision>((r) => {
        soltar = r
      }),
    )
    render(<ConsentimientoOAuthPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Conectar' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled())
    soltar({ ok: true, url: 'https://chatgpt.com/cb?code=xyz' })
    await waitFor(() => expect(servicio.aprobar).toHaveBeenCalledTimes(1))
  })
})
