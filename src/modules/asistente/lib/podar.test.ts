import { describe, expect, it } from 'vitest'
import { podarDuplicados } from './podar'

const SIN_NADA = { skus: [], correos: [] }

/*
 * La respuesta real que motivó esto, acortada a tres renglones. El modelo
 * enumeraba los veintinueve productos que abajo ya estaban dibujados como
 * tarjetas con foto, precio, stock y botones.
 */
const RESPUESTA_PH1 = [
  'Encontré **29 productos** relacionados con "ph1". El stock informado es **disponible**:',
  '',
  '- **BR.PH1** — BROPPE PUNTA PHILLIPS S2 ENCASTRE ¼ HEXAGONAL. **USD 31,16**. Disponible: **10**.',
  '- **SP.PH1** — SPEEDRILL PH1 PHILLIPS. Precio de lista no informado. Disponible: **0**.',
  '- **SP.VPPH1/50** — SPEEDRILL VPPH1/50 PHILLIPS. **USD 7,95**. Disponible: **287**.',
].join('\n')

describe('podarDuplicados · productos', () => {
  it('saca los renglones de la lista y deja lo que la tarjeta no dice', () => {
    const r = podarDuplicados(RESPUESTA_PH1, {
      skus: ['BR.PH1', 'SP.PH1', 'SP.VPPH1/50'],
      correos: [],
    })
    expect(r).toBe('Encontré **29 productos** relacionados con "ph1". El stock informado es **disponible**:')
  })

  /*
   * LO QUE NO SE PUEDE PODAR. Una frase que nombra un SKU para SEÑALARLO entre
   * los demás es el argumento de la respuesta, no una repetición. Sacarla
   * dejaría la respuesta sin su conclusión, que es justo lo que se preguntó.
   */
  it('no toca una frase que nombra un producto para distinguirlo', () => {
    const texto = 'De todos, el único con stock es **SP.VPPH1/70**: los demás están en cero.'
    expect(podarDuplicados(texto, { skus: ['SP.VPPH1/70'], correos: [] })).toBe(texto)
  })

  it('deja intacto un renglón de lista que habla de otra cosa', () => {
    const texto = ['Dos cosas:', '- No hay stock de ninguno.', '- **SP.PH1** — sin precio.'].join('\n')
    expect(podarDuplicados(texto, { skus: ['SP.PH1'], correos: [] })).toBe(
      ['Dos cosas:', '- No hay stock de ninguno.'].join('\n'),
    )
  })

  it('sin tarjetas no cambia nada', () => {
    expect(podarDuplicados(RESPUESTA_PH1, SIN_NADA)).toBe(RESPUESTA_PH1)
  })

  /*
   * Si TODO lo que dijo ya está en las tarjetas, no queda texto. Es el caso
   * bueno —la respuesta son las tarjetas— y la pantalla no dibuja un párrafo
   * vacío: por eso esto devuelve la cadena vacía y no un espacio en blanco.
   */
  it('si todo era la lista, no queda nada', () => {
    const texto = '- **SP.PH1** — uno.\n- **SP.PH2** — otro.'
    expect(podarDuplicados(texto, { skus: ['SP.PH1', 'SP.PH2'], correos: [] })).toBe('')
  })
})

describe('podarDuplicados · correos', () => {
  const correos = [
    { asunto: 'Delivery Status Notification (Failure)', de: 'mailer-daemon@googlemail.com' },
    { asunto: 'Nuevo dispositivo autorizado', de: '"STEL Order" <no-reply@messaging.stelorder.com>' },
  ]

  it('saca los renglones que repiten un correo, por el remitente o por el asunto', () => {
    const texto = [
      'Hay **1.036 correos** sin responder. Los dos más recientes:',
      '- mailer-daemon@googlemail.com — **Delivery Status Notification (Failure)** — 15/10/2026 — sin asignar.',
      '- no-reply@messaging.stelorder.com — **Nuevo dispositivo autorizado** — 15/10/2026 — sin asignar.',
    ].join('\n')
    expect(podarDuplicados(texto, { skus: [], correos })).toBe(
      'Hay **1.036 correos** sin responder. Los dos más recientes:',
    )
  })

  /* El remitente llega como «"Nombre" <mail@dominio>» y el modelo escribe sólo
     la dirección. Tiene que reconocerse igual. */
  it('reconoce el remitente aunque venga con el nombre adelante', () => {
    const texto = '- Llegó uno de no-reply@messaging.stelorder.com pidiendo confirmación.'
    expect(podarDuplicados(texto, { skus: [], correos })).toBe('')
  })

  /* Un asunto cortito podría aparecer de casualidad en cualquier frase. No
     alcanza para dar por repetido un renglón. */
  it('no poda por un asunto demasiado corto para reconocer', () => {
    const texto = '- Hay uno sin asunto que conviene mirar.'
    expect(podarDuplicados(texto, { skus: [], correos: [{ asunto: 'Hola', de: null }] })).toBe(texto)
  })
})
