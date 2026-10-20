import { describe, expect, it } from 'vitest'
import { DESPEDIDA, SALUDO, textoParaDecir } from './dicho'

describe('textoParaDecir', () => {
  it('saca los asteriscos de resalte y deja el texto', () => {
    // Es el caso real: `PROMPT_COMUN` le enseñó a resaltar así, y la voz lo
    // leería «asterisco asterisco V P P H».
    expect(textoParaDecir('tenés el **VPPH1/70** a doce dólares')).toBe(
      'tenés el VPPH1/70 a doce dólares',
    )
  })

  it('también los simples y los guiones bajos', () => {
    expect(textoParaDecir('el *mejor* y el _otro_')).toBe('el mejor y el otro')
  })

  it('convierte una lista en frases con pausa', () => {
    expect(textoParaDecir('- VPPH1/70\n- VPPH2/80')).toBe('VPPH1/70. VPPH2/80')
  })

  it('las listas numeradas igual', () => {
    expect(textoParaDecir('1. uno\n2) dos')).toBe('uno. dos')
  })

  it('saca los títulos', () => {
    expect(textoParaDecir('## Stock\nquedan tres')).toBe('Stock. quedan tres')
  })

  it('no deja dos puntos seguidos cuando el renglón ya terminaba en punto', () => {
    expect(textoParaDecir('Son tres.\nY uno sin stock.')).toBe('Son tres. Y uno sin stock.')
  })

  it('un bloque de código no se dice', () => {
    const r = textoParaDecir('mirá esto:\n```\nSKU,precio\nA,1\n```\ny listo')
    expect(r).not.toContain('SKU,precio')
    expect(r).toContain('y listo')
  })

  it('de un enlace se dice el texto, no la dirección', () => {
    expect(textoParaDecir('mirá [la ficha](https://x.y/z) ahí')).toBe('mirá la ficha ahí')
  })

  it('un texto que ya está limpio no se toca', () => {
    const limpio = 'tenés el VPPH1/70 a doce dólares, quedan quinientos cuarenta y cuatro'
    expect(textoParaDecir(limpio)).toBe(limpio)
  })

  it('no se come las barras de un SKU ni los números', () => {
    // La tentación era decir «barra» en vez de «/», pero eso rompe «24/48» y
    // los rangos. Que lo dicte lo pide el prompt, que es quien sabe cuándo.
    expect(textoParaDecir('el VPPH1/70 y el 24/48')).toContain('VPPH1/70')
    expect(textoParaDecir('el VPPH1/70 y el 24/48')).toContain('24/48')
  })

  it('aguanta el vacío y los espacios', () => {
    expect(textoParaDecir('')).toBe('')
    expect(textoParaDecir('   \n  ')).toBe('')
  })
})

describe('lo que se dice sin preguntar', () => {
  it('el saludo dice de qué sabe', () => {
    expect(SALUDO).toContain('catálogo')
    expect(SALUDO).toContain('Cata')
  })

  it('ni el saludo ni la despedida llevan nada que se lea como símbolo', () => {
    for (const t of [SALUDO, DESPEDIDA]) {
      expect(t).toBe(textoParaDecir(t))
      expect(t).not.toMatch(/[*#`[\]]/)
    }
  })
})
