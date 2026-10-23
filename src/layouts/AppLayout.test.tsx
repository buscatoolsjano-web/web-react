// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { iniciales, nombreVisible } from './sesion'

interface EstadoPrueba {
  ancho: number
  rol: string | null
  membresias: number
  cargando: boolean
  error: Error | null
  sesion: boolean
}
const estado = vi.hoisted<EstadoPrueba>(() => ({
  ancho: 1280,
  rol: 'admin',
  membresias: 1,
  cargando: false,
  error: null,
  sesion: true,
}))
const llamadas = vi.hoisted(() => ({ salir: vi.fn(), reintentar: vi.fn(), cambiar: vi.fn(), cambiarApariencia: vi.fn() }))

/* El árbol de este test llega al cliente de Supabase, que valida el entorno al
   cargarse. Sin este mock el test exige variables VITE_* y falla en la suite
   aislada y en CI, donde no existen. Ver ADR-019. */
vi.mock('@/services/supabase/client', () => ({ supabase: {} }))

vi.mock('@/hooks/useMediaQuery', () => ({
  useIsMobile: () => estado.ancho < 768,
  useMediaQuery: (q: string) => (q.includes('1023') ? estado.ancho >= 768 && estado.ancho < 1024 : false),
}))
vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({
    session: estado.sesion ? { user: { id: 'u1' } } : null,
    user: estado.sesion ? { email: 'jano@buscatools.test', user_metadata: { full_name: 'Jano Prueba' } } : null,
    cargando: false,
    salir: llamadas.salir,
  }),
}))
vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => {
    const lista = Array.from({ length: estado.rol ? estado.membresias : 0 }, (_, i) => ({
      companyId: `c${i}`,
      companyName: i === 0 ? 'Buscatools' : 'Torquetools',
      companySlug: '',
      rol: i === 0 ? estado.rol : 'salesperson',
      esInterno: true,
      customerId: null,
    }))
    return { membresias: lista, activa: lista[0] ?? null, cargando: estado.cargando, error: estado.error, cambiarEmpresa: llamadas.cambiar, reintentar: llamadas.reintentar }
  },
}))

// Los contadores de sin leer del menú consultan la base (Fase 27 · E3). Acá
// se prueba la NAVEGACIÓN, no los contadores: se mockean para no arrastrar el
// cliente de Supabase ni exigir un QueryClient.
vi.mock('./useNoLeidos', () => ({ useNoLeidos: () => ({ emails: 0, whatsapp: 0, chat: 0, consultas: 0 }) }))
// El shell monta el chat en vivo (Fase 130). Acá se prueba la navegación, no el
// realtime: se stubea para no arrastrar el canal de Supabase.
vi.mock('@/modules/chat/hooks/useChat', () => ({
  useRealtimeChat: () => ({ canal: 'conectado', reconectar: () => {} }),
}))
// El latido de presencia habla con supabase (acá mockeado como {}); no es lo
// que se prueba en el shell.
vi.mock('@/modules/chat/hooks/usePresencia', () => ({ usePresencia: () => {} }))
// La campana y el asistente consultan con react-query y este test monta el
// layout sin proveedor. Se mockean igual que los contadores del menú: lo que
// se prueba acá es el shell, no lo que traen.
vi.mock('./BotonesHeader', () => ({ BotonesHeader: () => <div /> }))
vi.mock('@/features/apariencia/useApariencia', () => ({
  useApariencia: () => ({
    apariencia: { version: 1, preset: 'claro-naranja', acento: 'tema', tamano: 'normal', fuente: 'sistema' },
    cambiar: llamadas.cambiarApariencia,
    restaurar: vi.fn(),
    guardando: false,
    error: null,
    disponible: true,
  }),
}))

const { AppLayout } = await import('./AppLayout')

/** Un sello de que se llegó a la portada, para poder mirarlo desde un test. */
function DondeEstoy() {
  return <p data-testid="donde-estoy">/</p>
}

