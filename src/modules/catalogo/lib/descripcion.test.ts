import { describe, expect, it } from 'vitest'
import { partirDescripcion } from './descripcion'

/**
 * Paridad con `_descSplitLink` del legacy (app.js:28648), y la regresión de
 * lo que se veía en pantalla: en la ficha de `IR.BMDS-2` se leía
 * «\n<a href="https://...">» como texto.
 *
 * Los casos de abajo son datos reales de la base, no inventados. Medido: 104
 * descripciones terminan con un ancla y el legacy parte las 104; otras 70
 * usan `<` como signo de menor y no hay que tocarlas.
 */

/** La descripción de IR.BMDS-2, carácter por carácter. */
const IR_BMDS_2 =
  'Balanceador industrial Ingersoll Rand BMDS-2 de 1 a 2.5 kg. Precisión, ergonomía y seguridad para herramientas livianas.' +
  '\n\\n<a href="https://www.buscatool.com/wp-content/uploads/2026/03/Balanceadores-Equilibradores-de-peso-Ingersoll-Rand.pdf">' +
  '<strong>Ver catálogo técnico (PDF)</strong></a>'

describe('El link del final se separa del texto', () => {
  it('el texto queda limpio: no se ve ni el «\\n» ni la etiqueta', () => {
    const { texto } = partirDescripcion(IR_BMDS_2)
    expect(texto).toBe(
      'Balanceador industrial Ingersoll Rand BMDS-2 de 1 a 2.5 kg. Precisión, ergonomía y seguridad para herramientas livianas.',
    )
    expect(texto).not.toContain('<')
    expect(texto).not.toContain('\\n')
  })

  it('el link sale con su URL y con la etiqueta de adentro del <strong>', () => {
    expect(partirDescripcion(IR_BMDS_2).enlace).toEqual({
      url: 'https://www.buscatool.com/wp-content/uploads/2026/03/Balanceadores-Equilibradores-de-peso-Ingersoll-Rand.pdf',
      etiqueta: 'Ver catálogo técnico (PDF)',
    })
  })

  it('el separador puede ser un salto real, sin el «\\n» literal', () => {
    const d = 'Texto.\n<a href="https://x.com/a.pdf"><strong>Ver PDF</strong></a>'
    expect(partirDescripcion(d)).toEqual({
      texto: 'Texto.',
      enlace: { url: 'https://x.com/a.pdf', etiqueta: 'Ver PDF' },
    })
  })

  it('un ancla sin etiqueta adentro no queda sin nombre', () => {
    const d = 'Texto.\\n<a href="https://x.com/a.pdf"></a>'
    expect(partirDescripcion(d).enlace?.etiqueta).toBe('Ver más')
  })
})

describe('Lo que NO se toca', () => {
  it('una descripción sin link se devuelve igual', () => {
    expect(partirDescripcion('Balanceador de 1 a 2.5 kg.')).toEqual({
      texto: 'Balanceador de 1 a 2.5 kg.',
      enlace: null,
    })
  })

  it('el «menor que» de una especificación NO es una etiqueta', () => {
    // 70 descripciones de la base lo usan: «<2.5 m», «<93%RH», «<+2°C».
    // Un limpiador de tags genérico se comería media ficha técnica.
    const d = 'Nivel de ruido <75 dB\nHumedad <93%RH\nTemperatura <+2°C'
    expect(partirDescripcion(d).texto).toBe(d)
    expect(partirDescripcion(d).enlace).toBeNull()
  })

  it('un <a> en el MEDIO del texto no se separa: no es el link del catálogo', () => {
    const d = 'Ver <a href="https://x.com">acá</a> y seguir leyendo.'
    expect(partirDescripcion(d).enlace).toBeNull()
    expect(partirDescripcion(d).texto).toBe(d)
  })

  it('vacío y nulo no rompen', () => {
    expect(partirDescripcion(null)).toEqual({ texto: '', enlace: null })
    expect(partirDescripcion(undefined)).toEqual({ texto: '', enlace: null })
    expect(partirDescripcion('')).toEqual({ texto: '', enlace: null })
  })
})

describe('Seguridad: el href no se acepta a ciegas', () => {
  it.each(['javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:msgbox', 'file:///etc/passwd'])(
    '«%s» no se convierte en link',
    (url) => {
      const { texto, enlace } = partirDescripcion(`Texto.\\n<a href="${url}">Click</a>`)
      expect(enlace).toBeNull()
      // Y el texto tampoco lo muestra: dejar el ancla cruda a la vista sería
      // lo peor de los dos mundos.
      expect(texto).toBe('Texto.')
    },
  )

  it('un href relativo tampoco: el catálogo del legacy siempre es una URL absoluta', () => {
    expect(partirDescripcion('Texto.\\n<a href="/wp-content/a.pdf">PDF</a>').enlace).toBeNull()
  })

  it('las 104 de la base son https, así que ninguna se pierde', () => {
    expect(partirDescripcion(IR_BMDS_2).enlace?.url.startsWith('https://')).toBe(true)
  })

  it('un onclick dentro del ancla se descarta con el resto de los atributos', () => {
    const d = 'Texto.\\n<a href="https://x.com/a.pdf" onclick="robar()">PDF</a>'
    expect(partirDescripcion(d).enlace).toEqual({ url: 'https://x.com/a.pdf', etiqueta: 'PDF' })
  })

  it('etiquetas anidadas dentro del ancla se limpian, no se ejecutan', () => {
    const d = 'Texto.\\n<a href="https://x.com/a.pdf"><strong><em>Ver</em> PDF</strong></a>'
    expect(partirDescripcion(d).enlace?.etiqueta).toBe('Ver PDF')
  })
})
