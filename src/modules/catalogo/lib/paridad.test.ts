import { describe, expect, it } from 'vitest'
import {
  cantidadDe,
  leerCarrito,
  MAXIMO_ITEMS,
  ponerCantidad,
  restar,
  sumar,
  unidades,
  type Carrito,
} from './carrito'
import { catalogoACsv, columnasPara, columnasPorDefecto } from './exportar'
import { columnasDeVarias, COLUMNAS_BASE } from './familias'
import { columnasDinamicas, MAXIMO_COLUMNAS, valorDinamico } from './columnasDinamicas'
import { columnaYdireccion, proximoOrden } from '../hooks/useFiltrosCatalogo'
import type { ProductoListado } from '../types'

/**
 * Paridad con el catálogo del legacy (Fase 22 · cierre de faltantes).
 *
 * Cada bloque referencia la línea de `app.js` de donde salió la regla. No son
 * tests de «que ande»: son tests de «que haga lo mismo». Si mañana alguien
 * cambia una de estas reglas, lo que se rompe es la paridad, no el código.
 */

const P = (over: Partial<ProductoListado> = {}): ProductoListado =>
  ({
    id: over.id ?? 'p1',
    sku: over.sku ?? 'SP.R2315HL',
    nombre: over.nombre ?? 'Punta Speedrill',
    marca: over.marca ?? { id: 'm', nombre: 'SPEEDRILL' },
    categoria: over.categoria ?? { id: 'c', nombre: 'Puntas', slug: 'punta' },
    serie: over.serie ?? '23',
    tipo: over.tipo ?? 'Punta',
    atributos: over.atributos ?? { largo: '80', encastre: '1/4' },
    precio: over.precio === undefined ? 12.5 : over.precio,
    stock: over.stock === undefined ? { real: 4, virtual: 3 } : over.stock,
    imagen: null,
    esKit: false,
    necesitaRevision: false,
    enCatalogo: over.enCatalogo ?? true,
  }) as unknown as ProductoListado

// ── #50 · Carrito ──────────────────────────────────────────────────────────
describe('#50 · El carrito hace lo que el stepper del legacy (app.js:17529)', () => {
  const punta = { id: 'p1', sku: 'SP.1', nombre: 'Punta' }
  const tubo = { id: 'p2', sku: 'SP.2', nombre: 'Tubo' }

  it('«+» suma de a uno desde cero', () => {
    let c: Carrito = []
    c = sumar(c, punta)
    c = sumar(c, punta)
    expect(cantidadDe(c, 'p1')).toBe(2)
  })

  it('«−» resta y NUNCA baja de cero', () => {
    let c: Carrito = sumar([], punta)
    c = restar(c, punta)
    c = restar(c, punta)
    expect(cantidadDe(c, 'p1')).toBe(0)
  })

  it('llegar a cero SACA el producto: no existe «está con cantidad 0»', () => {
    const c = restar(sumar([], punta), punta)
    expect(c).toHaveLength(0)
  })

  it('escribir la cantidad a mano la pone exacta', () => {
    expect(cantidadDe(ponerCantidad([], punta, 7), 'p1')).toBe(7)
  })

  it('una cantidad negativa o basura saca el producto en vez de romper', () => {
    expect(ponerCantidad(sumar([], punta), punta, -3)).toHaveLength(0)
    expect(ponerCantidad(sumar([], punta), punta, Number.NaN)).toHaveLength(0)
  })

  it('los decimales se truncan: no se cotizan 2,5 puntas', () => {
    expect(cantidadDe(ponerCantidad([], punta, 2.9), 'p1')).toBe(2)
  })

  it('el mismo producto dos veces es UNA línea, no dos', () => {
    const c = sumar(sumar([], punta), punta)
    expect(c).toHaveLength(1)
    expect(cantidadDe(c, 'p1')).toBe(2)
  })

  it('cambiar la cantidad no reordena el carrito', () => {
    let c = sumar(sumar([], punta), tubo)
    c = ponerCantidad(c, punta, 9)
    expect(c.map((i) => i.productId)).toEqual(['p1', 'p2'])
  })

  it('«Ítems» son unidades, no líneas', () => {
    const c = ponerCantidad(sumar([], tubo), punta, 5)
    expect(c).toHaveLength(2)
    expect(unidades(c)).toBe(6)
  })

  it('NO guarda el precio: eso lo resuelve la cotización con su tarifa', () => {
    const c = sumar([], punta)
    expect(Object.keys(c[0]!).sort()).toEqual(['cantidad', 'nombre', 'productId', 'sku'])
  })
})