function montar(ruta = '/ventas/pedidos') {
  document.body.innerHTML = '<div id="root"></div>'
  return render(
    /* El ERP entero vive bajo un QueryClientProvider, y desde la Fase 66
       AppLayout también lo necesita: precalienta la primera página del
       catálogo. El arnés refleja lo que hay en producción. */
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="*" element={<h1>Pantalla</h1>} />
          </Route>
          {/* La portada pública (Fase 87 · E2): está FUERA del layout del
              ERP, igual que en producción, porque es a donde tiene que ir
              quien cierra sesión. */}
          <Route path="/" element={<DondeEstoy />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
    { container: document.getElementById('root')! },
  )
}

beforeEach(() => {
  Object.assign(estado, { ancho: 1280, rol: 'admin', membresias: 1, cargando: false, error: null, sesion: true })
  vi.clearAllMocks()
  document.body.style.overflow = ''
})

describe('header', () => {
  it('logo oficial con nombre accesible, empresa activa visible y sin hamburguesa en desktop', () => {
    montar()
    const marca = screen.getByRole('link', { name: 'Buscatools ERP, ir al inicio' })
    expect(marca).toHaveAttribute('href', '/inicio')
    expect(marca.querySelector('img')).toHaveAttribute('src', expect.stringMatching(/brand\/buscatools-logo\.png$/))
    expect(marca.querySelector('img')).toHaveAttribute('alt', '')
    expect(screen.getByText('Buscatools')).toBeInTheDocument()
    expect(screen.getByText('Administrador')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Abrir menú' })).toBeNull()
  })

  it('con dos empresas, selector etiquetado que cambia la empresa activa', () => {
    estado.membresias = 2
    montar()
    const sel = screen.getByRole('combobox', { name: 'Empresa activa' })
    expect(within(sel).getByRole('option', { name: 'Torquetools · Vendedor' })).toBeInTheDocument()
    fireEvent.change(sel, { target: { value: 'c1' } })
    expect(llamadas.cambiar).toHaveBeenCalledWith('c1')
  })

  it('menú de usuario: abre, muestra identidad, Escape cierra y devuelve el foco; «Cerrar sesión» sale', async () => {
    montar()
    const boton = screen.getByRole('button', { name: 'Cuenta de Jano Prueba' })
    expect(boton).toHaveTextContent('JP')
    expect(boton).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(boton)
    expect(boton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('jano@buscatools.test')).toBeVisible()
    expect(screen.getByText('Buscatools · Administrador')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(boton).toHaveAttribute('aria-expanded', 'false')
    expect(boton).toHaveFocus()
    fireEvent.click(boton)
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    // Con await: salir pasó a navegar PRIMERO a la portada y cerrar la
    // sesión después, así que ya no ocurre en el mismo tick del clic.
    await waitFor(() => expect(llamadas.salir).toHaveBeenCalled())
  })

  /*
   * Salir deja a la persona en la portada, no en el login (Fase 87 · E2).
   *
   * «Recién cerré sesión y me llevó al login. Quiero que me lleve al inicio,
   * a lo que vería el usuario.» El login es un trámite, no un destino.
   *
   * Y el ORDEN es lo único delicado: primero se navega a `/` —que es
   * pública— y recién después se cierra la sesión. Al revés, `ProtectedRoute`
   * vería la sesión caída estando todavía en una ruta del ERP y mandaría al
   * login, que aparecería un instante antes de la portada.
   */
  it('cerrar sesión lleva a la portada, y llega ANTES de cerrarla', async () => {
    // Dónde estaba parada la pantalla en el instante en que se cerró la
    // sesión. Si todavía estaba en el ERP, el login va a aparecer.
    let dondeAlCerrar: string | null = null
    llamadas.salir.mockImplementation(() => {
      dondeAlCerrar = document.querySelector('[data-testid="donde-estoy"]') ? '/' : 'el ERP'
    })

    montar('/ventas/pedidos')
    fireEvent.click(screen.getByRole('button', { name: /jano/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))

    await waitFor(() => expect(screen.getByTestId('donde-estoy')).toBeInTheDocument())
    await waitFor(() => expect(llamadas.salir).toHaveBeenCalled())
    expect(dondeAlCerrar).toBe('/')
  })
})

describe('sidebar desktop (≥ 1024)', () => {
  it('grupos con título y el módulo de la ruta activa desplegado', () => {
    montar('/ventas/pedidos/123')
    const nav = screen.getByRole('navigation', { name: 'Principal' })
    for (const g of ['Operación', 'Datos', 'Comunicación', 'Análisis', 'Administración']) expect(within(nav).getByText(g)).toBeInTheDocument()
    const ventas = within(nav).getByRole('button', { name: 'Ventas' })
    expect(ventas).toHaveAttribute('aria-expanded', 'true')
    expect(within(nav).getByRole('link', { name: 'Pedidos' })).toHaveAttribute('aria-current', 'page')
    const compras = within(nav).getByRole('button', { name: 'Compras' })
    expect(compras).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(compras)
    expect(compras).toHaveAttribute('aria-expanded', 'true')
    expect(within(nav).getByRole('link', { name: 'Facturas' })).toBeVisible()
    // Fase 16: WhatsApp dejó de ser «próximamente» y ahora es un enlace real.
    expect(within(nav).getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', '/whatsapp')
  })

  it('el rol filtra igual que antes: un vendedor no ve Compras, Mantenimiento, Emails, Informes ni Configuración', () => {
    estado.rol = 'salesperson'
    montar('/inicio')
    const nav = screen.getByRole('navigation', { name: 'Principal' })
    expect(within(nav).getByRole('button', { name: 'Ventas' })).toBeInTheDocument()
    for (const n of ['Compras', 'Mantenimiento']) expect(within(nav).queryByRole('button', { name: n })).toBeNull()
    for (const n of ['Emails', 'Informes', 'Configuración']) expect(within(nav).queryByRole('link', { name: n })).toBeNull()
    expect(within(nav).getByRole('link', { name: 'Clientes' })).toBeInTheDocument()
  })
})

describe('tablet 768–1023: barra compacta', () => {
  it('íconos con nombre accesible; un módulo abre el panel completo con ese módulo desplegado', () => {
    estado.ancho = 900
    montar('/clientes')
    expect(screen.getByRole('link', { name: 'Clientes' })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(screen.getByRole('button', { name: 'Compras' }))
    const cajon = screen.getByRole('dialog', { name: 'Menú principal' })
    expect(within(cajon).getByRole('button', { name: 'Compras' })).toHaveAttribute('aria-expanded', 'true')
    expect(within(cajon).getByRole('link', { name: 'Proveedores' })).toBeVisible()
  })
})

describe('mobile < 768: cajón', () => {
  it('hamburguesa abre; foco adentro; resto inert; Escape cierra y devuelve el foco', () => {
    estado.ancho = 390
    montar('/inicio')
    expect(screen.queryByRole('navigation', { name: 'Principal' })).toBeNull()
    const ham = screen.getByRole('button', { name: 'Abrir menú' })
    ham.focus()
    fireEvent.click(ham)
    const cajon = screen.getByRole('dialog', { name: 'Menú principal' })
    expect(cajon.contains(document.activeElement)).toBe(true)
    expect(document.querySelector('main')).toHaveAttribute('inert')
    expect(document.querySelector('header')).toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.querySelector('main')).not.toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('')
    expect(ham).toHaveFocus()
  })

  it('elegir un destino cierra el cajón', () => {
    estado.ancho = 390
    montar('/inicio')
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Catálogo' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Pantalla' })).toBeInTheDocument()
  })
})

describe('estado de la empresa activa', () => {
  it('con empresa muestra la pantalla', () => {
    montar()
    expect(screen.getByRole('heading', { level: 1, name: 'Pantalla' })).toBeInTheDocument()
  })

  it('cargando: estado anunciado, no la pantalla', () => {
    estado.cargando = true
    montar()
    expect(screen.getByRole('status')).toHaveTextContent('Cargando tu empresa…')
    expect(screen.queryByText('Pantalla')).toBeNull()
  })

  it('sin empresa: estado explícito con reintentar y cerrar sesión (antes «Cargando…» infinito)', async () => {
    estado.rol = null
    montar()
    expect(screen.getByRole('heading', { level: 1, name: 'Tu usuario no tiene una empresa activa' })).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: 'Reintentar' }))
    expect(llamadas.reintentar).toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: 'Cerrar sesión' }))
    await waitFor(() => expect(llamadas.salir).toHaveBeenCalled())
  })

  it('error al leer membresías: alerta humana sin detalle técnico', () => {
    estado.rol = null
    estado.error = new Error('No se pudieron leer las empresas: JWT expired 42501')
    montar()
    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos leer tus empresas.')
    expect(document.body.textContent).not.toMatch(/JWT|42501/)
  })
})

