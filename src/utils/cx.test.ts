import { describe, it, expect } from 'vitest'
import { cx } from './cx'

describe('cx', () => {
  it('une clases válidas', () => {
    expect(cx('a', 'b')).toBe('a b')
  })

  it('descarta undefined, null y false', () => {
    expect(cx('a', undefined, null, false, 'b')).toBe('a b')
  })

  it('devuelve string vacío sin argumentos válidos', () => {
    expect(cx(undefined, false)).toBe('')
  })
})
