import { describe, expect, it } from 'vitest'
import { aCsv, celda } from './csv'
import type { ProveedorListado } from '../types'

const proveedor = (cambios: Partial<ProveedorListado> = {}): ProveedorListado => ({
  id: 'a1',
  referencia: 'PROV00008',
  razonSocial: 'Pinturerias REX S.A.',
  nombreComercial: null,
  pais: 'AR',
  telefono: '47247600',
  email: null,
  formaPago: 'FOB 180 DIAS',
  estado: 'active',
  esHistorico: true,
  necesitaRevision: false,
  motivosRevision: [],
  dadoDeBaja: false,
  ...cambios,
})

describe('celda', () => {
  it('entrecomilla lo que rompería el CSV', () => {
    expect(celda('50% adelanto; 50% contra entrega')).toBe('"50% adelanto; 50% contra entrega"')
    expect(celda('dice "hola"')).toBe('"dice ""hola"""')
    expect(celda('dos\nlíneas')).toBe('"dos\nlíneas"')
  })

  it('deja en paz lo que no', () => {
    expect(celda('FOB 180 DIAS')).toBe('FOB 180 DIAS')
    expect(celda(null)).toBe('')
    expect(celda(undefined)).toBe('')
  })
})

describe('aCsv', () => {
  it('encabezado y una fila', () => {
    const lineas = aCsv([proveedor()]).split('\r\n')
    expect(lineas[0]).toBe(
      'Referencia;Razon social;Nombre comercial;Pais;Telefono;Email;Forma de pago;Estado;Origen;Observaciones',
    )
    expect(lineas[1]).toBe(
      'PROV00008;Pinturerias REX S.A.;;AR;47247600;;FOB 180 DIAS;active;migrado;',
    )
  })

  it('un proveedor dado de baja se exporta como baja, no como activo', () => {
    const fila = aCsv([proveedor({ dadoDeBaja: true })]).split('\r\n')[1]
    expect(fila).toContain(';baja;')
  })

  it('un proveedor nuevo se distingue de uno migrado', () => {
    const fila = aCsv([proveedor({ esHistorico: false })]).split('\r\n')[1]
    expect(fila).toContain(';nuevo;')
  })

  it('los motivos de revisión van todos, separados', () => {
    const fila = aCsv([
      proveedor({ necesitaRevision: true, motivosRevision: ['LEGACY_EMAIL_EN_NOTAS', 'OTRO'] }),
    ]).split('\r\n')[1]
    expect(fila).toContain('LEGACY_EMAIL_EN_NOTAS | OTRO')
  })

  it('sin filas, sólo el encabezado', () => {
    expect(aCsv([]).split('\r\n')).toHaveLength(1)
  })
})