describe('sesión (utilidades)', () => {
  it('iniciales y nombre visible', () => {
    expect(iniciales('Jano Prueba', 'x@y')).toBe('JP')
    expect(iniciales('Norberto', 'x@y')).toBe('NO')
    expect(iniciales(null, 'ana@b.test')).toBe('A')
    expect(nombreVisible({ user_metadata: { full_name: '  Ana  ' } })).toBe('Ana')
    expect(nombreVisible({ user_metadata: { full_name: 42 } })).toBeNull()
    expect(nombreVisible(null)).toBeNull()
  })
})

describe('apariencia e identidad por módulo (Fase 14)', () => {
  it('«Apariencia» en el header abre el diálogo accesible y un tema se elige con el radio', async () => {
    montar()
    const boton = within(screen.getByRole('banner')).getByRole('button', { name: 'Apariencia' })
    fireEvent.click(boton)
    // El diálogo se carga bajo demanda (lazy).
    // El diálogo es lazy: con la suite completa en paralelo su carga puede pasar
    // de 5 s en una máquina cargada, y el test se volvía intermitente.
    const dialogo = await screen.findByRole('dialog', { name: 'Apariencia' }, { timeout: 15_000 })
    expect(within(dialogo).getByRole('group', { name: 'Tema' })).toBeInTheDocument()
    expect(within(dialogo).getByRole('radio', { name: 'Claro naranja, tema claro (original)' })).toBeChecked()
    fireEvent.click(within(dialogo).getByRole('radio', { name: 'Grafito, tema oscuro' }))
    expect(llamadas.cambiarApariencia).toHaveBeenCalledWith({ preset: 'grafito' })
  })

  it('data-modulo en <html>: ventas, compras, mantenimiento; nada en otros módulos y se limpia al salir', () => {
    const casos: [string, string | undefined][] = [
      ['/ventas/cotizaciones', 'ventas'],
      ['/compras/pedidos', 'compras'],
      ['/mantenimiento/ordenes', 'mantenimiento'],
      ['/catalogo', undefined],
      ['/clientes', undefined],
      ['/emails', undefined],
      ['/informes', undefined],
      ['/configuracion/numeracion', undefined],
      ['/', undefined],
    ]
    for (const [ruta, esperado] of casos) {
      const { unmount } = montar(ruta)
      expect(document.documentElement.dataset.modulo, ruta).toBe(esperado)
      unmount()
      expect(document.documentElement.dataset.modulo).toBeUndefined()
    }
  })
})
