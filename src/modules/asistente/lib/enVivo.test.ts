import { describe, expect, it } from 'vitest'
import {
  EN_VIVO_INICIAL,
  FRASE_GENERICA,
  FRASE_INICIAL,
  aplicar,
  fraseDelPaso,
  type EstadoEnVivo,
} from './enVivo'

const TITULOS: Record<string, string> = { catalogo: 'Catálogo', ventas: 'Ventas' }
const titulo = (id: string) => TITULOS[id] ?? ''

describe('fraseDelPaso', () => {
  it('sin paso todavía, no inventa una actividad', () => {
    expect(fraseDelPaso(null, titulo)).toBe(FRASE_INICIAL)
  })

  it('una derivación se dice con el nombre de pantalla del colega', () => {
    expect(fraseDelPaso({ clase: 'consulta', nombre: 'catalogo' }, titulo)).toBe('Consultando a Catálogo')
  })

  it('una herramienta se dice en castellano, no por su identificador', () => {
    expect(fraseDelPaso({ clase: 'herramienta', nombre: 'buscar_productos' }, titulo)).toBe(
      'Buscando en el catálogo',
    )
  })

  /*
   * LO QUE NO PUEDE PASAR: que se filtre el nombre interno a la pantalla.
   * La traza de abajo de cada respuesta se sacó justamente por eso —decía
   * «Catálogo usó buscar_productos»—, así que una herramienta nueva que nadie
   * tradujo tiene que caer en algo legible, no en su id.
   */
  it('una herramienta desconocida NO muestra su identificador', () => {
    const f = fraseDelPaso({ clase: 'herramienta', nombre: 'asistente_cosa_nueva' }, titulo)
    expect(f).toBe(FRASE_GENERICA)
    expect(f).not.toContain('asistente_cosa_nueva')
    expect(f).not.toContain('_')
  })

  it('un colega que el servidor no nombró tampoco filtra su id', () => {
    const f = fraseDelPaso({ clase: 'consulta', nombre: 'agente_raro' }, titulo)
    expect(f).toBe(FRASE_GENERICA)
    expect(f).not.toContain('agente_raro')
  })

  /*
   * EL PASO SE GUARDA CRUDO Y LA FRASE SE ARMA AL DIBUJAR, y esto es por qué.
   *
   * La lista de agentes la manda el servidor y puede llegar DESPUÉS de que
   * alguien abra el panel y pregunte de una. Con la frase ya resuelta, el
   * texto quedaba congelado en la genérica aunque la lista llegara un segundo
   * más tarde. Guardando el paso, la misma pantalla se corrige sola.
   */
  it('el mismo paso mejora cuando llega la lista de agentes', () => {
    const paso = { clase: 'consulta', nombre: 'catalogo' } as const
    expect(fraseDelPaso(paso, () => '')).toBe(FRASE_GENERICA)
    expect(fraseDelPaso(paso, titulo)).toBe('Consultando a Catálogo')
  })
})

describe('aplicar', () => {
  it('los deltas se van sumando', () => {
    let e = EN_VIVO_INICIAL
    for (const t of ['Hay ', 'tres ', 'puntas.']) e = aplicar(e, { tipo: 'delta', texto: t })
    expect(e.texto).toBe('Hay tres puntas.')
  })

  /*
   * EL CASO QUE JUSTIFICA TODO ESTO.
   *
   * Un agente empieza a escribir y después decide usar una herramienta. Lo
   * que escribió NO era la respuesta. Si quedara en pantalla, quien mira leyó
   * media frase que el asistente descartó y no tiene cómo saberlo.
   */
  it('un turno nuevo borra lo que se venía escribiendo', () => {
    let e = aplicar(EN_VIVO_INICIAL, { tipo: 'delta', texto: 'Voy a fijarme' })
    expect(e.texto).toBe('Voy a fijarme')

    e = aplicar(e, { tipo: 'turno' })
    expect(e.texto).toBe('')
  })

  it('un paso nuevo también borra lo escrito, y cambia el paso', () => {
    let e = aplicar(EN_VIVO_INICIAL, { tipo: 'delta', texto: 'mmm' })
    e = aplicar(e, { tipo: 'paso', clase: 'consulta', nombre: 'catalogo' })
    expect(e).toEqual({ paso: { clase: 'consulta', nombre: 'catalogo' }, texto: '' })
  })

  /* Un turno nuevo NO cambia el paso: sigue haciendo lo mismo que decía. */
  it('el turno conserva el paso', () => {
    let e = aplicar(EN_VIVO_INICIAL, { tipo: 'paso', clase: 'herramienta', nombre: 'stock_actual' })
    e = aplicar(e, { tipo: 'turno' })
    expect(e.paso).toEqual({ clase: 'herramienta', nombre: 'stock_actual' })
  })

  /* La secuencia real de «dame puntas PH2», de punta a punta. */
  it('la secuencia completa de una consulta termina con la respuesta escrita', () => {
    const avisos = [
      { tipo: 'turno' } as const,
      { tipo: 'paso', clase: 'consulta', nombre: 'catalogo' } as const,
      { tipo: 'turno' } as const,
      { tipo: 'paso', clase: 'herramienta', nombre: 'buscar_productos' } as const,
      { tipo: 'turno' } as const,
      { tipo: 'delta', texto: 'Sí, hay ' } as const,
      { tipo: 'delta', texto: 'tres.' } as const,
    ]
    const e: EstadoEnVivo = avisos.reduce(aplicar, EN_VIVO_INICIAL)
    expect(e.texto).toBe('Sí, hay tres.')
    expect(fraseDelPaso(e.paso, titulo)).toBe('Buscando en el catálogo')
  })
})
