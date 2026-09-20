// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Cliente360 } from '../types'

const estado = vi.hoisted(() => ({
  rol: 'admin',
  stel: false,
  cargandoAutoridad: false,
}))
const servicio = vi.hoisted(() => ({ cliente360: vi.fn() }))

vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({
    activa: { companyId: 'c1', companyName: 'ZZ', rol: estado.rol, esInterno: true, customerId: null },
  }),
}))
vi.mock('@/modules/ventas/hooks/useAutoridadNumeracion', () => ({
  useAutoridadNumeracion: () => ({ stel: () => estado.stel, cargando: estado.cargandoAutoridad }),
}))
vi.mock('../services/cliente360', () => servicio)

const { FichaRapidaCliente } = await import('./FichaRapidaCliente')

/** Una ficha con todo lleno; cada test cambia lo que le importa. */
const ficha = (cambios: Partial<Cliente360> = {}): Cliente360 => ({
  cliente: {
    id: 'cli-1',
    referencia: 'CLI00001',
    razonSocial: 'ZZ Mirgor SA',
    nombreComercial: null,
    cuit: '30712345671',
    rubro: 'Electrónica',
    tipo: 'business',
    estado: 'active',
    dadoDeBaja: false,
    necesitaRevision: false,
    motivosRevision: [],
    emails: ['compras@zz.test'],
    telefono: '11 5555 5555',
    esHistorico: true,
  },
  comercial: {
    vendedorId: 'u1',
    vendedor: 'ZZ Vendedor',
    moneda: 'USD',
    condicionDePago: '30 días',
    tarifaId: 't1',
    tarifa: 'ZZ Tarifa',
    contacto: { id: 'k1', nombre: 'ZZ Ana', rol: 'Compras', email: 'ana@zz.test', telefono: null },
  },
  kpis: {
    mes: '2026-09-01',
    mesAnterior: '2026-08-01',
    valores: [
      { clave: 'vendido_mes', moneda: 'USD', documentos: 2, importe: 6606.84 },
      { clave: 'vendido_mes_anterior', moneda: 'USD', documentos: 1, importe: 5589 },
      { clave: 'cotizado_mes', moneda: 'USD', documentos: 3, importe: 9000 },
      { clave: 'cotizaciones_abiertas', moneda: 'USD', documentos: 4, importe: 12000 },
      { clave: 'pedidos_por_entregar', moneda: 'USD', documentos: 1, importe: 800 },
    ],
  },
  meses: [
    { mes: '2026-09-01', tipo: 'pedido', moneda: 'USD', documentos: 2, importe: 6606.84 },
    { mes: '2026-08-01', tipo: 'pedido', moneda: 'USD', documentos: 1, importe: 5589 },
  ],
  recientes: [
    {
      tipo: 'cotizacion',
      id: 'q1',
      numero: 'COTI02543',
      fecha: '2026-09-10',
      estado: 'sent',
      entrega: null,
      moneda: 'USD',
      total: 3200,
    },
    {
      tipo: 'pedido',
      id: 'o1',
      numero: 'PDV01321',
      fecha: '2026-09-08',
      estado: 'confirmed',
      entrega: 'pending',
      moneda: 'USD',
      total: 800,
    },
  ],
  productos: [
    {
      productId: 'p1',
      sku: 'CP9911',
      nombre: 'Balanceador TECNA 9370',
      origen: 'pedido',
      fecha: '2026-09-08',
      cantidad: 4,
      precio: 200,
      moneda: 'USD',
    },
  ],
  totales: {
    cotizaciones: 111,
    pedidos: 67,
    entregas: 80,
    ultimaActividad: '2026-09-10',
    documentos12m: 42,
    productosDistintos: 397,
  },
  ...cambios,
})

const vacia = (): Cliente360 =>
  ficha({
    comercial: {
      vendedorId: null,
      vendedor: null,
      moneda: null,
      condicionDePago: null,
      tarifaId: null,
      tarifa: null,
      contacto: null,
    },
    kpis: { mes: '2026-09-01', mesAnterior: '2026-08-01', valores: [] },
    meses: [],
    recientes: [],
    productos: [],
    totales: { cotizaciones: 0, pedidos: 0, entregas: 0, ultimaActividad: null, documentos12m: 0, productosDistintos: 0 },
  })

