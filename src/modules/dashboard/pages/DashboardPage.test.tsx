// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/*
 * El cliente de Supabase pide las variables de entorno AL IMPORTARSE, y acá
 * llega de arrastre: el componente importa un service y el service lo importa
 * a él. En local hay .env y no se nota; en CI el paso de tests no recibe
 * secrets y el deploy se cae. Lo detecta `npm run test:isolated`, que corre
 * la suite como si no existiera .env.
 *
 * El doble vacio alcanza porque este test no usa Supabase para nada.
 */
vi.mock('@/services/supabase/client', () => ({ supabase: {} }))


/**
 * El Dashboard (Fase 21 · E2).
 *
 * Todo lo que lee viene de hooks que ya existen, así que se mockean enteros:
 * sin Supabase ni red. Lo que se prueba es lo que puede mentir en pantalla —un
 * mes a medias comparado contra uno entero, un +100 % sobre cero, monedas
 * sumadas, un número que lleva a una lista distinta— y qué ve cada rol.
 */
interface Consulta {
  isPending: boolean
  error: Error | null
  data: unknown
}
interface Estado {
  rol: string
  stel: boolean
  pipeline: Consulta
  actividad: Consulta
  atencion: Consulta
  cuentas: unknown[]
  bandeja: Consulta
  porPersona: Consulta
  ultimos: { documentos: unknown[]; cargando: boolean; error: Error | null; parcial: boolean }
  porEntregar: { total: number; filas: unknown[] }
  documentos: { sent: { total: number; filas: unknown[] }; draft: { total: number; filas: unknown[] } }
}
const estado = vi.hoisted<Estado>(() => ({
  rol: 'admin',
  stel: false,
  pipeline: { isPending: false, error: null, data: null },
  actividad: { isPending: false, error: null, data: null },
  atencion: { isPending: false, error: null, data: null },
  cuentas: [{ id: 'a1' }],
  bandeja: { isPending: false, error: null, data: { total: 3, totalSinLeer: 2, filas: [] } },
  porPersona: {
    isPending: false,
    error: null,
    data: [],
  },
  ultimos: { documentos: [], cargando: false, error: null, parcial: false },
  porEntregar: { total: 28, filas: [] },
  documentos: { sent: { total: 2, filas: [] }, draft: { total: 1, filas: [] } },
}))
const refetch = vi.hoisted(() => vi.fn())
const reintentar = vi.hoisted(() => vi.fn())

/* Quién mira: el inicio acomodado se guarda en SU perfil (Fase 76). */
vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u-yo', email: 'jano@buscatools.com.ar' } }),
}))
/* Y la preferencia misma: estos tests son del tablero, no del guardado, pero
   se anota lo que se manda para poder comprobar que se guarda. */
const guardados = vi.hoisted(() => [] as unknown[])
vi.mock('../services/inicio', () => ({
  leerInicio: () => Promise.resolve(null),
  guardarInicio: (v: unknown) => {
    guardados.push(v)
    return Promise.resolve(v)
  },
}))
vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1', companyName: 'ZZ Empresa', rol: estado.rol, esInterno: true }, cargando: false }),
}))
/* Fase 63: el desglose de un mes pide los documentos de ese mes. Acá se
   mockea el servicio —estos tests son del panel, no de la consulta— y se
   devuelve lo que pida cada tipo. */
vi.mock('@/modules/informes/services/documentos', () => ({
  obtenerDocumentosInforme: (_c: string, f: { tipo?: string | null }) =>
    Promise.resolve({
      total: 0,
      totalImporte: 0,
      filas:
        f.tipo === 'cotizaciones'
          ? [{ tipo: 'cotizaciones', id: 'c1', numero: 'COTI02585', fecha: '2026-09-04', clienteId: null,
               cliente: 'Grupo Mirgor S.A.', estado: 'sent', serie: null, origen: null, moneda: 'USD',
               importe: 15210.91, enRevision: false }]
          : f.tipo === 'pedidos'
            ? [{ tipo: 'pedidos', id: 'p1', numero: 'PDV01321', fecha: '2026-09-06', clienteId: null,
                 cliente: 'Dacatec S.R.L.', estado: 'confirmed', serie: null, origen: null, moneda: 'USD',
                 importe: 975.32, enRevision: false }]
            : [],
    }),
}))

vi.mock('@/modules/informes/services/actividad', () => ({
  ErrorInforme: class ErrorInforme extends Error {},
}))
vi.mock('@/modules/informes/hooks/useActividad', () => ({
  usePipeline: () => ({ ...estado.pipeline, isFetching: false, refetch }),
  useActividad: () => ({ ...estado.actividad, isFetching: false, refetch }),
}))
vi.mock('@/modules/dashboard/hooks/useDashboard', () => ({
  useAtencion: () => ({ ...estado.atencion, isFetching: false, refetch }),
  useUltimosDocumentos: () => ({ ...estado.ultimos, reintentar }),
  usePendientePorPersona: () => ({ ...estado.porPersona, refetch }),
}))
vi.mock('@/modules/emails/hooks/useEmails', () => ({
  useCuentas: () => ({ data: estado.cuentas, isPending: false }),
  useBandeja: () => ({ ...estado.bandeja, refetch }),
}))
vi.mock('@/modules/ventas/hooks/useAutoridadNumeracion', () => ({
  useAutoridadNumeracion: () => ({ stel: () => estado.stel, cargando: false }),
}))
vi.mock('@/modules/ventas/hooks/useDocumentos', () => ({
  // Los pedidos por entregar se piden con los MISMOS filtros que el listado
  // de destino, así que el mock distingue por el filtro y no por el tipo.
  useDocumentos: (_t: string, f: { estado: 'sent' | 'draft' | null; pendienteDeEntrega?: boolean }) => ({
    data: f.pendienteDeEntrega ? estado.porEntregar : estado.documentos[f.estado ?? 'sent'],
    isPending: false,
    error: null,
    isFetching: false,
    refetch,
  }),
}))

