// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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

function montar(ruta = '/ventas/pedidos') {
  document.body.innerHTML = '<div id="root"></div>'
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="*" element={<h1>Pantalla</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
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
    expect(marca).toHaveAttribute('href', '/')
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

  it('menú de usuario: abre, muestra identidad, Escape cierra y devuelve el foco; «Cerrar sesión» sale', () => {
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
    expect(llamadas.salir).toHaveBeenCalled()
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
    expect(within(nav).getByText('WhatsApp').closest('[aria-disabled]')).toHaveAttribute('aria-disabled', 'true')
  })

  it('el rol filtra igual que antes: un vendedor no ve Compras, Mantenimiento, Emails, Informes ni Configuración', () => {
    estado.rol = 'salesperson'
    montar('/')
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
    montar('/')
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
    montar('/')
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

  it('sin empresa: estado explícito con reintentar y cerrar sesión (antes «Cargando…» infinito)', () => {
    estado.rol = null
    montar()
    expect(screen.getByRole('heading', { level: 1, name: 'Tu usuario no tiene una empresa activa' })).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: 'Reintentar' }))
    expect(llamadas.reintentar).toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: 'Cerrar sesión' }))
    expect(llamadas.salir).toHaveBeenCalled()
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
    const dialogo = await screen.findByRole('dialog', { name: 'Apariencia' })
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
