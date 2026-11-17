import { describe, expect, it } from 'vitest'
import {
  aNumero,
  armarRenglones,
  claveDePrecio,
  detectarColumnas,
  detectarEncabezado,
  elegirAncla,
  elegirRoles,
  rolDe,
  elegirMarca,
  fechaDelNombre,
  leerCsv,
  marcasEnTexto,
  monedaDe,
  type Celda,
} from './importarLista'

describe('aNumero', () => {
  it('entiende los formatos de precio que mandan los proveedores', () => {
    expect(aNumero('1.234,56')).toBe(1234.56)
    expect(aNumero('1,234.56')).toBe(1234.56)
    expect(aNumero('€ 12,5')).toBe(12.5)
    expect(aNumero('USD 1250')).toBe(1250)
    expect(aNumero('1,250')).toBe(1250)
    expect(aNumero('1.250.000')).toBe(1250000)
    expect(aNumero(94)).toBe(94)
    expect(aNumero('SPRING PIN')).toBeNull()
    expect(aNumero('')).toBeNull()
  })
})

describe('monedaDe', () => {
  it('reconoce la moneda en un encabezado', () => {
    expect(monedaDe('List Price USD')).toBe('USD')
    expect(monedaDe('PVP 2026 €')).toBe('EUR')
    expect(monedaDe('Precio U$S')).toBe('USD')
    expect(monedaDe('Precio')).toBeNull()
  })
})

describe('leerCsv', () => {
  it('detecta el separador', () => {
    expect(leerCsv('Ref;Precio\nA1;10,5\n')).toEqual([['Ref', 'Precio'], ['A1', '10,5']])
    expect(leerCsv('Ref,Price\nA1,10.5\n')).toEqual([['Ref', 'Price'], ['A1', '10.5']])
    expect(leerCsv('Ref\tPrice\r\nA1\t10.5')).toEqual([['Ref', 'Price'], ['A1', '10.5']])
  })

  it('ignora la marca BOM que pone Excel al principio', () => {
    expect(leerCsv(String.fromCharCode(0xfeff) + 'Ref;Precio\nA1;10\n')[0]).toEqual(['Ref', 'Precio'])
  })

  it('respeta las comillas', () => {
    expect(leerCsv('Ref;Desc\nA1;"Punta 1/4"" HEX; magnética"\n')).toEqual([
      ['Ref', 'Desc'],
      ['A1', 'Punta 1/4" HEX; magnética'],
    ])
  })
})

/** Una lista con logo y título arriba, como la de Chicago Pneumatic. */
const LISTA_CP: Celda[][] = [
  ['CHICAGO PNEUMATIC', null, null, null, null],
  ['Price List 2024-01', null, null, null, null],
  [null, null, null, null, null],
  ['Part Number', 'Model', 'Description', 'List Price USD', 'Discount %'],
  [108119400, null, 'SPRING PIN', 1.75, -10],
  ['8941088542', 'CP8854-2', 'IMPACT WRENCH', '24.088,73', -10],
  ['8941088542', 'CP8854-2', 'IMPACT WRENCH (repetida)', 99, -10],
  ['110402', null, 'AIR FUSE HF 1/4" BSP', 94, -10],
  [null, null, 'Renglón de subtotal', null, null],
]

describe('detectarEncabezado', () => {
  it('saltea el título y encuentra el renglón de encabezados', () => {
    expect(detectarEncabezado(LISTA_CP)).toBe(3)
  })
})

describe('detectarColumnas', () => {
  const cols = detectarColumnas(LISTA_CP[3]!, LISTA_CP.slice(4), null)

  it('reconoce referencia, modelo, descripción y precio con su moneda', () => {
    expect(cols.referencia).toBe(0)
    expect(cols.modelo).toBe(1)
    expect(cols.descripcion).toBe(2)
    expect(cols.precios.map((p) => [p.indice, p.clave, p.moneda])).toEqual([[3, 'list_price_usd', 'USD']])
  })

  it('no toma el descuento como precio', () => {
    expect(cols.precios.some((p) => p.indice === 4)).toBe(false)
  })

  it('sin encabezados que lo digan, el precio es la columna numérica con decimales', () => {
    const c = detectarColumnas(['Código', 'Artículo', 'Importe'], [['A1', 'Punta PH2', '12,50'], ['A2', 'Punta PH3', '13,10']], 'EUR')
    expect(c.precios.map((p) => [p.indice, p.moneda])).toEqual([[2, 'EUR']])
  })
})

describe('elegirAncla', () => {
  it('prefiere el precio de lista al neto', () => {
    const c = detectarColumnas(['Ref', 'Net price EUR', 'List price EUR'], [['A', 5.5, 10.25]], null)
    expect(elegirAncla(c.precios)?.clave).toBe('list_price_eur')
  })
})

describe('armarRenglones', () => {
  it('deja una por referencia, descarta las vacías y guarda el modelo', () => {
    const cols = detectarColumnas(LISTA_CP[3]!, LISTA_CP.slice(4), null)
    const r = armarRenglones(LISTA_CP.slice(4), cols, elegirAncla(cols.precios))
    expect(r.renglones.map((x) => x.reference)).toEqual(['108119400', '8941088542', '110402'])
    expect(r.repetidas).toBe(1)
    expect(r.descartados).toBe(1)
    expect(r.renglones[1]).toMatchObject({ anchor: 24088.73, prices: { modelo: 'CP8854-2', list_price_usd: 24088.73 } })
  })
})

