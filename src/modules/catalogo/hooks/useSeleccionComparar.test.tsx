// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useSeleccionComparar } from './useSeleccionComparar'
import type { ProductoListado } from '../types'

const p = (id: string) => ({ id, sku: id } as unknown as ProductoListado)

describe('useSeleccionComparar (Fase 125)', () => {
  it('deja marcar más de 4, pero comparar sólo con 2 a 4', () => {
    const { result } = renderHook(() => useSeleccionComparar())

    act(() => { result.current.alternar(p('a')) })
    expect(result.current.puedeComparar).toBe(false) // con 1 no se compara

    act(() => { result.current.alternar(p('b')) })
    expect(result.current.puedeComparar).toBe(true) // 2 sí

    act(() => { result.current.alternar(p('c')); result.current.alternar(p('d')); result.current.alternar(p('e')) })
    // 5 marcados: ya no se compara, pero la selección se mantiene para exportar.
    expect(result.current.elegidos).toHaveLength(5)
    expect(result.current.puedeComparar).toBe(false)
    expect(result.current.demasiadosParaComparar).toBe(true)
  })

  it('«marcar todos» agrega los visibles, y de nuevo los saca', () => {
    const { result } = renderHook(() => useSeleccionComparar())
    const visibles = [p('a'), p('b'), p('c')]

    act(() => { result.current.alternarTodos(visibles) })
    expect(result.current.ids).toEqual(new Set(['a', 'b', 'c']))

    act(() => { result.current.alternarTodos(visibles) })
    expect(result.current.elegidos).toHaveLength(0)
  })

  it('«marcar todos» con algunos ya marcados completa el resto (no los invierte)', () => {
    const { result } = renderHook(() => useSeleccionComparar())
    act(() => { result.current.alternar(p('a')) })
    act(() => { result.current.alternarTodos([p('a'), p('b'), p('c')]) })
    expect(result.current.ids).toEqual(new Set(['a', 'b', 'c']))
  })
})
