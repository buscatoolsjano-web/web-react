import { describe, expect, it } from 'vitest'
import { aplicarDefaults, type DefaultsComerciales, type CampoSugerible } from './defaults'
import { borradorNuevo, cambiarCampo } from './borrador'

/**
 * Los defaults del cliente sobre el alta (Fase 17 · E2).
 *
 * Cada caso responde una pregunta concreta del negocio: qué pasa cuando el
 * cliente no tiene defaults, cuando la tarifa está en otra moneda, cuando el
 * vendedor se fue de la empresa, y —sobre todo— qué NO pisa lo que la persona
 * ya eligió.
 */
const OPCIONES = {
  tarifas: [
    { id: 'usd-a', nombre: 'Lista base', moneda: 'USD' },
    { id: 'usd-b', nombre: 'Mayorista', moneda: 'USD' },
    { id: 'ars-a', nombre: 'Lista pesos', moneda: 'ARS' },
  ],
  vendedores: [
    { id: 'v1', nombre: 'ZZ Vendedora' },
    { id: 'v2', nombre: 'ZZ Vendedor dos' },
  ],
}

const defaults = (p: Partial<DefaultsComerciales> = {}): DefaultsComerciales => ({
  vendedorId: null,
  tarifaId: null,
  formaPago: null,
  moneda: null,
  ...p,
})

const base = () => borradorNuevo('2026-09-18', '30 DIAS F/F con ECHEQ')
const sinTocar = new Set<CampoSugerible>()
const tocado = (...campos: CampoSugerible[]) => new Set<CampoSugerible>(campos)

describe('cliente con defaults completos', () => {
  it('sugiere moneda, vendedor, tarifa y forma de pago', () => {
    const r = aplicarDefaults(
      base(),
      defaults({ moneda: 'USD', vendedorId: 'v1', tarifaId: 'usd-b', formaPago: 'Contado' }),
      sinTocar,
      OPCIONES,
    )
    expect(r.borrador.cabecera.moneda).toBe('USD')
    expect(r.borrador.cabecera.vendedorId).toBe('v1')
    expect(r.borrador.cabecera.listaPrecioId).toBe('usd-b')
    expect(r.borrador.cabecera.formaPago).toBe('Contado')
    expect(r.aplicados.sort()).toEqual(['formaPago', 'listaPrecioId', 'moneda', 'vendedorId'])
    expect(r.avisos).toEqual([])
  })

  it('el default del cliente le gana a la forma de pago habitual del sistema', () => {
    const b = base()
    expect(b.cabecera.formaPago).toBe('30 DIAS F/F con ECHEQ')
    const r = aplicarDefaults(b, defaults({ formaPago: '60 días' }), sinTocar, OPCIONES)
    expect(r.borrador.cabecera.formaPago).toBe('60 días')
  })
})

describe('cliente sin defaults', () => {
  it('no cambia nada y no se queja', () => {
    const b = base()
    const r = aplicarDefaults(b, defaults(), sinTocar, OPCIONES)
    expect(r.borrador.cabecera).toEqual(b.cabecera)
    expect(r.aplicados).toEqual([])
    expect(r.avisos).toEqual([])
  })

  it('un cliente sin nada tampoco inventa una moneda', () => {
    const r = aplicarDefaults(base(), null, sinTocar, OPCIONES)
    expect(r.borrador.cabecera.moneda).toBe('')
  })
})

describe('defaults parciales', () => {
  it('sólo tarifa: sugiere sólo la tarifa (con la moneda ya elegida)', () => {
    const b = cambiarCampo(base(), 'moneda', 'USD')
    const r = aplicarDefaults(b, defaults({ tarifaId: 'usd-a' }), tocado('moneda'), OPCIONES)
    expect(r.borrador.cabecera.listaPrecioId).toBe('usd-a')
    expect(r.borrador.cabecera.vendedorId).toBe('')
    expect(r.aplicados).toEqual(['listaPrecioId'])
  })

  it('sólo vendedor: sugiere sólo el vendedor', () => {
    const r = aplicarDefaults(base(), defaults({ vendedorId: 'v2' }), sinTocar, OPCIONES)
    expect(r.aplicados).toEqual(['vendedorId'])
    expect(r.borrador.cabecera.listaPrecioId).toBe('')
  })
})

describe('moneda y tarifa', () => {
  it('sin moneda todavía, la tarifa espera: no se aplica ni se avisa', () => {
    const r = aplicarDefaults(base(), defaults({ tarifaId: 'usd-a' }), sinTocar, OPCIONES)
    expect(r.borrador.cabecera.listaPrecioId).toBe('')
    expect(r.avisos).toEqual([])
  })

  it('cuando después se elige la moneda, la tarifa entra sola', () => {
    const primera = aplicarDefaults(base(), defaults({ tarifaId: 'usd-a' }), sinTocar, OPCIONES)
    const conMoneda = cambiarCampo(primera.borrador, 'moneda', 'USD')
    const segunda = aplicarDefaults(conMoneda, defaults({ tarifaId: 'usd-a' }), tocado('moneda'), OPCIONES)
    expect(segunda.borrador.cabecera.listaPrecioId).toBe('usd-a')
  })

  it('tarifa en otra moneda: no se aplica y se explica', () => {
    const b = cambiarCampo(base(), 'moneda', 'ARS')
    const r = aplicarDefaults(b, defaults({ tarifaId: 'usd-a' }), tocado('moneda'), OPCIONES)
    expect(r.borrador.cabecera.listaPrecioId).toBe('')
    expect(r.avisos[0]).toMatch(/está en USD y el documento en ARS/)
  })

  it('la moneda del cliente manda sobre la tarifa incompatible que trae', () => {
    const r = aplicarDefaults(
      base(),
      defaults({ moneda: 'ARS', tarifaId: 'usd-a' }),
      sinTocar,
      OPCIONES,
    )
    expect(r.borrador.cabecera.moneda).toBe('ARS')
    expect(r.borrador.cabecera.listaPrecioId).toBe('')
    expect(r.avisos).toHaveLength(1)
  })

  it('una tarifa de otra empresa no se aplica', () => {
    const b = cambiarCampo(base(), 'moneda', 'USD')
    const r = aplicarDefaults(b, defaults({ tarifaId: 'de-otra-empresa' }), tocado('moneda'), OPCIONES)
    expect(r.borrador.cabecera.listaPrecioId).toBe('')
    expect(r.avisos[0]).toMatch(/no es de esta empresa/)
  })
})

