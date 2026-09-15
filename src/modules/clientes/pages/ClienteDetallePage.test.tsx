// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ClienteDetalle, ContactoCliente, DireccionCliente } from '../types'

const estado = vi.hoisted(() => ({
  rol: 'admin',
  cliente: null as unknown as ClienteDetalle,
  contactos: [] as ContactoCliente[],
  direcciones: [] as DireccionCliente[],
}))
const mutaciones = vi.hoisted(() => ({ dar: vi.fn(), reactivar: vi.fn(), guardar: vi.fn(), revision: vi.fn() }))

vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1', companyName: 'ZZ', rol: estado.rol, esInterno: true, customerId: null } }),
}))
vi.mock('../hooks/useClientes', () => ({
  useCliente: () => ({ data: estado.cliente, isPending: false, isFetching: false, error: null, refetch: vi.fn() }),
  useContactos: () => ({ data: estado.contactos, isPending: false }),
  useHistorial: () => ({ data: [], isPending: false }),
  useRelacionados: () => ({ data: { direcciones: estado.direcciones, candidatosDeOc: [] }, isPending: false }),
}))
vi.mock('../hooks/useEdicionClientes', () => ({
  useActualizarCliente: () => ({ mutate: mutaciones.guardar, isPending: false, error: null }),
  useBajaCliente: () => ({ dar: { mutate: mutaciones.dar, isPending: false, error: null }, reactivar: { mutate: mutaciones.reactivar, isPending: false, error: null } }),
  useResolverRevision: () => ({ mutate: mutaciones.revision, isPending: false, error: null }),
}))
// Los paneles de cada pestaña tienen sus propias consultas: acá sólo importa la ficha.
vi.mock('../components/PanelResumen', () => ({ PanelResumen: () => <p>métricas</p> }))
vi.mock('../components/EditorContactos', () => ({ EditorContactos: () => <p>editor de contactos</p> }))
vi.mock('../components/EditorDirecciones', () => ({ EditorDirecciones: () => <p>editor de direcciones</p> }))
vi.mock('../components/PanelMemoria', () => ({ PanelMemoria: () => <p>memoria</p> }))
vi.mock('../components/PanelPrecios', () => ({ PanelPrecios: () => <p>precios</p> }))
vi.mock('../components/PanelHistorial', () => ({ PanelHistorial: () => <p>historial</p> }))
vi.mock('../components/PanelRelacionados', () => ({ PanelRelacionados: () => <p>relacionados</p> }))

const { ClienteDetallePage } = await import('./ClienteDetallePage')

const base: ClienteDetalle = {
  id: 'c1',
  referencia: 'CLI00001',
  razonSocial: 'ZZ Cliente Uno SA',
  nombreComercial: 'ZZ Uno',
  nombreLegacy: null,
  cuit: '30712345671',
  emails: ['compras@zz.test'],
  dominios: ['zz.test'],
  rubro: 'ZZ Metalmecánica',
  telefono: '011 5555-0000',
  tipo: 'business',
  estado: 'active',
  condicionDePago: '30 días',
  monedaPorDefecto: 'USD',
  descuentoPct: 0,
  limiteDeCredito: null,
  vendedor: null,
  notas: null,
  esHistorico: false,
  origenLegacy: null,
  necesitaRevision: false,
  motivosRevision: [],
  dadoDeBaja: false,
  creadoEn: '2026-09-01T00:00:00Z',
}

const montar = () =>
  render(
    <MemoryRouter initialEntries={['/clientes/c1']}>
      <Routes>
        <Route path="/clientes/:id" element={<ClienteDetallePage />} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  estado.rol = 'admin'
  estado.cliente = { ...base }
  estado.contactos = [{ id: 'k1', nombre: 'ZZ Ana', cargo: 'Compras', email: null, telefono: null, fax: null, esPrincipal: true, notas: null }]
  estado.direcciones = [{ id: 'd1', tipo: 'both', calle: 'ZZ Calle 1', ciudad: null, provincia: null, codigoPostal: null, pais: 'AR', notas: null, esPrincipal: true, texto: 'ZZ Calle 1, AR' }]
  vi.clearAllMocks()
})

