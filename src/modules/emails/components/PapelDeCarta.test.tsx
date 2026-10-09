// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PapelDeCarta } from './PapelDeCarta'

/**
 * Escribir SOBRE la hoja con el membrete puesto (Fase 59 · E2).
 *
 * «No quiero escribir en una caja vacía y después tener que ver el formato, ni
 * que haya un botón que diga ver cómo se vería. Yo quiero escribir
 * directamente así, con este rectángulo blanco».
 */

/** El envoltorio real de Buscatools, recortado a lo que importa acá. */
const ENVOLTORIO = `
<table role="presentation" width="100%" style="background:#ffffff">
  <tr><td style="height:3px;background:#F37021">&nbsp;</td></tr>
  <tr><td><img src="https://app.buscatools.com/brand/buscatools-logo.png" alt="Buscatools"></td></tr>
  <tr><td style="font:15px/1.6 Arial;color:#1f2328">{{cuerpo}}</td></tr>
  <tr><td style="border-top:1px solid #e5e7eb;color:#6b7280">
    Juan M. J. Mocciaro (BUSCATOOLS) &middot; Melincué 5125, CABA (1417)
  </td></tr>
</table>`

const CUADRO = <textarea aria-label="Mensaje" defaultValue="Hola" />
const PELADO = <textarea aria-label="Mensaje pelado" />

const montar = (envoltorio: string) =>
  render(
    <PapelDeCarta envoltorio={envoltorio} sinMarco={PELADO}>
      {CUADRO}
    </PapelDeCarta>,
  )

describe('<PapelDeCarta>', () => {
  it('dibuja el membrete y el pie de la plantilla', () => {
    montar(ENVOLTORIO)
    expect(screen.getByAltText('Buscatools')).toBeInTheDocument()
    expect(screen.getByText(/Melincué 5125/)).toBeInTheDocument()
  })

  /*
   * EL PUNTO DE TODO ESTO. El cuadro de texto tiene que quedar DENTRO de la
   * celda del envoltorio, no encima ni al lado: de ahí hereda la tipografía,
   * el color y el ancho, que es lo que hace que lo escrito se vea como va a
   * salir. Si el portal fallara, el cuadro existiría igual pero fuera de la
   * tabla, y el test pasaría sin que nada se viera bien.
   */
  it('el cuadro de texto queda dentro de la celda del cuerpo, no al lado', () => {
    montar(ENVOLTORIO)
    const cuadro = screen.getByLabelText('Mensaje')
    const celda = cuadro.closest('td')
    expect(celda).not.toBeNull()
    expect(celda!.getAttribute('style')).toContain('Arial')
  })

  it('no hay botón de previa: lo que se ve ya es cómo sale', () => {
    montar(ENVOLTORIO)
    expect(screen.queryByRole('button', { name: /ver cómo sale/i })).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  /*
   * SIN PLANTILLA SE PUEDE MANDAR UN MAIL IGUAL. Una empresa recién creada no
   * tiene envoltorio, y la RPC tarda ~220 ms en traerlo: en los dos casos
   * llega '' y tiene que aparecer el cuadro de siempre.
   */
  it('sin envoltorio cae al cuadro pelado', () => {
    for (const vacio of ['', '   ']) {
      const { unmount } = montar(vacio)
      expect(screen.getByLabelText('Mensaje pelado')).toBeInTheDocument()
      expect(screen.queryByLabelText('Mensaje')).toBeNull()
      unmount()
    }
  })

  /* Un envoltorio sin `{{cuerpo}}` no tiene dónde escribir. La base lo impide
     al guardar la plantilla, pero uno viejo podría estar así: mejor el cuadro
     pelado que una hoja linda sin cursor. */
  it('un envoltorio sin el hueco cae al cuadro pelado', () => {
    montar('<table><tr><td>Sólo membrete</td></tr></table>')
    expect(screen.getByLabelText('Mensaje pelado')).toBeInTheDocument()
  })

  /*
   * La plantilla la escribe un admin de la empresa, pero esto se dibuja DENTRO
   * de la app —no en un iframe aislado como un mail recibido—, así que es el
   * único lugar donde un `<script>` en una plantilla correría con la sesión de
   * quien escribe.
   */
  it('sanitiza la plantilla igual, aunque sea propia', () => {
    const { container } = montar(
      '<table><tr><td><script>window.x=1</script><img src=x onerror="window.x=2">{{cuerpo}}</td></tr></table>',
    )
    expect(container.innerHTML).not.toMatch(/<script/i)
    expect(container.innerHTML).not.toMatch(/onerror/i)
    // Y el cuadro sigue estando: sanitizar no puede dejar sin escribir.
    expect(screen.getByLabelText('Mensaje')).toBeInTheDocument()
  })

  it('acepta espacios dentro del marcador', () => {
    montar('<table><tr><td>{{ cuerpo }}</td></tr></table>')
    expect(screen.getByLabelText('Mensaje')).toBeInTheDocument()
  })

  /* Dos huecos serían dos lugares donde escribir y un solo texto: el segundo
     quedaría vacío. La base sólo exige que haya uno; que no se rompa. */
  it('con el marcador repetido, el cuadro va en el primero', () => {
    montar('<table><tr><td id="a">{{cuerpo}}</td></tr><tr><td id="b">{{cuerpo}}</td></tr></table>')
    expect(screen.getByLabelText('Mensaje').closest('td')?.id).toBe('a')
  })
})
