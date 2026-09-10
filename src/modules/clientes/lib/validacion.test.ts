import { describe, expect, it } from 'vitest'
import {
  CLIENTE_VACIO,
  CONTACTO_VACIO,
  DIRECCION_VACIA,
  normalizarCuit,
  normalizarDominios,
  normalizarEmails,
  pareceCuit,
  TIPOS_DE_DIRECCION,
  validarCliente,
  validarContacto,
  validarDireccion,
} from './validacion'

describe('normalizarCuit', () => {
  it('deja sólo los dígitos', () => {
    expect(normalizarCuit('30-50328441-0')).toBe('30503284410')
    expect(normalizarCuit('30 50328441 0')).toBe('30503284410')
  })

  it('las dos formas del mismo CUIT normalizan igual', () => {
    expect(normalizarCuit('30-50328441-0')).toBe(normalizarCuit('30503284410'))
  })

  it('sin CUIT, cadena vacía', () => {
    expect(normalizarCuit(null)).toBe('')
    expect(normalizarCuit(undefined)).toBe('')
  })
})

describe('pareceCuit', () => {
  it('once dígitos', () => {
    expect(pareceCuit('30-50328441-0')).toBe(true)
    expect(pareceCuit('3050328441')).toBe(false)
    expect(pareceCuit('Básculas Magris S.A')).toBe(false)
  })
})

describe('normalizarEmails', () => {
  it('recorta y pasa a minúscula', () => {
    expect(normalizarEmails(['  Compras@ACME.com  '])).toEqual(['compras@acme.com'])
  })

  it('saca los repetidos comparando sin distinguir mayúsculas', () => {
    expect(normalizarEmails(['a@acme.com', 'A@ACME.COM', 'b@acme.com'])).toEqual([
      'a@acme.com',
      'b@acme.com',
    ])
  })

  it('descarta lo que no tiene forma de email y las cadenas vacías', () => {
    expect(normalizarEmails(['', '   ', 'no-es-un-mail', 'ok@acme.com'])).toEqual([
      'ok@acme.com',
    ])
  })
})

describe('normalizarDominios', () => {
  it('saca el arroba, el protocolo y la barra', () => {
    expect(normalizarDominios(['@Acme.com', 'https://acme.com/contacto'])).toEqual([
      'acme.com',
    ])
  })

  it('descarta lo que no tiene punto', () => {
    expect(normalizarDominios(['acme', 'acme.com'])).toEqual(['acme.com'])
  })
})

describe('validarCliente', () => {
  const base = { ...CLIENTE_VACIO, razonSocial: 'Acme S.A.' }

  it('la razón social es obligatoria', () => {
    const e = validarCliente({ ...CLIENTE_VACIO, razonSocial: '   ' })
    expect(e.some((x) => x.campo === 'razonSocial')).toBe(true)
  })

  it('un cliente mínimo es válido', () => {
    expect(validarCliente(base)).toEqual([])
  })

  it('un CUIT nuevo tiene que tener once dígitos', () => {
    const e = validarCliente({ ...base, cuit: '3050328441' })
    expect(e.some((x) => x.campo === 'cuit')).toBe(true)
  })

  it('un CUIT nuevo bien formado pasa, con guiones o sin ellos', () => {
    expect(validarCliente({ ...base, cuit: '30-50328441-0' })).toEqual([])
    expect(validarCliente({ ...base, cuit: '30503284410' })).toEqual([])
  })

  it('NO obliga a corregir el CUIT histórico si no se lo tocó', () => {
    // 21 clientes migrados traen basura en `tax_id`. Exigir que se arreglen
    // para poder cambiar un teléfono sería obligar a inventar un dato.
    const e = validarCliente({ ...base, cuit: 'Básculas Magris S.A' }, 'Básculas Magris S.A')
    expect(e).toEqual([])
  })

  it('pero sí lo valida si lo cambiaron por otra cosa mal formada', () => {
    const e = validarCliente({ ...base, cuit: '123' }, 'Básculas Magris S.A')
    expect(e.some((x) => x.campo === 'cuit')).toBe(true)
  })

  it('cambiar el formato del mismo CUIT no cuenta como cambio', () => {
    const e = validarCliente({ ...base, cuit: '30503284410' }, '30-50328441-0')
    expect(e).toEqual([])
  })

  it('avisa de un email mal escrito', () => {
    const e = validarCliente({ ...base, emails: ['no-es-un-mail'] })
    expect(e.some((x) => x.campo === 'emails')).toBe(true)
  })

  it('avisa de un email repetido dentro del mismo cliente', () => {
    const e = validarCliente({ ...base, emails: ['a@acme.com', 'A@ACME.com'] })
    expect(e.some((x) => x.campo === 'emails')).toBe(true)
  })

  it('rechaza un tipo de cliente inventado', () => {
    const e = validarCliente({ ...base, tipo: 'mayorista' })
    expect(e.some((x) => x.campo === 'tipo')).toBe(true)
  })
})

describe('validarContacto', () => {
  it('el nombre es obligatorio', () => {
    expect(validarContacto(CONTACTO_VACIO)).toHaveLength(1)
  })

  it('un contacto con nombre alcanza', () => {
    expect(validarContacto({ ...CONTACTO_VACIO, nombre: 'Ana' })).toEqual([])
  })

  it('avisa del email mal escrito', () => {
    const e = validarContacto({ ...CONTACTO_VACIO, nombre: 'Ana', email: 'ana@' })
    expect(e).toHaveLength(1)
  })
})

describe('validarDireccion', () => {
  it('la calle es obligatoria', () => {
    expect(validarDireccion(DIRECCION_VACIA)).toHaveLength(1)
  })

  it('acepta los cuatro tipos que admite el CHECK', () => {
    for (const tipo of ['shipping', 'billing', 'both', 'other']) {
      expect(validarDireccion({ ...DIRECCION_VACIA, calle: 'Av. Siempreviva 742', tipo })).toEqual(
        [],
      )
    }
  })

  it('la lista de tipos es exactamente la del CHECK de la tabla', () => {
    expect(TIPOS_DE_DIRECCION.map((t) => t.valor)).toEqual([
      'shipping',
      'billing',
      'both',
      'other',
    ])
  })

  it('rechaza un tipo que la tabla no tiene', () => {
    // `otra` en castellano NO es un valor del CHECK: el valor es `other`.
    const e = validarDireccion({ ...DIRECCION_VACIA, calle: 'Calle 1', tipo: 'otra' })
    expect(e).toHaveLength(1)
  })

  it('el país va con su código de dos letras', () => {
    expect(validarDireccion({ ...DIRECCION_VACIA, calle: 'Calle 1', pais: 'AR' })).toEqual([])
    expect(validarDireccion({ ...DIRECCION_VACIA, calle: 'Calle 1', pais: 'Argentina' })).toHaveLength(
      1,
    )
  })
})
