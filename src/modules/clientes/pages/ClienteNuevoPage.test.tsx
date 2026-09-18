// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import type { ClienteSimilar } from '../types'

/**
 * Alta de cliente (Fase 17 · E5).
 *
 * Lo que se prueba es el contrato con el servidor: **qué se manda** en el alta,
 * que el contacto y la dirección sean opcionales de verdad, y que lo que la
 * pantalla dice de los duplicados sea lo que corresponde —avisar, y bloquear
 * sólo el CUIT, que es lo único que la base no va a dejar pasar—.
 */

vi.mock('@/services/supabase/client', () => ({ supabase: {} }))

const estado = vi.hoisted(() => ({
  rol: 'admin',
  similares: [] as ClienteSimilar[],
  errorAlCrear: null as Error | null,
}))
const espias = vi.hoisted(() => ({
  crear: vi.fn((_alta: unknown, _opciones?: unknown) => {}),
}))

vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({
    activa: { companyId: 'c1', companyName: 'ZZ', rol: estado.rol, esInterno: true, customerId: null },
  }),
}))
vi.mock('../hooks/useEdicionClientes', () => ({
  useCrearCliente: () => ({
    mutate: espias.crear,
    isPending: false,
    error: estado.errorAlCrear,
  }),
}))
vi.mock('../hooks/useClientes', () => ({
  useClientesSimilares: () => ({ data: estado.similares, isFetching: false }),
  useOpcionesComerciales: () => ({
    vendedores: [{ id: 'u1', nombre: 'ZZ Vendedora' }],
    tarifas: [{ id: 'pl1', nombre: 'ZZ Mayorista' }],
  }),
}))

const { ClienteNuevoPage } = await import('./ClienteNuevoPage')

const similar = (p: Partial<ClienteSimilar> = {}): ClienteSimilar => ({
  id: 'otro',
  razonSocial: 'ZZ Alfa SA',
  nombreComercial: null,
  cuit: '30712345674',
  referencia: 'CLI00042',
  emails: [],
  telefono: null,
  dadoDeBaja: false,
  necesitaRevision: false,
  motivo: 'NOMBRE',
  fuerza: 'debil',
  parecido: 0.8,
  ...p,
})

const montar = () => {
  const router = createMemoryRouter(
    [
      { path: '/clientes/nuevo', element: <ClienteNuevoPage /> },
      { path: '/clientes', element: <p>listado</p> },
      { path: '/clientes/:id', element: <p>ficha del cliente</p> },
    ],
    { initialEntries: ['/clientes/nuevo'] },
  )
  return render(<RouterProvider router={router} />)
}

/** Lo mínimo para que el formulario deje guardar. */
const escribirRazonSocial = (nombre = 'ZZ Cliente Nuevo SA') => {
  fireEvent.change(screen.getByLabelText(/Razón social/), { target: { value: nombre } })
}

const alta = () => espias.crear.mock.calls[0]![0] as {
  datos: { razonSocial: string; vendedorId: string; tarifaId: string }
  contacto: { nombre: string; cargo: string } | null
  direccion: { tipo: string; calle: string } | null
}

beforeEach(() => {
  estado.rol = 'admin'
  estado.similares = []
  estado.errorAlCrear = null
  vi.clearAllMocks()
})

