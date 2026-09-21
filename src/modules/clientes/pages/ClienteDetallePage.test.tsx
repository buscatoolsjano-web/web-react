// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Link, RouterProvider, createMemoryRouter } from 'react-router-dom'
import type { ClienteDetalle, ContactoCliente, DireccionCliente } from '../types'
import type { DatosCliente } from '../lib/validacion'

const estado = vi.hoisted(() => ({
  rol: 'admin',
  cliente: null as unknown as ClienteDetalle,
  contactos: [] as ContactoCliente[],
  direcciones: [] as DireccionCliente[],
  vendedores: [] as { id: string; nombre: string }[],
  tarifas: [] as { id: string; nombre: string }[],
  errorGuardar: null as Error | null,
  usuarioId: 'u-admin',
  // Fase 19 · E2: la ficha y la ficha rápida leen la MISMA función.
  resumen: null as { totales: { cotizaciones: number; pedidos: number; entregas: number } } | null,
  // Fase 19 · E2: qué tipos numera STEL. Por defecto ninguno.
  stel: [] as string[],
  // Fase 19 · E3: ¿hay una serie de cotización que numere el ERP?
  serieErp: false,
  autoridadCargando: false,
}))
const mutaciones = vi.hoisted(() => ({
  dar: vi.fn(),
  reactivar: vi.fn(),
  // Tipada con la firma real: sin eso `mock.calls[0]` es una tupla vacía y no
  // se puede afirmar nada sobre lo que se mandó.
  guardar: vi.fn((_payload: { esperado: string; datos: DatosCliente }) => undefined),
  revision: vi.fn(),
}))

// La ficha importa `FalloDeCliente` del servicio, y el servicio importa el
// cliente de Supabase, que exige `.env` al importarse: sin este mock la suite
// aislada —la que corre como si no existiera `.env`— se cae.
vi.mock('@/services/supabase/client', () => ({ supabase: {} }))
// Fase 17 · E3: la agenda del cliente la administra también el vendedor que
// lo tiene asignado, así que la página necesita saber quién está mirando.
vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({ user: { id: estado.usuarioId }, session: null, cargando: false, salir: vi.fn() }),
}))
vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1', companyName: 'ZZ', rol: estado.rol, esInterno: true, customerId: null } }),
}))
vi.mock('../hooks/useClientes', () => ({
  useCliente: () => ({ data: estado.cliente, isPending: false, isFetching: false, error: null, refetch: vi.fn() }),
  useContactos: () => ({ data: estado.contactos, isPending: false }),
  // Fase 17 · E4: cada pestaña tiene su consulta y se pide cuando se abre.
  useHistorial: () => ({ data: { filas: [], total: 0 }, isPending: false, isFetching: false }),
  useDirecciones: () => ({ data: estado.direcciones, isPending: false, refetch: vi.fn() }),
  useCandidatosDeOc: () => ({ data: [], isPending: false }),
  // Fase 17 · E1: vendedores y tarifas de los dos desplegables comerciales.
  useOpcionesComerciales: () => ({ vendedores: estado.vendedores, tarifas: estado.tarifas }),
}))
// La ficha comparte con Ventas la regla de quién puede emitir: si la
// numeración la administra STEL, el ERP no crea el documento.
vi.mock('@/modules/ventas/hooks/useAutoridadNumeracion', () => ({
  useAutoridadNumeracion: () => ({
    stel: (t: string) => estado.stel.includes(t),
    cargando: estado.autoridadCargando,
  }),
}))
/**
 * Fase 19 · E3: abrir el alta no lo decide la autoridad general sino si hay
 * una serie que el ERP numere. Sin serie ERP —el estado por defecto— la
 * puerta se comporta como antes.
 */
