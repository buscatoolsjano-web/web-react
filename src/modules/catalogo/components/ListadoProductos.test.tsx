// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ProductoListado } from '../types'

const estado = vi.hoisted(() => ({ movil: false }))
vi.mock('@/hooks/useMediaQuery', () => ({
  useIsMobile: () => estado.movil,
  useMediaQuery: () => !estado.movil,
}))

vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: (): { activa: { companyId: string; esInterno: boolean } } => ({
    activa: { companyId: 'empresa-1', esInterno: true },
  }),
}))

/*
 * Fase 22 · Etapa B: la ficha dejó de ser sólo un cartel y busca similares.
 * Se mockea la búsqueda para que estos tests sigan siendo del LISTADO.
 *
 * El mock NO importa el módulo real. Hacerlo —`await real()`— arrastra
 * `services/supabase/client`, que llama a `getEnv()` al importarse y exige
 * variables de entorno. En local hay `.env` y pasaba; en la suite aislada
 * —que corre como si no existiera, justamente para cachar esto— fallaba, y
 * eso es lo que tira el deploy en CI.
 *
 * Se declara lo que el listado usa y nada más.
 */
/*
 * Y también el hook: `PopoverProducto` usa `useSimilares`, que vive en
 * `hooks/useProductos`, que importa el service. Mockear sólo el service no
 * alcanza — el import del hook ya arrastra la cadena.
 */
vi.mock('../hooks/useProductos', () => ({
  useSimilares: () => ({ data: { productos: [], fuentes: new Map() }, isPending: false }),
  useProductos: () => ({ data: { productos: [], total: 0 }, isPending: false, isFetching: false, error: null, refetch: vi.fn() }),
  useDisponibilidad: () => ({ data: undefined }),
  useProductoPorId: () => ({ data: null, isPending: false, error: null }),
  useMovimientos: () => ({ data: undefined, isFetching: false }),
}))
vi.mock('../services/productos', () => ({
  similaresDe: () => Promise.resolve({ productos: [], fuentes: new Map() }),
  consultarProductos: () => Promise.resolve({ productos: [], total: 0 }),
  consultarTodosLosProductos: () => Promise.resolve({ productos: [], total: 0, truncado: false }),
  contarCatalogoCompleto: () => Promise.resolve(0),
}))

const { ListadoProductos } = await import('./ListadoProductos')

/**
 * El listado del catálogo con el producto encima (Fase 21 · E1).
 *
 * Lo que se prueba acá es el comportamiento de la fila —que abrir el producto
 * sea barato y no se dispare sin querer—, no el contenido del modal.
 */
const producto = (p: Partial<ProductoListado> = {}): ProductoListado => ({
  id: 'p1',
  sku: 'SP.2520/8B',
  nombre: 'SPEEDRILL 2520/8B ADAPTADOR',
  modelo: '2520/8B',
  serie: 'Adaptador',
  tipo: 'Adaptador',
  esKit: false,
  necesitaRevision: false,
  marca: { id: 'm1', nombre: 'SPEEDRILL' },
  categoria: { id: 'c1', nombre: 'Puntas y tubos', slug: 'punta' },
  atributos: { encastre: '1/4 HEX', largo: '200', medida: '8' },
  precio: 83.37,
  precioDesde: null,
  precioOrigen: 'tarifa',
  precioTarifa: 83.37,
  stock: { real: 16, virtual: 16 },
  disponible: null,
  imagen: null,
  enCatalogo: true,
  motivoFueraDelCatalogo: null,
  ...p,
})

const definiciones = [
  { key: 'encastre', label: 'Encastre', unidad: null, tipo: 'text' as const, filtrable: true, posicion: 1, enumerada: false, rango: null, opciones: [], enFicha: true },
  { key: 'largo', label: 'Largo', unidad: 'mm', tipo: 'text' as const, filtrable: true, posicion: 2, enumerada: false, rango: null, opciones: [], enFicha: true },
]

const montar = (props: Partial<Parameters<typeof ListadoProductos>[0]> = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>
      <ListadoProductos
        productos={[producto()]}
        esInterno
        moneda="USD"
        disponibilidad={undefined}
        unidades={new Map()}
        cargando={false}
        definiciones={definiciones}
        {...props}
      />
    </MemoryRouter>
    </QueryClientProvider>,
  )

beforeEach(() => {
  estado.movil = false
  vi.useRealTimers()
})

