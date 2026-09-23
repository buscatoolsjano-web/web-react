import { describe, expect, it } from 'vitest'
import { columnasDe, familiaDe } from './familias'
import { aCanonico, aTextoComparable, cercania, compararValor, filaComparada, sinDato, textoDe, valorDe } from './similitud'
import type { ProductoListado } from '../types'

/**
 * El comparador de productos similares (Fase 22 · Etapa B).
 *
 * Lo que se prueba acá no es que pinte verde o rojo: es que **no pinte rojo
 * cuando no sabe**. Decir que dos productos difieren en el largo porque uno
 * dice «1.6 MTS» y el otro «1600 mm» es peor que no decir nada, porque parece
 * un dato.
 */
const producto = (x: Partial<ProductoListado> & { sku: string }): ProductoListado => ({
  enCatalogo: true,
  id: x.sku,
  nombre: x.sku,
  serie: null,
  tipo: null,
  esKit: false,
  necesitaRevision: false,
  marca: null,
  categoria: null,
  atributos: {},
  precio: null,
  stock: null,
  disponible: null,
  imagen: null,
  ...x,
})

const balanceador = (sku: string, a: Record<string, unknown>) =>
  producto({ sku, marca: { id: 'm', nombre: 'TECNA' }, atributos: a })

const col = (familia: string, clave: string) => columnasDe(familia).find((c) => c.clave === clave)!

describe('Unidades: la misma medida escrita distinto es la misma medida', () => {
  it.each([
    ['1.6 m', 1600],
    ['1,6 m', 1600],
    ['1600 mm', 1600],
    ['1.6 MTS', 1600],
    ['160 cm', 1600],
  ])('%s → %i mm', (texto, mm) => {
    expect(aCanonico(texto, 'longitud')).toBe(mm)
  })

  it('un valor pelado toma la unidad de SU columna, no la de la magnitud', () => {
    // El `largo` de una punta está cargado en mm y el recorrido de un
    // balanceador en metros. El mismo «1.6» significa cosas distintas según
    // dónde esté, así que la unidad implícita la pone la columna.
    expect(aCanonico('200', 'longitud', 'mm')).toBe(200)
    expect(aCanonico('1.6', 'longitud', 'm')).toBe(1600)
  })

  it('sin unidad declarada no se adivina: null antes que un número inventado', () => {
    expect(aCanonico('200', 'longitud')).toBeNull()
  })

  it('la masa de un balanceador está en kg', () => {
    expect(aCanonico('0.4', 'masa', 'kg')).toBe(400)
    expect(aCanonico('400 g', 'masa', 'kg')).toBe(400)
  })

  it('un encastre NO es una magnitud: 1/4 HEX no vale 0,25', () => {
    expect(aCanonico('1/4 HEX', 'longitud')).toBeNull()
    expect(aCanonico('1/2', 'longitud')).toBeNull()
  })

  it('un texto tampoco', () => {
    expect(aCanonico('Adaptador', 'longitud')).toBeNull()
    expect(aCanonico('PLASTICO', 'masa')).toBeNull()
  })

  it('una unidad desconocida no se inventa', () => {
    expect(aCanonico('5 leguas', 'longitud')).toBeNull()
  })

  it('sin magnitud declarada no se normaliza nada', () => {
    expect(aCanonico('200', undefined)).toBeNull()
  })
})

describe('Texto: mismo valor escrito distinto coincide, parecido NO', () => {
  it('mayúsculas, espacios y separadores no cuentan', () => {
    expect(aTextoComparable('1/4 hex')).toBe(aTextoComparable('1/4HEX'))
    expect(aTextoComparable('Alumínio')).toBe(aTextoComparable('ALUMINIO'))
  })

  it('pero no es fuzzy: dos cosas parecidas siguen siendo distintas', () => {
    expect(aTextoComparable('PLASTICO')).not.toBe(aTextoComparable('PLASTICO REFORZADO'))
  })
})