describe('Alta de cliente · lo básico', () => {
  it('con la razón social alcanza: sin contacto ni dirección', () => {
    montar()
    escribirRazonSocial()
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))

    expect(espias.crear).toHaveBeenCalledTimes(1)
    expect(alta().datos.razonSocial).toBe('ZZ Cliente Nuevo SA')
    expect(alta().contacto).toBeNull()
    expect(alta().direccion).toBeNull()
  })

  it('sin tocar nada, Crear está apagado: no se manda un alta vacía', () => {
    montar()
    expect(screen.getByRole('button', { name: 'Crear cliente' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))
    expect(espias.crear).not.toHaveBeenCalled()
  })

  it('sin razón social no llega al servidor', () => {
    montar()
    fireEvent.change(screen.getByLabelText(/Teléfono/), { target: { value: '11 5555' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))
    expect(espias.crear).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('razón social es obligatoria')
  })

  it('el vendedor y la tarifa se eligen desde el alta', () => {
    montar()
    escribirRazonSocial()
    fireEvent.change(screen.getByLabelText(/Vendedor/), { target: { value: 'u1' } })
    fireEvent.change(screen.getByLabelText(/Tarifa/), { target: { value: 'pl1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))

    expect(alta().datos.vendedorId).toBe('u1')
    expect(alta().datos.tarifaId).toBe('pl1')
  })

  it('quien no puede crear clientes no ve el formulario', () => {
    estado.rol = 'technician'
    montar()
    expect(screen.queryByLabelText(/Razón social/)).not.toBeInTheDocument()
    expect(screen.getByText(/no puede dar de alta clientes/i)).toBeInTheDocument()
  })
})

describe('Alta de cliente · contacto y dirección opcionales', () => {
  it('el contacto aparece sólo si se pide, y viaja con el alta', () => {
    montar()
    expect(screen.queryByLabelText(/^Nombre$/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: /Cargar un contacto ahora/ }))
    escribirRazonSocial()
    fireEvent.change(screen.getByLabelText(/^Nombre$/), { target: { value: 'ZZ Ana Pérez' } })
    fireEvent.change(screen.getByLabelText(/Cargo/), { target: { value: 'Compras' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))

    expect(alta().contacto).toMatchObject({ nombre: 'ZZ Ana Pérez', cargo: 'Compras' })
    expect(alta().direccion).toBeNull()
  })

  it('la dirección aparece sólo si se pide, con su tipo', () => {
    montar()
    expect(screen.queryByLabelText(/Calle y número/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: /Cargar una dirección ahora/ }))
    escribirRazonSocial()
    // «Tipo» existe dos veces —el del cliente y el de la dirección—, así que
    // se busca dentro del grupo de la dirección.
    const grupo = screen.getByRole('group', { name: /Primera dirección/ })
    fireEvent.change(within(grupo).getByLabelText(/Calle y número/), {
      target: { value: 'Av. Siempreviva 742' },
    })
    fireEvent.change(within(grupo).getByLabelText(/^Tipo$/), { target: { value: 'billing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))

    expect(alta().direccion).toMatchObject({ tipo: 'billing', calle: 'Av. Siempreviva 742' })
    expect(alta().contacto).toBeNull()
  })

  it('un contacto a medias no llega al servidor', () => {
    montar()
    escribirRazonSocial()
    fireEvent.click(screen.getByRole('checkbox', { name: /Cargar un contacto ahora/ }))
    fireEvent.change(screen.getByLabelText(/Cargo/), { target: { value: 'Compras' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))

    expect(espias.crear).not.toHaveBeenCalled()
    expect(screen.getByText(/nombre del contacto es obligatorio/i)).toBeInTheDocument()
  })

  it('una dirección sin calle tampoco', () => {
    montar()
    escribirRazonSocial()
    fireEvent.click(screen.getByRole('checkbox', { name: /Cargar una dirección ahora/ }))
    fireEvent.change(screen.getByLabelText(/Ciudad/), { target: { value: 'Springfield' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))

    expect(espias.crear).not.toHaveBeenCalled()
    expect(screen.getByText(/calle es obligatoria/i)).toBeInTheDocument()
  })

  it('destildar el contacto lo saca del alta, aunque esté escrito', () => {
    montar()
    escribirRazonSocial()
    fireEvent.click(screen.getByRole('checkbox', { name: /Cargar un contacto ahora/ }))
    fireEvent.change(screen.getByLabelText(/^Nombre$/), { target: { value: 'ZZ Ana' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Cargar un contacto ahora/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))

    expect(alta().contacto).toBeNull()
  })
})

describe('Alta de cliente · duplicados', () => {
  it('un nombre parecido avisa y deja crear igual', () => {
    estado.similares = [similar()]
    montar()
    escribirRazonSocial('ZZ Alfa S.A.')

    const aviso = screen.getByRole('status')
    expect(aviso).toHaveTextContent('Hay un cliente parecido')
    expect(within(aviso).getByRole('link', { name: 'ZZ Alfa SA' })).toHaveAttribute(
      'href',
      '/clientes/otro',
    )
    expect(screen.getByRole('button', { name: 'Crear cliente' })).toBeEnabled()
  })

  it('el mismo CUIT bloquea, y dice dónde está el que ya existe', () => {
    estado.similares = [similar({ motivo: 'CUIT', fuerza: 'fuerte', parecido: 1 })]
    montar()
    escribirRazonSocial()

    expect(screen.getByRole('button', { name: 'Crear cliente' })).toBeDisabled()
    const alertas = screen.getAllByRole('alert')
    expect(alertas.some((a) => a.textContent?.includes('Ya existe un cliente con este CUIT'))).toBe(true)
    expect(alertas.some((a) => a.textContent?.includes('corregí el CUIT'))).toBe(true)
  })

  it('el mismo email avisa, pero no bloquea: puede ser una sucursal', () => {
    estado.similares = [similar({ motivo: 'EMAIL', fuerza: 'media', parecido: 1 })]
    montar()
    escribirRazonSocial()

    expect(screen.getByRole('status')).toHaveTextContent('Mismo email')
    expect(screen.getByRole('button', { name: 'Crear cliente' })).toBeEnabled()
  })

  it('sin candidatos no se dice nada', () => {
    montar()
    escribirRazonSocial()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('en ningún caso se ofrece fusionar', () => {
    estado.similares = [similar({ motivo: 'CUIT', fuerza: 'fuerte' })]
    montar()
    escribirRazonSocial()
    expect(screen.queryByRole('button', { name: /fusionar|unificar|combinar/i })).not.toBeInTheDocument()
  })
})

describe('Alta de cliente · el servidor tiene la última palabra', () => {
  it('un error del servidor se muestra y no navega', async () => {
    estado.errorAlCrear = new Error('Ya hay un cliente con ese CUIT en esta empresa.')
    montar()
    escribirRazonSocial()

    await waitFor(() =>
      expect(screen.getByText('Ya hay un cliente con ese CUIT en esta empresa.')).toBeInTheDocument(),
    )
    expect(screen.queryByText('ficha del cliente')).not.toBeInTheDocument()
  })
})