const { DashboardPage } = await import('./DashboardPage')

const cifra = (documentos: number, importe: number) => ({ documentos, importe, enRevision: 0 })

/** Los números reales de septiembre 2026, medidos en producción. */
const ACTIVIDAD = {
  actual: { desde: '2026-09-01', hasta: '2026-09-22', parcial: true },
  anterior: { desde: '2026-08-01', hasta: '2026-08-22', parcial: false },
  kpis: [
    {
      tipo: 'cotizaciones',
      documentosActual: 30,
      documentosAnterior: 24,
      enRevisionActual: 0,
      sinMonedaEnRevisionActual: 0,
      monedas: [
        { moneda: 'USD', actual: cifra(27, 90518.55), anterior: cifra(17, 63493.94), variacion: 42.56 },
        { moneda: 'ARS', actual: cifra(3, 3501735.15), anterior: cifra(7, 7795023.92), variacion: -55.08 },
        // El EUR existe en la historia y no tuvo movimiento este mes.
        { moneda: 'EUR', actual: cifra(0, 0), anterior: cifra(1, 500), variacion: -100 },
      ],
    },
    {
      tipo: 'pedidos',
      documentosActual: 22,
      documentosAnterior: 19,
      enRevisionActual: 0,
      sinMonedaEnRevisionActual: 0,
      monedas: [{ moneda: 'USD', actual: cifra(19, 25348.68), anterior: cifra(0, 0), variacion: null }],
    },
    { tipo: 'entregas', documentosActual: 0, documentosAnterior: 0, enRevisionActual: 0, sinMonedaEnRevisionActual: 0, monedas: [] },
  ],
  series: [
    {
      tipo: 'cotizaciones',
      monedas: ['USD', 'ARS'],
      meses: [
        { mes: '2026-08-01', porMoneda: { USD: cifra(17, 63493.94), ARS: cifra(7, 7795023.92) } },
        { mes: '2026-09-01', porMoneda: { USD: cifra(27, 90518.55) } },
      ],
    },
    { tipo: 'pedidos', monedas: ['USD'], meses: [{ mes: '2026-09-01', porMoneda: { USD: cifra(19, 25348.68) } }] },
    { tipo: 'entregas', monedas: [], meses: [] },
  ],
}

const PIPELINE = {
  abiertas: [
    { moneda: 'USD', documentos: 120, importe: 300000, aceptadas: 9, porAntiguedad: {} },
    { moneda: 'ARS', documentos: 34, importe: 8000000, aceptadas: 2, porAntiguedad: {} },
  ],
  pendientes: [{ moneda: 'USD', sinEntrega: { documentos: 20, importe: 700 }, parcial: { documentos: 8, importe: 300 } }],
}

const ATENCION = {
  total: 219,
  conNoVerificable: 20,
  documentos: [
    { id: 'd1', tipo: 'cotizacion', numero: 'COTI-T00123', fecha: '2026-09-18', activos: ['x'], noVerificables: [] },
    { id: 'd2', tipo: 'pedido', numero: 'PDV01320', fecha: '2026-09-17', activos: [], noVerificables: ['y'] },
  ],
}

const DOC = (tipo: string, numero: string, fecha: string, moneda: string, total: number, id = numero) => ({
  id, tipo, numero, fecha, clienteId: 'c', clienteNombre: 'Cliente X', titulo: null, moneda, total,
  estado: tipo === 'cotizacion' ? 'sent' : tipo === 'pedido' ? 'confirmed' : 'delivered',
  estadoSecundario: null, vendedor: null, serie: null, origen: null,
  necesitaRevision: false, motivosRevision: [], numeroFueraDeSerie: false,
})

/* El desglose del mes usa `useQuery` de verdad (Fase 63): el resto de los
   datos llega por hooks mockeados, pero ése se ejerce entero, así que el
   panel necesita su cliente. Sin reintentos: un fallo en un test tiene que
   verse enseguida, no después de tres vueltas. */
/**
 * El tablero por persona, tal como lo devuelve la RPC.
 *
 * Es una FUNCIÓN y no una constante porque algunos tests le sacan la fila
 * propia o la vacían, y un objeto compartido se llevaría ese cambio al test
 * siguiente.
 */