describe('Sin dato no es rojo (B10)', () => {
  const principal = balanceador('A', { min_kg: 0.4, max_kg: 1, longitud: '1.6', carcasa: 'ALUMINIO' })

  it('si al similar le falta el dato → neutro, no distinto', () => {
    const sinCarcasa = balanceador('B', { min_kg: 0.4, max_kg: 1, longitud: '1.6' })
    expect(compararValor(principal, sinCarcasa, col('balanceador', 'carcasa'))).toBe('sin-dato')
  })

  it('si al PRINCIPAL le falta el dato, tampoco', () => {
    const vacio = balanceador('C', {})
    expect(compararValor(vacio, principal, col('balanceador', 'carcasa'))).toBe('sin-dato')
  })

  it('el 0 SÍ es un dato: un torque mínimo de 0 no es un dato faltante', () => {
    expect(sinDato(0)).toBe(false)
    const a = producto({ sku: 'A', atributos: { torq_min: 0 } })
    const b = producto({ sku: 'B', atributos: { torq_min: 0 } })
    expect(compararValor(a, b, col('atornillador', 'torq_min'))).toBe('igual')
  })

  it('un string vacío no es un dato', () => {
    expect(sinDato('   ')).toBe(true)
    expect(sinDato([])).toBe(true)
  })
})

describe('El caso exacto del enunciado (B8)', () => {
  // Principal: 0,4–1 kg · 1,6 m · aluminio
  // Similar:   1–2 kg   · 1,6 m · aluminio
  const principal = balanceador('P', { min_kg: 0.4, max_kg: 1, longitud: '1.6', carcasa: 'ALUMINIO' })
  const similar = balanceador('S', { min_kg: 1, max_kg: 2, longitud: '1600 mm', carcasa: 'Aluminio' })

  it.each([
    ['min_kg', 'distinto'],
    ['max_kg', 'distinto'],
    ['longitud', 'igual'],
    ['carcasa', 'igual'],
  ])('%s → %s', (clave, esperado) => {
    expect(compararValor(principal, similar, col('balanceador', clave))).toBe(esperado)
  })

  it('el recorrido coincide aunque esté en otra unidad', () => {
    expect(compararValor(principal, similar, col('balanceador', 'longitud'))).toBe('igual')
  })
})

describe('El producto principal no se compara contra sí mismo (B11)', () => {
  const p = balanceador('P', { min_kg: 0.4, max_kg: 1, carcasa: 'ALUMINIO' })

  it('su fila sale entera en neutro, no toda verde', () => {
    const fila = filaComparada(p, p, 'balanceador', true)
    expect(fila.every((c) => c.veredicto === 'sin-dato')).toBe(true)
  })

  it('pero muestra sus valores igual', () => {
    const fila = filaComparada(p, p, 'balanceador', true)
    expect(fila.find((c) => c.clave === 'carcasa')?.texto).toBe('ALUMINIO')
  })
})

describe('Lo que se muestra es el valor original, no el normalizado', () => {
  it('«1.6» de recorrido se muestra con su unidad', () => {
    const b = balanceador('A', { longitud: '1.6' })
    expect(textoDe(b, col('balanceador', 'longitud'))).toBe('1.6 m')
  })

  it('si el valor ya trae la unidad no se la duplica', () => {
    const b = balanceador('A', { longitud: '1600 mm' })
    expect(textoDe(b, col('balanceador', 'longitud'))).toBe('1600 mm')
  })

  it('lo que falta se muestra como raya, no como vacío', () => {
    const b = balanceador('A', {})
    expect(textoDe(b, col('balanceador', 'carcasa'))).toBe('—')
  })

  it('una lista se muestra separada por comas', () => {
    const p = producto({ sku: 'A', atributos: { medida: ['8', '10'] } })
    expect(textoDe(p, col('punta', 'medida'))).toBe('8, 10')
  })
})

