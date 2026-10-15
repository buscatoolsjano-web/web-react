import { describe, expect, it } from 'vitest'
import {
  describirRegla,
  problemasDeRegla,
  type Accion,
  type Condicion,
  type NombresDeLaEmpresa,
} from './reglasCorreo'

const NOMBRES: NombresDeLaEmpresa = {
  etiquetas: new Map([['l1', 'Avisos']]),
  personas: new Map([['u1', 'Jano']]),
}

const regla = (condiciones: Condicion[], acciones: Accion[]) => ({
  id: 'r1',
  nombre: 'Una regla',
  activa: true,
  orden: 100,
  condiciones,
  acciones,
})

/*
 * La regla leída en voz alta.
 *
 * No es cosmética: una lista de reglas que hay que abrir para entender es una
 * lista que nadie revisa, y las reglas que nadie revisa son las que un día
 * etiquetan mal media bandeja sin que nadie se entere.
 */
describe('describirRegla', () => {
  it('arma la frase con el «si» y el «entonces»', () => {
    const r = regla(
      [{ campo: 'de', op: 'contiene', valor: 'stelorder.com' }],
      [{ tipo: 'etiquetar', labelId: 'l1' }, { tipo: 'estado', valor: 'resuelto' }],
    )
    expect(describirRegla(r, NOMBRES)).toBe(
      'Si el remitente contiene «stelorder.com», ponerle «Avisos» y darlo por resuelto.',
    )
  })

  it('varias condiciones se leen encadenadas con «y»', () => {
    const r = regla(
      [
        { campo: 'asunto', op: 'no_contiene', valor: 'factura' },
        { campo: 'es_cliente', valor: true },
      ],
      [{ tipo: 'asignar', userId: 'u1' }],
    )
    expect(describirRegla(r, NOMBRES)).toBe(
      'Si el asunto no contiene «factura» y es de un cliente del ERP, asignárselo a Jano.',
    )
  })

  it('la condición de cliente en negativo se dice en negativo', () => {
    const r = regla([{ campo: 'es_cliente', valor: false }], [{ tipo: 'sacar_de_bandeja' }])
    expect(describirRegla(r, NOMBRES)).toBe('Si NO es de un cliente del ERP, sacarlo de la bandeja.')
  })

  /*
   * Una etiqueta se puede borrar después de escribir la regla. La acción
   * queda sin efecto —el motor la saltea—, y la pantalla tiene que DECIRLO:
   * mostrar un uuid no explica nada y callarlo deja una regla que parece
   * hacer algo que no hace.
   */
  it('dice cuando la etiqueta o la persona ya no existen', () => {
    const r = regla(
      [{ campo: 'texto', op: 'contiene', valor: 'x' }],
      [{ tipo: 'etiquetar', labelId: 'borrada' }, { tipo: 'asignar', userId: 'se-fue' }],
    )
    expect(describirRegla(r, NOMBRES)).toBe(
      'Si en cualquier parte contiene «x», ponerle «una etiqueta que ya no existe» y asignárselo a alguien que ya no está.',
    )
  })
})

describe('problemasDeRegla', () => {
  const ok = {
    nombre: 'Avisos',
    condiciones: [{ campo: 'de', op: 'contiene', valor: 'stel' }] as Condicion[],
    acciones: [{ tipo: 'etiquetar', labelId: 'l1' }] as Accion[],
  }

  it('una regla completa no tiene problemas', () => {
    expect(problemasDeRegla(ok)).toEqual([])
  })

  it('sin nombre, sin condiciones o sin acciones, lo dice', () => {
    expect(problemasDeRegla({ ...ok, nombre: '  ' })).toContain('Ponele un nombre a la regla.')
    expect(problemasDeRegla({ ...ok, condiciones: [] })).toContain('Agregá al menos una condición.')
    expect(problemasDeRegla({ ...ok, acciones: [] })).toContain('Agregá al menos una acción.')
  })

  it('una condición de texto vacía no se puede guardar', () => {
    const r = problemasDeRegla({ ...ok, condiciones: [{ campo: 'asunto', op: 'contiene', valor: '  ' }] })
    expect(r).toContain('Escribí qué tiene que decir el asunto.')
  })

  it('la acción a medio elegir tampoco', () => {
    expect(problemasDeRegla({ ...ok, acciones: [{ tipo: 'etiquetar', labelId: '' }] })).toContain(
      'Elegí la etiqueta que se va a poner.',
    )
    expect(problemasDeRegla({ ...ok, acciones: [{ tipo: 'asignar', userId: '' }] })).toContain(
      'Elegí a quién asignárselo.',
    )
  })

  /*
   * Dos etiquetas SÍ: «ponerle Cotizar y Urgente» es razonable. Dos asignados
   * NO: el hilo tiene uno solo, así que la segunda acción nunca iba a correr y
   * quien la escribió se iba a quedar esperando.
   */
  it('deja poner dos etiquetas, pero no dos asignados ni dos estados', () => {
    expect(
      problemasDeRegla({
        ...ok,
        acciones: [{ tipo: 'etiquetar', labelId: 'l1' }, { tipo: 'etiquetar', labelId: 'l2' }],
      }),
    ).toEqual([])
    expect(
      problemasDeRegla({
        ...ok,
        acciones: [{ tipo: 'asignar', userId: 'u1' }, { tipo: 'asignar', userId: 'u2' }],
      }),
    ).toContain('Un hilo se le asigna a una sola persona: dejá una.')
    expect(
      problemasDeRegla({
        ...ok,
        acciones: [{ tipo: 'estado', valor: 'resuelto' }, { tipo: 'estado', valor: 'en_proceso' }],
      }),
    ).toContain('Elegí un solo estado.')
  })
})
