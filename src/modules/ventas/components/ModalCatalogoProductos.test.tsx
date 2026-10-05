// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanDeConsulta } from '@/modules/catalogo/lib/planDeConsulta'
import type { Facetas, ProductoListado } from '@/modules/catalogo/types'
import type { UltimoPrecio } from '@/modules/clientes/types'

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

/**
 * Las facetas salen de la MISMA RPC que el catálogo. Se devuelven categorías y
 * un atributo con valores, que es lo que aparece al elegir una categoría.
 */
vi.mock('@/modules/catalogo/services/facetas', () => ({
  obtenerFacetas: (plan: PlanDeConsulta): Promise<Facetas> =>
    Promise.resolve({
      total: 2,
      marcas: [{ valor: 'm1', etiqueta: 'CHICAGO PNEUMATIC', cantidad: 2 }],
      categorias: [
        { valor: 'cat-bal', etiqueta: 'Balanceadores', cantidad: 1 },
        { valor: 'cat-pun', etiqueta: 'Puntas y tubos', cantidad: 1 },
      ],
      subtipos: [],
      series: [],
      // Los atributos aparecen recién con una categoría elegida, igual que en
      // el catálogo: sin categoría serían los 234 valores de todo el inventario.
      atributos:
        plan.categoria === null
          ? []
          : [
              {
                key: 'encastre',
                label: 'Encastre',
                unidad: null,
                clase: 'enum' as const,
                opciones: [
                  { valor: '1/4 HEX', etiqueta: '1/4 HEX', cantidad: 1 },
                  { valor: '1/2', etiqueta: '1/2', cantidad: 1 },
                ],
                min: null,
                max: null,
              },
            ],
    }),
}))

vi.mock('@/modules/catalogo/services/productos', () => ({
  consultarProductos: (plan: PlanDeConsulta, listaPrecioId: string | null, esInterno: boolean) => {
    estado.planes.push({ plan, listaPrecioId, esInterno })
    const todos = [producto('p1', 'CP.CP9911', 'BALANCEADOR DE 0.4 A 1 KG', 46.03)]
    if (plan.categoria === null) todos.push(producto('p2', 'SP.TX40', 'ATORNILLADOR', null))
    return Promise.resolve({ productos: todos, total: todos.length })
  },
}))

function producto(id: string, sku: string, nombre: string, precio: number | null): ProductoListado {
  return {
    enCatalogo: true,
    motivoFueraDelCatalogo: null,
    id,
    sku,
    nombre,
    modelo: sku,
    serie: null,
    tipo: null,
    esKit: false,
    necesitaRevision: false,
    marca: { id: 'm1', nombre: 'CHICAGO PNEUMATIC' },
    categoria: { id: 'cat-bal', nombre: 'Balanceadores', slug: 'balanceadores' },
    atributos: {},
    precio,
    stock: { real: 7, virtual: 9 },
    disponible: null,
    imagen: null,
  }
}

/**
 * El alta de producto se saltea entera: lo que se prueba acá no es el
 * formulario —tiene sus propios tests— sino qué hace ESTE modal con el
 * producto que vuelve.
 */
vi.mock('@/modules/catalogo/components/ModalNuevoProducto', () => ({
  ModalNuevoProducto: ({ onCreado }: { onCreado: (p: { id: string; sku: string; nombre: string }) => void }) => (
    <div>
      alta de producto
      <button type="button" onClick={() => onCreado({ id: 'p9', sku: 'ZZ.NUEVO', nombre: 'EL QUE ACABO DE CREAR' })}>
        crear
      </button>
    </div>
  ),
}))

const { ModalCatalogoProductos } = await import('./ModalCatalogoProductos')

