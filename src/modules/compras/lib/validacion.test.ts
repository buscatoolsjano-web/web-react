import { describe, expect, it } from 'vitest'
import {
  esEmail,
  normalizarCuit,
  normalizarPais,
  pareceCuit,
  PROVEEDOR_VACIO,
  pedidoVacio,
  validarPedido,
  validarProveedor,
  type DatosPedidoCompra,
  type DatosProveedor,
} from './validacion'

const con = (cambios: Partial<DatosProveedor>): DatosProveedor => ({
  ...PROVEEDOR_VACIO,
  razonSocial: 'Pinturerias REX S.A.',
  ...cambios,
})

describe('normalizarCuit', () => {
  it('deja sólo los dígitos', () => {
    expect(normalizarCuit('30-50328441-0')).toBe('30503284410')
    expect(normalizarCuit('30503284410')).toBe('30503284410')
  })

  it('un texto que no es un CUIT queda vacío', () => {
    expect(normalizarCuit('Básculas Magris S.A')).toBe('')
    expect(normalizarCuit(null)).toBe('')
    expect(normalizarCuit(undefined)).toBe('')
  })
})

describe('pareceCuit', () => {
  it('once dígitos, ni diez ni doce', () => {
    expect(pareceCuit('30-50328441-0')).toBe(true)
    expect(pareceCuit('3050328441')).toBe(false)
    expect(pareceCuit('305032844100')).toBe(false)
  })
})

describe('esEmail', () => {
  it('reconoce lo que tiene forma de email', () => {
    expect(esEmail('ventas@proveedor.com.ar')).toBe(true)
    expect(esEmail('  info@wilkox.com.ar  ')).toBe(true)
  })

  it('y rechaza lo que no', () => {
    expect(esEmail('ventas')).toBe(false)
    expect(esEmail('ventas@proveedor')).toBe(false)
    expect(esEmail('dos @espacios.com')).toBe(false)
  })
})

describe('normalizarPais', () => {
  it('siempre en mayúsculas: es lo que exige el CHECK', () => {
    expect(normalizarPais('ar')).toBe('AR')
    expect(normalizarPais(' es ')).toBe('ES')
    expect(normalizarPais(null)).toBe('')
  })
})

describe('validarProveedor', () => {
  it('la razón social es obligatoria', () => {
    const errores = validarProveedor({ ...PROVEEDOR_VACIO, razonSocial: '   ' })
    expect(errores.map((e) => e.campo)).toContain('razonSocial')
  })

  it('un proveedor con sólo la razón social es válido', () => {
    expect(validarProveedor(con({}))).toEqual([])
  })

  it('un CUIT nuevo mal formado se rechaza', () => {
    const errores = validarProveedor(con({ cuit: '3050328441' }))
    expect(errores.map((e) => e.campo)).toContain('cuit')
    expect(errores[0]?.mensaje).toContain('10')
  })

  it('un CUIT bien formado pasa', () => {
    expect(validarProveedor(con({ cuit: '30-50328441-0' }))).toEqual([])
  })

  it('el CUIT vacío no molesta: el legacy no trae ninguno', () => {
    expect(validarProveedor(con({ cuit: '' }))).toEqual([])
  })

  it('un CUIT legacy raro que NO cambió no obliga a arreglarlo', () => {
    // Corregir un teléfono no tiene que exigir inventar un CUIT.
    const datos = con({ cuit: 'Básculas Magris S.A', telefono: '47247600' })
    expect(validarProveedor(datos, 'Básculas Magris S.A')).toEqual([])
  })

  it('la comparación es por dígitos: retocar el texto sin tocar el número no dispara nada', () => {
    // «Básculas Magris S.A» y «Básculas Magris S.A.» tienen los mismos cero
    // dígitos, así que para la validación el CUIT no cambió.
    expect(validarProveedor(con({ cuit: 'Básculas Magris S.A.' }), 'Básculas Magris S.A')).toEqual([])
  })

  it('pero si le ponen dígitos que no son un CUIT, sí', () => {
    const errores = validarProveedor(con({ cuit: '4724 7600' }), 'Básculas Magris S.A')
    expect(errores.map((e) => e.campo)).toContain('cuit')
  })

  it('un email mal formado se rechaza', () => {
    const errores = validarProveedor(con({ email: 'ventas@' }))
    expect(errores.map((e) => e.campo)).toContain('email')
  })

  it('el país va con dos letras', () => {
    expect(validarProveedor(con({ pais: 'AR' }))).toEqual([])
    expect(validarProveedor(con({ pais: 'ar' }))).toEqual([])
    expect(validarProveedor(con({ pais: 'ARG' })).map((e) => e.campo)).toContain('pais')
    expect(validarProveedor(con({ pais: 'Argentina' })).map((e) => e.campo)).toContain('pais')
  })

  it('el país vacío es válido: no se inventa uno', () => {
    expect(validarProveedor(con({ pais: '' }))).toEqual([])
  })

  it('la dirección larga en una línea no molesta a nadie', () => {
    const datos = con({
      direccion: 'Direccion: Av.Saenz Peña 2227 · San Martin · BUENOS AIRES · CP 1651 · AR',
    })
    expect(validarProveedor(datos)).toEqual([])
  })
})

