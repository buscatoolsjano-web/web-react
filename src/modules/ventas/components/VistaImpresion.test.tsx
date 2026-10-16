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
  partes: [],
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
    expect(encabezados()).toEqual(['Ref.', 'Nombre / descripción', 'Uds.', 'Precio', 'Subtotal', 'Imp.'])
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

    /**
     * Regla 10 + Fase 28 · E9: la foto vive en la celda de la referencia, y su
     * hueco existe en TODAS las filas o en ninguna. Una columna aparte movía
     * el ancho de la tabla según el formato.
     */
    it('con fotos, el hueco existe en todas las filas aunque el producto no tenga', () => {
      montar(
        doc({ lineas: [linea({ foto: 'https://ejemplo/1.png' }), linea({ id: 'l2', foto: null })] }),
        { ...OPCIONES_INICIALES, conFotos: true },
      )

      // La foto NO agrega columna: sigue empezando en «Ref.».
      expect(encabezados()[0]).toBe('Ref.')
      const filas = screen.getAllByRole('row').slice(1)
      expect(new Set(filas.map((f) => within(f).getAllByRole('cell').length)).size).toBe(1)
      // Sólo una tiene imagen: la foto es decorativa, se busca por etiqueta.
      expect(filas.filter((f) => f.querySelector('img') !== null)).toHaveLength(1)
    })

    /* Apagando las fotos la tabla no cambia de forma: las mismas columnas y
       ninguna imagen. Desde la Fase 82 hay que apagarlas a mano, porque el
       documento viene CON foto de fábrica. */
    it('sin fotos las columnas son las mismas: el formato no cambia la tabla', () => {
      montar(doc({ lineas: [linea({ foto: 'https://ejemplo/1.png' })] }), {
        ...OPCIONES_INICIALES,
        conFotos: false,
      })
      expect(encabezados()[0]).toBe('Ref.')
      // El logo de la empresa no cuenta: se mira la tabla, no la hoja entera.
      expect(screen.getByRole('table').querySelector('img')).toBeNull()
    })

    /**
     * Fase 28 · E9: la descripción se arma con los datos del producto —marca,
     * modelo, origen, NCM, atributos—, como el documento del sistema anterior.
     * Cada dato va entero o no va: «Encastre: 1/4 HEX» no se parte al medio.
     */
    it('la descripción sale de los datos del producto, cada uno sin partirse', () => {
      montar(
        doc({
          lineas: [
            linea({
              partes: [
                { etiqueta: 'Marca', valor: 'SPEEDRILL' },
                { etiqueta: 'Encastre', valor: '1/4 HEX' },
              ],
            }),
          ],
        }),
      )
      const fila = screen.getAllByRole('row')[1]!
      expect(fila).toHaveTextContent('Marca: SPEEDRILL')
      expect(fila).toHaveTextContent('Encastre: 1/4 HEX')
    })

    it('sin datos del producto cae en la descripción escrita a mano', () => {
      montar(doc({ lineas: [linea({ partes: [], descripcion: 'Lo que escribió la persona' })] }))
      expect(screen.getAllByRole('row')[1]!).toHaveTextContent('Lo que escribió la persona')
    })

    /** Un capítulo es una NOTA: título y texto, sin referencia ni importes. */
    it('una nota ocupa toda la fila y muestra su texto', () => {
      montar(doc({ lineas: [linea({ id: 'c1', esCapitulo: true, nombre: 'Se entrega en Melincué 5125.' })] }))
      const fila = screen.getAllByRole('row')[1]!
      expect(within(fila).getAllByRole('cell')).toHaveLength(1)
      expect(fila).toHaveTextContent('Se entrega en Melincué 5125.')
      // Ni cantidad, ni precio, ni la palabra «Capítulo» puesta de fábrica.
      expect(fila).not.toHaveTextContent('Capítulo')
    })

    it('una descripción larga no agrega columnas ni cambia el orden', () => {
      montar(doc({ lineas: [linea({ descripcion: 'x'.repeat(600) })] }))
      expect(encabezados()).toEqual(['Ref.', 'Nombre / descripción', 'Uds.', 'Precio', 'Subtotal', 'Imp.'])
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

/*
 * Todas las filas del mismo alto (Fase 74).
 *
 * «Cuando pongo imprimir no todas las líneas tienen el mismo tamaño.» Pasaba
 * porque cada fila medía lo que ocupaba su contenido: un nombre de dos
 * renglones o una descripción de tres estiraban ésa y no las otras.
 *
 * El alto lo decide el DOCUMENTO y no cada línea, y eso es lo que se prueba
 * acá: la altura de una fila no puede depender de lo que diga esa fila. La
 * medida en milímetros la pone el CSS; un test en jsdom no la puede mirar.
 */
describe('las filas de productos miden todas lo mismo', () => {
  const tabla = () => screen.getAllByRole('table')[0]!
  /* Con fotos manda el marco de 20 mm y las tres alturas no se distinguen:
     estos casos son sobre el alto que elige el TEXTO, así que se apagan.
     Desde la Fase 82 las fotos vienen prendidas de fábrica. */
  const sinFotos = { ...OPCIONES_INICIALES, conFotos: false }

  it('sin descripciones, la tabla usa el alto corto', () => {
    montar(doc({ lineas: [linea(), linea({ id: 'l2', nombre: 'Otro' })] }), sinFotos)
    expect(tabla().className).toMatch(/filasSimples/)
  })

  /* Alcanza con que UNA línea traiga algo abajo del nombre: si sólo creciera
     esa fila, volveríamos a tener filas de dos alturas. */
  it('con que una sola línea tenga descripción, todas reservan ese lugar', () => {
    montar(doc({ lineas: [linea(), linea({ id: 'l2', descripcion: 'Acero templado, 8 mm' })] }), sinFotos)
    expect(tabla().className).toMatch(/filasDesc/)
  })

  it('los atributos del producto cuentan como descripción', () => {
    montar(doc({ lineas: [linea({ partes: [{ etiqueta: 'Marca', valor: 'Speedrill' }] })] }), sinFotos)
    expect(tabla().className).toMatch(/filasDesc/)
  })

  /* Una descripción que repite el nombre no se imprime, así que tampoco
     cambia el alto: reservar lugar para algo que no se dibuja es papel. */
  it('una descripción igual al nombre no cuenta', () => {
    montar(doc({ lineas: [linea({ descripcion: 'Candado de bloqueo LOTO' })] }), sinFotos)
    expect(tabla().className).toMatch(/filasSimples/)
  })

  it('con fotos manda el marco, aunque no haya descripciones', () => {
    montar(doc({ lineas: [linea()] }), { ...OPCIONES_INICIALES, conFotos: true })
    expect(tabla().className).toMatch(/filasFoto/)
  })
})

/*
 * La columna de descuento sólo existe si hay descuentos (Fase 82).
 *
 * «Si no hay descuento, que ni aparezca. Entonces todo se desplaza un poco más
 * y va a hacer que entre bien la descripción.» Son 16 mm que casi siempre
 * están llenos de guiones, y se los lleva la columna del nombre, que es la que
 * se queda corta.
 */
describe('la columna de descuento', () => {
  const encabezadosDe = () => screen.getAllByRole('columnheader').map((th) => th.textContent?.trim())

  it('no está cuando ninguna línea tiene descuento', () => {
    montar(doc({ lineas: [linea(), linea({ id: 'l2', descuentoPct: 0 })] }))
    expect(encabezadosDe()).not.toContain('% Dto.')
  })

  it('aparece en cuanto UNA línea lo tiene', () => {
    montar(doc({ lineas: [linea(), linea({ id: 'l2', descuentoPct: 10 })] }))
    expect(encabezadosDe()).toContain('% Dto.')
    expect(screen.getByText('10%')).toBeInTheDocument()
  })

  /*
   * Mientras se edita está SIEMPRE, aunque no haya ninguno: si no, no habría
   * dónde escribir el primero —la columna aparecería recién después de
   * cargarlo, que es justo cuando ya no hace falta—.
   */
  it('editando está siempre, para poder cargar el primero', () => {
    render(
      <VistaImpresion
        doc={doc({ lineas: [linea()] })}
        empresa={empresa}
        opciones={OPCIONES_INICIALES}
        edicion={{
          onCantidad: () => {},
          onPrecio: () => {},
          onDescuento: () => {},
          onEliminar: () => {},
          onAgregar: () => {},
        }}
      />,
    )
    expect(encabezadosDe()).toContain('% Dto.')
  })
})
