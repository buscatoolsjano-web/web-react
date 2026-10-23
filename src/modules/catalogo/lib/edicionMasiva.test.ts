import { describe, expect, it } from 'vitest'
import {
  CAMPOS_FIJOS,
  campoDeAtributo,
  camposMasivos,
  describirCambio,
  puedeAplicar,
} from './edicionMasiva'
import type { DefinicionAtributo } from '../types'

const def = (key: string, label: string, unidad: string | null = null): DefinicionAtributo => ({
  key,
  label,
  unidad,
  tipo: 'text',
  filtrable: true,
  posicion: 1,
  enumerada: false,
  rango: null,
  opciones: [],
  enFicha: true,
})

describe('edicionMasiva · qué se puede cambiar (Fase 137)', () => {
  it('ofrece primero las columnas fijas y después las características', () => {
    const campos = camposMasivos([def('medida', 'Medida', 'mm')])
    expect(campos.slice(0, CAMPOS_FIJOS.length).map((c) => c.clave)).toEqual(
      CAMPOS_FIJOS.map((c) => c.clave),
    )
    expect(campos.at(-1)).toMatchObject({ clave: 'attr.medida', rpc: 'attr.medida', atributoKey: 'medida' })
  })

  it('la referencia (sku) NO está entre los campos: es la clave única', () => {
    const claves = camposMasivos([]).map((c) => c.clave)
    expect(claves).not.toContain('sku')
  })

  it('un atributo se traduce a attr.<key> con su unidad', () => {
    expect(campoDeAtributo(def('torque', 'Torque', 'N·m'))).toEqual({
      clave: 'attr.torque',
      etiqueta: 'Torque',
      tipo: 'atributo',
      rpc: 'attr.torque',
      atributoKey: 'torque',
      unidad: 'N·m',
    })
  })
})

describe('edicionMasiva · puedeAplicar', () => {
  const marca = CAMPOS_FIJOS[0]! // brand_id
  const categoria = CAMPOS_FIJOS[1]! // category_id

  it('no deja aplicar sin productos', () => {
    expect(puedeAplicar(marca, 'm1', 0)).toBe(false)
  })

  it('no deja aplicar sin campo', () => {
    expect(puedeAplicar(null, 'algo', 5)).toBe(false)
  })

  it('la categoría no puede quedar vacía (es NOT NULL)', () => {
    expect(puedeAplicar(categoria, '', 5)).toBe(false)
    expect(puedeAplicar(categoria, 'c1', 5)).toBe(true)
  })

  it('las demás sí admiten vacío (queda sin dato / borra la clave)', () => {
    expect(puedeAplicar(marca, '', 5)).toBe(true)
  })
})

describe('edicionMasiva · describirCambio', () => {
  const tipo = CAMPOS_FIJOS[2]! // product_type, texto
  const atributo = campoDeAtributo(def('medida', 'Medida', 'mm'))

  it('dice el campo, el valor y cuántos', () => {
    expect(describirCambio(tipo, ' Punta ', 3)).toBe('Vas a poner «Tipo» = «Punta» en 3 productos.')
  })

  it('singular con uno solo', () => {
    expect(describirCambio(tipo, 'Punta', 1)).toBe('Vas a poner «Tipo» = «Punta» en 1 producto.')
  })

  it('vaciar una columna la deja sin dato; vaciar un atributo lo BORRA', () => {
    expect(describirCambio(tipo, '  ', 2)).toBe('Vas a dejar «Tipo» sin dato en 2 productos.')
    expect(describirCambio(atributo, '', 2)).toBe('Vas a BORRAR «Medida» en 2 productos.')
  })
})