describe('vendedor inválido', () => {
  it('un vendedor que ya no está no se aplica, y se dice', () => {
    const r = aplicarDefaults(base(), defaults({ vendedorId: 'se-fue' }), sinTocar, OPCIONES)
    expect(r.borrador.cabecera.vendedorId).toBe('')
    expect(r.avisos[0]).toMatch(/vendedor predeterminado del cliente ya no está disponible/)
    expect(r.aplicados).toEqual([])
  })
})

describe('lo que la persona eligió no se pisa', () => {
  it('una tarifa elegida a mano sobrevive al cambio de cliente', () => {
    const b = cambiarCampo(cambiarCampo(base(), 'moneda', 'USD'), 'listaPrecioId', 'usd-b')
    const r = aplicarDefaults(
      b,
      defaults({ moneda: 'USD', tarifaId: 'usd-a' }),
      tocado('moneda', 'listaPrecioId'),
      OPCIONES,
    )
    expect(r.borrador.cabecera.listaPrecioId).toBe('usd-b')
    expect(r.aplicados).not.toContain('listaPrecioId')
  })

  it('un vendedor elegido a mano tampoco se pisa', () => {
    const b = cambiarCampo(base(), 'vendedorId', 'v2')
    const r = aplicarDefaults(b, defaults({ vendedorId: 'v1' }), tocado('vendedorId'), OPCIONES)
    expect(r.borrador.cabecera.vendedorId).toBe('v2')
  })

  it('una forma de pago escrita a mano tampoco', () => {
    const b = cambiarCampo(base(), 'formaPago', 'Contra entrega')
    const r = aplicarDefaults(b, defaults({ formaPago: '60 días' }), tocado('formaPago'), OPCIONES)
    expect(r.borrador.cabecera.formaPago).toBe('Contra entrega')
  })

  it('y la moneda elegida a mano manda sobre la del cliente', () => {
    const b = cambiarCampo(base(), 'moneda', 'ARS')
    const r = aplicarDefaults(b, defaults({ moneda: 'USD' }), tocado('moneda'), OPCIONES)
    expect(r.borrador.cabecera.moneda).toBe('ARS')
  })
})

describe('pero lo inválido no se conserva por haber sido manual', () => {
  it('una tarifa manual incompatible con la moneda se limpia', () => {
    const b = cambiarCampo(cambiarCampo(base(), 'moneda', 'ARS'), 'listaPrecioId', 'usd-a')
    const r = aplicarDefaults(b, defaults(), tocado('moneda', 'listaPrecioId'), OPCIONES)
    expect(r.borrador.cabecera.listaPrecioId).toBe('')
    expect(r.avisos[0]).toMatch(/se quitó/)
  })

  it('una tarifa manual de otra empresa también', () => {
    const b = cambiarCampo(cambiarCampo(base(), 'moneda', 'USD'), 'listaPrecioId', 'ajena')
    const r = aplicarDefaults(b, defaults(), tocado('moneda', 'listaPrecioId'), OPCIONES)
    expect(r.borrador.cabecera.listaPrecioId).toBe('')
    expect(r.avisos[0]).toMatch(/no es de esta empresa/)
  })

  it('un vendedor manual que ya no está, también se limpia', () => {
    const b = cambiarCampo(base(), 'vendedorId', 'se-fue')
    const r = aplicarDefaults(b, defaults(), tocado('vendedorId'), OPCIONES)
    expect(r.borrador.cabecera.vendedorId).toBe('')
    expect(r.avisos[0]).toMatch(/ya no está disponible/)
  })
})

describe('cambio de cliente', () => {
  it('lo que había puesto el cliente anterior se va con él', () => {
    const conA = aplicarDefaults(
      base(),
      defaults({ moneda: 'USD', vendedorId: 'v1', tarifaId: 'usd-a' }),
      sinTocar,
      OPCIONES,
    )
    // Cliente B, sin ningún default.
    const conB = aplicarDefaults(conA.borrador, defaults(), sinTocar, OPCIONES)
    expect(conB.borrador.cabecera.vendedorId).toBe('')
    expect(conB.borrador.cabecera.listaPrecioId).toBe('')
    // La moneda ya elegida no se borra: dejar un documento sin moneda sería peor.
    expect(conB.borrador.cabecera.moneda).toBe('USD')
  })

  it('los defaults del cliente nuevo reemplazan a los del anterior', () => {
    const conA = aplicarDefaults(
      base(),
      defaults({ moneda: 'USD', vendedorId: 'v1', tarifaId: 'usd-a' }),
      sinTocar,
      OPCIONES,
    )
    const conB = aplicarDefaults(
      conA.borrador,
      defaults({ moneda: 'USD', vendedorId: 'v2', tarifaId: 'usd-b' }),
      sinTocar,
      OPCIONES,
    )
    expect(conB.borrador.cabecera.vendedorId).toBe('v2')
    expect(conB.borrador.cabecera.listaPrecioId).toBe('usd-b')
  })
})
