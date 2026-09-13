import { describe, expect, it } from 'vitest'
import {
  ASUNTO,
  destinatariosIniciales,
  direccionValida,
  extraerDirecciones,
  partirEntrada,
  sinDuplicados,
  totalAdjuntos,
} from './destinatarios'

const PROPIA = 'info@buscatools.com.ar'
const msg = (p: Partial<{ de: string; para: string; cc: string; responderA: string }>) => ({
  de: 'Cliente <cliente@ejemplo.test>',
  para: 'info@buscatools.com.ar',
  cc: '',
  responderA: '',
  ...p,
})

describe('responder', () => {
  it('al remitente, nunca al propio buzón', () => {
    expect(destinatariosIniciales('responder', msg({}), PROPIA)).toEqual({ para: ['cliente@ejemplo.test'], cc: [] })
  })

  it('respeta Reply-To', () => {
    expect(destinatariosIniciales('responder', msg({ responderA: 'Ventas <ventas@ejemplo.test>' }), PROPIA).para).toEqual(['ventas@ejemplo.test'])
  })

  it('respondiendo un mensaje que mandó el propio buzón: a sus destinatarios', () => {
    const r = destinatariosIniciales('responder', msg({ de: 'Buscatools <INFO@buscatools.com.ar>', para: 'a@x.test, b@y.test' }), PROPIA)
    expect(r.para).toEqual(['a@x.test', 'b@y.test'])
  })
})

describe('responder a todos', () => {
  it('To y Cc originales menos el propio buzón, sin duplicados ni vacíos', () => {
    const r = destinatariosIniciales(
      'responder_todos',
      msg({
        de: '"Pérez, Juan" <juan@ejemplo.test>',
        para: 'info@buscatools.com.ar, Compras <compras@ejemplo.test>, JUAN@ejemplo.test',
        cc: ' , otro@ejemplo.test, compras@ejemplo.test, Info <info@buscatools.com.ar>',
      }),
      PROPIA,
    )
    expect(r).toEqual({ para: ['juan@ejemplo.test'], cc: ['compras@ejemplo.test', 'otro@ejemplo.test'] })
  })

  it('reenviar y nuevo arrancan vacíos', () => {
    expect(destinatariosIniciales('reenviar', msg({}), PROPIA)).toEqual({ para: [], cc: [] })
    expect(destinatariosIniciales('nuevo', msg({}), PROPIA)).toEqual({ para: [], cc: [] })
  })
})

describe('direcciones', () => {
  it('extrae de cabeceras con nombres, comillas y comas dentro de las comillas', () => {
    expect(extraerDirecciones('"Pérez, Juan" <Juan@X.test>, otro@y.test; <z@w.test>')).toEqual(['juan@x.test', 'otro@y.test', 'z@w.test'])
  })

  it('partir lo tipeado separa válidas e inválidas', () => {
    expect(partirEntrada('a@b.test; c@d.test, mal@, sin-arroba')).toEqual({ validas: ['a@b.test', 'c@d.test'], invalidas: ['mal@'] })
    expect(partirEntrada('Juan <juan@x.test>').validas).toEqual(['juan@x.test'])
  })

  it('validación razonable, igual a la del backend', () => {
    expect(direccionValida('nombre+etiqueta@sub.dominio.com.ar')).toBe(true)
    expect(direccionValida("o'brien@ejemplo.museum")).toBe(true)
    for (const d of ['a@b', 'a b@c.test', 'a@b.test\r\nBcc: x@y.test', 'a..b@c.test']) expect(direccionValida(d)).toBe(false)
  })

  it('una dirección en Para no se repite en Cc ni Cco', () => {
    expect(sinDuplicados(['a@x.test'], ['A@x.test', 'b@x.test'], ['b@x.test', 'c@x.test'])).toEqual({ para: ['a@x.test'], cc: ['b@x.test'], cco: ['c@x.test'] })
  })
})

describe('asuntos y adjuntos', () => {
  it('no apila prefijos', () => {
    expect(ASUNTO.respuesta('Pedido')).toBe('Re: Pedido')
    expect(ASUNTO.respuesta('RE: Pedido')).toBe('RE: Pedido')
    expect(ASUNTO.reenvio('Fwd: Pedido')).toBe('Fwd: Pedido')
    expect(ASUNTO.reenvio('')).toBe('Fwd: (sin asunto)')
  })

  it('suma tamaños', () => {
    expect(totalAdjuntos([{ tamano: 10 }, { tamano: 5 }])).toBe(15)
  })
})
