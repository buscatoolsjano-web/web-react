// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { SecuenciaDiagnostico } from '../lib/numeracion'

const estado = vi.hoisted(() => ({
  movil: false,
  filas: [] as unknown[],
  sync: [] as unknown[],
  series: [] as unknown[],
  seriesError: false,
  rol: 'admin',
  guardados: [] as unknown[],
  eliminados: [] as unknown[],
  falla: null as string | null,
}))

vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1', companyName: 'ZZ STEL', rol: estado.rol, esInterno: true }, cargando: false }),
}))
vi.mock('@/hooks/useMediaQuery', () => ({ useIsMobile: () => estado.movil, useMediaQuery: () => estado.movil }))
vi.mock('../hooks/useEmpresaConfig', () => ({
  useNumeracion: () => ({ data: estado.filas, isPending: false, isError: false }),
  // Fase 14 E4: el bloque de sync es aparte; acá se prueban las columnas de numeración.
  useSyncStel: () => ({ data: estado.sync, isPending: false, isError: false }),
  useAutoridadSeries: () => ({ data: estado.seriesError ? undefined : estado.series, isPending: false, isError: estado.seriesError }),
  // Fase 58 E3: la pantalla dejó de ser de sólo lectura.
  useAccionesNumeracion: () => ({
    guardar: {
      isPending: false,
      mutateAsync: async (v: unknown) => {
        if (estado.falla) throw new (await import('../services/numeracion')).ErrorNumeracion(estado.falla)
        estado.guardados.push(v)
        return 'CREATED'
      },
    },
    eliminar: {
      isPending: false,
      mutateAsync: async (v: unknown) => {
        if (estado.falla) throw new (await import('../services/numeracion')).ErrorNumeracion(estado.falla)
        estado.eliminados.push(v)
      },
    },
  }),
}))

const { NumeracionPage } = await import('./NumeracionPage')

const sec = (p: Partial<SecuenciaDiagnostico>): SecuenciaDiagnostico => ({
  docType: 'quote',
  serie: 'QUO',
  prefijo: 'QUO',
  padding: 5,
  esDefault: true,
  proximo: 'QUO00005',
  proximoNumero: 5,
  documentos: 1,
  fueraPatron: 0,
  maxNumero: null,
  maxSinAtipicos: null,
  atipicosPorEncima: 0,
  estado: 'SIN_DOCUMENTOS',
  autoridad: 'STEL',
  autoridadConfigurada: true,
  ...p,
})

/** Las dos series de Ventas que de verdad tiene Buscatools, ambas en ERP. */
const VENTAS_ERP = [
  sec({ docType: 'quote', serie: 'COTI', prefijo: 'COTI', proximo: 'COTI02630', proximoNumero: 2630, autoridad: 'ERP', esDefault: true, documentos: 2630 }),
  sec({ docType: 'delivery', serie: 'RT', prefijo: 'RT', padding: 10, proximo: 'RT0000001433', proximoNumero: 1433, autoridad: 'ERP', esDefault: true, documentos: 1432 }),
]

async function clic(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el)
    await Promise.resolve()
  })
}

beforeEach(() => {
  estado.movil = false
  estado.filas = [sec({}), sec({ docType: 'delivery', serie: 'DEL', prefijo: 'DEL', proximo: 'DEL00005', documentos: 0 })]
  estado.sync = []
  estado.series = []
  estado.seriesError = false
  estado.rol = 'admin'
  estado.guardados = []
  estado.eliminados = []
  estado.falla = null
})

describe('Numeración: STEL siempre visible al adaptar columnas', () => {
  it('tabla: la columna Autoridad no se oculta y muestra STEL y la emisión bloqueada en cada fila', () => {
    render(<NumeracionPage />)
    const cabeceras = screen.getAllByRole('columnheader')
    const autoridad = cabeceras.find((c) => c.textContent === 'Autoridad')!
    expect(autoridad.className).not.toMatch(/oculta/)
    for (const fila of screen.getAllByRole('row').slice(1)) {
      expect(within(fila).getByText('STEL')).toBeInTheDocument()
      expect(within(fila).getByText('Emisión desde ERP bloqueada')).toBeInTheDocument()
      // Con «Grande» el chip puede partirse en dos renglones en vez de ensanchar la tabla.
      expect(within(fila).getByText('Emisión desde ERP bloqueada').parentElement!.className).toMatch(/chip/)
    }
    // El dato de las columnas ocultas se repite bajo el tipo, con singular y plural.
    expect(screen.getByText(/1 documento$/)).toBeInTheDocument()
    expect(screen.getByText(/0 documentos$/)).toBeInTheDocument()
    expect(screen.getByText(/STEL es la autoridad/)).toBeInTheDocument()
  })

  it('mobile: cada card mantiene autoridad y emisión', () => {
    estado.movil = true
    render(<NumeracionPage />)
    const cards = screen.getAllByRole('article')
    expect(cards).toHaveLength(2)
    for (const c of cards) {
      expect(within(c).getByText('STEL')).toBeInTheDocument()
      expect(within(c).getByText('Emisión desde ERP bloqueada')).toBeInTheDocument()
    }
  })
})

