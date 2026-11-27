// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { ESPERA_MAXIMA_FASE_DOS_MS, useFaseDos } from './useFaseDos'

describe('useFaseDos', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('espera a que termine lo principal', () => {
    const { result, rerender } = renderHook(({ listo }) => useFaseDos(listo), { initialProps: { listo: false } })
    expect(result.current).toBe(false)
    rerender({ listo: true })
    expect(result.current).toBe(true)
  })

  it('no espera para siempre si lo principal se cuelga', () => {
    const { result } = renderHook(() => useFaseDos(false))
    act(() => {
      vi.advanceTimersByTime(ESPERA_MAXIMA_FASE_DOS_MS - 1)
    })
    expect(result.current).toBe(false)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe(true)
  })
})
