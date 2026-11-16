// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useNoIndexar } from './useNoIndexar'

const etiqueta = () => document.head.querySelector('meta[name="robots"][data-erp]')

describe('useNoIndexar', () => {
  it('marca la página como noindex mientras está montada, y la desmarca al salir', () => {
    const { unmount } = renderHook(() => useNoIndexar())
    expect(etiqueta()?.getAttribute('content')).toBe('noindex, nofollow')
    unmount()
    expect(etiqueta()).toBeNull()
  })
})