describe('La fila abre el producto encima del catálogo', () => {
  it('un click en cualquier celda lo abre, sin navegar', () => {
    const abrir = vi.fn()
    montar({ onAbrirProducto: abrir })
    fireEvent.click(screen.getByText('SPEEDRILL'))
    expect(abrir).toHaveBeenCalledWith('p1')
  })

  /**
   * Fase 25 · E4: **la referencia abre lo mismo que el resto de la fila.**
   *
   * Fase 38: el enlace era el NOMBRE del producto; ahora es la REFERENCIA,
   * porque la columna del nombre se fue —era la más ancha de la tabla y decía
   * lo mismo que las tres de al lado—. El comportamiento no cambió.
   *
   * Antes navegaba a la ficha, y el mismo producto se veía de dos formas
   * distintas según dónde se hubiera tocado. Sigue siendo un `<a>` con href de
   * verdad —eso es lo que hace que ctrl-click y «abrir en pestaña nueva»
   * lleven a la ficha, que es una URL compartible—, pero el click pelado abre
   * el modal.
   */
  it('la referencia abre el modal, y sigue teniendo el href de la ficha', () => {
    const abrir = vi.fn()
    montar({ onAbrirProducto: abrir })
    const link = screen.getByRole('link', { name: 'SP.2520/8B' })
    expect(link).toHaveAttribute('href', '/catalogo/SP.2520%2F8B')
    fireEvent.click(link)
    expect(abrir).toHaveBeenCalledTimes(1)
    expect(abrir).toHaveBeenCalledWith('p1')
  })

  it('Ctrl+click en la referencia no abre el modal: se está abriendo la ficha en otra pestaña', () => {
    const abrir = vi.fn()
    montar({ onAbrirProducto: abrir })
    fireEvent.click(screen.getByRole('link', { name: 'SP.2520/8B' }), { ctrlKey: true })
    expect(abrir).not.toHaveBeenCalled()
  })

  it('sin modal —otra pantalla que reusa el listado— la referencia sigue siendo el enlace a la ficha', () => {
    montar({})
    expect(screen.getByRole('link', { name: 'SP.2520/8B' })).toHaveAttribute(
      'href',
      '/catalogo/SP.2520%2F8B',
    )
  })

  it('Ctrl+click no lo abre: se está abriendo en otra pestaña', () => {
    const abrir = vi.fn()
    montar({ onAbrirProducto: abrir })
    fireEvent.click(screen.getByText('SPEEDRILL').closest('tr')!, { ctrlKey: true })
    expect(abrir).not.toHaveBeenCalled()
  })

  it('Shift+click tampoco: es una selección', () => {
    const abrir = vi.fn()
    montar({ onAbrirProducto: abrir })
    fireEvent.click(screen.getByText('SPEEDRILL').closest('tr')!, { shiftKey: true })
    expect(abrir).not.toHaveBeenCalled()
  })

  it('con el teclado: la fila se enfoca y Enter abre', () => {
    const abrir = vi.fn()
    montar({ onAbrirProducto: abrir })
    const fila = screen.getByText('SPEEDRILL').closest('tr')!
    expect(fila).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(fila, { key: 'Enter' })
    expect(abrir).toHaveBeenCalledWith('p1')
  })

  /**
   * Fase 25 · E2: Stock real y Stock virtual son DOS columnas, cada una con su
   * encabezado ordenable — como el legacy (`app.js:15518`). Juntas en «12 / 10»
   * no se podían ordenar por separado, que es lo que se pidió.
   */
  it('el stock son dos columnas, y las dos ordenan', () => {
    montar({ onAbrirProducto: vi.fn(), orden: { campo: 'stock_real', direccion: 'desc', ordenar: vi.fn() } })
    const real = screen.getByRole('columnheader', { name: /Stock real/ })
    const virtual = screen.getByRole('columnheader', { name: /Stock virtual/ })
    expect(real).toHaveAttribute('aria-sort', 'descending')
    expect(virtual).toHaveAttribute('aria-sort', 'none')
    expect(real.querySelector('button')).not.toBeNull()
    expect(virtual.querySelector('button')).not.toBeNull()
  })

  it('tocar el encabezado de un saldo pide ese orden', () => {
    const ordenar = vi.fn()
    montar({ onAbrirProducto: vi.fn(), orden: { campo: 'nombre', direccion: 'asc', ordenar } })
    fireEvent.click(screen.getByRole('columnheader', { name: /Stock virtual/ }).querySelector('button')!)
    expect(ordenar).toHaveBeenCalledWith('stock_virtual')
  })

  /**
   * «Sin saldo registrado» no es cero (Fase 21 · E3.1), y separar las columnas
   * no cambia eso: son 21.449 productos de 21.828 sin ninguna fila en
   * `stock_balances`.
   */
  it('un producto sin saldo muestra «—» en las dos columnas, no cero', () => {
    montar({ onAbrirProducto: vi.fn(), productos: [producto({ stock: null })] })
    expect(screen.getAllByText('Sin saldo registrado')).toHaveLength(2)
    expect(screen.queryByText('0')).toBeNull()
  })

  /**
   * Fase 25 · E3: «Datos a revisar» ya no se muestra en el Catálogo. Lo tenían
   * 12.593 de 21.828 productos, así que marcaba más de la mitad del catálogo.
   * El dato sigue en la base y en Configuración.
   */
  it('no se muestra «Datos a revisar», aunque el producto lo tenga', () => {
    montar({ onAbrirProducto: vi.fn(), productos: [producto({ necesitaRevision: true })] })
    expect(screen.queryByText('Datos a revisar')).toBeNull()
  })

  it('pero «Kit» sí se sigue mostrando', () => {
    montar({ onAbrirProducto: vi.fn(), productos: [producto({ esKit: true, necesitaRevision: true })] })
    expect(screen.getByText('Kit')).toBeInTheDocument()
    expect(screen.queryByText('Datos a revisar')).toBeNull()
  })

  it('el producto abierto queda marcado', () => {
    montar({ onAbrirProducto: vi.fn(), abierto: 'p1' })
    expect(screen.getByText('SPEEDRILL').closest('tr')).toHaveAttribute('aria-current', 'true')
  })
})