function montar(
  props: Partial<{
    listaPrecioId: string | null
    moneda: string | null
    historicos: Map<string, UltimoPrecio>
  }> = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onAgregar = vi.fn()
  const onCerrar = vi.fn()
  render(
    <QueryClientProvider client={qc}>
      <ModalCatalogoProductos
        listaPrecioId={props.listaPrecioId ?? 'lp-9'}
        moneda={props.moneda ?? 'USD'}
        esInterno={estado.esInterno}
        historicos={props.historicos}
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
    fireEvent.click(await screen.findByRole('button', { name: /Balanceadores/ }))
    await waitFor(() => expect(estado.planes.some((p) => p.plan.categoria === 'cat-bal')).toBe(true))
  })

  /**
   * Fase 28 · E6/E7: es lo que faltaba. Con una categoría elegida tienen que
   * aparecer SUS atributos, como filtro Y como columna de la tabla.
   */
  it('con una categoría elegida aparecen sus atributos, y como columna', async () => {
    montar()
    await screen.findByText('BALANCEADOR DE 0.4 A 1 KG')
    expect(screen.queryByRole('columnheader', { name: /Encastre/ })).toBeNull()

    fireEvent.click(await screen.findByRole('button', { name: /Puntas y tubos/ }))

    // La columna, que además ordena…
    const columna = await screen.findByRole('columnheader', { name: /Encastre/ })
    expect(columna).toHaveAttribute('aria-sort', 'none')
    // …y el filtro, que es un desplegable aparte. Fase 38: es un `select`
    // común, no un botón con panel flotante — el panel se rompía dentro de la
    // fila de filtros, que scrollea en horizontal.
    const filtro = screen.getByLabelText('Filtrar por Encastre')
    expect(filtro.tagName).toBe('SELECT')
  })

  it('tocar una columna ordena, y tocarla de nuevo la da vuelta', async () => {
    montar()
    await screen.findByText('BALANCEADOR DE 0.4 A 1 KG')
    const encabezado = () => screen.getByRole('columnheader', { name: /SKU/ })

    fireEvent.click(within(encabezado()).getByRole('button'))
    await waitFor(() => expect(estado.planes.at(-1)?.plan.orden).toBe('sku'))
    expect(encabezado()).toHaveAttribute('aria-sort', 'ascending')

    fireEvent.click(within(encabezado()).getByRole('button'))
    await waitFor(() => expect(estado.planes.at(-1)?.plan.orden).toBe('sku_desc'))
    expect(encabezado()).toHaveAttribute('aria-sort', 'descending')
  })

  it('ordenar por un atributo se lo pide a la base como attr:<clave>', async () => {
    montar()
    await screen.findByText('BALANCEADOR DE 0.4 A 1 KG')
    fireEvent.click(await screen.findByRole('button', { name: /Puntas y tubos/ }))
    const columna = await screen.findByRole('columnheader', { name: /Encastre/ })
    fireEvent.click(within(columna).getByRole('button'))
    await waitFor(() => expect(estado.planes.at(-1)?.plan.orden).toBe('attr:encastre'))
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
    // Tercer argumento desde la Fase 40: el precio con el que entra la línea.
    // Sin histórico de este cliente, el de la tarifa, que es lo que ya hacía.
    expect(onAgregar).toHaveBeenCalledWith(
      expect.objectContaining({ sku: 'CP.CP9911' }),
      3,
      // El precio de la tarifa del producto de prueba, sin histórico de cliente.
      { precio: 46.03, deHistorico: false },
    )
    expect(onCerrar).not.toHaveBeenCalled()
    // Se dice cuál se agregó: con veinte filas en pantalla hace falta.
    expect(await screen.findByRole('button', { name: 'Sumar más' })).toBeInTheDocument()
  })

  it('sin cantidad escrita agrega una unidad', async () => {
    const { onAgregar } = montar()
    await screen.findByText('BALANCEADOR DE 0.4 A 1 KG')
    fireEvent.click(screen.getAllByRole('button', { name: '+ Agregar' })[0]!)
    expect(onAgregar).toHaveBeenCalledWith(
      expect.objectContaining({ sku: 'CP.CP9911' }),
      1,
      { precio: 46.03, deHistorico: false },
    )
  })

  /*
   * Lo que pidió el negocio: si a ESTE cliente ya se le vendió ESTE producto,
   * la línea entra con ese precio y no con el de la tarifa. El caso real que
   * lo motivó fue 49,40 y después 22,20 al mismo cliente en USD.
   */
  it('con histórico del cliente, la línea entra con ese precio y no con el de la tarifa', async () => {
    const historicos = new Map([
      [
        'p1',
        {
          productId: 'p1',
          sku: 'CP.CP9911',
          nombre: 'BALANCEADOR DE 0.4 A 1 KG',
          moneda: 'USD',
          ultimoPrecio: 22.2,
          ultimaFecha: '2026-05-19',
          ultimoDocumento: 'PDV01233',
          ultimoDocumentoId: 'd1',
          ultimoTipo: 'pedido' as const,
          precioAnterior: 49.4,
          veces: 2,
        },
      ],
    ])
    const { onAgregar } = montar({ historicos })
    await screen.findByText('BALANCEADOR DE 0.4 A 1 KG')
    // Se ve antes de agregar: el histórico, y abajo la tarifa tachada.
    expect(screen.getByTitle(/Último precio de este cliente/)).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '+ Agregar' })[0]!)
    expect(onAgregar).toHaveBeenCalledWith(expect.objectContaining({ sku: 'CP.CP9911' }), 1, {
      precio: 22.2,
      deHistorico: true,
    })
  })

  // Con el merge de líneas, «2 líneas agregadas» sería mentira.
  it('el pie cuenta productos, no líneas', async () => {
    montar()
    await screen.findByText('BALANCEADOR DE 0.4 A 1 KG')
    fireEvent.click(screen.getAllByRole('button', { name: '+ Agregar' })[0]!)
    fireEvent.click(await screen.findByRole('button', { name: 'Sumar más' }))
    expect(await screen.findByText(/1 producto agregado/)).toBeInTheDocument()
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

/*
 * Crear un producto sin salir de la cotización (Fase 40).
 *
 * El caso real: estás armando una cotización, el producto que te pidieron no
 * está en el catálogo todavía, y hasta ahora había que abandonar el documento,
 * ir al Catálogo, crearlo y empezar de nuevo.
 */
describe('crear un producto desde el documento', () => {
  it('el buscador ofrece crear uno, y al crearlo lo deja buscado por su SKU', async () => {
    montar()
    await screen.findByText('BALANCEADOR DE 0.4 A 1 KG')

    fireEvent.click(screen.getByRole('button', { name: 'Nuevo producto' }))
    fireEvent.click(await screen.findByRole('button', { name: 'crear' }))

    // Queda escrito en el buscador: se ve QUÉ está filtrando la lista.
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/Buscar por SKU/)).toHaveValue('ZZ.NUEVO'),
    )
    // Y se le pidió al catálogo con ese texto, sin esperar el debounce.
    await waitFor(() => expect(estado.planes.at(-1)?.plan.texto).toBe('ZZ.NUEVO'))
  })

  /**
   * NO se agrega solo al documento. Un producto recién creado no tiene precio
   * en la tarifa —no puede tenerlo— y agregarlo de una escondería justo eso:
   * entraría en cero sin que nadie lo mire.
   */
  it('no lo agrega solo: avisa que falta ponerle cantidad y mirar el precio', async () => {
    const { onAgregar } = montar()
    await screen.findByText('BALANCEADOR DE 0.4 A 1 KG')

    fireEvent.click(screen.getByRole('button', { name: 'Nuevo producto' }))
    fireEvent.click(await screen.findByRole('button', { name: 'crear' }))

    expect(onAgregar).not.toHaveBeenCalled()
    const aviso = await screen.findByText(/ZZ.NUEVO creado y agregado al buscador/)
    expect(aviso.closest('[class]')).toBeTruthy()
    expect(screen.getByText(/todavía no está en la tarifa/)).toBeInTheDocument()
  })
})