const POR_PERSONA = () => [
  {
    userId: 'u-nor', nombre: 'Norberto', rol: 'employee', esMio: false,
    correos: 4, cotizaciones: 0, pedidos: 0,
    hecho: { cotizaciones: 0, pedidos: 0, entregas: 0, correos: 0 },
  },
  // La fila del que mira, que el servidor marca con `auth.uid()`.
  {
    userId: 'u-yo', nombre: 'Jano', rol: 'admin', esMio: true,
    correos: 2, cotizaciones: 1, pedidos: 0,
    hecho: { cotizaciones: 3, pedidos: 1, entregas: 2, correos: 5 },
  },
  {
    userId: null, nombre: 'Sin asignar', rol: '', esMio: false,
    correos: 717, cotizaciones: 143, pedidos: 28,
    hecho: { cotizaciones: 9, pedidos: 4, entregas: 4, correos: 0 },
  },
]

const montar = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )

beforeEach(() => {
  estado.rol = 'admin'
  estado.stel = false
  estado.pipeline = { isPending: false, error: null, data: PIPELINE }
  estado.actividad = { isPending: false, error: null, data: ACTIVIDAD }
  estado.atencion = { isPending: false, error: null, data: ATENCION }
  estado.cuentas = [{ id: 'a1' }]
  estado.bandeja = { isPending: false, error: null, data: { total: 3, totalSinLeer: 2, filas: [] } }
  estado.ultimos = {
    documentos: [DOC('entrega', 'RT-ERP00001', '2026-09-21', 'USD', 157.91), DOC('cotizacion', 'COTI-T00030', '2026-09-20', 'ARS', 235950)],
    cargando: false,
    error: null,
    parcial: false,
  }
  estado.documentos = { sent: { total: 2, filas: [] }, draft: { total: 1, filas: [] } }
  estado.porEntregar = { total: 28, filas: [] }
  estado.porPersona = { isPending: false, error: null, data: POR_PERSONA() }
  refetch.mockClear()
  reintentar.mockClear()
})

/*
 * EL PERÍODO YA NO TIENE RENGLÓN PROPIO (Fase 77).
 *
 * Arriba de todo decía «Septiembre 2026 · Datos al 22 de septiembre» y, al
 * costado, contra qué ventana se compara. Se pidió sacarlo para ganar alto, y
 * se puede: cada tarjeta de números YA dice su ventana —«1–22 de septiembre»—
 * abajo del porcentaje, que es donde hace falta para no leer «bajó 22 %» como
 * un derrumbe cuando son ocho días que faltan.
 *
 * Lo único que no estaba repetido —contra qué se compara— bajó a los números,
 * que es lo que explica.
 */
describe('A · El período se dice donde se usa', () => {
  it('el encabezado ya no se lleva un renglón para el mes', () => {
    montar()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Dashboard')
    expect(screen.queryByText('Septiembre 2026')).toBeNull()
    expect(screen.queryByText(/· Datos al 22 de septiembre/)).toBeNull()
  })

  it('el subtítulo va al lado del título, no abajo', () => {
    montar()
    const linea = screen.getByRole('heading', { level: 1 }).parentElement!
    expect(linea).toHaveTextContent(/Resumen operativo y comercial de ZZ Empresa/)
  })

  it('contra qué se compara está con los números', () => {
    montar()
    const texto = screen.getByText('Se compara 1–22 de septiembre contra 1–22 de agosto')
    // En el mismo bloque que las tres tarjetas, no en el encabezado.
    const bloque = texto.parentElement!
    expect(bloque).toHaveTextContent('Cotizado')
    expect(bloque).toHaveTextContent('Pedidos')
    expect(bloque).toHaveTextContent('Entregado')
  })
})