describe('La ficha al vuelo', () => {
  it('aparece al pasar por la imagen, con los datos que YA tiene la fila', () => {
    vi.useFakeTimers()
    montar({ onAbrirProducto: vi.fn() })
    const celda = screen.getByText('SPEEDRILL').closest('tr')!.querySelector('td')!

    fireEvent.mouseEnter(celda)
    // El retardo existe para que pasar el mouse camino al buscador no abra
    // veinte fichas.
    expect(screen.queryByRole('tooltip')).toBeNull()
    // El temporizador corre dentro de React: sin act(), el estado que
    // abre la ficha se actualiza fuera del render y el test no lo ve.
    act(() => {
      vi.advanceTimersByTime(300)
    })

    const pop = screen.getByRole('tooltip')
    expect(pop).toHaveTextContent('SP.2520/8B')
    expect(pop).toHaveTextContent('Encastre')
    expect(pop).toHaveTextContent('1/4 HEX')
    // Y el precio y el stock de la fila, sin pedir nada.
    expect(pop).toHaveTextContent('83,37')
    expect(pop).toHaveTextContent('16')

    fireEvent.mouseLeave(celda)
    // Fase 22 · Etapa B: el cierre espera 180 ms. La ficha dejó de ser un
    // cartel y tiene un comparador adentro; entre la miniatura y la ficha hay
    // un hueco de 12 px, y cerrar al instante hacía imposible cruzarlo.
    expect(screen.queryByRole('tooltip')).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(screen.queryByRole('tooltip')).toBeNull()
    vi.useRealTimers()
  })

  it('entrar en la ficha cancela el cierre: se puede llegar al comparador', () => {
    vi.useFakeTimers()
    montar({ onAbrirProducto: vi.fn() })
    const celda = screen.getByText('SPEEDRILL').closest('tr')!.querySelector('td')!
    fireEvent.mouseEnter(celda)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    const pop = screen.getByRole('tooltip')

    // El mouse sale de la miniatura y entra en la ficha, que es el recorrido
    // normal para ir a tocar un similar.
    fireEvent.mouseLeave(celda)
    fireEvent.mouseEnter(pop)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.queryByRole('tooltip')).not.toBeNull()

    // Y salir de la ficha sí la cierra.
    fireEvent.mouseLeave(pop)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(screen.queryByRole('tooltip')).toBeNull()
    vi.useRealTimers()
  })

  it('Escape la cierra sin mover el mouse', () => {
    vi.useFakeTimers()
    montar({ onAbrirProducto: vi.fn() })
    const celda = screen.getByText('SPEEDRILL').closest('tr')!.querySelector('td')!
    fireEvent.mouseEnter(celda)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(screen.queryByRole('tooltip')).not.toBeNull()
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(screen.queryByRole('tooltip')).toBeNull()
    vi.useRealTimers()
  })

  it('en mobile no hay ficha al vuelo: no existe el hover', () => {
    estado.movil = true
    montar({ onAbrirProducto: vi.fn() })
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})

/*
 * ANCHOS AJUSTABLES EN EL CATÁLOGO (Fase 58 · E6).
 *
 * «Es importante que las columnas respeten su tamaño… pero también quiero yo
 * poder ir modificando el tamaño de las columnas, tipo ir agarrando y
 * ampliarlo, achicarlo».
 *
 * Que los anchos se RESPETEN ya lo resolvió la Fase 39 con
 * `table-layout: fixed`. Lo que se prueba acá es lo otro: que se puedan
 * cambiar, que el cambio quede, y sobre todo que agarrar el borde no dispare
 * el orden de la columna ni abra la ficha del producto, que son las dos cosas
 * que ya hacía un clic ahí.
 */
import { leerAnchos, MIN_PX } from '@/components/tables/anchoDeColumnas'

const tiradorDe = (etiqueta: string) => screen.getByRole('separator', { name: `Ancho de ${etiqueta}` })

const anchoTh = (etiqueta: string) =>
  Number.parseInt(screen.getByRole('columnheader', { name: new RegExp(etiqueta) }).style.width, 10)

function arrastrarEn(etiqueta: string, deltaPx: number) {
  const t = tiradorDe(etiqueta)
  act(() => {
    fireEvent.pointerDown(t, { clientX: 400 })
  })
  act(() => {
    fireEvent.pointerMove(window, { clientX: 400 + deltaPx })
  })
  act(() => {
    fireEvent.pointerUp(window, { clientX: 400 + deltaPx })
  })
}

describe('El ancho de las columnas del catálogo', () => {
  beforeEach(() => localStorage.clear())

  it('las columnas de texto traen un tirador y un ancho declarado', () => {
    montar()
    // Referencia se hizo ajustable en la Fase 107 (pedido explícito): también
    // se agarra del borde y se ensancha, como Modelo o Marca.
    for (const etiqueta of ['Referencia', 'Modelo', 'Marca', 'Tipo']) {
      expect(tiradorDe(etiqueta)).toBeInTheDocument()
      expect(anchoTh(etiqueta)).toBeGreaterThanOrEqual(MIN_PX)
    }
  })

  /* Las de ancho conocido lo piden en píxeles en el CSS desde la Fase 39: ahí
     el reparto ya es el bueno y no hay nada que ajustar a mano. */
  it('las columnas de ancho fijo no llevan tirador', () => {
    montar()
    expect(screen.queryByRole('separator', { name: 'Ancho de Precio' })).toBeNull()
    expect(screen.queryByRole('separator', { name: 'Ancho de Stock real' })).toBeNull()
  })

  it('arrastrar ensancha esa columna y no la de al lado', () => {
    montar()
    const antes = anchoTh('Modelo')
    const vecina = anchoTh('Marca')

    arrastrarEn('Modelo', 70)

    expect(anchoTh('Modelo')).toBe(antes + 70)
    expect(anchoTh('Marca')).toBe(vecina)
  })

  it('el ancho queda guardado y vuelve al recargar', () => {
    const { unmount } = montar()
    arrastrarEn('Marca', 90)
    const dejado = anchoTh('Marca')
    expect(leerAnchos('catalogo').marca).toBe(dejado)
    unmount()

    montar()
    expect(anchoTh('Marca')).toBe(dejado)
  })

  /*
   * LAS DOS COSAS QUE YA HACÍA UN CLIC AHÍ. La cabecera ordena y la fila abre
   * el producto: si el tirador no detuviera el evento, cada ajuste de ancho
   * reordenaría la tabla de paso.
   */
  it('agarrar el borde no reordena la columna', () => {
    const ordenar = vi.fn()
    montar({ orden: { campo: 'sku', direccion: 'asc', ordenar } })
    act(() => {
      fireEvent.click(tiradorDe('Modelo'))
    })
    expect(ordenar).not.toHaveBeenCalled()
  })

  // Las flechas, para quien no puede hacer un arrastre preciso con el mouse.
  it('se puede ajustar con el teclado', () => {
    montar()
    const antes = anchoTh('Tipo')
    act(() => {
      fireEvent.keyDown(tiradorDe('Tipo'), { key: 'ArrowRight' })
    })
    expect(anchoTh('Tipo')).toBeGreaterThan(antes)
  })

  it('las columnas de atributos también se ajustan, cada una con su clave', () => {
    montar({ columnasDinamicas: [{ key: 'encastre', label: 'Encastre', unidad: null }] })
    arrastrarEn('Encastre', 50)
    // Con el prefijo `attr:`, para que un atributo llamado como una columna
    // fija no le pise el ancho.
    expect(Object.keys(leerAnchos('catalogo'))).toContain('attr:encastre')
  })

  it('en mobile no hay tiradores: son cards, no columnas', () => {
    estado.movil = true
    montar()
    expect(screen.queryByRole('separator')).toBeNull()
  })
})