vi.mock('@/modules/ventas/hooks/useAperturaDeAlta', () => ({
  useAperturaDeAlta: (tipo: string) => ({
    abierta: tipo === 'cotizacion' ? estado.serieErp || !estado.stel.includes('quote') : !estado.stel.includes('sales_order'),
    cargando: estado.autoridadCargando,
  }),
}))
vi.mock('../hooks/useCliente360', () => ({
  useCliente360: () => ({ data: estado.resumen, isPending: false, error: null }),
}))
vi.mock('../hooks/useEdicionClientes', () => ({
  useActualizarCliente: () => ({ mutate: mutaciones.guardar, isPending: false, error: estado.errorGuardar }),
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
vi.mock('../components/PanelProductos', () => ({ PanelProductos: () => <p>productos</p> }))
vi.mock('../components/PanelAdjuntos', () => ({ PanelAdjuntos: () => <p>adjuntos</p> }))
vi.mock('../components/PanelTrazabilidad', () => ({ PanelTrazabilidad: () => <p>trazabilidad</p> }))

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
  vendedorId: null,
  tarifaId: null,
  tarifaNombre: null,
  actualizadoEn: '2026-09-17T13:00:00.000Z',
  creadoEn: '2026-09-01T00:00:00Z',
}

/**
 * Un data router de verdad (como el de la aplicación, `createHashRouter`): el
 * aviso al salir con cambios sin guardar (Fase 17 · E1) usa `useBlocker`, que
 * sólo existe ahí.
 */
const montar = (extra?: React.ReactNode) => {
  const router = createMemoryRouter(
    [
      {
        path: '/clientes/:id',
        element: (
          <>
            {extra}
            <ClienteDetallePage />
          </>
        ),
      },
      { path: '/clientes', element: <p>listado</p> },
    ],
    { initialEntries: ['/clientes/c1'] },
  )
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  estado.rol = 'admin'
  estado.cliente = { ...base }
  estado.contactos = [{ id: 'k1', nombre: 'ZZ Ana', cargo: 'Compras', email: null, telefono: null, fax: null, esPrincipal: true, notas: null, activo: true, actualizadoEn: '2026-01-01T00:00:00Z' }]
  estado.errorGuardar = null
  estado.usuarioId = 'u-admin'
  estado.resumen = { totales: { cotizaciones: 2, pedidos: 1, entregas: 0 } }
  estado.vendedores = [{ id: 'u1', nombre: 'ZZ Vendedora' }]
  estado.tarifas = [{ id: 'pl1', nombre: 'ZZ Mayorista' }]
  estado.direcciones = [{ id: 'd1', tipo: 'both', calle: 'ZZ Calle 1', ciudad: null, provincia: null, codigoPostal: null, pais: 'AR', notas: null, esPrincipal: true, texto: 'ZZ Calle 1, AR', activo: true, actualizadoEn: '2026-01-01T00:00:00Z' }]
  estado.stel = []
  estado.serieErp = false
  estado.autoridadCargando = false
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
    for (const t of ['Sin contacto principal', 'Sin emails', 'Sin teléfono', 'Sin CUIT', 'Sin direcciones', 'Sin vendedor asignado', 'Sin rubro', 'Sin dominios', 'Sin notas']) {
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

/**
 * La edición segura (Fase 17 · E1).
 *
 * Lo que se prueba es el contrato nuevo: que el guardado mande el testigo de
 * concurrencia, que no se ofrezca guardar lo que no cambió, que descartar
 * pregunte, que salir con cambios avise y que un conflicto conserve lo escrito.
 */
describe('Ficha del cliente · edición segura (Fase 17 · E1)', () => {
  const abrirEdicion = () => fireEvent.click(screen.getByRole('button', { name: 'Editar' }))

  it('sin tocar nada, Guardar está apagado: no se manda un guardado vacío', () => {
    montar()
    abrirEdicion()
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
    expect(mutaciones.guardar).not.toHaveBeenCalled()
  })

  it('Guardar manda UNA llamada con el testigo de concurrencia', () => {
    montar()
    abrirEdicion()
    fireEvent.change(screen.getByLabelText(/Teléfono/), { target: { value: '011 4444-0000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(mutaciones.guardar).toHaveBeenCalledTimes(1)
    const [payload] = mutaciones.guardar.mock.calls[0]!
    expect(payload.esperado).toBe('2026-09-17T13:00:00.000Z')
    expect(payload.datos.telefono).toBe('011 4444-0000')
  })

  it('el vendedor y la tarifa se eligen y viajan en el mismo guardado', () => {
    montar()
    abrirEdicion()
    fireEvent.change(screen.getByLabelText(/Vendedor asignado/), { target: { value: 'u1' } })
    fireEvent.change(screen.getByLabelText(/Tarifa por defecto/), { target: { value: 'pl1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    const [payload] = mutaciones.guardar.mock.calls[0]!
    expect(payload.datos.vendedorId).toBe('u1')
    expect(payload.datos.tarifaId).toBe('pl1')
  })

  it('se dice que la tarifa todavía no cambia los precios de los documentos', () => {
    montar()
    abrirEdicion()
    expect(screen.getByText(/Todavía no cambia los precios de los documentos/)).toBeInTheDocument()
  })

  it('quien no administra la ficha no ve vendedor ni tarifa', () => {
    estado.rol = 'salesperson'
    montar()
    abrirEdicion()
    expect(screen.queryByLabelText(/Vendedor asignado/)).toBeNull()
    expect(screen.queryByLabelText(/Tarifa por defecto/)).toBeNull()
    // Pero sí puede editar el resto de la ficha.
    expect(screen.getByLabelText(/Teléfono/)).toBeInTheDocument()
  })

  it('Cancelar con cambios pregunta antes de perderlos, y no guarda', () => {
    montar()
    abrirEdicion()
    fireEvent.change(screen.getByLabelText(/Teléfono/), { target: { value: '011 9999-9999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    const dialogo = screen.getByRole('alertdialog', { name: 'Hay cambios sin guardar' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Descartar cambios' }))

    expect(mutaciones.guardar).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument()
  })

  it('Cancelar sin cambios cierra derecho, sin preguntar', () => {
    montar()
    abrirEdicion()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument()
  })

  it('cambiar de pestaña NO pregunta: no se navega a ningún lado', () => {
    montar()
    abrirEdicion()
    fireEvent.change(screen.getByLabelText(/Teléfono/), { target: { value: '011 1212-1212' } })
    fireEvent.click(screen.getByRole('tab', { name: /Contactos/ }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('irse del cliente con cambios PREGUNTA antes de perder el borrador', async () => {
    montar(<Link to="/clientes">volver al listado</Link>)
    abrirEdicion()
    fireEvent.change(screen.getByLabelText(/Teléfono/), { target: { value: '011 3333-3333' } })

    fireEvent.click(screen.getByRole('link', { name: 'volver al listado' }))
    const dialogo = await screen.findByRole('alertdialog', { name: 'Hay cambios sin guardar' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Seguir editando' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByLabelText(/Teléfono/)).toHaveValue('011 3333-3333')

    fireEvent.click(screen.getByRole('link', { name: 'volver al listado' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Descartar y salir' }))
    expect(await screen.findByText('listado')).toBeInTheDocument()
    expect(mutaciones.guardar).not.toHaveBeenCalled()
  })

  it('sin editar, navegar no pregunta nada', async () => {
    montar(<Link to="/clientes">volver al listado</Link>)
    fireEvent.click(screen.getByRole('link', { name: 'volver al listado' }))
    expect(await screen.findByText('listado')).toBeInTheDocument()
  })
})

describe('Ficha del cliente · conflicto de edición (Fase 17 · E1)', () => {
  it('un conflicto se explica aparte y conserva lo escrito', async () => {
    const { FalloDeCliente } = await import('../services/edicion')
    estado.errorGuardar = new FalloDeCliente(
      'CONFLICTO_DE_EDICION',
      'Alguien más guardó este cliente mientras lo editabas.',
    )
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))

    expect(screen.getByText('Este cliente cambió mientras lo editabas')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Recargar' })).toBeInTheDocument()
    // El formulario sigue en pantalla: lo escrito no se pierde.
    expect(screen.getByLabelText(/Teléfono/)).toBeInTheDocument()
    // Y no se repite el mensaje crudo abajo del formulario.
    expect(screen.queryByText('Alguien más guardó este cliente mientras lo editabas.')).toBeNull()
  })

  it('un error común sí se muestra donde estaba', async () => {
    const { FalloDeCliente } = await import('../services/edicion')
    estado.errorGuardar = new FalloDeCliente('CUIT_INVALIDO', 'El CUIT tiene que tener 11 dígitos.')
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    expect(screen.getByText('El CUIT tiene que tener 11 dígitos.')).toBeInTheDocument()
    expect(screen.queryByText('Este cliente cambió mientras lo editabas')).toBeNull()
  })
})

describe('Ficha del cliente · emitir desde la ficha (Fase 19 · E2)', () => {
  it('con la numeración en el ERP, los dos botones llevan al alta con el cliente puesto', () => {
    montar()
    expect(screen.getByRole('link', { name: 'Nueva cotización' })).toHaveAttribute(
      'href',
      '/ventas/cotizaciones/nueva?cliente=c1',
    )
    expect(screen.getByRole('link', { name: 'Nuevo pedido' })).toHaveAttribute(
      'href',
      '/ventas/pedidos/nuevo?cliente=c1',
    )
    expect(screen.queryByText(/Emisión desde el ERP bloqueada/)).toBeNull()
  })

  /**
   * La regresión: hasta la Fase 19 · E2 éstos eran dos links sueltos. Con STEL
   * numerando se podía llegar a la pantalla de alta, armar la cotización
   * entera y recién ahí encontrarse con «Crear cotización» deshabilitado.
   */
  it('si STEL numera las cotizaciones, el botón no es un link: está deshabilitado y dice por qué', () => {
    estado.stel = ['quote']
    montar()
    const boton = screen.getByRole('button', { name: 'Nueva cotización' })
    expect(boton).toBeDisabled()
    const motivo = screen.getByText(/Emisión desde el ERP bloqueada: STEL numera las cotizaciones/)
    expect(boton).toHaveAttribute('aria-describedby', motivo.id)
    // El pedido no está bloqueado: sigue siendo un link.
    expect(screen.getByRole('link', { name: 'Nuevo pedido' })).toBeInTheDocument()
  })

  it('con los dos tipos bloqueados, el motivo es UNA línea que los nombra a los dos', () => {
    estado.stel = ['quote', 'sales_order']
    montar()
    expect(screen.getByRole('button', { name: 'Nueva cotización' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Nuevo pedido' })).toBeDisabled()
    expect(
      screen.getAllByText(
        'Emisión desde el ERP bloqueada: STEL numera las cotizaciones y los pedidos de esta empresa.',
      ),
    ).toHaveLength(1)
  })

  /**
   * Fase 19 · E3 · §7-A/B/D. Con una serie que el ERP numera, la cotización
   * vuelve a ser un link: abrir el alta no emite nada, y adentro decide la
   * serie elegida. El pedido NO: no tiene ninguna serie del ERP todavía.
   */
  it.each(['admin', 'employee'])('%s: con una serie del ERP, «Nueva cotización» vuelve a llevar al alta con el cliente', (rol) => {
    estado.rol = rol
    estado.stel = ['quote', 'sales_order']
    estado.serieErp = true
    montar()
    expect(screen.getByRole('link', { name: 'Nueva cotización' })).toHaveAttribute(
      'href',
      '/ventas/cotizaciones/nueva?cliente=c1',
    )
    expect(screen.getByRole('button', { name: 'Nuevo pedido' })).toBeDisabled()
    // Y el motivo que queda nombra sólo lo que sigue bloqueado.
    expect(screen.getByText(/Emisión desde el ERP bloqueada: STEL numera los pedidos/)).toBeInTheDocument()
  })

  it('un rol sin permiso no gana ninguna acción porque exista la serie del ERP', () => {
    estado.rol = 'salesperson'
    estado.stel = ['quote']
    estado.serieErp = true
    montar()
    expect(screen.queryByRole('link', { name: 'Nueva cotización' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Nueva cotización' })).toBeNull()
  })

  it('mientras no se leyó la autoridad no se inventa un motivo: deshabilitados y sin texto', () => {
    estado.autoridadCargando = true
    montar()
    expect(screen.getByRole('button', { name: 'Nueva cotización' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Nuevo pedido' })).toBeDisabled()
    expect(screen.queryByText(/Emisión desde el ERP bloqueada/)).toBeNull()
  })

  /**
   * `salesperson` administra la ficha del cliente pero NO escribe en Ventas
   * (`quotes_write` es admin + employee). Es el rol que hacía visible el
   * problema: veía los dos botones y la base lo rechazaba.
   */
  it('quien no escribe en Ventas no ve las acciones de emisión, como en el listado de Ventas', () => {
    estado.rol = 'salesperson'
    montar()
    expect(screen.queryByRole('link', { name: 'Nueva cotización' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Nueva cotización' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Nuevo pedido' })).toBeNull()
    expect(screen.queryByText(/Emisión desde el ERP bloqueada/)).toBeNull()
  })
})