describe('B · Situación del mes', () => {
  /*
   * Fase 63: el gráfico pasó a estar arriba de todo, así que «va primero» ya
   * no es «es el primer encabezado de la página» sino «es el primero de los
   * KPI». El orden ENTRE los tres es lo que este test siempre cuidó.
   */
  it('Cotizado es el protagonista y va primero de los tres', () => {
    montar()
    const titulos = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    const kpis = titulos.filter((t) => t === 'Cotizado' || t === 'Pedidos' || t === 'Entregado')
    expect(kpis).toEqual(['Cotizado', 'Pedidos', 'Entregado'])
  })

  /*
   * Y ESTO ES LO NUEVO. «Lo que está arriba ahora son números, pero al no
   * haber muchos gráficos no se entiende bien». Un KPI dice «bajó 22 %» sin
   * decir contra qué forma: los doce meses son el contexto que vuelve
   * legibles a los números que siguen.
   */
  it('el gráfico va arriba de los números', () => {
    montar()
    const titulos = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(titulos.indexOf('Evolución · últimos 12 meses')).toBeLessThan(titulos.indexOf('Cotizado'))
  })

  it('una línea por moneda, sin ningún total entre monedas', () => {
    montar()
    const cotizado = screen.getByRole('region', { name: 'Cotizado' })
    expect(within(cotizado).getByText('USD 90.518,55')).toBeInTheDocument()
    expect(within(cotizado).getByText('ARS 3.501.735,15')).toBeInTheDocument()
    expect(within(cotizado).getByText('27 cotizaciones')).toBeInTheDocument()
    expect(within(cotizado).getByText('3 cotizaciones')).toBeInTheDocument()
    // 90.518 + 3.501.735 no existe como número.
    expect(cotizado.textContent).not.toMatch(/3\.592\.253|TOTAL/i)
  })

  it('el EUR no ocupa una línea si no tuvo movimiento este mes', () => {
    montar()
    expect(within(screen.getByRole('region', { name: 'Cotizado' })).queryByText(/EUR/)).toBeNull()
  })

  it('la comparación dice la dirección con flecha Y texto, no sólo color', () => {
    montar()
    const cotizado = screen.getByRole('region', { name: 'Cotizado' })
    expect(within(cotizado).getByText('Subió 42,6 % vs 1–22 de agosto')).toBeInTheDocument()
    expect(within(cotizado).getByText('Bajó 55,1 % vs 1–22 de agosto')).toBeInTheDocument()
  })

  it('el mes anterior en cero no inventa un +100 %', () => {
    montar()
    const pedidos = screen.getByRole('region', { name: 'Pedidos' })
    expect(within(pedidos).getByText(/Sin base de comparación/)).toBeInTheDocument()
    expect(pedidos.textContent).not.toMatch(/100|∞|Infinity|NaN/)
  })

  it('un tipo sin actividad lo dice con palabras, no con un cero', () => {
    montar()
    expect(within(screen.getByRole('region', { name: 'Entregado' })).getByText('Sin entregas en este período.')).toBeInTheDocument()
  })

  it('si falla la actividad, el bloque avisa y se puede reintentar', () => {
    estado.actividad = { isPending: false, error: new Error('x'), data: null }
    montar()
    const cotizado = screen.getByRole('region', { name: 'Cotizado' })
    fireEvent.click(within(cotizado).getByRole('button', { name: 'Reintentar' }))
    expect(refetch).toHaveBeenCalled()
    // Y el resto del Dashboard sigue en pie.
    expect(screen.getByRole('heading', { name: 'Atención hoy' })).toBeInTheDocument()
  })
})

describe('C · Atención hoy', () => {
  it('los números accionables, cada uno con su link filtrado', () => {
    montar()
    // Acotado a la sección: desde la Fase 40, «Pendiente por persona» también
    // muestra un 28 —los pedidos sin entregar, sin vendedor asignado— y un
    // `getByText('28')` global encontraba los dos.
    const seccion = screen.getByRole('heading', { name: 'Atención hoy' }).closest('section')!
    expect(within(seccion).getByText('154')).toBeInTheDocument()
    // 28 sale del estado de cumplimiento del servidor —el mismo que filtra la
    // lista de destino—, no de lo entregado línea por línea.
    expect(within(seccion).getByText('28')).toBeInTheDocument()
    expect(within(seccion).getByText('219')).toBeInTheDocument()
    // El link lleva al MISMO número que muestra la tarjeta. El listado ya sabe
    // decir «abierta» —incluidas las 11 aceptadas sin pedido confirmado—, así
    // que no hay que recortar el KPI para que entre en lo que sabía filtrar.
    expect(screen.getByRole('link', { name: /Ver las 154 abiertas/ })).toHaveAttribute('href', '/ventas/cotizaciones?abierta=1')
    expect(screen.getByRole('link', { name: /Ver pedidos pendientes/ })).toHaveAttribute('href', '/ventas/pedidos?pendiente=1')
    /*
     * `sinresponder=1`, no `estado=pendiente` (Fase 40). El viejo contaba 1515
     * sobre 1516 hilos porque `pendiente` es el valor por omisión y nadie lo
     * tocó nunca: incluía lo que mandamos nosotros, los borradores y lo
     * archivado. El link tiene que llevar a la MISMA consulta que da el
     * número, o la tarjeta vuelve a decir una cosa y la lista otra.
     */
    expect(screen.getByRole('link', { name: /Ver la bandeja/ })).toHaveAttribute('href', '/emails?sinresponder=1')
  })

  it('los no verificables se dicen aparte, no se suman al problema', () => {
    montar()
    expect(screen.getByText(/20 tienen algún motivo que no se puede verificar/)).toBeInTheDocument()
  })

  it('el número de revisión se puede abrir y cada documento lleva a su ficha', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: /Ver cuáles son/ }))
    expect(screen.getByRole('link', { name: /COTI-T00123/ })).toHaveAttribute('href', '/ventas/cotizaciones/d1')
    expect(screen.getByRole('link', { name: /PDV01320/ })).toHaveAttribute('href', '/ventas/pedidos/d2')
  })

  it('Mantenimiento NO aparece: 0 órdenes no es trabajo pendiente', () => {
    montar()
    // Se mira DENTRO de Atención: «Órdenes de servicio» sigue siendo un acceso
    // rápido del menú, y eso está bien; lo que no puede es contarse como
    // trabajo pendiente del día.
    const atencion = screen.getByRole('heading', { name: 'Atención hoy' }).closest('section')!
    expect(within(atencion).queryByText(/Órdenes de servicio/)).toBeNull()
    expect(within(atencion).queryByText(/stock crítico/i)).toBeNull()
    expect(within(atencion).queryByText(/historial/i)).toBeNull()
  })

  it('sin cuenta de correo, la tarjeta de Emails no existe', () => {
    estado.cuentas = []
    montar()
    expect(screen.queryByText('Emails sin responder')).toBeNull()
  })

  // Al revés que la de arriba: CON cuenta, la tarjeta está. Si no se comprueba
  // esto, renombrar la tarjeta deja a la prueba negativa pasando por vacío.
  it('con cuenta de correo, la tarjeta de Emails está', () => {
    montar()
    expect(screen.getByText('Emails sin responder')).toBeInTheDocument()
  })

  it('sin nada pendiente, lo dice en vez de mostrar cuatro ceros', () => {
    estado.pipeline = { isPending: false, error: null, data: { abiertas: [], pendientes: [] } }
    estado.atencion = { isPending: false, error: null, data: { total: 0, conNoVerificable: 0, documentos: [] } }
    estado.bandeja = { isPending: false, error: null, data: { total: 0, totalSinLeer: 0, filas: [] } }
    estado.porEntregar = { total: 0, filas: [] }
    montar()
    expect(screen.getByText(/Nada pendiente/)).toBeInTheDocument()
  })
})

