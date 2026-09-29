import { describe, expect, it } from 'vitest'
import {
  clienteAutomatico,
  faltaParaImportar,
  lineasARevisar,
  necesitaRevision,
  resumirLineas,
  type CandidatoCliente,
  type LineaEmparejada,
  type MetodoCliente,
  type MetodoLinea,
} from './importarOc'

const cliente = (metodo: MetodoCliente, confianza = 1, id = 'c1'): CandidatoCliente => ({
  customerId: id,
  nombre: 'METALÚRGICA ZZ S.A.',
  cuit: '30712345679',
  metodo,
  confianza,
})

const linea = (metodo: MetodoLinea, over: Partial<LineaEmparejada> = {}): LineaEmparejada => ({
  n: 1,
  codigo: 'SP.553',
  descripcion: 'TUBO IMAN',
  cantidad: 4,
  precio: 900,
  productId: metodo === 'sin_match' ? null : 'p1',
  sku: metodo === 'sin_match' ? null : 'SP.553',
  nombre: metodo === 'sin_match' ? null : 'SPEEDRILL 553',
  metodo,
  confianza: 1,
  ...over,
})

describe('Cuándo la pantalla elige el cliente sola', () => {
  it('con el CUIT, elige: es el dato duro', () => {
    expect(clienteAutomatico([cliente('cuit')])?.customerId).toBe('c1')
  })

  it('con el nombre exacto también', () => {
    expect(clienteAutomatico([cliente('nombre_exacto', 0.95)])?.customerId).toBe('c1')
  })

  /**
   * La decisión central. Los trigramas devuelven el MÁS parecido que
   * encontraron, no el correcto: con mil clientes siempre hay alguno que se
   * parece. Un 0,97 sigue siendo un parecido.
   */
  it('con un parecido NO elige, por alto que sea', () => {
    expect(clienteAutomatico([cliente('parecido', 0.97)])).toBeNull()
  })

  /**
   * Dos con el mismo nombre exacto son dos empresas distintas que se llaman
   * igual. Elegir una por orden alfabético es peor que preguntar: mandarle la
   * mercadería a la otra no se deshace.
   */
  it('con dos candidatos no elige, aunque los dos sean exactos', () => {
    expect(clienteAutomatico([cliente('nombre_exacto', 0.95, 'c1'), cliente('nombre_exacto', 0.95, 'c2')])).toBeNull()
  })

  it('sin candidatos, no hay nada que elegir', () => {
    expect(clienteAutomatico([])).toBeNull()
  })
})

describe('Qué líneas hay que mirar', () => {
  it.each<MetodoLinea>(['alias', 'sku', 'alias_sin_cantidad', 'modelo', 'referencia_vieja'])(
    'un match por %s no necesita revisión',
    (metodo) => {
      expect(necesitaRevision(linea(metodo))).toBe(false)
    },
  )

  it('un parecido sí, aunque tenga producto', () => {
    expect(necesitaRevision(linea('parecido', { confianza: 0.88 }))).toBe(true)
  })

  it('una línea sin producto, obviamente', () => {
    expect(necesitaRevision(linea('sin_match'))).toBe(true)
  })

  it('las devuelve en una lista, conservando el orden de la OC', () => {
    const lineas = [linea('alias', { n: 1 }), linea('parecido', { n: 2 }), linea('sin_match', { n: 3 })]
    expect(lineasARevisar(lineas).map((l) => l.n)).toEqual([2, 3])
  })
})

describe('El resumen de arriba de la tabla', () => {
  /**
   * «No sé qué es esto» y «creo que es esto, miralo» son dos problemas
   * distintos y se cuentan aparte: un solo número escondería cuál de los dos
   * hay, y se revisan de manera diferente.
   */
  it('separa lo que no se encontró de lo que hay que confirmar', () => {
    const r = resumirLineas([
      linea('alias', { n: 1 }),
      linea('sku', { n: 2 }),
      linea('parecido', { n: 3 }),
      linea('sin_match', { n: 4 }),
      linea('sin_match', { n: 5 }),
    ])
    expect(r).toEqual({ total: 5, resueltas: 2, aConfirmar: 1, sinProducto: 2 })
  })

  it('una OC entera resuelta no tiene nada para mirar', () => {
    expect(resumirLineas([linea('alias'), linea('sku')])).toMatchObject({ aConfirmar: 0, sinProducto: 0 })
  })
})

describe('Qué frena la importación', () => {
  const base = { clienteId: 'c1', numero: 'OC-412', lineas: [linea('alias')] }

  it('con cliente, número y líneas, no falta nada', () => {
    expect(faltaParaImportar(base)).toEqual([])
  })

  it('sin cliente no se puede: no se sabría a quién', () => {
    expect(faltaParaImportar({ ...base, clienteId: null })).toEqual([
      'Elegí a qué cliente corresponde la orden.',
    ])
  })

  it('sin número tampoco: no se podría reconocer después', () => {
    expect(faltaParaImportar({ ...base, numero: '   ' })).toHaveLength(1)
  })

  /**
   * Las líneas sin producto NO frenan. Entran a la cotización con el texto del
   * cliente y se completan a mano: perderlas sería peor que importarlas
   * incompletas.
   */
  it('las líneas sin producto no frenan nada', () => {
    expect(faltaParaImportar({ ...base, lineas: [linea('sin_match')] })).toEqual([])
  })

  it('pero sin ninguna línea, no es una orden de compra', () => {
    expect(faltaParaImportar({ ...base, lineas: [] })).toEqual(['La orden no tiene ninguna línea.'])
  })
})
