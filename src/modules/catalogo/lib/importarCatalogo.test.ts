import { describe, expect, it } from 'vitest'
import { detectarColumnas, parsearCatalogo, parsearCsv } from './importarCatalogo'
import type { DefinicionAtributo } from '../types'

const defs: DefinicionAtributo[] = [
  { key: 'medida', label: 'Medida' } as DefinicionAtributo,
  { key: 'voltaje', label: 'Voltaje' } as DefinicionAtributo,
]

describe('parsearCsv', () => {
  it('separa por ; y saca el BOM y el CRLF', () => {
    const { encabezados, filas } = parsearCsv('﻿Referencia;Marca\r\nAP.1;APEX\r\nAP.2;TOHNICHI')
    expect(encabezados).toEqual(['Referencia', 'Marca'])
    expect(filas).toEqual([['AP.1', 'APEX'], ['AP.2', 'TOHNICHI']])
  })

  it('respeta el ; y los saltos de línea dentro de comillas', () => {
    const { filas } = parsearCsv('Referencia;Descripción\r\nAP.1;"Punta 1/4; larga"\r\nAP.2;"Dos\nlíneas"')
    expect(filas[0]).toEqual(['AP.1', 'Punta 1/4; larga'])
    expect(filas[1]).toEqual(['AP.2', 'Dos\nlíneas'])
  })

  it('desescapa las comillas dobladas', () => {
    const { filas } = parsearCsv('Referencia;Descripción\nAP.1;"Llave ""T"" 10mm"')
    expect(filas[0]).toEqual(['AP.1', 'Llave "T" 10mm'])
  })

  it('un archivo sin filas de datos no explota', () => {
    expect(parsearCsv('﻿Referencia;Marca\r\n')).toEqual({ encabezados: ['Referencia', 'Marca'], filas: [] })
  })
})

describe('detectarColumnas', () => {
  it('reconoce las etiquetas del export y clasifica su destino', () => {
    const { columnas, sinReferencia } = detectarColumnas(
      ['Referencia', 'Descripción', 'Marca', 'Categoría', 'Serie', 'Tipo', 'Medida', 'Precio'],
      defs,
    )
    expect(sinReferencia).toBe(false)
    const porClave = Object.fromEntries(columnas.map((c) => [c.clave, c.destino.tipo]))
    expect(porClave).toMatchObject({
      sku: 'match', nombre: 'campo', marca: 'marca', categoria: 'categoria',
      serie: 'campo', tipo: 'campo', medida: 'atributo', precio: 'ignorada',
    })
    // La Referencia no es elegible (es la llave); el resto sí.
    expect(columnas.find((c) => c.clave === 'sku')?.elegible).toBe(false)
    expect(columnas.find((c) => c.clave === 'medida')?.elegible).toBe(true)
  })

  it('reconoce un atributo declarado que el export no incluye (por su etiqueta)', () => {
    const { columnas } = detectarColumnas(['Referencia', 'Voltaje'], defs)
    const v = columnas.find((c) => c.clave === 'voltaje')
    expect(v?.destino).toEqual({ tipo: 'atributo', key: 'voltaje' })
    expect(v?.elegible).toBe(true)
  })

  it('marca stock, moneda y en catálogo como no aplicables', () => {
    const { columnas } = detectarColumnas(['Referencia', 'Stock real', 'Moneda', 'En catálogo'], defs)
    expect(columnas.filter((c) => c.destino.tipo === 'ignorada').map((c) => c.clave).sort()).toEqual(
      ['en_catalogo', 'moneda', 'stock_real'],
    )
  })

  it('avisa las columnas desconocidas y si falta la Referencia', () => {
    const { desconocidas, sinReferencia } = detectarColumnas(['Marca', 'ColumnaRara'], defs)
    expect(desconocidas).toEqual(['ColumnaRara'])
    expect(sinReferencia).toBe(true)
  })
})

describe('detectarColumnas · ID interno (Fase 125)', () => {
  it('con «ID interno», ÉL es la llave y la Referencia pasa a ser un campo editable', () => {
    const { columnas, sinReferencia } = detectarColumnas(['ID interno', 'Referencia', 'Descripción'], defs)
    expect(sinReferencia).toBe(false)
    const id = columnas.find((c) => c.clave === 'id')
    const sku = columnas.find((c) => c.clave === 'sku')
    expect(id?.destino).toEqual({ tipo: 'match-id' })
    expect(id?.elegible).toBe(false)
    // La Referencia dejó de ser la llave: ahora se puede actualizar el SKU.
    expect(sku?.destino).toEqual({ tipo: 'campo', campo: 'sku' })
    expect(sku?.elegible).toBe(true)
  })

  it('con ID interno y SIN Referencia, igual se puede matchear', () => {
    const { sinReferencia } = detectarColumnas(['ID interno', 'Marca'], defs)
    expect(sinReferencia).toBe(false)
  })
})

describe('parsearCatalogo', () => {
  it('arma las filas con sus valores por clave y saltea las sin Referencia', () => {
    const csv = 'Referencia;Descripción;Medida\r\nAP.1;Punta corta;13mm\r\n;Sin ref;x\r\nAP.2;Punta larga;10mm'
    const r = parsearCatalogo(csv, defs)
    expect(r.sinReferencia).toBe(false)
    expect(r.filas).toHaveLength(2)
    expect(r.filas[0]).toMatchObject({ numero: 2, sku: 'AP.1', valores: { sku: 'AP.1', nombre: 'Punta corta', medida: '13mm' } })
    // La fila sin referencia (línea 3) se descarta; AP.2 es la línea 4.
    expect(r.filas[1]).toMatchObject({ numero: 4, sku: 'AP.2' })
  })

  it('captura el ID interno por fila y conserva la que tiene ID aunque le cambien la Referencia', () => {
    const csv = 'ID interno;Referencia;Descripción\r\nuuid-1;NUEVA-REF;Punta corta\r\nuuid-2;;Sin referencia'
    const r = parsearCatalogo(csv, defs)
    expect(r.filas).toHaveLength(2)
    expect(r.filas[0]).toMatchObject({ id: 'uuid-1', sku: 'NUEVA-REF', valores: { sku: 'NUEVA-REF' } })
    // Con ID interno, una fila sin Referencia NO se descarta: matchea por id.
    expect(r.filas[1]).toMatchObject({ id: 'uuid-2', sku: '' })
  })
})
