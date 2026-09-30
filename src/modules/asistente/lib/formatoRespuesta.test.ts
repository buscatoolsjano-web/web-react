import { describe, expect, it } from 'vitest'
import { pedazos } from './formatoRespuesta'

/** `[texto|NEGRITA]` para poder leer el resultado de un vistazo. */
const leer = (s: string) => pedazos(s).map((p) => (p.negrita ? `[${p.texto}]` : p.texto)).join('')

describe('Las negritas de la respuesta', () => {
  it('resalta lo que va entre asteriscos dobles', () => {
    expect(leer('El mejor fue **Grupo Mirgor S.A.**, con 8 documentos.')).toBe(
      'El mejor fue [Grupo Mirgor S.A.], con 8 documentos.',
    )
  })

  it('resalta varios tramos en la misma línea', () => {
    expect(leer('**BR.PH2** — 10 unidades, **USD 30,68**.')).toBe('[BR.PH2] — 10 unidades, [USD 30,68].')
  })

  it('un texto sin asteriscos vuelve entero y sin resaltar', () => {
    expect(pedazos('Sin nada raro.')).toEqual([{ texto: 'Sin nada raro.', negrita: false }])
  })

  /**
   * Lo importante: un modelo que escribe un `**` de más no puede hacer que
   * media respuesta cambie de aspecto. Sin cerrar, es texto.
   */
  it('los asteriscos sin cerrar quedan como texto', () => {
    expect(leer('Esto **quedó abierto y sigue')).toBe('Esto **quedó abierto y sigue')
  })

  it('cuatro asteriscos seguidos no se comen caracteres', () => {
    expect(leer('antes ****después')).toBe('antes ****después')
  })

  it('el texto vacío no rompe', () => {
    expect(pedazos('')).toEqual([{ texto: '', negrita: false }])
  })
})
