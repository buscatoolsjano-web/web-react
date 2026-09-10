import { describe, expect, it } from 'vitest'
import { claveDe, normalizarClave } from './alias'

/**
 * Funciones puras: no tocan la red ni el cliente de Supabase, y por eso viven
 * en `lib/`. Lo que hace la base con esa clave —el índice único por cliente— se
 * prueba contra datos reales en `scripts/fase5-memoria-precios-tests.mjs`.
 */

describe('normalizarClave', () => {
  it('es la misma normalización que usó la migración', () => {
    // Tal cual quedó en `customer_product_aliases.normalized_key`.
    expect(normalizarClave('speedrill em3 allen bit 1/4 hex bit 6.3')).toBe(
      'speedrill em3 allen bit 1 4 hex bit 6 3',
    )
    expect(normalizarClave('sp.553 tubo iman fijo 60enc 1/4 hex')).toBe(
      'sp 553 tubo iman fijo 60enc 1 4 hex',
    )
  })

  it('la puntuación y las mayúsculas no distinguen dos alias', () => {
    expect(normalizarClave('SP.553 Tubo')).toBe(normalizarClave('sp 553   tubo'))
  })

  it('saca las tildes', () => {
    expect(normalizarClave('Extensión')).toBe('extension')
  })

  it('recorta los bordes', () => {
    expect(normalizarClave('  /// punta ///  ')).toBe('punta')
  })

  it('un texto sin letras ni números queda vacío', () => {
    expect(normalizarClave('///')).toBe('')
  })
})

describe('claveDe', () => {
  const base = { descripcionCliente: 'Tubo largo 38', productId: 'p1' }

  it('usa el código del cliente cuando lo hay', () => {
    expect(claveDe({ ...base, codigoCliente: 'ABC-123' })).toBe('abc 123')
  })

  it('y la descripción cuando no', () => {
    expect(claveDe({ ...base, codigoCliente: '' })).toBe('tubo largo 38')
    expect(claveDe({ ...base, codigoCliente: '   ' })).toBe('tubo largo 38')
  })

  it('dos formas de escribir el mismo código dan la misma clave', () => {
    const a = claveDe({ ...base, codigoCliente: 'ABC-123' })
    const b = claveDe({ ...base, codigoCliente: 'abc.123' })
    expect(a).toBe(b)
  })
})
