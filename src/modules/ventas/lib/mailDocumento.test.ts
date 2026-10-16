import { describe, expect, it } from 'vitest'
import { asuntoDeDocumento, cuerpoDeDocumento, destinatariosDeDocumento, type DatosMailDocumento } from './mailDocumento'

/**
 * La semilla del mail con el que se manda un documento (Fase 84).
 *
 * «Que se mande con el asunto de "Cotización COT-BTSxxxxx" y en el cuerpo
 * diga algo como adjunto cotización.»
 *
 * Nada de esto sale solo: el composer se abre con todo escrito y quien vende
 * lo lee antes de apretar «Enviar». Así que lo que se prueba no es la
 * redacción —eso se mira— sino lo que duele si sale mal: a quién va, que no
 * se repita una dirección y que el número sea el del documento.
 */
const datos = (p: Partial<DatosMailDocumento> = {}): DatosMailDocumento => ({
  tipo: 'cotizacion',
  numero: 'COT-BTS00007',
  contactoNombre: 'Matias Lamas',
  contactoEmail: 'matias.lamas@mirgor.com.ar',
  contactosExtra: [],
  moneda: 'USD',
  total: 4797.4,
  ...p,
})

describe('El asunto', () => {
  it('es el tipo y el número del documento', () => {
    expect(asuntoDeDocumento(datos())).toBe('Cotización COT-BTS00007')
    expect(asuntoDeDocumento(datos({ tipo: 'pedido', numero: 'PDV01330' }))).toBe('Pedido PDV01330')
    expect(asuntoDeDocumento(datos({ tipo: 'entrega', numero: 'RT0001' }))).toBe('Remito RT0001')
  })
})

describe('El cuerpo', () => {
  it('saluda por el primer nombre y dice número y total', () => {
    const cuerpo = cuerpoDeDocumento(datos())
    expect(cuerpo).toContain('Hola Matias,')
    // Por el primer nombre: «Hola Matias Lamas» suena a carta de banco.
    expect(cuerpo).not.toContain('Matias Lamas')
    expect(cuerpo).toContain('la cotización COT-BTS00007')
    expect(cuerpo).toContain('USD 4.797,40')
  })

  it('sin contacto, saluda igual y no inventa un nombre', () => {
    const cuerpo = cuerpoDeDocumento(datos({ contactoNombre: null }))
    expect(cuerpo.startsWith('Hola,')).toBe(true)
  })

  it('sin total, no deja el importe a medias', () => {
    const cuerpo = cuerpoDeDocumento(datos({ total: null }))
    expect(cuerpo).toContain('la cotización COT-BTS00007.')
    expect(cuerpo).not.toMatch(/por (USD|ARS|$)/)
  })

  /* La firma la pone el composer, que es de quien escribe y se puede editar
     en un mail puntual (Fase 41 · E3). Si también la pusiera esto, saldría
     dos veces. */
  it('no trae firma', () => {
    expect(cuerpoDeDocumento(datos())).not.toMatch(/saludos|atentamente/i)
  })
})

describe('Los destinatarios', () => {
  it('el contacto principal va en Para y el equipo en copia', () => {
    const d = destinatariosDeDocumento(
      datos({ contactosExtra: [{ nombre: 'Ana', email: 'ana@mirgor.com.ar' }, { nombre: 'Luis', email: 'luis@mirgor.com.ar' }] }),
    )
    expect(d.para).toEqual(['matias.lamas@mirgor.com.ar'])
    expect(d.cc).toEqual(['ana@mirgor.com.ar', 'luis@mirgor.com.ar'])
  })

  /* El principal suele estar también entre los extras: mandárselo dos veces
     no rompe nada, pero se ve descuidado del lado del cliente. */
  it('no repite al principal en copia', () => {
    const d = destinatariosDeDocumento(
      datos({ contactosExtra: [{ nombre: 'Matias', email: 'MATIAS.LAMAS@mirgor.com.ar' }] }),
    )
    expect(d.para).toEqual(['matias.lamas@mirgor.com.ar'])
    expect(d.cc).toEqual([])
  })

  it('tampoco repite un extra que figura dos veces', () => {
    const d = destinatariosDeDocumento(
      datos({
        contactoEmail: null,
        contactosExtra: [{ nombre: 'Ana', email: 'ana@mirgor.com.ar' }, { nombre: 'Ana', email: 'Ana@Mirgor.com.ar' }],
      }),
    )
    expect(d.para).toEqual(['ana@mirgor.com.ar'])
  })

  /* Sin principal, los extras suben a «Para»: un mail sin destinatario no se
     puede mandar, y dejarlos en copia sería justamente eso. */
  it('sin contacto principal, el equipo sube a Para', () => {
    const d = destinatariosDeDocumento(
      datos({ contactoEmail: null, contactosExtra: [{ nombre: 'Ana', email: 'ana@mirgor.com.ar' }] }),
    )
    expect(d.para).toEqual(['ana@mirgor.com.ar'])
    expect(d.cc).toEqual([])
  })

  it('un contacto sin correo no deja un hueco en la lista', () => {
    const d = destinatariosDeDocumento(
      datos({ contactoEmail: null, contactosExtra: [{ nombre: 'Sin mail', email: null }, { nombre: 'Ana', email: 'ana@mirgor.com.ar' }] }),
    )
    expect(d.para).toEqual(['ana@mirgor.com.ar'])
  })

  it('sin ninguna dirección, el composer se abre vacío', () => {
    const d = destinatariosDeDocumento(datos({ contactoEmail: null, contactosExtra: [] }))
    expect(d).toEqual({ para: [], cc: [] })
  })
})
