// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import type { ClienteListado, GrupoCuitLegacy } from '../types'

/**
 * La cola de revisión (Fase 17 · E5).
 *
 * Lo que se prueba: que los motivos se lean en castellano, que resolver uno
 * mande exactamente ese motivo, que quien no puede resolver no vea el botón, y
 * que la cola **no ofrezca fusionar ni borrar** — lo único que corresponde acá
 * es abrir el cliente y mirar.
 */

vi.mock('@/services/supabase/client', () => ({ supabase: {} }))

const estado = vi.hoisted(() => ({
  rol: 'admin',
  filas: [] as ClienteListado[],
  total: 0,
  cargando: false,
  errorResolver: null as Error | null,
  // Fase 19 · E3B: la evidencia del CUIT legacy de los de esta página.
  grupos: [] as GrupoCuitLegacy[],
  gruposCargando: false,
}))
const espias = vi.hoisted(() => ({
  resolver: vi.fn((_m?: unknown, _o?: unknown) => {}),
  pedidos: vi.fn((_ids?: readonly string[]) => {}),
}))

vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({
    activa: { companyId: 'c1', companyName: 'ZZ', rol: estado.rol, esInterno: true, customerId: null },
  }),
}))
vi.mock('../hooks/useClientes', () => ({
  useColaDeRevision: () => ({
    data: { filas: estado.filas, total: estado.total },
    isPending: estado.cargando,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
  useGruposCuitLegacy: (ids: readonly string[]) => {
    espias.pedidos(ids)
    return { data: estado.grupos, isPending: estado.gruposCargando, error: null }
  },
}))
vi.mock('../hooks/useEdicionClientes', () => ({
  useResolverRevision: () => ({
    mutate: espias.resolver,
    isPending: false,
    error: estado.errorResolver,
  }),
}))

const { ClientesRevisarPage } = await import('./ClientesRevisarPage')

const cliente = (p: Partial<ClienteListado> = {}): ClienteListado => ({
  id: 'c-uno',
  referencia: 'CLI00042',
  razonSocial: 'ZZ Alfa SA',
  nombreComercial: null,
  cuit: '30712345674',
  emails: [],
  dominios: [],
  rubro: null,
  telefono: null,
  esHistorico: true,
  necesitaRevision: true,
  motivosRevision: ['CUIT_REPETIDO_EN_LEGACY'],
  dadoDeBaja: false,
  ...p,
})

const montar = () => {
  const router = createMemoryRouter(
    [
      { path: '/clientes/revisar', element: <ClientesRevisarPage /> },
      { path: '/clientes', element: <p>listado</p> },
      { path: '/clientes/:id', element: <p>ficha del cliente</p> },
    ],
    { initialEntries: ['/clientes/revisar'] },
  )
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  estado.rol = 'admin'
  estado.filas = [cliente()]
  estado.total = 1
  estado.cargando = false
  estado.errorResolver = null
  estado.grupos = []
  estado.gruposCargando = false
  vi.clearAllMocks()
})

describe('Cola de revisión', () => {
  it('muestra el cliente con su motivo en castellano, no el código', () => {
    montar()
    expect(screen.getByRole('heading', { level: 1, name: 'Clientes para revisar' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ZZ Alfa SA' })).toHaveAttribute('href', '/clientes/c-uno')
    expect(screen.queryByText('CUIT_REPETIDO_EN_LEGACY')).not.toBeInTheDocument()
    // La frase exacta, no un `/CUIT/` suelto: desde la Fase 19 · E3B la
    // tarjeta tiene varios textos con esa palabra y el genérico ya no
    // distingue el motivo de su evidencia.
    expect(
      screen.getByText('El sistema anterior usaba este CUIT en más de una ficha de cliente.'),
    ).toBeInTheDocument()
  })

  it('dice de dónde viene el cliente sin exponer su identidad interna', () => {
    montar()
    expect(screen.getByText(/CLI00042/)).toBeInTheDocument()
    expect(screen.getByText(/migrado del sistema anterior/)).toBeInTheDocument()
  })

  it('resolver manda exactamente el motivo que se apretó', () => {
    estado.filas = [cliente({ motivosRevision: ['CUIT_REPETIDO_EN_LEGACY', 'SOLO_EN_CONTACTOS'] })]
    montar()
    const botones = screen.getAllByRole('button', { name: 'Dar por revisado' })
    expect(botones).toHaveLength(2)
    fireEvent.click(botones[1]!)

    expect(espias.resolver).toHaveBeenCalledTimes(1)
    expect(espias.resolver.mock.calls[0]![0]).toEqual(['SOLO_EN_CONTACTOS'])
  })

  it('siempre ofrece abrir el cliente: revisar es mirar', () => {
    montar()
    // Los motivos también son <li>: se busca la tarjeta por su enlace al cliente.
    const tarjeta = screen.getByRole('link', { name: 'ZZ Alfa SA' }).closest('li')!
    expect(within(tarjeta).getByRole('link', { name: 'Abrir el cliente' })).toBeInTheDocument()
  })

  it('no ofrece fusionar ni borrar', () => {
    montar()
    expect(
      screen.queryByRole('button', { name: /fusionar|unificar|combinar|borrar|eliminar/i }),
    ).not.toBeInTheDocument()
  })

  it('un cliente dado de baja se ve marcado, no escondido', () => {
    estado.filas = [cliente({ dadoDeBaja: true })]
    montar()
    expect(screen.getByText('Dado de baja')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ZZ Alfa SA' })).toBeInTheDocument()
  })

  it('quien no puede resolver la lee pero no la toca', () => {
    estado.rol = 'salesperson'
    montar()
    expect(screen.queryByRole('button', { name: 'Dar por revisado' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ZZ Alfa SA' })).toBeInTheDocument()
  })

  it('sin nada que revisar lo dice, y ofrece volver al listado', () => {
    estado.filas = []
    estado.total = 0
    montar()
    expect(screen.getByText('No hay clientes para revisar')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ir al listado' })).toBeInTheDocument()
  })

  it('con más de una página, el paginador dice cuántos hay en total', () => {
    estado.filas = Array.from({ length: 25 }, (_, i) => cliente({ id: `c-${i}`, razonSocial: `ZZ ${i}` }))
    estado.total = 40
    montar()
    expect(screen.getByText(/40 clientes marcados/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Siguiente/ })).toBeInTheDocument()
  })

  it('un error al resolver se dice y no borra la fila de la pantalla', () => {
    estado.errorResolver = new Error('No tenés permiso para resolver la revisión de este cliente')
    montar()
    expect(screen.getByRole('alert')).toHaveTextContent('No tenés permiso')
    expect(screen.getByRole('link', { name: 'ZZ Alfa SA' })).toBeInTheDocument()
  })
})

/**
 * Fase 19 · E3B — la evidencia del CUIT del sistema anterior.
 *
 * Hasta esta entrega la tarjeta decía «el sistema anterior usaba este CUIT en
 * más de una ficha» con un «sin CUIT» justo arriba: prometía una comparación
 * que no podía mostrar.
 */
describe('Cola de revisión · CUIT del sistema anterior', () => {
  const grupo = (p: Partial<GrupoCuitLegacy> = {}): GrupoCuitLegacy => ({
    clienteId: 'c-uno',
    crudo: '30-70945325-0',
    normalizado: '30709453250',
    fichas: [
      {
        id: 'c-dos',
        razonSocial: 'ZZ Alfa SA (no expo)',
        nombreComercial: null,
        referencia: 'CLI00099',
        cuit: null,
        dadoDeBaja: false,
      },
    ],
    ...p,
  })

  it('muestra el CUIT vigente y el del sistema anterior, uno al lado del otro', () => {
    estado.filas = [cliente({ cuit: null })]
    estado.grupos = [grupo()]
    montar()
    expect(screen.getByText('CUIT vigente')).toBeInTheDocument()
    expect(screen.getByText('Sin CUIT')).toBeInTheDocument()
    expect(screen.getByText('CUIT en el sistema anterior')).toBeInTheDocument()
    expect(screen.getByText('30-70945325-0')).toBeInTheDocument()
  })

  it('lista las otras fichas del grupo y las enlaza', () => {
    estado.filas = [cliente({ cuit: null })]
    estado.grupos = [grupo()]
    montar()
    expect(screen.getByText('La otra ficha con ese mismo CUIT')).toBeInTheDocument()
    const otra = screen.getByRole('link', { name: 'ZZ Alfa SA (no expo)' })
    expect(otra).toHaveAttribute('href', '/clientes/c-dos')
    expect(screen.getByText(/CLI00099/)).toBeInTheDocument()
  })

  it('con tres fichas lo dice en plural y las muestra todas', () => {
    estado.filas = [cliente({ cuit: null })]
    estado.grupos = [grupo({
      fichas: [
        { id: 'c-dos', razonSocial: 'ZZ Beta', nombreComercial: null, referencia: 'CLI2', cuit: null, dadoDeBaja: false },
        { id: 'c-tres', razonSocial: 'ZZ Gama', nombreComercial: null, referencia: 'CLI3', cuit: null, dadoDeBaja: true },
      ],
    })]
    montar()
    expect(screen.getByText('Las otras 2 fichas con ese mismo CUIT')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ZZ Beta' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ZZ Gama' })).toBeInTheDocument()
    expect(screen.getByText('Dado de baja')).toBeInTheDocument()
  })

  /**
   * El caso que justifica guardar el crudo: en el legacy hay un
   * `2024652303-8`, con el guión mal puesto. Formatearlo escondería que los
   * datos se cargaban así.
   */
  it('el crudo mal formado se muestra tal cual, sin reformatear', () => {
    estado.filas = [cliente({ cuit: null })]
    estado.grupos = [grupo({ crudo: '2024652303-8', normalizado: '20246523038' })]
    montar()
    expect(screen.getByText('2024652303-8')).toBeInTheDocument()
    expect(screen.queryByText('20-24652303-8')).not.toBeInTheDocument()
  })

  it('el crudo sin separadores también se muestra tal cual', () => {
    estado.filas = [cliente({ cuit: null })]
    estado.grupos = [grupo({ crudo: '30709453250' })]
    montar()
    expect(screen.getByText('30709453250')).toBeInTheDocument()
  })

  it('sin evidencia no promete una comparación: lo dice', () => {
    estado.filas = [cliente({ cuit: null })]
    estado.grupos = []
    montar()
    expect(screen.getByText(/no quedó en los datos migrados/)).toBeInTheDocument()
    expect(screen.queryByText('CUIT en el sistema anterior')).not.toBeInTheDocument()
  })

  it('mientras la evidencia viaja no dice ni que hay ni que no hay', () => {
    estado.filas = [cliente({ cuit: null })]
    estado.grupos = []
    estado.gruposCargando = true
    montar()
    expect(screen.queryByText(/no quedó en los datos migrados/)).not.toBeInTheDocument()
    expect(screen.queryByText('CUIT en el sistema anterior')).not.toBeInTheDocument()
  })

  it('si las otras fichas no son visibles para quien mira, lo dice sin inventarlas', () => {
    estado.filas = [cliente({ cuit: null })]
    estado.grupos = [grupo({ fichas: [] })]
    montar()
    expect(screen.getByText('30-70945325-0')).toBeInTheDocument()
    expect(screen.getByText(/no están entre los clientes que podés ver/)).toBeInTheDocument()
  })

  it('sólo pide la evidencia de los clientes que chocaron por CUIT', () => {
    estado.filas = [
      cliente({ id: 'c-uno', motivosRevision: ['CUIT_REPETIDO_EN_LEGACY'] }),
      cliente({ id: 'c-dos', razonSocial: 'ZZ Beta SA', motivosRevision: ['SOLO_EN_CONTACTOS'] }),
    ]
    estado.total = 2
    montar()
    expect(espias.pedidos).toHaveBeenCalledWith(['c-uno'])
  })

  it('un motivo que no es el del CUIT no muestra la comparación', () => {
    estado.filas = [cliente({ cuit: null, motivosRevision: ['SOLO_EN_CONTACTOS'] })]
    estado.grupos = []
    montar()
    expect(screen.queryByText('CUIT en el sistema anterior')).not.toBeInTheDocument()
    expect(screen.queryByText(/no quedó en los datos migrados/)).not.toBeInTheDocument()
  })

  /** Ni un botón que decida por nadie: eso es de una persona. */
  it('no ofrece fusionar, elegir ganador ni copiar el CUIT', () => {
    estado.filas = [cliente({ cuit: null })]
    estado.grupos = [grupo()]
    montar()
    const botones = screen.getAllByRole('button').map((b) => b.textContent ?? '')
    expect(botones.join(' | ')).not.toMatch(/fusionar|unir|elegir|usar este|copiar|asignar/i)
  })
})