describe('fechaDelNombre', () => {
  const hoy = new Date(2026, 10, 17)
  it('saca la fecha del nombre del archivo', () => {
    expect(fechaDelNombre('2025 12 18 - Ingersoll-Rand - FACTURA.pdf', hoy)).toBe('2025-12-18')
    expect(fechaDelNombre('CPD_CPV_Price_List_2024_01_USD.xlsx', hoy)).toBe('2024-01-01')
    expect(fechaDelNombre('LISTA DE PRECIOS SPEEDRILL 2026.xlsx', hoy)).toBe('2026-01-01')
    expect(fechaDelNombre('lista 15-03-2026.csv', hoy)).toBe('2026-03-15')
    expect(fechaDelNombre('lista.csv', hoy)).toBe('2026-11-17')
  })
})

describe('marca', () => {
  const marcas = [
    { id: 'cp', nombre: 'CHICAGO PNEUMATIC' },
    { id: 'sp', nombre: 'SPEEDRILL' },
    { id: 'te', nombre: 'TECNA' },
  ]

  it('encuentra la marca en el nombre del archivo, con guiones bajos o sin espacios', () => {
    expect(marcasEnTexto('2024 CHICAGO_PNEUMATIC lista.xlsx', marcas).map((m) => m.id)).toEqual(['cp'])
    expect(marcasEnTexto('ChicagoPneumatic2024.xlsx', marcas).map((m) => m.id)).toEqual(['cp'])
    expect(marcasEnTexto('TECNA EQUILIBRADORE 2026.xlsx', marcas).map((m) => m.id)).toEqual(['te'])
    expect(marcasEnTexto('lista nueva.xlsx', marcas)).toEqual([])
  })

  it('combina el nombre con las referencias encontradas', () => {
    expect(
      elegirMarca([
        { id: 'to', nombre: 'TOHNICHI', coincidencias: 1, enElTexto: false },
        { id: 'cp', nombre: 'CHICAGO PNEUMATIC', coincidencias: 1, enElTexto: true },
      ])?.id,
    ).toBe('cp')
    expect(
      elegirMarca([
        { id: 'sp', nombre: 'SPEEDRILL', coincidencias: 3600, enElTexto: false },
        { id: 'te', nombre: 'TECNA', coincidencias: 0, enElTexto: true },
      ])?.id,
    ).toBe('sp')
    expect(elegirMarca([{ id: 'x', nombre: 'X', coincidencias: 0, enElTexto: false }])).toBeNull()
  })
})

describe('claveDePrecio', () => {
  it('arma una clave estable', () => {
    expect(claveDePrecio('PVP España €')).toBe('pvp_espana_eur')
    expect(claveDePrecio('Precio U$S')).toBe('precio_usd')
  })
})

describe('lista de TECNA (varios precios y datos técnicos)', () => {
  const enc = [
    'Marca', 'Referencia', 'Modelo', 'Peso mínimo (kg)', 'Peso máximo (kg)', 'Tipo de carcasa', 'Peso del producto (kg)',
    'Link web', 'PVP España (EUR)', 'Precio TTS→Buscatools (EUR)', 'Costo Argentina (EUR)', 'PVP Buscatools (EUR)',
    'Costo Tecsolda (EUR) — ref.', 'Observaciones',
  ]
  const fila = (ref: string, peso: number): Celda[] => [
    'TECNA', ref, ref.replace('TN-', ''), 0.2, 0.5, 'Aleación de aluminio (construcción liviana)', peso,
    'https://tecnanogravity.com.ar/x', 29.46, 19.06, 32.41, 81.02, 26.22, 'Carcasa: catálogo oficial TECNA con notas largas',
  ]
  const datos = [fila('TN-X-LIGHT.0,5', 0.43), fila('TN-X-LIGHT.1', 0.46), fila('TN-X-LIGHT.2', 0.49)]
  const cols = detectarColumnas(enc, datos, 'EUR')

  it('no toma «Peso del producto» (un número) como descripción', () => {
    expect(cols.descripcion).not.toBe(6)
    expect(cols.descripcion === null || enc[cols.descripcion] === 'Tipo de carcasa').toBe(true)
  })

  it('elige el costo y la venta de Argentina / de la empresa', () => {
    const r = elegirRoles(cols.precios, ['Buscatools'])
    expect(r.costo?.encabezado).toBe('Costo Argentina (EUR)')
    expect(r.venta?.encabezado).toBe('PVP Buscatools (EUR)')
    expect(cols.precios.every((p) => p.moneda === 'EUR')).toBe(true)
  })
})

describe('rolDe', () => {
  it('distingue costo de venta', () => {
    expect(rolDe('Net price EUR')).toBe('costo')
    expect(rolDe('Costo USD')).toBe('costo')
    expect(rolDe('List Price 2024 USD')).toBe('venta')
    expect(rolDe('PVP España')).toBe('venta')
    expect(rolDe('Importación')).toBe(null)
  })
})
