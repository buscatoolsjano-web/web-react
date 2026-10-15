// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { CorreoNombrado } from '../services/asistente'
import { TarjetasCorreos } from './TarjetasCorreos'

/**
 * Las tarjetas de correo (Fase 69).
 *
 * Lo que se prueba es lo que convierte un renglón de texto en algo con lo que
 * se puede trabajar: que el botón lleve a ESE hilo, y que el remitente se lea
 * como un nombre y no como una cabecera de correo.
 */
const correo = (c: Partial<CorreoNombrado> = {}): CorreoNombrado => ({
  id: 'h1',
  asunto: 'FACTURA DE VENTA ALQUILER MAQUINA ESTIC',
  de: '"Compras Mirgor" <compras@mirgor.com.ar>',
  fecha: '2026-10-15T16:03:00Z',
  sinLeer: false,
  adjuntos: false,
  asignadoA: null,
  cliente: null,
  ...c,
})

const montar = (correos: CorreoNombrado[]) =>
  render(
    <MemoryRouter>
      <TarjetasCorreos correos={correos} />
    </MemoryRouter>,
  )

describe('TarjetasCorreos', () => {
  /*
   * EL PUNTO DE TODO ESTO. Antes la respuesta nombraba el correo y había que
   * ir a buscarlo a la bandeja a mano. El enlace tiene que apuntar al hilo
   * exacto, que es el dato que viaja estructurado y no por el texto.
   */
  it('cada correo abre SU hilo', () => {
    montar([correo({ id: 'hilo-abc' }), correo({ id: 'hilo-xyz', asunto: 'Otro' })])

    const enlaces = screen.getAllByRole('link', { name: /ver mail/i })
    expect(enlaces).toHaveLength(2)
    expect(enlaces[0]).toHaveAttribute('href', '/emails/hilo-abc')
    expect(enlaces[1]).toHaveAttribute('href', '/emails/hilo-xyz')
  })

  /* «"Compras Mirgor" <compras@mirgor.com.ar>» es la cabecera cruda. Lo que
     identifica de un vistazo es el nombre; la dirección queda en el `title`. */
  it('muestra el nombre del remitente, con la dirección a mano', () => {
    montar([correo()])
    const quien = screen.getByText('Compras Mirgor')
    expect(quien).toHaveAttribute('title', '"Compras Mirgor" <compras@mirgor.com.ar>')
    expect(screen.getByText('FACTURA DE VENTA ALQUILER MAQUINA ESTIC')).toBeInTheDocument()
  })

  it('sin nombre, muestra la dirección sola', () => {
    montar([correo({ de: 'mailer-daemon@googlemail.com' })])
    expect(screen.getByText('mailer-daemon@googlemail.com')).toBeInTheDocument()
  })

  /*
   * Las marcas aparecen sólo cuando dicen algo. Un «Sin asignar» repetido en
   * veinticinco tarjetas es ruido que se lee veinticinco veces; lo que importa
   * marcar es lo excepcional.
   */
  it('marca lo que no se leyó y a quién está asignado, y calla el resto', () => {
    montar([correo({ sinLeer: true, asignadoA: 'Jano', cliente: 'NEWSAN SA' })])
    const tarjeta = screen.getByRole('listitem')
    expect(within(tarjeta).getByText('Sin leer')).toBeInTheDocument()
    expect(within(tarjeta).getByText('Asignado: Jano')).toBeInTheDocument()
    expect(within(tarjeta).getByText('NEWSAN SA')).toBeInTheDocument()
  })

  it('un correo leído y sin asignar no dibuja ninguna marca', () => {
    montar([correo()])
    expect(screen.queryByText('Sin leer')).not.toBeInTheDocument()
    expect(screen.queryByText(/asignado/i)).not.toBeInTheDocument()
  })

  it('sin correos no dibuja nada', () => {
    const { container } = montar([])
    expect(container).toBeEmptyDOMElement()
  })
})