const montar = (clienteId = 'cli-1') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <FichaRapidaCliente clienteId={clienteId} />
      </MemoryRouter>
    </QueryClientProvider>,
  )

beforeEach(() => {
  Object.assign(estado, { rol: 'admin', stel: false, cargandoAutoridad: false })
  vi.clearAllMocks()
})

describe('Un cliente con datos', () => {
  it('contesta quién es, quién lo atiende y cómo llegar a su ficha', async () => {
    servicio.cliente360.mockResolvedValue(ficha())
    montar()

    expect(await screen.findByRole('heading', { name: 'ZZ Mirgor SA' })).toBeInTheDocument()
    expect(screen.getByText('30-71234567-1 · CLI00001 · Electrónica')).toBeInTheDocument()
    expect(screen.getByText('ZZ Ana')).toBeInTheDocument()
    expect(screen.getByText('ZZ Vendedor')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abrir ficha' })).toHaveAttribute('href', '/clientes/cli-1')
  })

  it('el alta de cotización lleva el cliente en la URL, para que tome sus defaults', async () => {
    servicio.cliente360.mockResolvedValue(ficha())
    montar()
    expect(await screen.findByRole('link', { name: /Nueva cotización/ })).toHaveAttribute(
      'href',
      '/ventas/cotizaciones/nueva?cliente=cli-1',
    )
  })

  it('muestra los últimos documentos con su número, estado e importe', async () => {
    servicio.cliente360.mockResolvedValue(ficha())
    montar()
    expect(await screen.findByRole('link', { name: /COTI02543/ })).toHaveAttribute(
      'href',
      '/ventas/cotizaciones/q1',
    )
    expect(screen.getByRole('link', { name: /PDV01321/ })).toHaveAttribute('href', '/ventas/pedidos/o1')
    expect(screen.getByText('Enviada')).toBeInTheDocument()
    // El pedido muestra ADEMÁS su estado de entrega: «confirmado» y «entregado»
    // son dos preguntas distintas.
    expect(screen.getByText('Confirmado')).toBeInTheDocument()
    expect(screen.getByText('Pendiente')).toBeInTheDocument()
  })

  it('muestra los productos con su último precio y de dónde salió', async () => {
    servicio.cliente360.mockResolvedValue(ficha())
    montar()
    expect(await screen.findByText('CP9911')).toBeInTheDocument()
    expect(screen.getByText('Balanceador TECNA 9370')).toBeInTheDocument()
    expect(screen.getByText(/USD 200,00/)).toBeInTheDocument()
    expect(screen.getByText(/\(pedido\)/)).toBeInTheDocument()
  })

  it('pide la ficha una sola vez: no hay una consulta por KPI', async () => {
    servicio.cliente360.mockResolvedValue(ficha())
    montar()
    await screen.findByRole('heading', { name: 'ZZ Mirgor SA' })
    expect(servicio.cliente360).toHaveBeenCalledTimes(1)
  })
})

describe('Monedas', () => {
  /**
   * Las consultas se acotan a la sección de KPIs: los mismos importes también
   * aparecen en la tabla accesible del gráfico, y ahí estar repetidos está
   * bien. Lo que se prueba acá es qué dicen las tarjetas.
   */
  const tarjetas = async () => screen.findByRole('region', { name: /En septiembre/ })

  it('con dos monedas muestra las dos, NUNCA la suma', async () => {
    servicio.cliente360.mockResolvedValue(
      ficha({
        kpis: {
          mes: '2026-09-01',
          mesAnterior: '2026-08-01',
          valores: [
            { clave: 'vendido_mes', moneda: 'USD', documentos: 1, importe: 6606.84 },
            { clave: 'vendido_mes', moneda: 'ARS', documentos: 1, importe: 1_240_000 },
          ],
        },
      }),
    )
    montar()

    const kpis = within(await tarjetas())
    expect(kpis.getByText('USD 6.606,84')).toBeInTheDocument()
    expect(kpis.getByText('ARS 1.240.000,00')).toBeInTheDocument()
    // 1.246.606,84 sería la suma. No puede estar en ningún lado de la pantalla.
    expect(screen.queryByText(/1\.246\.606/)).not.toBeInTheDocument()
  })

  it('con una sola moneda no complica la pantalla', async () => {
    servicio.cliente360.mockResolvedValue(ficha())
    montar()
    const kpis = within(await tarjetas())
    expect(kpis.getByText('USD 6.606,84')).toBeInTheDocument()
    expect(kpis.queryByText(/ARS/)).not.toBeInTheDocument()
  })
})

describe('La comparación con el mes anterior', () => {
  it('muestra la variación cuando hay con qué comparar', async () => {
    servicio.cliente360.mockResolvedValue(ficha())
    montar()
    expect(await screen.findByText(/\+18,2 %/)).toBeInTheDocument()
  })

  it('el mes anterior en cero NO se muestra como infinito ni como +100 %', async () => {
    servicio.cliente360.mockResolvedValue(
      ficha({
        kpis: {
          mes: '2026-09-01',
          mesAnterior: '2026-08-01',
          valores: [{ clave: 'vendido_mes', moneda: 'USD', documentos: 1, importe: 5000 }],
        },
      }),
    )
    montar()
    expect(await screen.findByText('Sin base de comparación')).toBeInTheDocument()
    expect(screen.queryByText(/Infinity|∞|\+100 %/)).not.toBeInTheDocument()
  })
})

describe('Un cliente sin nada', () => {
  it('no rompe, y lo dice con palabras', async () => {
    servicio.cliente360.mockResolvedValue(vacia())
    montar()

    expect(await screen.findByRole('heading', { name: 'ZZ Mirgor SA' })).toBeInTheDocument()
    expect(screen.getByText('Todavía no tiene documentos.')).toBeInTheDocument()
    expect(screen.getByText('Todavía no cotizó ni pidió ningún producto.')).toBeInTheDocument()
    expect(screen.getByText('Sin contacto principal')).toBeInTheDocument()
    expect(screen.getByText('Sin asignar')).toBeInTheDocument()
    expect(screen.getAllByText('Sin movimientos').length).toBeGreaterThan(0)
  })
})

describe('Cargando, error y sin permiso', () => {
  it('mientras carga muestra un esqueleto, no una ficha vacía', () => {
    servicio.cliente360.mockReturnValue(new Promise(() => {}))
    montar()
    expect(screen.getByLabelText('Cargando la ficha del cliente…')).toBeInTheDocument()
  })

  it('si falla, el panel NO se cierra: queda el motivo y se puede reintentar', async () => {
    servicio.cliente360.mockRejectedValue(new Error('No se pudo leer la ficha: timeout'))
    montar()
    expect(await screen.findByRole('alert')).toHaveTextContent('timeout')
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('un cliente que el actor no puede ver dice eso, y no muestra ni un importe', async () => {
    // La RPC devuelve `null`: es lo que ve un vendedor con el uuid de un
    // cliente que no tiene asignado.
    servicio.cliente360.mockResolvedValue(null)
    montar('cli-ajeno')

    expect(await screen.findByText('No se puede ver este cliente')).toBeInTheDocument()
    expect(screen.queryByText(/USD/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Nueva cotización/ })).not.toBeInTheDocument()
  })
})

describe('Quién puede crear, y cuándo', () => {
  it('un vendedor no ve «Nueva cotización»: no escribe en Ventas', async () => {
    estado.rol = 'salesperson'
    servicio.cliente360.mockResolvedValue(ficha())
    montar()
    await screen.findByRole('heading', { name: 'ZZ Mirgor SA' })
    expect(screen.queryByRole('link', { name: /Nueva cotización/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Nueva cotización/ })).not.toBeInTheDocument()
  })

  it('con STEL numerando, el botón queda deshabilitado y CON el motivo a la vista', async () => {
    estado.stel = true
    servicio.cliente360.mockResolvedValue(ficha())
    montar()

    const boton = await screen.findByRole('button', { name: /Nueva cotización/ })
    expect(boton).toBeDisabled()
    expect(screen.getByText(/STEL numera/)).toBeInTheDocument()
    // Y no queda un link paralelo que sí funcione.
    expect(screen.queryByRole('link', { name: /Nueva cotización/ })).not.toBeInTheDocument()
  })

  it('mientras no se sabe la autoridad, no se ofrece crear', async () => {
    estado.cargandoAutoridad = true
    servicio.cliente360.mockResolvedValue(ficha())
    montar()
    await waitFor(() => expect(screen.getByRole('button', { name: /Nueva cotización/ })).toBeDisabled())
  })
})