/*
 * LA COMPACTACIÓN (Fase 58 · E3). «Lo de numeración hacerlo más acotado».
 *
 * Lo de autoridad se muestra sólo cuando tiene algo que decir. Con las 25
 * secuencias reales en ERP, una columna que repite «ERP» veinticinco veces y un
 * bloque que explica un reparto que ya no existe eran justo lo que hacía que no
 * se entendiera cuál es el dato importante.
 */
describe('Numeración: más acotada cuando todo lo emite el ERP', () => {
  it('sin nada en STEL no hay columna Autoridad ni bloque de autoridad', () => {
    estado.filas = VENTAS_ERP
    render(<NumeracionPage />)
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).not.toContain('Autoridad')
    expect(screen.queryByRole('region', { name: 'Autoridad de emisión' })).not.toBeInTheDocument()
  })

  /* Y vuelven solos si algo vuelve a STEL: la pantalla no se queda ciega. */
  it('con una excepción de serie en STEL, el bloque vuelve', () => {
    estado.filas = VENTAS_ERP
    estado.series = [{ docType: 'delivery', serie: 'RT-ML', autoridad: 'STEL', motivo: 'MercadoLibre sigue en STEL' }]
    render(<NumeracionPage />)
    const bloque = screen.getByRole('region', { name: 'Autoridad de emisión' })
    expect(within(bloque).getByText(/Remitos MercadoLibre · RT-ML/)).toBeInTheDocument()
    expect(within(bloque).getByText('STEL · Solo importación')).toBeInTheDocument()
    expect(within(bloque).getByText(/Secuencia del ERP: no aplica/)).toBeInTheDocument()
    expect(within(bloque).getByText(/Notas de entrega .remitos. · RT$/)).toBeInTheDocument()
  })

  it('con un tipo en STEL, el bloque lo refleja', () => {
    estado.filas = [sec({ docType: 'quote', serie: 'COTI', prefijo: 'COTI', proximo: 'COTI02630', autoridad: 'STEL' })]
    render(<NumeracionPage />)
    const bloque = screen.getByRole('region', { name: 'Autoridad de emisión' })
    expect(within(bloque).getByText('STEL · Solo importación')).toBeInTheDocument()
    expect(within(bloque).queryByText('ERP')).not.toBeInTheDocument()
  })

  it('ya no dice que es de sólo lectura ni que queda para el cutover', () => {
    estado.filas = VENTAS_ERP
    render(<NumeracionPage />)
    expect(screen.queryByText(/queda para el cutover/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Nada de esto se edita acá/)).not.toBeInTheDocument()
    expect(screen.queryByText('Sólo lectura')).not.toBeInTheDocument()
  })

  it('la predeterminada se marca con una etiqueta en vez de un «no predeterminada» al revés', () => {
    estado.filas = VENTAS_ERP
    render(<NumeracionPage />)
    expect(screen.getAllByText('predeterminada')).toHaveLength(2)
    expect(screen.queryByText(/no predeterminada/)).not.toBeInTheDocument()
  })
})

