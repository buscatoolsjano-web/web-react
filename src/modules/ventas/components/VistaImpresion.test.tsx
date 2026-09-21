// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { VistaImpresion } from './VistaImpresion'
import { OPCIONES_INICIALES, type DocumentoImprimible, type EmpresaImpresion, type LineaImpresa } from '../lib/impresion'

/**
 * El documento impreso (Fase 19 · E6).
 *
 * Lo que se prueba acá son INVARIANTES ESTRUCTURALES, no si se ve lindo: eso
 * se mira con los ojos. Lo que un test sí puede sostener es que el documento
 * no cambia de forma según los datos —que era el problema del formato viejo—:
 * las mismas columnas, el mismo hueco de la foto, el total una sola vez.
 */
const empresa: EmpresaImpresion = {
  nombre: 'Buscatools',
  razonSocial: 'Juan M. J. Mocciaro (BUSCATOOLS)',
  cuit: '20-27089205-2',
  direccion: 'Melincué 5125, CABA (1417)',
  telefono: '11.2169.3304',
  email: 'info@buscatools.com.ar',
  web: 'www.buscatools.com',
  color: '#f37021',
}

const linea = (p: Partial<LineaImpresa> = {}): LineaImpresa => ({
  id: 'l1',
  esCapitulo: false,
  numero: 1,
  sku: 'PRO10022',
  nombre: 'Candado de bloqueo LOTO',
  descripcion: null,
  cantidad: 2,
  precio: 100,
  descuentoPct: 0,
  subtotal: 200,
  impuestoPct: 21,
  foto: null,
  ...p,
})

const doc = (p: Partial<DocumentoImprimible> = {}): DocumentoImprimible => ({
  tipo: 'cotizacion',
  titulo: 'COTIZACIÓN DE VENTA',
  subtitulo: 'VENTA MOSTRADOR',
  numero: 'COTI02558',
  fecha: '2026-09-16',
  cliente: 'Grupo Mirgor S.A.',
  clienteCuit: '30-57803607-1',
  contacto: null,
  moneda: 'USD',
  formaPago: '30 DIAS F/F con ECHEQ',
  vendedor: null,
  domicilioEntrega: null,
  transporte: null,
  seguimiento: null,
  notas: null,
  lineas: [linea()],
  subtotal: 200,
  impuesto: 42,
  total: 242,
  origen: null,
  esHistorico: false,
  ...p,
})

const montar = (d = doc(), o = OPCIONES_INICIALES) =>
  render(<VistaImpresion doc={d} empresa={empresa} opciones={o} />)

const encabezados = () =>
  screen.getAllByRole('columnheader').map((th) => th.textContent?.trim())