describe('#50 · Lo guardado no se cree a ciegas', () => {
  it('lo que no es una lista se descarta', () => {
    expect(leerCarrito('{"a":1}')).toEqual([])
    expect(leerCarrito('no es json')).toEqual([])
    expect(leerCarrito(null)).toEqual([])
  })

  it('una fila sin productId se descarta, las buenas sobreviven', () => {
    const crudo = JSON.stringify([
      { sku: 'X', cantidad: 2 },
      { productId: 'p1', sku: 'SP.1', nombre: 'Punta', cantidad: 3 },
    ])
    expect(leerCarrito(crudo)).toEqual([{ productId: 'p1', sku: 'SP.1', nombre: 'Punta', cantidad: 3 }])
  })

  it('una cantidad cero o negativa guardada se descarta', () => {
    const crudo = JSON.stringify([{ productId: 'p1', cantidad: 0 }, { productId: 'p2', cantidad: -5 }])
    expect(leerCarrito(crudo)).toEqual([])
  })

  it('hay un tope: un carrito de mil líneas no es una cotización', () => {
    const muchos = Array.from({ length: MAXIMO_ITEMS + 50 }, (_, i) => ({
      productId: `p${i}`, sku: `S${i}`, nombre: 'x', cantidad: 1,
    }))
    expect(leerCarrito(JSON.stringify(muchos))).toHaveLength(MAXIMO_ITEMS)
  })
})

// ── #49 · Exportación ──────────────────────────────────────────────────────
describe('#49 · Exportar respeta el rol (app.js:16999)', () => {
  it('un cliente NO puede pedir stock virtual: no se le ofrece', () => {
    const claves = columnasPara(false).map((c) => c.clave)
    expect(claves).not.toContain('stock_virtual')
    expect(claves).not.toContain('stock_real')
  })

  it('un interno sí', () => {
    expect(columnasPara(true).map((c) => c.clave)).toContain('stock_virtual')
  })

  it('aunque pida la columna, el archivo de un cliente no la trae', () => {
    // La defensa no es que la casilla no se vea: es que la función no la escribe.
    const csv = catalogoACsv([P()], new Set(['sku', 'stock_real', 'stock_virtual']), {
      esInterno: false,
      moneda: 'USD',
    })
    expect(csv.split('\r\n')[0]).toBe('Referencia')
  })
})