describe('Cada familia compara lo suyo (B19)', () => {
  it('una punta no tiene capacidad de carga', () => {
    expect(columnasDe('punta').map((c) => c.clave)).not.toContain('min_kg')
  })

  it('un balanceador no tiene encastre', () => {
    expect(columnasDe('balanceador').map((c) => c.clave)).not.toContain('encastre')
  })

  it('«Otros» no es comparable: 12.588 productos sin un solo atributo', () => {
    expect(familiaDe('otros')).toBeNull()
    expect(columnasDe('otros')).toEqual([])
  })

  it('una familia desconocida tampoco inventa columnas', () => {
    expect(columnasDe('lo-que-sea')).toEqual([])
    expect(columnasDe(null)).toEqual([])
  })

  it('todas las familias comparables empiezan identificando la fila', () => {
    for (const f of ['punta', 'balanceador', 'atornillador'] as const) {
      expect(columnasDe(f).slice(0, 2).map((c) => c.clave)).toEqual(['marca', 'sku'])
    }
  })
})

describe('valorDe lee de donde corresponde', () => {
  const p = producto({
    sku: 'SP.2520/8B',
    tipo: 'Adaptador',
    serie: 'Adaptador',
    marca: { id: 'm', nombre: 'SPEEDRILL' },
    atributos: { encastre: '1/4 HEX' },
  })

  it('las columnas propias', () => {
    expect(valorDe(p, col('punta', 'marca'))).toBe('SPEEDRILL')
    expect(valorDe(p, col('punta', 'sku'))).toBe('SP.2520/8B')
    expect(valorDe(p, col('punta', 'tipo'))).toBe('Adaptador')
  })

  it('y los atributos', () => {
    expect(valorDe(p, col('punta', 'encastre'))).toBe('1/4 HEX')
  })

  it('un atributo que no está da null, no rompe', () => {
    expect(valorDe(p, col('punta', 'medida'))).toBeNull()
  })
})

describe('Cercanía: ordena, no puntúa a la vista (B12)', () => {
  const principal = balanceador('P', { min_kg: 0.4, max_kg: 1, longitud: '1.6', carcasa: 'ALUMINIO' })

  it('el que coincide en todo va primero', () => {
    const clon = balanceador('IGUAL', { min_kg: 0.4, max_kg: 1, longitud: '1.6', carcasa: 'ALUMINIO' })
    const otro = balanceador('OTRO', { min_kg: 9, max_kg: 20, longitud: '3', carcasa: 'ACERO' })
    expect(cercania(principal, clon, 'balanceador')).toBeGreaterThan(cercania(principal, otro, 'balanceador'))
  })

  it('«no sé» queda entre «sí» y «no», que es donde está', () => {
    const difiere = balanceador('D', { min_kg: 9, max_kg: 20, longitud: '3', carcasa: 'ACERO' })
    const nosabe = balanceador('N', {})
    const coincide = balanceador('C', { min_kg: 0.4, max_kg: 1, longitud: '1.6', carcasa: 'ALUMINIO' })
    const d = cercania(principal, difiere, 'balanceador')
    const n = cercania(principal, nosabe, 'balanceador')
    const c = cercania(principal, coincide, 'balanceador')
    expect(d).toBeLessThan(n)
    expect(n).toBeLessThan(c)
  })

  it('una familia sin columnas no ordena nada', () => {
    expect(cercania(principal, principal, 'otros')).toBe(0)
  })
})

describe('El modelo identifica, no compara', () => {
  const a = producto({ sku: 'SP.2520/8B', marca: { id: 'm', nombre: 'SPEEDRILL' } })
  const b = producto({ sku: 'SP.2521/8B', marca: { id: 'm', nombre: 'SPEEDRILL' } })

  it('dos productos distintos siempre tienen modelo distinto: pintarlo rojo no dice nada', () => {
    // null, no 'sin-dato': el modelo ESTÁ, sólo que compararlo no informa.
    expect(compararValor(a, b, col('punta', 'sku'))).toBeNull()
  })

  it('pero el modelo se sigue mostrando', () => {
    expect(textoDe(b, col('punta', 'sku'))).toBe('SP.2521/8B')
  })

  it('la marca SÍ se compara: «el mismo producto de otra marca» es el hallazgo', () => {
    expect(compararValor(a, b, col('punta', 'marca'))).toBe('igual')
    const otra = producto({ sku: 'X', marca: { id: 'o', nombre: 'APEX' } })
    expect(compararValor(a, otra, col('punta', 'marca'))).toBe('distinto')
  })
})
