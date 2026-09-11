import { describe, expect, it } from 'vitest'
import { errorDe, validarActivo, validarLinea, validarOrden, validarRepuesto } from './validacion'
import type { DatosActivo } from '../services/activos'
import type { DatosOrden } from '../services/ordenes'

const ACTIVO: DatosActivo = {
  duenoId: null,
  productoId: null,
  identificador: '',
  serie: '',
  marca: '',
  modelo: '',
  tipo: '',
  ciudad: '',
  provincia: '',
  garantiaDesde: '',
  garantiaHasta: '',
  bajoContrato: false,
  notas: '',
}

const ORDEN: DatosOrden = {
  activoId: 'a1',
  clienteId: 'c1',
  tipoServicio: 'corrective',
  motivoIngreso: '',
  condicionVisual: '',
  tecnicoId: null,
  fechaIngreso: '2026-09-10',
  notasDiagnostico: '',
}

describe('validarActivo', () => {
  it('un equipo vacío es válido: nada es obligatorio', () => {
    // Es la regla de fondo. El serial, el dueño y el producto son nullable en
    // el schema, así que exigirlos acá inventaría una regla que la base no
    // tiene y dejaría afuera casos reales del sistema anterior.
    expect(validarActivo(ACTIVO)).toEqual([])
  })

  it('un equipo sin serie y sin dueño pasa', () => {
    expect(validarActivo({ ...ACTIVO, serie: '', duenoId: null })).toEqual([])
  })

  it('una fecha de garantía mal escrita se rechaza', () => {
    const e = validarActivo({ ...ACTIVO, garantiaDesde: 'ayer' })
    expect(errorDe(e, 'garantiaDesde')).toMatch(/no es válida/)
  })

  it('el 30 de febrero no existe', () => {
    const e = validarActivo({ ...ACTIVO, garantiaHasta: '2026-02-30' })
    expect(errorDe(e, 'garantiaHasta')).toMatch(/no es válida/)
  })

  it('la garantía no puede terminar antes de empezar', () => {
    const e = validarActivo({
      ...ACTIVO,
      garantiaDesde: '2026-06-01',
      garantiaHasta: '2026-01-01',
    })
    expect(errorDe(e, 'garantiaHasta')).toMatch(/anterior/)
  })

  it('el mismo día en los dos extremos es válido', () => {
    expect(
      validarActivo({ ...ACTIVO, garantiaDesde: '2026-06-01', garantiaHasta: '2026-06-01' }),
    ).toEqual([])
  })
})

describe('validarOrden', () => {
  it('una orden completa es válida', () => {
    expect(validarOrden(ORDEN)).toEqual([])
  })

  it('exige el equipo', () => {
    expect(errorDe(validarOrden({ ...ORDEN, activoId: '' }), 'activoId')).toBeTruthy()
  })

  it('exige el cliente, y explica que queda congelado', () => {
    const mensaje = errorDe(validarOrden({ ...ORDEN, clienteId: '' }), 'clienteId')
    expect(mensaje).toBeTruthy()
    expect(mensaje).toMatch(/queda guardado en la orden/)
  })

  it('exige el tipo de servicio y la fecha de ingreso', () => {
    expect(errorDe(validarOrden({ ...ORDEN, tipoServicio: '' }), 'tipoServicio')).toBeTruthy()
    expect(errorDe(validarOrden({ ...ORDEN, fechaIngreso: '' }), 'fechaIngreso')).toBeTruthy()
  })

  it('una fecha de ingreso inválida se rechaza como inválida, no como vacía', () => {
    expect(errorDe(validarOrden({ ...ORDEN, fechaIngreso: '10/09/2026' }), 'fechaIngreso')).toMatch(
      /no es válida/,
    )
  })

  it('el técnico y el motivo son opcionales', () => {
    expect(validarOrden({ ...ORDEN, tecnicoId: null, motivoIngreso: '' })).toEqual([])
  })
})

describe('errorDe', () => {
  it('devuelve null cuando el campo está bien', () => {
    expect(errorDe(validarOrden(ORDEN), 'activoId')).toBeNull()
  })
})

describe('validarLinea', () => {
  const base = { descripcion: 'Mano de obra', cantidad: 1, precioUnitario: 100, productoId: null, tipo: 'labour' }

  it('una línea con concepto, cantidad y precio es válida', () => {
    expect(validarLinea(base)).toEqual([])
  })

  it('sin producto y sin descripción no dice nada, y se rechaza', () => {
    // Un renglón con importe y sin concepto es lo que recibiría el cliente.
    expect(errorDe(validarLinea({ ...base, descripcion: '  ' }), 'descripcion')).toBeTruthy()
  })

  it('con producto elegido, la descripción deja de ser obligatoria', () => {
    expect(validarLinea({ ...base, descripcion: '', productoId: 'p-1' })).toEqual([])
  })

  it('la cantidad tiene que ser mayor que cero', () => {
    expect(errorDe(validarLinea({ ...base, cantidad: 0 }), 'cantidad')).toBeTruthy()
    expect(errorDe(validarLinea({ ...base, cantidad: -1 }), 'cantidad')).toBeTruthy()
    expect(errorDe(validarLinea({ ...base, cantidad: NaN }), 'cantidad')).toBeTruthy()
  })

  it('el precio puede ser cero pero no negativo', () => {
    expect(validarLinea({ ...base, precioUnitario: 0 })).toEqual([])
    expect(errorDe(validarLinea({ ...base, precioUnitario: -1 }), 'precioUnitario')).toBeTruthy()
  })

  it('no valida el total: lo calcula el servidor', () => {
    // Por eso `validarLinea` no recibe ningún total.
    expect(Object.keys(base)).not.toContain('total')
  })
})

describe('validarRepuesto', () => {
  const base = {
    productoId: 'p-1',
    depositoId: 'd-1',
    cantidad: 1,
    costoUnitario: null as number | null,
    monedaCosto: null as string | null,
  }

  it('producto, depósito y cantidad alcanzan: el costo es opcional', () => {
    expect(validarRepuesto(base)).toEqual([])
  })

  it('exige el producto y el depósito', () => {
    expect(errorDe(validarRepuesto({ ...base, productoId: null }), 'productoId')).toBeTruthy()
    expect(errorDe(validarRepuesto({ ...base, depositoId: null }), 'depositoId')).toBeTruthy()
  })

  it('con costo, exige la moneda del costo', () => {
    // Es el CHECK `chk_mop_costo_moneda`: un número sin unidad no es un costo.
    const e = validarRepuesto({ ...base, costoUnitario: 25 })
    expect(errorDe(e, 'monedaCosto')).toMatch(/moneda/)
  })

  it('con costo y moneda, pasa', () => {
    expect(validarRepuesto({ ...base, costoUnitario: 25, monedaCosto: 'ARS' })).toEqual([])
  })

  it('costo cero con moneda también pasa: un repuesto puede no costar nada', () => {
    expect(validarRepuesto({ ...base, costoUnitario: 0, monedaCosto: 'ARS' })).toEqual([])
  })

  it('el costo no puede ser negativo', () => {
    const e = validarRepuesto({ ...base, costoUnitario: -1, monedaCosto: 'ARS' })
    expect(errorDe(e, 'costoUnitario')).toBeTruthy()
  })

  it('sin costo, la moneda puede faltar', () => {
    expect(validarRepuesto({ ...base, costoUnitario: null, monedaCosto: null })).toEqual([])
  })
})
