import { describe, expect, it } from 'vitest'
import {
  CAMPOS_EDITABLES,
  cambios,
  detectarTipoImagen,
  erroresDe,
  formularioDesde,
  mensajeErrorEmpresa,
  normalizar,
  validarCampo,
  validarLogo,
  type DatosEmpresa,
} from './empresa'

const datos: DatosEmpresa = {
  id: 'c1',
  slug: 'buscatools',
  name: 'Buscatools',
  legal_name: 'Juan M. J. Mocciaro (BUSCATOOLS)',
  tax_id: '20-27089205-2',
  address: 'Melincué 5125, CABA (1417)',
  phone: '11.2169.3304',
  email: 'info@buscatools.com.ar',
  website: 'www.buscatools.com.ar',
  brand_color: '#F37021',
  default_currency: 'ARS',
  is_active: true,
  logo_path: null,
  updated_at: '2026-09-08T18:59:21.433774+00:00',
  puede_editar: true,
}

describe('campos editables', () => {
  it('son exactamente la lista blanca de la RPC (sin slug, moneda, estado ni logo)', () => {
    expect([...CAMPOS_EDITABLES].sort()).toEqual(['address', 'brand_color', 'email', 'legal_name', 'name', 'phone', 'tax_id', 'website'])
  })
  it('el formulario sólo lleva esos campos, con null → cadena vacía', () => {
    const f = formularioDesde({ ...datos, legal_name: null })
    expect(Object.keys(f).sort()).toEqual([...CAMPOS_EDITABLES].sort())
    expect(f.legal_name).toBe('')
  })
})

describe('normalización', () => {
  it('trim, vacío → null, email en minúsculas y color en mayúsculas', () => {
    expect(normalizar('name', '  Buscatools  ')).toBe('Buscatools')
    expect(normalizar('legal_name', '   ')).toBeNull()
    expect(normalizar('email', ' Info@BuscaTools.COM ')).toBe('info@buscatools.com')
    expect(normalizar('brand_color', '#f37021')).toBe('#F37021')
  })
})

describe('dirty state', () => {
  const inicial = formularioDesde(datos)
  it('sin cambios reales no hay nada para guardar', () => {
    expect(cambios(inicial, { ...inicial, name: ' Buscatools ', email: 'INFO@buscatools.com.ar' })).toEqual({})
  })
  it('sólo los campos que cambiaron, normalizados', () => {
    expect(cambios(inicial, { ...inicial, phone: ' 11 5555 5555 ', legal_name: '' })).toEqual({ phone: '11 5555 5555', legal_name: null })
  })
  it('un dato histórico inválido que no se tocó no genera error', () => {
    const viejo = formularioDesde({ ...datos, phone: 'abc' })
    expect(erroresDe(viejo, { ...viejo, name: 'Otro' })).toEqual({})
    expect(Object.keys(erroresDe(viejo, { ...viejo, phone: 'abcd' }))).toEqual(['phone'])
  })
})

describe('validación por campo', () => {
  it('acepta los datos reales de Buscatools', () => {
    for (const c of CAMPOS_EDITABLES) expect(validarCampo(c, formularioDesde(datos)[c])).toBeNull()
  })
  it('acepta un NIF español con forma básica', () => {
    expect(validarCampo('tax_id', 'B18123456')).toBeNull()
  })
  it('rechaza formatos inválidos', () => {
    expect(validarCampo('name', '  ')).toMatch(/Obligatorio/)
    expect(validarCampo('email', 'no-es')).not.toBeNull()
    expect(validarCampo('website', 'javascript:alert(1)')).not.toBeNull()
    expect(validarCampo('brand_color', 'red')).not.toBeNull()
    expect(validarCampo('tax_id', '<script>')).not.toBeNull()
    expect(validarCampo('phone', 'llamame')).not.toBeNull()
    expect(validarCampo('address', 'x'.repeat(301))).toMatch(/300/)
  })
})

describe('logo', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
  it('detecta el tipo por los bytes', () => {
    expect([png, jpg, webp, svg].map(detectarTipoImagen)).toEqual(['image/png', 'image/jpeg', 'image/webp', null])
  })
  it('valida tamaño, formato y coincidencia con el tipo declarado', () => {
    expect(validarLogo('image/png', 1000, png)).toBeNull()
    expect(validarLogo('image/jpg', 1000, jpg)).toBeNull()
    expect(validarLogo('image/png', 0, png)).toBe('archivo_vacio')
    expect(validarLogo('image/png', 2 * 1024 * 1024 + 1, png)).toBe('archivo_grande')
    expect(validarLogo('image/svg+xml', 100, svg)).toBe('formato_no_permitido')
    expect(validarLogo('image/png', 100, svg)).toBe('formato_no_permitido')
    expect(validarLogo('image/jpeg', 100, png)).toBe('tipo_no_coincide')
  })
  it('todo error tiene mensaje propio', () => {
    for (const c of ['archivo_vacio', 'archivo_grande', 'formato_no_permitido', 'tipo_no_coincide', 'conflicto_version', 'sin_permiso', 'campos_no_permitidos']) {
      expect(mensajeErrorEmpresa(c)).not.toBe(mensajeErrorEmpresa('xyz'))
    }
    expect(mensajeErrorEmpresa('datos_invalidos:email')).toMatch(/Email/)
  })
})