// ── Pedido de compra ───────────────────────────────────────────────────────

const pedido = (cambios: Partial<DatosPedidoCompra> = {}): DatosPedidoCompra => ({
  ...pedidoVacio('2026-09-10'),
  proveedorId: 'abc',
  moneda: 'USD',
  ...cambios,
})

describe('validarPedido', () => {
  it('un pedido con proveedor, moneda y fecha es válido', () => {
    expect(validarPedido(pedido())).toEqual([])
  })

  it('el proveedor es obligatorio', () => {
    const e = validarPedido(pedido({ proveedorId: '' }))
    expect(e.map((x) => x.campo)).toContain('proveedorId')
  })

  it('la moneda es obligatoria', () => {
    const e = validarPedido(pedido({ moneda: '' }))
    expect(e.map((x) => x.campo)).toContain('moneda')
  })

  it('una moneda inventada se rechaza', () => {
    const e = validarPedido(pedido({ moneda: 'BTC' }))
    expect(e.map((x) => x.campo)).toContain('moneda')
  })

  it('la fecha del pedido es obligatoria', () => {
    const e = validarPedido(pedido({ fecha: '' }))
    expect(e.map((x) => x.campo)).toContain('fecha')
  })

  it('la ETA puede quedar vacía: «no se sabe» es un dato', () => {
    expect(validarPedido(pedido({ fechaEstimada: '' }))).toEqual([])
  })

  it('pero una ETA anterior al pedido no tiene sentido', () => {
    const e = validarPedido(pedido({ fecha: '2026-09-10', fechaEstimada: '2026-09-01' }))
    expect(e.map((x) => x.campo)).toContain('fechaEstimada')
  })

  it('una ETA posterior está bien', () => {
    expect(validarPedido(pedido({ fecha: '2026-09-10', fechaEstimada: '2026-11-01' }))).toEqual([])
  })

  it('el tipo de cambio es opcional pero tiene que ser positivo', () => {
    expect(validarPedido(pedido({ tipoCambio: '' }))).toEqual([])
    expect(validarPedido(pedido({ tipoCambio: '1450,50' }))).toEqual([])
    expect(validarPedido(pedido({ tipoCambio: '0' })).map((x) => x.campo)).toContain('tipoCambio')
    expect(validarPedido(pedido({ tipoCambio: '-3' })).map((x) => x.campo)).toContain('tipoCambio')
    expect(validarPedido(pedido({ tipoCambio: 'mucho' })).map((x) => x.campo)).toContain('tipoCambio')
  })
})