/*
 * D · La evolución, rehecha en la Fase 62.
 *
 * Los tests de antes describían el diseño viejo —un selector EXCLUYENTE de
 * métrica y una sola serie en pantalla— y por eso se reescribieron: lo que se
 * pidió fue justamente poder comparar las tres a la vez. Lo que NO cambia, y
 * sigue teniendo su test, es que nunca se mezclan dos monedas.
 */
describe('D · La evolución', () => {
  const leyenda = () => screen.getByRole('group', { name: 'Series a comparar' })

  it('las tres series se ven a la vez, y la leyenda dice cuál es cuál', () => {
    montar()
    expect(screen.getByRole('heading', { name: 'Evolución · últimos 12 meses' })).toBeInTheDocument()
    for (const s of ['Cotizado', 'Pedidos', 'Entregado']) {
      expect(within(leyenda()).getByRole('button', { name: s })).toHaveAttribute('aria-pressed', 'true')
    }
  })

  it('se puede apagar una serie para comparar sólo dos', () => {
    montar()
    fireEvent.click(within(leyenda()).getByRole('button', { name: 'Pedidos' }))
    expect(within(leyenda()).getByRole('button', { name: 'Pedidos' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(leyenda()).getByRole('button', { name: 'Cotizado' })).toHaveAttribute('aria-pressed', 'true')
  })

  /* Un gráfico sin ninguna serie no dice nada y deja al lector sin una forma
     obvia de volver. */
  it('la última serie encendida no se puede apagar', () => {
    montar()
    fireEvent.click(within(leyenda()).getByRole('button', { name: 'Pedidos' }))
    fireEvent.click(within(leyenda()).getByRole('button', { name: 'Entregado' }))
    fireEvent.click(within(leyenda()).getByRole('button', { name: 'Cotizado' }))
    expect(within(leyenda()).getByRole('button', { name: 'Cotizado' })).toHaveAttribute('aria-pressed', 'true')
  })

  /* LO QUE NO CAMBIÓ: una barra que sume ARS con USD no es más alta, es falsa. */
  it('el selector de moneda no mezcla: elige una', () => {
    montar()
    expect(screen.getByText(/Importes en USD/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Moneda'), { target: { value: 'ARS' } })
    expect(screen.getByText(/Importes en ARS/)).toBeInTheDocument()
  })

  /*
   * EL TOOLTIP. Se pidió «si pongo el mouse en algún mes me diga cuánto $», y
   * tiene que decir las tres series de una: el puntero no puede tener que
   * acertarle a una barra de 17 px para leer un número.
   */
  it('al señalar un mes dice el importe de cada serie', () => {
    montar()
    const meses = screen.getAllByRole('button', { name: /Septiembre 2026/ })
    fireEvent.mouseEnter(meses[0]!)
    const tip = screen.getByRole('tooltip')
    expect(within(tip).getByText('Septiembre 2026')).toBeInTheDocument()
    expect(within(tip).getByText('USD 90.518,55')).toBeInTheDocument()
    expect(within(tip).getByText(/Cotizado/)).toBeInTheDocument()
    expect(within(tip).getByText(/Pedidos/)).toBeInTheDocument()
  })

  /* El teclado tiene que llegar al mismo dato que el mouse. */
  it('el mismo detalle aparece al enfocar con el teclado', () => {
    montar()
    fireEvent.focus(screen.getAllByRole('button', { name: /Septiembre 2026/ })[0]!)
    expect(within(screen.getByRole('tooltip')).getByText('USD 90.518,55')).toBeInTheDocument()
  })

  /* El tooltip enriquece, no condiciona: todo valor está también sin pasar el
     mouse, en la tabla. */
  it('«Ver los números» abre la tabla con una columna por serie', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Ver los números' }))
    const tabla = screen.getByRole('table', { name: /por mes en/ })
    expect(within(tabla).getByText('Septiembre 2026')).toBeInTheDocument()
    expect(within(tabla).getByText('USD 90.518,55')).toBeInTheDocument()
    for (const s of ['Cotizado', 'Pedidos', 'Entregado']) {
      expect(within(tabla).getByRole('columnheader', { name: s })).toBeInTheDocument()
    }
  })

  it('sin movimientos en ninguna serie lo dice, no dibuja un gráfico vacío', () => {
    // Sin series no hay nada que graficar, que es distinto de «falló».
    estado.actividad = { ...estado.actividad, data: undefined }
    montar()
    expect(screen.getByText(/Sin movimientos/)).toBeInTheDocument()
  })
})

/*
 * E · El desglose del mes (Fase 63).
 *
 * «Toco octubre y abajo del gráfico se me desglosa qué es lo que hay, así
 * puedo ver qué se cotizó, qué se pidió, qué se entregó».
 */
describe('E · El desglose del mes', () => {
  const mesDe = (nombre: string) => screen.getAllByRole('button', { name: new RegExp(nombre) })[0]!

  it('sin tocar nada no hay desglose, pero invita a tocar', () => {
    montar()
    expect(screen.getByText('Tocá un mes para ver qué hay adentro.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /Detalle de/ })).toBeNull()
  })

  it('al tocar un mes se abre el detalle de ESE mes, debajo del gráfico', async () => {
    montar()
    fireEvent.click(mesDe('Septiembre 2026'))
    const detalle = await screen.findByRole('region', { name: 'Detalle de Septiembre 2026' })
    expect(detalle).toBeInTheDocument()
    // Debajo del gráfico y no encima: un modal taparía la barra recién tocada.
    const grafico = screen.getByRole('heading', { name: 'Evolución · últimos 12 meses' }).closest('section')!
    expect(grafico.contains(detalle)).toBe(true)
  })

  /* Las tres columnas, que es la pregunta tal cual se hizo. */
  it('separa qué se cotizó, qué se pidió y qué se entregó', async () => {
    montar()
    fireEvent.click(mesDe('Septiembre 2026'))
    const detalle = await screen.findByRole('region', { name: /Detalle de/ })
    // Se espera al CONTENIDO: mientras la consulta va y viene, el panel
    // existe pero muestra el esqueleto.
    await within(detalle).findByRole('heading', { name: /Cotizado/ })
    for (const t of ['Pedidos', 'Entregado']) {
      expect(within(detalle).getByRole('heading', { name: new RegExp(t) })).toBeInTheDocument()
    }
  })

  it('cada documento se lista y lleva a su ficha', async () => {
    montar()
    fireEvent.click(mesDe('Septiembre 2026'))
    const detalle = await screen.findByRole('region', { name: /Detalle de/ })
    const enlace = await within(detalle).findByRole('link', { name: /COTI02585/ })
    expect(enlace).toHaveAttribute('href', '/ventas/cotizaciones/c1')
    expect(within(detalle).getByText('Grupo Mirgor S.A.')).toBeInTheDocument()
  })

  /* Un tipo sin movimientos lo dice con palabras: una columna vacía se lee
     como «no cargó» y es otra cosa. */
  it('un tipo sin movimientos lo dice, no deja la columna muda', async () => {
    montar()
    fireEvent.click(mesDe('Septiembre 2026'))
    const detalle = await screen.findByRole('region', { name: /Detalle de/ })
    expect((await within(detalle).findAllByText('Sin movimientos.')).length).toBeGreaterThan(0)
  })

  it('volver a tocar el mismo mes lo cierra', async () => {
    montar()
    fireEvent.click(mesDe('Septiembre 2026'))
    await screen.findByRole('region', { name: /Detalle de/ })
    fireEvent.click(mesDe('Septiembre 2026'))
    expect(screen.queryByRole('region', { name: /Detalle de/ })).toBeNull()
  })

  it('se puede cerrar con su botón', async () => {
    montar()
    fireEvent.click(mesDe('Septiembre 2026'))
    await screen.findByRole('region', { name: /Detalle de/ })
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar el detalle del mes' }))
    expect(screen.queryByRole('region', { name: /Detalle de/ })).toBeNull()
  })
})

/*
 * «Primero quiero ver lo que yo tengo pendiente o qué estuve haciendo este
 * mes, y después abajo el pendiente del resto» (Fase 64).
 */
describe('F · Lo tuyo, antes que lo del resto', () => {
  const miBloque = () => screen.getByRole('region', { name: /Lo tuyo/ })

  it('mi fila sale arriba, con mi nombre y mi rol', () => {
    montar()
    const mio = miBloque()
    expect(within(mio).getByText('Jano')).toBeInTheDocument()
    expect(within(mio).getByText('Administrador')).toBeInTheDocument()
  })

  it('mi pendiente se dice con palabras, no con una fila de números sueltos', () => {
    montar()
    /*
     * `toHaveTextContent` y no `getByText`: el número va en un `<strong>`, y
     * el matcher de `getByText` sólo mira los nodos de texto DIRECTOS del
     * elemento, así que «3 cotizaciones» nunca le llega entero.
     */
    const mio = miBloque()
    expect(mio).toHaveTextContent('2 correos sin responder')
    expect(mio).toHaveTextContent('1 cotización esperando')
    // Cero pedidos NO se lista: un cero no es trabajo pendiente.
    expect(mio).not.toHaveTextContent('pedido por entregar')
  })

  /*
   * El pedido pendiente, que es lo que se pidió ver (Fase 72).
   *
   * Hasta ahora este renglón no aparecía NUNCA: el servidor repartía por
   * `salesperson_id`, que está en null en los 751 documentos, así que todo
   * caía en «Sin asignar». Ahora cuenta también lo que creaste vos, y un
   * pedido sin entregar es exactamente lo que uno quiere ver al entrar.
   */
  it('un pedido mío sin entregar aparece en «Tenés pendiente»', () => {
    estado.porPersona = {
      isPending: false,
      error: null,
      data: POR_PERSONA().map((f) => (f.esMio ? { ...f, pedidos: 1 } : f)),
    }
    montar()
    const mio = miBloque()
    expect(mio).toHaveTextContent('1 pedido por entregar')
    // Y el total de la caja los suma: 2 correos + 1 cotización + 1 pedido.
    expect(within(mio).getByRole('heading', { name: /Tenés pendiente/ })).toHaveTextContent('4')
  })

  /*
   * Y se puede abrir (Fase 73). El listado de Ventas ya filtra por vendedor,
   * con la misma regla que la columna: el vendedor y, si no hay, quien lo
   * creó. Antes estos números eran murallas: decían «tenés uno» y había que
   * ir a buscarlo a mano entre los 193 pedidos.
   */
  it('mi pendiente de ventas lleva al listado filtrado por mí', () => {
    estado.porPersona = {
      isPending: false,
      error: null,
      data: POR_PERSONA().map((f) => (f.esMio ? { ...f, pedidos: 1 } : f)),
    }
    montar()
    const mio = miBloque()
    expect(within(mio).getByRole('link', { name: /1\s*cotización esperando/ })).toHaveAttribute(
      'href',
      '/ventas/cotizaciones?estado=sent&vendedor=u-yo',
    )
    expect(within(mio).getByRole('link', { name: /1\s*pedido por entregar/ })).toHaveAttribute(
      'href',
      '/ventas/pedidos?pendiente=1&vendedor=u-yo',
    )
  })

  it('mi correo pendiente lleva a la bandeja filtrada por mí', () => {
    montar()
    expect(within(miBloque()).getByRole('link', { name: /2\s*correos sin responder/ })).toHaveAttribute(
      'href',
      '/emails?sinresponder=1&asignado=u-yo',
    )
  })

  it('lo que hice este mes se nombra por el mes del encabezado', () => {
    montar()
    const mio = miBloque()
    expect(within(mio).getByRole('heading', { name: /Hiciste en septiembre/ })).toBeInTheDocument()
    expect(mio).toHaveTextContent('3 cotizaciones')
    expect(mio).toHaveTextContent('1 pedido')
    expect(mio).toHaveTextContent('2 remitos')
    expect(mio).toHaveTextContent('5 correos enviados')
  })

  /*
   * EL PIE QUE IMPIDE QUE EL BLOQUE MIENTA.
   *
   * `created_by` sólo lo tienen los documentos nacidos en el ERP; los demás
   * entran por la sincronización de STEL y no registran autor. Sin esta línea,
   * «1 pedido» se leería como «este mes hiciste un solo pedido».
   */
  it('dice cuántos documentos del mes no registran autor', () => {
    montar()
    // 9 + 4 + 4 de la fila «Sin asignar»; el correo no se cuenta porque un
    // correo enviado siempre sabe quién lo mandó.
    expect(within(miBloque()).getByText(/otros 17 documentos de septiembre/)).toBeInTheDocument()
  })

  /*
   * El vacío manda a mirar abajo, que es donde está el montón de STEL. Desde
   * la Fase 72 un vacío acá quiere decir algo más fuerte que antes: no sólo
   * que nadie te asignó nada, sino que tampoco quedó pendiente nada de lo que
   * creaste vos.
   */
  it('sin nada pendiente lo dice, y manda a mirar lo que no es de nadie', () => {
    estado.porPersona = {
      isPending: false,
      error: null,
      data: POR_PERSONA().map((f) => (f.esMio ? { ...f, correos: 0, cotizaciones: 0, pedidos: 0 } : f)),
    }
    montar()
    expect(within(miBloque()).getByText(/No tenés nada pendiente/)).toBeInTheDocument()
  })

  /* Mi fila va ARRIBA y no se repite abajo: leerla dos veces es ruido. */
  it('mi tarjeta no se repite abajo', () => {
    montar()
    const resto = screen.getByRole('heading', { name: 'Pendiente del resto' }).closest('section')!
    expect(within(resto).queryByText('Jano')).toBeNull()
    expect(within(resto).getByText('Norberto')).toBeInTheDocument()
    // «Sin asignar» NUNCA es mía: es el montón que no repartió nadie, y es
    // justamente el dato que hay que seguir viendo abajo.
    expect(within(resto).getByText('Sin asignar')).toBeInTheDocument()
  })

  /* El montón que no repartió nadie: su link pide justamente ésos, los que
     no tienen vendedor ni autor. */
  it('«Sin asignar» abre la lista de los que no son de nadie', () => {
    montar()
    const resto = screen.getByRole('heading', { name: 'Pendiente del resto' }).closest('section')!
    expect(within(resto).getByRole('link', { name: /143\s*cotizaciones esperando/ })).toHaveAttribute(
      'href',
      '/ventas/cotizaciones?estado=sent&vendedor=nadie',
    )
    expect(within(resto).getByRole('link', { name: /28\s*pedidos por entregar/ })).toHaveAttribute(
      'href',
      '/ventas/pedidos?pendiente=1&vendedor=nadie',
    )
  })
  it('cada tarjeta lleva el total de esa persona', () => {
    montar()
    const resto = screen.getByRole('heading', { name: 'Pendiente del resto' }).closest('section')!
    // 717 + 143 + 28 de la fila sin asignar.
    expect(within(resto).getByText('888')).toBeInTheDocument()
  })

  /*
   * Quien no tiene nada pendiente no gasta una tarjeta: va al pie, en una
   * línea. Antes ocupaba una fila entera de ceros, y con cinco personas eso
   * era casi toda la tabla (Fase 74).
   */
  it('los que están libres se nombran al pie, sin tarjeta propia', () => {
    estado.porPersona = {
      isPending: false,
      error: null,
      data: [
        ...POR_PERSONA(),
        {
          userId: 'u-fac', nombre: 'Facundo', rol: 'salesperson', esMio: false,
          correos: 0, cotizaciones: 0, pedidos: 0,
          hecho: { cotizaciones: 0, pedidos: 0, entregas: 0, correos: 0 },
        },
      ],
    }
    montar()
    const resto = screen.getByRole('heading', { name: 'Pendiente del resto' }).closest('section')!
    expect(within(resto).getByText(/Sin nada pendiente: Facundo/)).toBeInTheDocument()
  })

  /* Y el panel entero es de quien reparte: un empleado ve lo suyo y nada más. */
  it('el pendiente del resto sólo lo ve un admin', () => {
    estado.rol = 'employee'
    montar()
    expect(screen.queryByRole('heading', { name: 'Pendiente del resto' })).toBeNull()
    // El bloque propio sigue estando: es su trabajo, no el ajeno.
    expect(screen.getByRole('heading', { name: /Lo tuyo/ })).toBeInTheDocument()
  })

  /*
   * Si el que mira no es miembro listado de la empresa no hay fila propia, y
   * entonces no hay bloque personal: el de abajo queda completo, que es
   * exactamente lo que había antes de esta fase.
   */
  it('sin fila propia no se inventa un bloque personal', () => {
    estado.porPersona = {
      isPending: false,
      error: null,
      data: POR_PERSONA().filter((f) => !f.esMio),
    }
    montar()
    expect(screen.queryByRole('region', { name: /Lo tuyo/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Pendiente del resto' })).toBeInTheDocument()
  })
})

/*
 * El inicio que cada uno acomoda (Fase 76).
 *
 * «Quiero que todos los módulos del inicio sean widgets modificables por
 * usuario, para que cada uno pueda agrandar, achicar, subir y bajar lo que
 * quiera. Y el predeterminado: las acciones rápidas arriba de todo.»
 *
 * Lo que se prueba acá es la pantalla; las reglas de mover y redimensionar
 * están probadas aparte y son puras (`lib/widgets.test.ts`).
 */
describe('G · El inicio se acomoda', () => {
  const titulos = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent?.trim())

  it('de fábrica, los accesos rápidos abren la pantalla', () => {
    montar()
    expect(titulos()[0]).toBe('Accesos rápidos')
  })

  /* Sin encender el modo no hay flechas: el inicio es para mirarlo, no para
     acomodarlo todos los días. */
  it('sin acomodar no hay botones de mover', () => {
    montar()
    expect(screen.queryByRole('button', { name: /^Bajar / })).toBeNull()
    expect(screen.getByRole('button', { name: 'Acomodar' })).toBeInTheDocument()
  })

  it('acomodando, bajar un bloque lo mueve y lo deja guardado', async () => {
    guardados.length = 0
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Acomodar' }))

    expect(titulos()[0]).toBe('Accesos rápidos')
    fireEvent.click(screen.getByRole('button', { name: 'Bajar Accesos rápidos' }))

    await waitFor(() => expect(titulos()[0]).not.toBe('Accesos rápidos'))
    // Se guarda solo: no hay botón de guardar.
    expect(guardados).toHaveLength(1)
    const v = guardados[0] as { widgets: { clave: string }[] }
    expect(v.widgets[1]?.clave).toBe('accesos')
  })

  /* El primero no se puede subir y el último no se puede bajar: el botón está
     apagado en vez de escondido, que es lo que explica por qué no se mueve. */
  it('en los bordes los botones están apagados', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Acomodar' }))
    expect(screen.getByRole('button', { name: 'Subir Accesos rápidos' })).toBeDisabled()
  })

  it('agrandar y achicar guardan el tamaño nuevo', async () => {
    guardados.length = 0
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Acomodar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Agrandar Evolución comercial' }))

    await waitFor(() => expect(guardados).toHaveLength(1))
    const v = guardados[0] as { widgets: { clave: string; tamano: string }[] }
    expect(v.widgets.find((w) => w.clave === 'evolucion')?.tamano).toBe('grande')
  })

  /* Lo que no se puede ver tampoco se acomoda: el pendiente del resto es de
     admin, así que para un empleado no está ni en la lista. */
  it('un empleado no acomoda el pendiente del resto', () => {
    estado.rol = 'employee'
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Acomodar' }))
    expect(screen.queryByRole('button', { name: /Pendiente del resto/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Subir Lo tuyo' })).toBeInTheDocument()
  })
})
