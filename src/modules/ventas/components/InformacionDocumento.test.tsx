// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { InformacionDocumento } from './InformacionDocumento'
import type { DocumentoDetalle } from '../types'

/**
 * La pestaña Información, ahora la misma para los tres documentos
 * (Fase 15 · E6).
 *
 * Lo que se prueba es la regla: un dato que **debería estar** y falta se
 * muestra como faltante; uno que **no corresponde** al tipo no se muestra; y
 * uno **opcional y vacío**, tampoco.
 */
const doc = (p: Partial<DocumentoDetalle> = {}): DocumentoDetalle => ({
    id: 'd1',
    tipo: 'cotizacion',
    numero: 'COTI00001',
    numeroOriginal: null,
    numeroSospechado: null,
    fecha: '2026-09-17',
    clienteId: 'c9',
    clienteNombre: 'ZZ Cliente SA',
    clienteCuit: null,
    contactoNombre: null,
    contactoId: null,
    contactosExtra: [],
    vendedoresExtra: [],
    contactoRol: null,
    contactoEmail: null,
    contactoTelefono: null,
    vendedorId: null,
    vendedor: null,
    listaPrecioId: null,
    listaPrecioNombre: null,
    titulo: null,
    moneda: 'USD',
    tipoCambio: null,
    estado: 'draft',
    estadoSecundario: null,
    serie: 'COTI',
    notas: null,
    formaPago: null,
    transporte: null,
    seguimiento: null,
    domicilioEntrega: null,
    domicilioElegido: null,
    validaHasta: null,
    descuentoPct: null,
    percepcionPct: null,
    subtotal: 100,
    impuesto: 21,
    total: 121,
    necesitaRevision: false,
    motivosRevision: [],
    numeroFueraDeSerie: false,
    esHistorico: false,
    externalSource: null,
    creadoPor: 'Lisandro',
    creadoEn: '2026-09-17T12:00:00.000Z',
    actualizadoEn: '2026-09-17T13:00:00.000Z',
    lineas: [],
    origen: null,
    ...p,
  })

const montar = (d: DocumentoDetalle, parte: 'principal' | 'mas' = 'principal') =>
  render(
    <MemoryRouter>
      <InformacionDocumento doc={d} parte={parte} />
    </MemoryRouter>,
  )

/* Los datos que el sistema anterior guarda en «Más información» viven en la
   otra mitad desde la Fase 84: de dónde salió el documento, el domicilio, el
   transporte. Montar con `parte="mas"` es mirar esa pestaña. */
const montarMas = (d: DocumentoDetalle) => montar(d, 'mas')

const etiquetas = () => screen.getAllByRole('term').map((t) => t.textContent)

describe('Información · cotización', () => {
  it('muestra lo comercial', () => {
    montar(doc({ validaHasta: '2026-10-17', listaPrecioNombre: 'Mayorista', formaPago: '30 días' }))
    // Fase 28 · E11: «Válida hasta» no aplica y no se muestra, ni siquiera
    // cuando el documento trae el dato cargado.
    expect(etiquetas()).not.toContain('Válida hasta')
    expect(screen.queryByText('17/10/2026')).toBeNull()
    expect(screen.getByText('Mayorista')).toBeInTheDocument()
    expect(screen.getByText('30 días')).toBeInTheDocument()
  })

  it('lo que falta y debería estar, se dice', () => {
    montar(doc())
    expect(screen.getByText('Sin tarifa registrada')).toBeInTheDocument()
    expect(screen.getByText('Sin título')).toBeInTheDocument()
    expect(screen.getAllByText('Sin registrar').length).toBeGreaterThanOrEqual(1)
  })

  /**
   * Sólo lo que muestra el sistema anterior, y en su orden (Fase 84).
   *
   * «Sólo poné los datos que aparecen en STEL, así ganamos espacio, y en el
   * mismo orden.» La ficha tenía catorce filas y la de allá tiene ocho.
   *
   * Lo que se prueba es la LISTA y su ORDEN, que es lo que se pidió, y que
   * nada de lo que se sacó era información que sólo estaba acá: «Origen» es
   * el chip del encabezado, «Moneda» está en cada precio, «Creado» y
   * «Última modificación» están en Trazabilidad y el contacto se abre
   * tocando el cliente.
   */
  it('muestra los nueve datos del sistema anterior, en su orden', () => {
    montar(doc({ titulo: 'VENTAS MERCADO LIBRE', creadoPor: 'Juan' }))
    expect(etiquetas()).toEqual([
      'Referencia',
      'Fecha',
      'Estado',
      'Título',
      'Cliente',
      'Forma de pago',
      'Creado por',
      'Agente',
      'Tarifa',
    ])
  })

  it('no repite lo que ya está en otro lado de la pantalla', () => {
    montar(doc({ notas: 'Generada al importar la orden de compra 4800027323.', tipoCambio: 1100 }))
    for (const ausente of ['Origen', 'Moneda', 'Contacto', 'Observaciones', 'Creado', 'Última modificación', 'Tipo de cambio']) {
      expect(etiquetas()).not.toContain(ausente)
    }
  })
})

