import { describe, expect, it } from 'vitest'
import { clasificarFallo, instruccionParaElModelo } from './errores'

/**
 * Lo que de verdad importa de este módulo no es la clasificación en sí, sino
 * la CONDUCTA que provoca: que el modelo reintente cuando reintentar sirve y
 * deje de hacerlo cuando no. Por eso las pruebas miran el texto que sale, no
 * sólo la etiqueta.
 */
describe('clasificar el fallo de una herramienta', () => {
  it('una columna que no existe es la herramienta rota, no los parámetros', () => {
    // 42703 es el caso real que motivó esto: `asistente_ver_documento` apuntaba
    // a `purchase_orders.order_number`, que no existe, y el agente la llamó
    // seis veces porque el mensaje decía «probá de otra forma».
    expect(clasificarFallo('42703')).toBe('rota')
    expect(clasificarFallo('42883')).toBe('rota') // función inexistente
    expect(clasificarFallo('42P01')).toBe('rota') // tabla inexistente
    expect(clasificarFallo('42723')).toBe('rota') // dos sobrecargas, no se puede elegir
  })

  it('una fecha o un uuid mal escritos SÍ son de parámetros', () => {
    expect(clasificarFallo('22P02')).toBe('parametros')
    expect(clasificarFallo('22007')).toBe('parametros')
    expect(clasificarFallo('P0001')).toBe('parametros')
  })

  it('separa permiso y demora, que piden conductas distintas', () => {
    expect(clasificarFallo('42501')).toBe('permiso')
    expect(clasificarFallo('57014')).toBe('demora')
  })

  it('sin código no adivina', () => {
    expect(clasificarFallo(null)).toBe('desconocido')
    expect(clasificarFallo(undefined)).toBe('desconocido')
    expect(clasificarFallo('')).toBe('desconocido')
    expect(clasificarFallo('   ')).toBe('desconocido')
    expect(clasificarFallo('XX999')).toBe('desconocido')
  })

  it('el código viene en minúscula o con espacios y se entiende igual', () => {
    expect(clasificarFallo('42p01')).toBe('rota')
    expect(clasificarFallo(' 42703 ')).toBe('rota')
  })
})

describe('qué se le dice al modelo', () => {
  it('ante una herramienta rota le dice que NO la vuelva a llamar', () => {
    const t = instruccionParaElModelo('rota', 'ver_documento')
    expect(t).toMatch(/no la vuelvas a llamar/i)
    expect(t).toContain('ver_documento')
    // Y que siga por otro lado: media respuesta explicada vale más que un «no pude».
    expect(t).toMatch(/otra herramienta|contestá lo que sí/i)
  })

  it('ante un error de parámetros SÍ lo invita a reintentar', () => {
    const t = instruccionParaElModelo('parametros', 'buscar_documentos')
    expect(t).toMatch(/probá de nuevo/i)
    expect(t).not.toMatch(/no la vuelvas a llamar/i)
  })

  it('ante falta de permiso no lo manda a probar con otros argumentos', () => {
    const t = instruccionParaElModelo('permiso', 'ver_documento')
    expect(t).toMatch(/no reintentes/i)
  })

  it('ante una demora le pide reintentar UNA vez, pidiendo menos', () => {
    const t = instruccionParaElModelo('demora', 'buscar_documentos')
    expect(t).toMatch(/una vez/i)
    expect(t).toMatch(/menos/i)
  })

  it('lo desconocido conserva el texto de siempre', () => {
    expect(instruccionParaElModelo('desconocido', 'x')).toMatch(/revisá los parámetros/i)
  })
})