describe('Ficha del cliente (Fase 13 · E4)', () => {
  it('jerarquía: identidad → contacto → actividad → pestañas; datos como lista, no como campos', () => {
    montar()
    expect(screen.getByRole('heading', { level: 1, name: 'ZZ Uno' })).toBeInTheDocument()
    const secciones = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(secciones.slice(0, 3)).toEqual(['Contacto', 'Actividad', 'Datos comerciales'])
    const contacto = screen.getByRole('region', { name: 'Contacto' })
    expect(within(contacto).getByText('ZZ Ana')).toBeInTheDocument()
    expect(within(contacto).getByRole('link', { name: 'compras@zz.test' })).toHaveAttribute('href', 'mailto:compras@zz.test')
    expect(within(contacto).getByText('30-71234567-1')).toBeInTheDocument()
    expect(within(contacto).getByText('ZZ Calle 1, AR')).toBeInTheDocument()
    expect(within(contacto).queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('tablist', { name: 'Secciones de la ficha' })).toBeInTheDocument()
  })

  it('cliente con poca información: faltantes con texto, nunca vacío, null ni undefined', () => {
    estado.cliente = { ...base, nombreComercial: null, referencia: null, cuit: null, emails: [], dominios: [], rubro: null, telefono: null, condicionDePago: null, monedaPorDefecto: null }
    estado.contactos = []
    estado.direcciones = []
    const { container } = montar()
    for (const t of ['Sin contactos', 'Sin emails', 'Sin teléfono', 'Sin CUIT', 'Sin direcciones', 'Sin rubro', 'Sin dominios', 'Sin notas']) {
      expect(screen.getByText(t)).toBeInTheDocument()
    }
    expect(container).not.toHaveTextContent(/undefined|null|NaN/)
  })

  it.each([
    ['admin', true],
    ['salesperson', true],
    ['technician', false],
  ])('%s: Editar y Dar de baja visibles = %s (mismos permisos que antes)', (rol, ve) => {
    estado.rol = rol
    montar()
    expect(!!screen.queryByRole('button', { name: 'Editar' })).toBe(ve)
    expect(!!screen.queryByRole('button', { name: 'Dar de baja' })).toBe(ve)
  })

  it('Dar de baja pide confirmación accesible (foco en «Volver»), nunca window.confirm', () => {
    const nativo = vi.spyOn(window, 'confirm')
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Dar de baja' }))
    const dialogo = screen.getByRole('alertdialog', { name: '¿Dar de baja a ZZ Uno?' })
    expect(dialogo).toHaveAccessibleDescription(/No se borra/)
    expect(screen.getByRole('button', { name: 'Volver' })).toHaveFocus()
    expect(mutaciones.dar).not.toHaveBeenCalled()
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Dar de baja' }))
    expect(mutaciones.dar).toHaveBeenCalledTimes(1)
    expect(nativo).not.toHaveBeenCalled()
  })

  it('Editar abre el formulario en su pestaña con los datos del cliente', () => {
    montar()
    fireEvent.click(screen.getByRole('tab', { name: /Contactos/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    expect(screen.getByRole('tab', { name: 'Datos comerciales' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('textbox', { name: /Razón social/ })).toHaveValue('ZZ Cliente Uno SA')
  })

  it('dado de baja: aviso, badge y Reactivar en lugar de Editar', () => {
    estado.cliente = { ...base, dadoDeBaja: true }
    montar()
    expect(screen.getByText('Cliente dado de baja')).toBeInTheDocument()
    expect(screen.getAllByText('Dado de baja').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Reactivar' }))
    expect(mutaciones.reactivar).toHaveBeenCalled()
  })
})
