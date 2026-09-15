// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { ResultadoEnlace } from '@/services/auth/session'

// Auth real no se toca: los servicios se reemplazan y el test mira la UI.
const auth = vi.hoisted<{ session: { user: { email: string } } | null; cargando: boolean }>(() => ({ session: null, cargando: false }))
const servicios = vi.hoisted(() => ({
  iniciarSesion: vi.fn(),
  solicitarRecuperacion: vi.fn(),
  procesarEnlaceDeAuth: vi.fn(),
  definirContrasena: vi.fn(),
}))

vi.mock('../useAuth', () => ({ useAuth: () => auth }))
vi.mock('@/services/auth/session', () => servicios)
vi.mock('@/services/auth/contrasenaPendiente', () => ({ contrasenaPendiente: () => null }))

const { LoginPage } = await import('./LoginPage')
const { RecuperarPage } = await import('./RecuperarPage')
const { DefinirContrasenaPage, FormularioContrasena } = await import('./DefinirContrasenaPage')
const { AuthLayout } = await import('@/layouts/AuthLayout')

const enLayout = (ruta: string, pagina: ReactNode) =>
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/auth" element={<AuthLayout />}>
          <Route path="*" element={pagina} />
        </Route>
        <Route path="/" element={<p>Inicio del ERP</p>} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  auth.session = null
  auth.cargando = false
  for (const f of Object.values(servicios)) f.mockReset()
})

describe('Layout de Auth', () => {
  it('logo PNG oficial con nombre accesible y el producto «Buscatools ERP»', () => {
    enLayout('/auth/login', <LoginPage />)
    const logo = screen.getByRole('img', { name: 'Buscatools' })
    expect(logo).toHaveAttribute('src', expect.stringMatching(/brand\/buscatools-logo\.png$/))
    expect(screen.getByText('ERP')).toBeInTheDocument()
    expect(screen.getByText('Buscatools ERP · Sistema de gestión interno')).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
  })
})

describe('Login', () => {
  it('campos con label, botón deshabilitado hasta completar y enlace de recuperación táctil', () => {
    enLayout('/auth/login', <LoginPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Iniciar sesión' })).toBeInTheDocument()
    const boton = screen.getByRole('button', { name: 'Ingresar' })
    expect(boton).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'persona@ejemplo.test' } })
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'secreto' } })
    expect(boton).toBeEnabled()
    expect(screen.getByRole('link', { name: '¿Olvidaste tu contraseña?' })).toHaveAttribute('href', '/auth/recuperar')
  })

  it('mismo submit: llama a iniciarSesion y muestra el error como alerta', async () => {
    servicios.iniciarSesion.mockResolvedValue({ ok: false, error: 'Email o contraseña incorrectos.' })
    enLayout('/auth/login', <LoginPage />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'persona@ejemplo.test' } })
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'mal' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }))
    expect(servicios.iniciarSesion).toHaveBeenCalledWith('persona@ejemplo.test', 'mal')
    expect(await screen.findByRole('alert')).toHaveTextContent('Email o contraseña incorrectos.')
  })

  it('con sesión, no muestra el formulario', () => {
    auth.session = { user: { email: 'x@ejemplo.test' } }
    enLayout('/auth/login', <LoginPage />)
    expect(screen.getByText('Inicio del ERP')).toBeInTheDocument()
  })
})

describe('Recuperar contraseña', () => {
  it('éxito genérico: no revela si la cuenta existe', async () => {
    servicios.solicitarRecuperacion.mockResolvedValue('enviado')
    enLayout('/auth/recuperar', <RecuperarPage />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'quien@ejemplo.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }))
    const aviso = await screen.findByRole('status')
    expect(aviso).toHaveTextContent('Si existe una cuenta asociada, vas a recibir un correo.')
    expect(document.body.textContent).not.toMatch(/no existe|no está registrad|no encontramos/i)
    expect(screen.getByRole('link', { name: 'Volver a iniciar sesión' })).toHaveAttribute('href', '/auth/login')
  })

  it('límite y sin red se muestran como alerta', async () => {
    servicios.solicitarRecuperacion.mockResolvedValue('limite')
    enLayout('/auth/recuperar', <RecuperarPage />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'quien@ejemplo.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Se pidieron demasiados correos.')
  })
})

describe('Definir contraseña', () => {
  const conEnlace = (r: ResultadoEnlace) => servicios.procesarEnlaceDeAuth.mockResolvedValue(r)

  it('mientras verifica: estado anunciado', () => {
    servicios.procesarEnlaceDeAuth.mockReturnValue(new Promise(() => {}))
    enLayout('/auth/definir-contrasena', <DefinirContrasenaPage />)
    expect(screen.getByRole('status')).toHaveTextContent('Verificando el enlace…')
  })

  it('enlace vencido: explica y ofrece pedir uno nuevo', async () => {
    conEnlace({ ok: false, codigo: 'enlace_vencido' })
    enLayout('/auth/definir-contrasena', <DefinirContrasenaPage />)
    expect(await screen.findByRole('heading', { level: 1, name: 'El enlace venció' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('El enlace venció o ya se usó.')
    expect(screen.getByRole('link', { name: 'Pedir un enlace nuevo' })).toHaveAttribute('href', '/auth/recuperar')
  })

  it('enlace inválido: otro título, misma salida', async () => {
    conEnlace({ ok: false, codigo: 'enlace_invalido' })
    enLayout('/auth/definir-contrasena', <DefinirContrasenaPage />)
    expect(await screen.findByRole('heading', { level: 1, name: 'El enlace no sirve' })).toBeInTheDocument()
  })

  it('recuperación: formulario con ayuda asociada, validación local y el mismo definirContrasena', async () => {
    auth.session = { user: { email: 'persona@ejemplo.test' } }
    conEnlace({ ok: true, motivo: 'recovery' })
    servicios.definirContrasena.mockResolvedValue({ ok: true })
    enLayout('/auth/definir-contrasena', <DefinirContrasenaPage />)
    expect(await screen.findByRole('heading', { name: 'Elegí una contraseña nueva' })).toBeInTheDocument()
    const nueva = screen.getByLabelText('Contraseña nueva')
    expect(nueva).toHaveAccessibleDescription(/Al menos 8 caracteres/)
    fireEvent.change(nueva, { target: { value: 'corta' } })
    fireEvent.change(screen.getByLabelText('Repetir contraseña'), { target: { value: 'corta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Usá al menos 8 caracteres.')
    expect(servicios.definirContrasena).not.toHaveBeenCalled()
    fireEvent.change(nueva, { target: { value: 'unaClaveLarga1' } })
    fireEvent.change(screen.getByLabelText('Repetir contraseña'), { target: { value: 'unaClaveLarga1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }))
    await waitFor(() => expect(servicios.definirContrasena).toHaveBeenCalledWith('unaClaveLarga1'))
    expect(await screen.findByRole('heading', { name: 'Contraseña guardada' })).toBeInTheDocument()
  })

  it('invitación: título de bienvenida', () => {
    render(
      <MemoryRouter>
        <FormularioContrasena esInvitacion email="nueva@ejemplo.test" />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Bienvenido: elegí tu contraseña' })).toBeInTheDocument()
    expect(screen.getByText('nueva@ejemplo.test')).toBeInTheDocument()
  })
})
