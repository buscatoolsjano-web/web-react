// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { useParamsUrl, type CambiosUrl } from './useParamsUrl'

/**
 * El bug que esto evita: el autoguardado escribía `borrador=` y, antes de que la
 * página volviera a renderizar, el envío escribía `envio=` partiendo de los
 * params viejos. La URL perdía el borrador.
 */
describe('useParamsUrl', () => {
  function montar(inicial: string) {
    let cambiar: (c: CambiosUrl) => void = () => undefined
    function Sonda() {
      const [, c] = useParamsUrl()
      cambiar = c
      return null
    }
    const router = createMemoryRouter([{ path: '/hilo', element: <Sonda /> }], { initialEntries: [inicial] })
    render(<RouterProvider router={router} />)
    return { router, cambiar: (c: CambiosUrl) => cambiar(c) }
  }

  it('dos cambios seguidos, sin render en el medio, se componen', async () => {
    const { router, cambiar } = montar('/hilo?componer=responder&mensaje=abc')
    // Una referencia vieja al callback, como la que guarda el composer al abrirse.
    const viejo = cambiar
    await act(async () => {
      viejo({ borrador: 'r1' })
      viejo({ envio: 'crid-1' })
      await Promise.resolve()
    })
    const p = new URLSearchParams(router.state.location.search)
    expect(Object.fromEntries(p)).toEqual({ componer: 'responder', mensaje: 'abc', borrador: 'r1', envio: 'crid-1' })
  })

  it('null borra, undefined no toca', async () => {
    const { router, cambiar } = montar('/hilo?componer=reenviar&borrador=r1&envio=x')
    await act(async () => {
      cambiar({ borrador: null, envio: undefined })
      await Promise.resolve()
    })
    expect(Object.fromEntries(new URLSearchParams(router.state.location.search))).toEqual({ componer: 'reenviar', envio: 'x' })
  })
})
