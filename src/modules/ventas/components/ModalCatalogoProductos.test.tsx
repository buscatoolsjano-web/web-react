// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanDeConsulta } from '@/modules/catalogo/lib/planDeConsulta'
import type { ProductoListado } from '@/modules/catalogo/types'

const estado = vi.hoisted(() => ({
  planes: [] as { plan: PlanDeConsulta; listaPrecioId: string | null; esInterno: boolean }[],
  esInterno: true,
}))

vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({
    activa: { companyId: 'c1', companyName: 'ZZ', rol: 'admin', esInterno: estado.esInterno },
    cargando: false,
  }),
}))

vi.mock('@/modules/catalogo/services/facetas', () => ({
  listarCategorias: () =>
    Promise.resolve([
      { id: 'cat-bal', nombre: 'Balanceadores', slug: 'balanceadores', necesitaRevision: false },
      { id: 'cat-imp', nombre: 'Llaves de impacto', slug: 'llaves-de-impacto', necesitaRevision: false },
    ]),
}))

vi.mock('@/modules/catalogo/services/productos', () => ({
  consultarProductos: (plan: PlanDeConsulta, listaPrecioId: string | null, esInterno: boolean) => {
    estado.planes.push({ plan, listaPrecioId, esInterno })
    const todos = [producto('p1', 'CP.CP9911', 'BALANCEADOR DE 0.4 A 1 KG', 'cat-bal', 46.03)]
    if (plan.categoria === null) todos.push(producto('p2', 'SP.TX40', 'ATORNILLADOR', 'cat-otros', null))
    return Promise.resolve({ productos: todos, total: todos.length })
  },
}))

function producto(id: string, sku: string, nombre: string, categoriaId: string, precio: number | null): ProductoListado {
  return {
    enCatalogo: true,
    motivoFueraDelCatalogo: null,
    id,
    sku,
    nombre,
    serie: null,
    tipo: null,
    esKit: false,
    necesitaRevision: false,
    marca: { id: 'm1', nombre: 'CHICAGO PNEUMATIC' },
    categoria: { id: categoriaId, nombre: 'Balanceadores', slug: 'balanceadores' },
    atributos: {},
    precio,
    stock: { real: 7, virtual: 9 },
    disponible: null,
    imagen: null,
  }
}

const { ModalCatalogoProductos } = await import('./ModalCatalogoProductos')

function montar(props: Partial<{ listaPrecioId: string | null; moneda: string | null }> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onAgregar = vi.fn()
  const onCerrar = vi.fn()
  render(
    <QueryClientProvider client={qc}>
      <ModalCatalogoProductos
        listaPrecioId={props.listaPrecioId ?? 'lp-9'}
        moneda={props.moneda ?? 'USD'}
        esInterno={estado.esInterno}
        onCerrar={onCerrar}
        onAgregar={onAgregar}
      />
    </QueryClientProvider>,
  )
  return { onAgregar, onCerrar }
}

beforeEach(() => {
  estado.planes = []
  estado.esInterno = true
})

describe('elegir productos del catálogo desde el documento', () => {
  // El buscador que había antes exigía dos letras y sólo buscaba: no se podía
  // recorrer una categoría. Ése era el motivo del cambio.
  it('lista productos sin escribir nada', async () => {
    montar()
    expect(await screen.findByText('BALANCEADOR DE 0.4 A 1 KG')).toBeInTheDocument()
    expect(estado.planes[0]?.plan.texto).toBeNull()
  })

  it('filtrar por categoría se lo pide al catálogo', async () => {
    montar()
    await screen.findByText('BALANCEADOR DE 0.4 A 1 KG')
    fireEvent.click(screen.getByRole('button', { name: 'Balanceadores' }))
    await waitFor(() => expect(estado.planes.some((p) => p.plan.categoria === 'cat-bal')).toBe(true))
  })

  it('el precio sale de la tarifa del documento, no de la del catálogo', async () => {
    montar({ listaPrecioId: 'lp-9' })
    await screen.findByText('BALANCEADOR DE 0.4 A 1 KG')
    expect(estado.planes[0]?.listaPrecioId).toBe('lp-9')
  })

  it('agrega con la cantidad elegida y no cierra la ventana', async () => {
    const { onAgregar, onCerrar } = montar()
    await screen.findByText('BALANCEADOR DE 0.4 A 1 KG')
    fireEvent.change(screen.getByLabelText('Cantidad de CP.CP9911'), { target: { value: '3' } })
    fireEvent.click(screen.getAllByRole('button', { name: '+ Agregar' })[0]!)
    expect(onAgregar).toHaveBeenCalledWith(expect.objectContaining({ sku: 'CP.CP9911' }), 3)
    expect(onCerrar).not.toHaveBeenCalled()
    // Se dice cuál se agregó: con veinte filas en pantalla hace falta.
    expect(await screen.findByRole('button', { name: 'Agregar otra vez' })).toBeInTheDocument()
  })

  it('sin cantidad escrita agrega una unidad', async () => {
    const { onAgregar } = montar()
    await screen.findByText('BALANCEADOR DE 0.4 A 1 KG')
    fireEvent.click(screen.getAllByRole('button', { name: '+ Agregar' })[0]!)
    expect(onAgregar).toHaveBeenCalledWith(expect.objectContaining({ sku: 'CP.CP9911' }), 1)
  })

  it('un producto sin precio en la tarifa se ve, no se esconde', async () => {
    montar()
    expect(await screen.findByText('ATORNILLADOR')).toBeInTheDocument()
    expect(screen.getByTitle('Sin precio en la tarifa del documento')).toBeInTheDocument()
  })

  it('el stock es sólo para adentro', async () => {
    montar()
    await screen.findByText('BALANCEADOR DE 0.4 A 1 KG')
    expect(screen.getByRole('columnheader', { name: 'SR' })).toBeInTheDocument()
  })
})

describe('con un rol externo', () => {
  beforeEach(() => {
    estado.esInterno = false
  })

  it('no muestra columnas de stock', async () => {
    montar()
    await screen.findByText('BALANCEADOR DE 0.4 A 1 KG')
    expect(screen.queryByRole('columnheader', { name: 'SR' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'SV' })).not.toBeInTheDocument()
  })
})