describe('#49 · El archivo', () => {
  it('separador ; y CRLF, como el resto del ERP', () => {
    const csv = catalogoACsv([P()], new Set(['sku', 'marca']), { esInterno: true, moneda: 'USD' })
    expect(csv).toBe('Referencia;Marca\r\nSP.R2315HL;SPEEDRILL')
  })

  it('sin columnas no hay archivo, ni siquiera una cabecera vacía', () => {
    expect(catalogoACsv([P()], new Set(), { esInterno: true, moneda: 'USD' })).toBe('')
  })

  it('sin filas queda la cabecera: un archivo vacío no miente', () => {
    expect(catalogoACsv([], new Set(['sku']), { esInterno: true, moneda: 'USD' })).toBe('Referencia')
  })

  it('«sin saldo registrado» sale vacío, NO cero (F21 · E3.1)', () => {
    const csv = catalogoACsv([P({ stock: null })], new Set(['sku', 'stock_real']), {
      esInterno: true,
      moneda: 'USD',
    })
    expect(csv.split('\r\n')[1]).toBe('SP.R2315HL;')
  })

  it('protege contra fórmulas: un nombre que empieza con «=» no se ejecuta', () => {
    const csv = catalogoACsv([P({ nombre: '=cmd|calc' })], new Set(['nombre']), {
      esInterno: true,
      moneda: 'USD',
    })
    expect(csv).toContain("'=cmd|calc")
  })

  it.each(['=', '+', '-', '@'])('«%s» al inicio de un nombre se neutraliza', (c) => {
    const csv = catalogoACsv([P({ nombre: `${c}peligro` })], new Set(['nombre']), {
      esInterno: true, moneda: 'USD',
    })
    expect(csv).toContain(`'${c}peligro`)
  })

  it('un nombre con «;» no parte la fila', () => {
    const csv = catalogoACsv([P({ nombre: 'Punta; larga' })], new Set(['sku', 'nombre']), {
      esInterno: true, moneda: 'USD',
    })
    expect(csv.split('\r\n')[1]).toBe('SP.R2315HL;"Punta; larga"')
  })

  it('un atributo que quedó como objeto sale vacío, no «[object Object]»', () => {
    // `attributes` es jsonb: nada impide que alguien haya guardado un objeto.
    const csv = catalogoACsv([P({ atributos: { largo: { mal: 1 } } })], new Set(['largo']), {
      esInterno: true, moneda: 'USD',
    })
    expect(csv.split('\r\n')[1]).toBe('')
  })

  it('por omisión vienen los básicos y el precio, como el legacy', () => {
    const d = columnasPorDefecto(true)
    expect(d.has('sku')).toBe(true)
    expect(d.has('marca')).toBe(true)
    expect(d.has('precio')).toBe(true)
    expect(d.has('torq_min')).toBe(false)
  })
})

// ── #42 · Comparación manual ───────────────────────────────────────────────
describe('#42 · Familias distintas: el legacy compara parcial, no bloquea', () => {
  it('todos de la misma familia → exactamente las columnas de siempre', () => {
    const cols = columnasDeVarias(['punta', 'punta'])
    expect(cols.map((c) => c.clave)).toEqual(['marca', 'sku', 'tipo', 'medida', 'encastre', 'largo', 'serie'])
  })

  it('familias distintas → la unión, con una base común adelante', () => {
    const cols = columnasDeVarias(['punta', 'balanceador']).map((c) => c.clave)
    expect(cols.slice(0, 4)).toEqual(COLUMNAS_BASE.map((c) => c.clave))
    expect(cols).toContain('encastre') // de punta
    expect(cols).toContain('min_kg') // de balanceador
  })

  it('no repite una columna que las dos familias comparten', () => {
    const cols = columnasDeVarias(['atornillador', 'llave-de-impacto']).map((c) => c.clave)
    expect(cols.filter((c) => c === 'encastre')).toHaveLength(1)
    expect(new Set(cols).size).toBe(cols.length)
  })

  it('«otros» no bloquea: quedan las columnas base y se compara lo que hay', () => {
    const cols = columnasDeVarias(['otros', 'otros']).map((c) => c.clave)
    expect(cols).toEqual(COLUMNAS_BASE.map((c) => c.clave))
  })

  it('«otros» mezclado con una familia real suma los atributos de esa familia', () => {
    const cols = columnasDeVarias(['otros', 'balanceador']).map((c) => c.clave)
    expect(cols).toContain('min_kg')
    expect(cols).toContain('categoria')
  })

  it('la categoría sólo aparece al mezclar: es lo que explica las diferencias', () => {
    expect(columnasDeVarias(['punta']).map((c) => c.clave)).not.toContain('categoria')
    expect(columnasDeVarias(['punta', 'otros']).map((c) => c.clave)).toContain('categoria')
  })
})