describe('El documento impreso', () => {
  it('lleva el logo real, no el nombre escrito', () => {
    montar()
    const logo = screen.getAllByRole('img').find((i) => i.getAttribute('src')?.includes('buscatools-logo'))
    expect(logo).toBeDefined()
    expect(logo).toHaveAttribute('alt', 'Buscatools')
  })

  it('el tipo de documento y el título comercial tienen jerarquías distintas', () => {
    montar()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('COTIZACIÓN DE VENTA')
    expect(screen.getByText('VENTA MOSTRADOR')).toBeInTheDocument()
  })

  it('los dos bloques de datos están, con el nombre del tipo de documento', () => {
    montar()
    expect(screen.getByRole('heading', { name: 'Datos de la cotización' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Datos del cliente' })).toBeInTheDocument()
    expect(screen.getByText('30-57803607-1')).toBeInTheDocument()
  })

  it.each([
    ['pedido', 'PEDIDO DE VENTA', 'Datos del pedido'],
    ['entrega', 'NOTA DE ENTREGA', 'Datos de la entrega'],
  ] as const)('el %s usa la MISMA estructura, con sus etiquetas', (tipo, titulo, bloque) => {
    montar(doc({ tipo, titulo }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(titulo)
    expect(screen.getByRole('heading', { name: bloque })).toBeInTheDocument()
    // Y las mismas columnas: el documento no cambia de forma según el tipo.
    expect(encabezados()).toEqual(['Ref.', 'Nombre / descripción', 'Uds.', 'Precio', '% Dto.', 'Subtotal', 'Imp.'])
  })

  it('un campo opcional vacío no rompe la estructura: el CUIT sin cargar dice «—»', () => {
    const { container } = montar(doc({ clienteCuit: null, formaPago: null, subtitulo: null }))
    // El bloque del cliente conserva sus dos campos: el CUIT que no está se
    // dibuja como raya, no desaparece ni corre al de abajo.
    const bloque = screen.getByRole('heading', { name: 'Datos del cliente' }).parentElement!
    expect(within(bloque).getByText('CUIT:')).toBeInTheDocument()
    expect(within(bloque).getByText('—')).toBeInTheDocument()
    // Y la forma de pago, que tampoco está, no deja una etiqueta huérfana.
    expect(container.textContent).not.toContain('Forma de pago:')
  })

  describe('la grilla de productos', () => {
    it('tiene las mismas columnas con uno o con varios productos', () => {
      const { unmount } = montar()
      const conUno = encabezados()
      unmount()

      montar(doc({ lineas: [linea(), linea({ id: 'l2', sku: 'X' }), linea({ id: 'l3', sku: 'Y' })] }))
      expect(encabezados()).toEqual(conUno)
    })

    /** Regla 10: el hueco de la foto existe en TODAS las filas o en ninguna. */
    it('con fotos, la columna existe en todas las filas aunque el producto no tenga', () => {
      montar(
        doc({ lineas: [linea({ foto: 'https://ejemplo/1.png' }), linea({ id: 'l2', foto: null })] }),
        { ...OPCIONES_INICIALES, conFotos: true },
      )

      expect(encabezados()[0]).toBe('Foto')
      const filas = screen.getAllByRole('row').slice(1)
      // Las dos filas tienen la misma cantidad de celdas: la de la foto está
      // en las dos, con imagen y sin imagen.
      expect(new Set(filas.map((f) => within(f).getAllByRole('cell').length)).size).toBe(1)
      // Y sólo una tiene imagen: la foto es decorativa (`alt=""`), así que se
      // la busca por etiqueta y no por rol.
      expect(filas.filter((f) => f.querySelector('img') !== null)).toHaveLength(1)
    })

    it('sin fotos no hay columna de foto: el formato no las lleva', () => {
      montar(doc({ lineas: [linea({ foto: 'https://ejemplo/1.png' })] }))
      expect(encabezados()).not.toContain('Foto')
    })

    it('una descripción larga no agrega columnas ni cambia el orden', () => {
      montar(doc({ lineas: [linea({ descripcion: 'x'.repeat(600) })] }))
      expect(encabezados()).toEqual(['Ref.', 'Nombre / descripción', 'Uds.', 'Precio', '% Dto.', 'Subtotal', 'Imp.'])
    })
  })

  describe('los totales', () => {
    it('aparecen UNA sola vez, con la moneda explícita', () => {
      montar()
      expect(screen.getAllByText('TOTAL')).toHaveLength(1)
      expect(screen.getByText('USD 242,00')).toBeInTheDocument()
    })

    it.each(['ARS', 'USD'])('la moneda del documento es la que se imprime (%s)', (moneda) => {
      montar(doc({ moneda }))
      expect(screen.getByText(`${moneda} 242,00`)).toBeInTheDocument()
    })

    it('el formato sin totales no los muestra, y el resto del documento no cambia', () => {
      montar(doc(), { ...OPCIONES_INICIALES, formato: 'sin-totales' })
      expect(screen.queryByText('TOTAL')).toBeNull()
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
      expect(encabezados()).toContain('Subtotal')
    })

    it('sin valorar no imprime ninguna columna de dinero', () => {
      montar(doc(), { ...OPCIONES_INICIALES, formato: 'sin-valorar' })
      expect(encabezados()).toEqual(['Ref.', 'Nombre / descripción', 'Uds.'])
      expect(screen.queryByText('TOTAL')).toBeNull()
    })
  })

  it('el remito no inventa campos: sólo muestra lo que quedó registrado', () => {
    const remito = { tipo: 'entrega', titulo: 'NOTA DE ENTREGA' } as const
    const { unmount } = montar(doc(remito))
    for (const etiqueta of ['Entregar en:', 'Transporte:', 'Seguimiento:']) {
      expect(screen.queryByText(etiqueta)).toBeNull()
    }
    unmount()

    montar(
      doc({ ...remito, domicilioEntrega: 'Calle Falsa 123', transporte: 'Andreani', seguimiento: 'AB1234' }),
    )
    expect(screen.getByText('Entregar en:')).toBeInTheDocument()
    expect(screen.getByText('Andreani')).toBeInTheDocument()
    expect(screen.getByText('AB1234')).toBeInTheDocument()
  })

  it('dentro del documento no hay ningún control del ERP', () => {
    montar()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryAllByRole('combobox')).toHaveLength(0)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })
})