describe('Numeración: editar (Fase 58 · E3)', () => {
  it('un admin ve «Nueva serie» y puede editar las del ERP', () => {
    estado.filas = VENTAS_ERP
    render(<NumeracionPage />)
    expect(screen.getByRole('button', { name: 'Nueva serie' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Editar' })).toHaveLength(2)
  })

  /* Un employee entra a Numeración (lo dice `SECCIONES_CONFIGURACION`) pero no
     la edita: la RPC sólo acepta admin, así que no se le ofrece el botón. */
  it('un empleado la ve de sólo lectura, sin botones', () => {
    estado.rol = 'employee'
    estado.filas = VENTAS_ERP
    render(<NumeracionPage />)
    expect(screen.queryByRole('button', { name: 'Nueva serie' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.getByText('Sólo lectura')).toBeInTheDocument()
  })

  // Lo que numera STEL no se edita desde el ERP: la RPC lo rechaza igual.
  it('una serie de STEL no se puede editar ni eliminar', () => {
    render(<NumeracionPage />)
    for (const b of [...screen.getAllByRole('button', { name: 'Editar' }), ...screen.getAllByRole('button', { name: 'Eliminar' })]) {
      expect(b).toBeDisabled()
    }
  })

  /* La predeterminada no se elimina: dejaría al tipo sin ninguna y la base lo
     rechaza con `es_predeterminada`. */
  it('la serie predeterminada no se puede eliminar', () => {
    estado.filas = VENTAS_ERP
    render(<NumeracionPage />)
    for (const b of screen.getAllByRole('button', { name: 'Eliminar' })) expect(b).toBeDisabled()
  })

  it('el formulario de alta arranca vacío y muestra cómo va a salir el número', async () => {
    estado.filas = VENTAS_ERP
    render(<NumeracionPage />)
    await clic(screen.getByRole('button', { name: 'Nueva serie' }))

    expect(screen.getByRole('dialog', { name: 'Nueva serie de numeración' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Nombre de la serie'), { target: { value: 'cot-2026' } })
    fireEvent.change(screen.getByLabelText('Prefijo'), { target: { value: 'cot-2026' } })
    fireEvent.change(screen.getByLabelText('Próximo número'), { target: { value: '1' } })

    expect(screen.getByText('COT-202600001')).toBeInTheDocument()

    await clic(screen.getByRole('button', { name: 'Crear serie' }))
    expect(estado.guardados).toEqual([
      { docType: 'quote', serie: 'COT-2026', prefijo: 'COT-2026', relleno: 5, proximo: 1, esDefault: false, seleccionable: true },
    ])
  })

  /* Editar no deja cambiar el tipo ni el nombre: junto con la empresa son la
     clave primaria, y los documentos emitidos referencian ese nombre. */
  it('al editar, el tipo y el nombre quedan bloqueados y el prefijo no', async () => {
    estado.filas = VENTAS_ERP
    render(<NumeracionPage />)
    await clic(screen.getAllByRole('button', { name: 'Editar' })[0]!)

    expect(screen.getByRole('dialog', { name: 'Editar COTI' })).toBeInTheDocument()
    expect(screen.getByLabelText('Tipo de documento')).toBeDisabled()
    expect(screen.getByLabelText('Nombre de la serie')).toBeDisabled()
    expect(screen.getByLabelText('Prefijo')).not.toBeDisabled()
    expect(screen.getByLabelText('Próximo número')).toHaveValue(2630)
  })

  /*
   * EL GUARDA QUE IMPORTA, de punta a punta. Con 2629 ya emitido con COTI,
   * poner el próximo en 2629 emitiría un número repetido: no sale ni al
   * servidor, y el mensaje dice cuál es el número ocupado.
   */
  it('no deja poner un próximo número que ya se emitió', async () => {
    estado.filas = [sec({ docType: 'quote', serie: 'COTI', prefijo: 'COTI', proximoNumero: 2630, proximo: 'COTI02630', maxNumero: 2629, maxSinAtipicos: 2629, autoridad: 'ERP', estado: 'OK' })]
    render(<NumeracionPage />)
    await clic(screen.getByRole('button', { name: 'Editar' }))

    fireEvent.change(screen.getByLabelText('Próximo número'), { target: { value: '2629' } })
    await clic(screen.getByRole('button', { name: 'Guardar' }))

    expect(estado.guardados).toEqual([])
    expect(screen.getByText(/tiene que ser mayor que 2629/)).toBeInTheDocument()
  })

  it('un prefijo con espacios tampoco sale', async () => {
    estado.filas = VENTAS_ERP
    render(<NumeracionPage />)
    await clic(screen.getAllByRole('button', { name: 'Editar' })[0]!)

    fireEvent.change(screen.getByLabelText('Prefijo'), { target: { value: 'CO TI' } })
    await clic(screen.getByRole('button', { name: 'Guardar' }))

    expect(estado.guardados).toEqual([])
    expect(screen.getByText(/sin espacios/)).toBeInTheDocument()
  })

  it('si la base rechaza, se muestra su mensaje con el número ocupado', async () => {
    estado.filas = VENTAS_ERP
    estado.falla = 'numero_ocupado:2585'
    render(<NumeracionPage />)
    await clic(screen.getAllByRole('button', { name: 'Editar' })[0]!)
    await clic(screen.getByRole('button', { name: 'Guardar' }))

    expect(screen.getByText(/el mayor existente con ese prefijo es 2585/)).toBeInTheDocument()
  })

  it('eliminar pide confirmación y manda tipo y serie', async () => {
    estado.filas = [
      ...VENTAS_ERP,
      sec({ docType: 'quote', serie: 'COT-VIEJA', prefijo: 'COT-VIEJA', autoridad: 'ERP', esDefault: false, documentos: 0 }),
    ]
    render(<NumeracionPage />)
    const habilitado = screen.getAllByRole('button', { name: 'Eliminar' }).find((b) => !(b as HTMLButtonElement).disabled)!
    await clic(habilitado)

    expect(screen.getByRole('dialog', { name: 'Eliminar la serie COT-VIEJA' })).toBeInTheDocument()
    await clic(within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar' }))
    expect(estado.eliminados).toEqual([{ docType: 'quote', serie: 'COT-VIEJA' }])
  })
})

describe('Numeración: estado del sync con STEL (Fase 14 E4)', () => {
  it('sin datos (o sin permiso) la sección no aparece', () => {
    render(<NumeracionPage />)
    expect(screen.queryByText('Sincronización con STEL')).not.toBeInTheDocument()
  })

  it('con datos muestra estado, última corrida y punto de control, y el error si lo hay', () => {
    estado.sync = [
      { entidad: 'products', estado: 'finished', inicio: '2026-09-15T10:00:00Z', fin: '2026-09-15T10:00:05Z', checkpoint: '2026-09-15T09:00:00Z', ultimoVisto: '555001', llamadas: 2, error: null, bloqueado: false, resumen: {} },
      { entidad: 'documents', estado: 'failed', inicio: '2026-09-15T11:00:00Z', fin: '2026-09-15T11:00:02Z', checkpoint: null, ultimoVisto: null, llamadas: 17, error: 'sin checkpoint: pasar --desde', bloqueado: false, resumen: {} },
    ]
    render(<NumeracionPage />)
    expect(screen.getByText('Sincronización con STEL')).toBeInTheDocument()
    expect(screen.getByText(/Catálogo/)).toBeInTheDocument()
    expect(screen.getByText('Al día')).toBeInTheDocument()
    expect(screen.getByText('Con error')).toBeInTheDocument()
    expect(screen.getByText(/sin checkpoint/)).toBeInTheDocument()
    expect(screen.getByText(/2 llamadas a STEL/)).toBeInTheDocument()
    expect(screen.getByText(/sin punto de control todavía/)).toBeInTheDocument()
  })

  it('no muestra nada que se parezca a una clave de API', () => {
    estado.sync = [{ entidad: 'products', estado: 'finished', inicio: null, fin: null, checkpoint: null, ultimoVisto: null, llamadas: 0, error: null, bloqueado: false, resumen: {} }]
    render(<NumeracionPage />)
    expect(document.body.textContent?.toLowerCase()).not.toContain('apikey')
    expect(document.body.textContent?.toLowerCase()).not.toContain('stel_api_key')
  })
})

describe('Numeración: autoridad de emisión por serie (Fase 14 E5)', () => {
  /* El fixture lleva una excepción en STEL a propósito: desde la Fase 58 el
     bloque sólo aparece cuando hay algo que no sea ERP. */
  const conStel = [{ docType: 'delivery', serie: 'RT-ML', autoridad: 'STEL' as const, motivo: 'MercadoLibre sigue en STEL' }]

  it('muestra una fila por serie con su autoridad real', () => {
    estado.filas = VENTAS_ERP
    estado.series = conStel
    render(<NumeracionPage />)
    const bloque = screen.getByRole('region', { name: 'Autoridad de emisión' })
    expect(within(bloque).getByText(/Cotizaciones · COTI/)).toBeInTheDocument()
    expect(within(bloque).getByText(/COTI02630/)).toBeInTheDocument()
    expect(within(bloque).getAllByText('ERP').length).toBe(2)
  })

  it('si la consulta de series falla, quedan las filas por tipo y se avisa', () => {
    // Un tipo en STEL para que el bloque exista aunque las excepciones no lleguen.
    estado.filas = [...VENTAS_ERP, sec({ docType: 'sales_order', serie: 'PDV', prefijo: 'PDV', autoridad: 'STEL', documentos: 0 })]
    estado.seriesError = true
    render(<NumeracionPage />)
    const bloque = screen.getByRole('region', { name: 'Autoridad de emisión' })
    expect(within(bloque).getAllByText('ERP').length).toBe(2)
    expect(within(bloque).getByText(/No se pudieron leer las excepciones por serie/)).toBeInTheDocument()
  })

  it('mobile: el bloque sigue visible y sin desbordar', () => {
    estado.movil = true
    estado.filas = VENTAS_ERP
    estado.series = conStel
    render(<NumeracionPage />)
    const bloque = screen.getByRole('region', { name: 'Autoridad de emisión' })
    expect(within(bloque).getByText(/Remitos MercadoLibre · RT-ML/)).toBeInTheDocument()
    // La fila envuelve en vez de ensanchar: el chip baja debajo del texto.
    expect(bloque.querySelector('li')!.className).toMatch(/filaSync/)
  })
})