// ── #13 · Orden por columna ────────────────────────────────────────────────
describe('#13 · El toggle del encabezado (app.js:17366)', () => {
  it('una columna nueva ordena ascendente', () => {
    expect(proximoOrden('nombre', 'marca')).toBe('marca')
  })

  it('la misma columna da vuelta la dirección', () => {
    expect(proximoOrden('marca', 'marca')).toBe('marca_desc')
  })

  it('y vuelve a ascendente: NO hay tercer click que saque el orden', () => {
    expect(proximoOrden('marca_desc', 'marca')).toBe('marca')
  })

  it('cambiar de columna estando en descendente arranca ascendente', () => {
    expect(proximoOrden('marca_desc', 'sku')).toBe('sku')
  })

  it('desde relevancia, tocar una columna ordena por ella', () => {
    expect(proximoOrden('relevancia', 'serie')).toBe('serie')
  })

  it('el encabezado sabe qué flecha dibujar', () => {
    expect(columnaYdireccion('marca')).toEqual({ campo: 'marca', direccion: 'asc' })
    expect(columnaYdireccion('marca_desc')).toEqual({ campo: 'marca', direccion: 'desc' })
    expect(columnaYdireccion('relevancia')).toEqual({ campo: 'relevancia', direccion: 'asc' })
  })
})

// ── #19 · Columnas dinámicas por categoría ─────────────────────────────────
describe('#19 · Al elegir una categoría aparecen sus atributos (app.js:15086)', () => {
  const faceta = (key: string, label: string, conDato: number, clase: 'enum' | 'range' = 'enum') => ({
    key, label, unidad: null, clase,
    opciones: [{ valor: 'x', etiqueta: 'x', cantidad: conDato }],
    min: null, max: null,
  })

  it('sin categoría elegida no hay columnas, como el legacy', () => {
    expect(columnasDinamicas(null, [faceta('encastre', 'Encastre', 100)], 100)).toEqual([])
  })

  it('con categoría, el atributo que tiene casi toda la familia entra', () => {
    const cols = columnasDinamicas('cat-1', [faceta('encastre', 'Encastre', 96)], 100)
    expect(cols.map((c) => c.key)).toEqual(['encastre'])
  })

  it('el que casi nadie tiene NO entra: una columna vacía ocupa y no informa', () => {
    expect(columnasDinamicas('cat-1', [faceta('eslinga', 'Eslinga', 3)], 100)).toEqual([])
  })

  it('hay un techo: doce atributos dejan la tabla ilegible', () => {
    const muchos = Array.from({ length: 12 }, (_, i) => faceta(`a${i}`, `A${i}`, 100))
    expect(columnasDinamicas('cat-1', muchos, 100)).toHaveLength(MAXIMO_COLUMNAS)
  })

  it('un rango siempre entra: su cobertura no se mide por opciones', () => {
    const cols = columnasDinamicas('cat-1', [faceta('largo', 'Largo', 0, 'range')], 100)
    expect(cols.map((c) => c.key)).toEqual(['largo'])
  })

  it('sin productos no hay columnas: no se divide por cero', () => {
    expect(columnasDinamicas('cat-1', [faceta('encastre', 'Encastre', 0)], 0)).toEqual([])
  })
})

describe('#19 · El valor de la celda', () => {
  const col = { key: 'largo', label: 'Largo', unidad: 'mm' }

  it('agrega la unidad cuando el valor es sólo un número', () => {
    expect(valorDinamico(P({ atributos: { largo: 80 } }), col)).toBe('80 mm')
  })

  it('no la duplica si el valor ya la trae escrita', () => {
    expect(valorDinamico(P({ atributos: { largo: '80 mm' } }), col)).toBe('80 mm')
  })

  it('sin el atributo muestra «—», no vacío', () => {
    expect(valorDinamico(P({ atributos: {} }), col)).toBe('—')
  })

  it('una cadena vacía también es «—»', () => {
    expect(valorDinamico(P({ atributos: { largo: '   ' } }), col)).toBe('—')
  })

  it('un objeto mal cargado no se imprime como «[object Object]»', () => {
    expect(valorDinamico(P({ atributos: { largo: { mal: 1 } } }), col)).toBe('—')
  })

  it('sin unidad definida, el valor sale tal cual', () => {
    expect(valorDinamico(P({ atributos: { encastre: '1/4 HEX' } }), { key: 'encastre', label: 'E', unidad: null })).toBe('1/4 HEX')
  })
})