describe('Información · pedido', () => {
  it('muestra tarifa y forma de pago, pero no la validez', () => {
    montar(doc({ tipo: 'pedido', numero: 'PDV00001', serie: 'PDV', listaPrecioNombre: 'Lista base' }))
    expect(etiquetas()).toContain('Tarifa')
    expect(etiquetas()).toContain('Forma de pago')
    expect(etiquetas()).not.toContain('Válida hasta')
  })

  it('enlaza la cotización de origen, y dice cuándo es manual', () => {
    montarMas(doc({ tipo: 'pedido', origen: { tipo: 'cotizacion', id: 'q1', numero: 'COTI02558' } }))
    expect(screen.getByRole('link', { name: 'COTI02558' })).toHaveAttribute('href', '/ventas/cotizaciones/q1')

    montarMas(doc({ tipo: 'pedido' }))
    expect(screen.getByText('Sin cotización: pedido manual')).toBeInTheDocument()
  })
})

describe('Información · remito', () => {
  const remito = (p: Partial<DocumentoDetalle> = {}) =>
    doc({ tipo: 'entrega', numero: 'RT00001', serie: 'RT', ...p })

  it('no muestra lo que el remito no decide', () => {
    montarMas(remito())
    for (const ausente of ['Vendedor', 'Forma de pago', 'Tarifa', 'Válida hasta']) {
      expect(etiquetas()).not.toContain(ausente)
    }
  })

  it('muestra la dirección de entrega congelada', () => {
    montarMas(
      remito({
        domicilioEntrega: {
          street: 'Av. Siempreviva 742', city: 'Springfield', state: 'Buenos Aires',
          postal_code: 'B1636', country_code: 'AR',
        },
      }),
    )
    expect(screen.getByText(/Av. Siempreviva 742 · Springfield, Buenos Aires · B1636 AR/)).toBeInTheDocument()
  })

  it('sin domicilio registrado lo dice, y no pone el del cliente de hoy', () => {
    montarMas(remito())
    expect(etiquetas()).toContain('Dirección de entrega')
    expect(screen.getByText('Sin domicilio registrado')).toBeInTheDocument()
  })

  /*
   * El transporte y el seguimiento SIEMPRE tienen su fila en «Más
   * información», aunque estén vacíos (Fase 84).
   *
   * Es al revés que en la tarjeta de arriba, y a propósito: esta pestaña es
   * la que se abre para ver si algo está puesto, y además es la misma que se
   * edita. Si las filas vacías no estuvieran, apretar «Editar» agregaría
   * campos y la pestaña cambiaría de forma, que es justo lo que se vino a
   * arreglar.
   */
  it('el transporte y el seguimiento tienen su fila, con dato o sin él', () => {
    const vacio = montarMas(remito())
    expect(etiquetas()).toContain('Transporte')
    expect(etiquetas()).toContain('Seguimiento')
    vacio.unmount()

    montarMas(remito({ transporte: 'Andreani', seguimiento: 'AR-993' }))
    expect(screen.getByText('Andreani')).toBeInTheDocument()
    expect(screen.getByText('AR-993')).toBeInTheDocument()
  })

  it('enlaza el pedido de origen, y dice cuándo no hay', () => {
    montarMas(remito({ origen: { tipo: 'pedido', id: 'o1', numero: 'PDV01321' } }))
    expect(screen.getByRole('link', { name: 'PDV01321' })).toHaveAttribute('href', '/ventas/pedidos/o1')

    montarMas(remito())
    expect(screen.getByText('Sin pedido relacionado')).toBeInTheDocument()
  })
})

/*
 * Los tres documentos entran por la misma puerta (Fase 84).
 *
 * «Fijate lo mismo en pedido y remito, que esté todo igual.»
 *
 * La cotización y el pedido muestran la ficha AGRUPADA en las cuatro
 * secciones numeradas; el remito, suelta, porque su editor es un solo grupo.
 * Eran dos marcados distintos y sólo uno llevaba la clase que la vuelve densa
 * con la hoja cerrada: por eso el remito era el único que no se parecía.
 *
 * La clase se busca por su nombre sin el hash, que es lo que se puede desde
 * un test: lo que importa es que esté en los dos caminos.
 */
describe('la ficha es la misma en los tres documentos', () => {
  const ficha = (c: HTMLElement) => c.querySelector('[class*="ficha"]')

  it('agrupada —cotización y pedido— lleva la clase que la vuelve densa', () => {
    const { container } = render(
      <MemoryRouter>
        <InformacionDocumento doc={doc({ tipo: 'pedido', numero: 'PDV00001', serie: 'PDV' })} />
      </MemoryRouter>,
    )
    expect(ficha(container)).not.toBeNull()
  })

  it('suelta —el remito— también', () => {
    const { container } = render(
      <MemoryRouter>
        <InformacionDocumento doc={doc({ tipo: 'entrega', numero: 'RT00001', serie: 'RT' })} />
      </MemoryRouter>,
    )
    expect(ficha(container)).not.toBeNull()
  })
})
