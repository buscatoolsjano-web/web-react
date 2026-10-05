import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * El buscador de clientes (Fase 22 · A8, reescrito en la Fase 40).
 *
 * Dos problemas medidos, y el segundo es el grave:
 *
 *  · Con el campo vacío la consulta salía SIN filtro y devolvía los primeros
 *    20 por orden alfabético: «27 de Julio S.R.L.», «A-Evangelista S.A.»…,
 *    que no son sugerencias de nada y encima costaban una consulta.
 *
 *  · Con texto, buscaba `%texto%`, ordenaba alfabéticamente y cortaba en 15.
 *    Escribir «mi» devolvía «Adami Adrian Alfredo», «ADITIVOS ALIMENTARIOS»…
 *    y **Mirgor no aparecía**: el corte se consumía con nombres que contienen
 *    «mi» en el medio y van antes en el alfabeto.
 *
 * Por eso el orden lo decide la base, antes del límite, y lo que se prueba acá
 * es justamente eso: que el servicio NO reordene ni recorte nada de su lado.
 * Reordenar las 15 filas que ya llegaron no arregla nada —la que importaba no
 * vino— y hacerlo igual daría la ilusión de que sí.
 */
const llamadas = vi.hoisted(() => ({
  rpc: [] as { nombre: string; args: Record<string, unknown> }[],
}))

/** Lo que devuelve `public.buscar_clientes`, ya ordenado por rango. */
const filas = [
  { id: 'c1', nombre: 'Mimet S.A.', razon_social: 'Mimet S.A.', cuit: '30111111118', referencia: 'CLI00100', dado_de_baja: false, rango: 1 },
  { id: 'c2', nombre: 'Francisco Rivas', razon_social: 'Mitsubishi Hitachi', cuit: null, referencia: null, dado_de_baja: false, rango: 1 },
  { id: 'c3', nombre: 'Grupo Mirgor S.A.', razon_social: 'Grupo Mirgor S.A.', cuit: '30578036071', referencia: 'CLI00719', dado_de_baja: false, rango: 2 },
]

vi.mock('@/services/supabase/client', () => ({
  supabase: {
    rpc: (nombre: string, args: Record<string, unknown>) => {
      llamadas.rpc.push({ nombre, args })
      return Promise.resolve({ data: filas, error: null })
    },
  },
}))

const { buscarClientes, buscarClientesParaFiltro } = await import('./clientes')

beforeEach(() => {
  llamadas.rpc = []
})

describe('Sin texto no se busca nada', () => {
  it('el campo vacío devuelve cero clientes y NO consulta', async () => {
    expect(await buscarClientes('c1', '')).toEqual([])
    expect(llamadas.rpc).toHaveLength(0)
  })

  it('sólo espacios es lo mismo que vacío', async () => {
    expect(await buscarClientes('c1', '   ')).toEqual([])
    expect(llamadas.rpc).toHaveLength(0)
  })

  it('una sola letra tampoco: «a» son cientos de clientes', async () => {
    expect(await buscarClientes('c1', 'a')).toEqual([])
    expect(llamadas.rpc).toHaveLength(0)
  })
})

describe('El orden lo decide la base', () => {
  it('con dos letras consulta, y devuelve las filas TAL COMO vinieron', async () => {
    const r = await buscarClientes('c1', 'mi')
    expect(llamadas.rpc).toHaveLength(1)
    expect(llamadas.rpc[0]!.nombre).toBe('buscar_clientes')
    // Sin reordenar ni recortar: el rango ya viene aplicado desde el servidor.
    expect(r.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
  })

  /**
   * Antes el texto se interpolaba dentro del `or()` de PostgREST, así que un
   * paréntesis o una coma rompían la sintaxis del filtro. Ahora viaja como
   * parámetro: no hay sintaxis que romper.
   */
  it('los paréntesis y las comas viajan como parámetro, no como filtro', async () => {
    await buscarClientes('c1', 'S.A. (ex Norte), 20')
    expect(llamadas.rpc[0]!.args['p_texto']).toBe('S.A. (ex Norte), 20')
  })

  /**
   * La diferencia entre los dos buscadores es una sola, y es de negocio: dar
   * de alta mira al futuro y no ofrece bajas; filtrar mira al pasado y las
   * necesita, porque sus documentos existen.
   */
  it('el alta no ofrece inactivos; el filtro sí', async () => {
    await buscarClientes('c1', 'mi')
    expect(llamadas.rpc[0]!.args['p_incluir_inactivos']).toBe(false)

    await buscarClientesParaFiltro('c1', 'mi')
    expect(llamadas.rpc[1]!.args['p_incluir_inactivos']).toBe(true)
  })
})

describe('La razón social se muestra sólo cuando aporta', () => {
  /**
   * El nombre visible es el comercial, y en este maestro el comercial suele
   * ser una PERSONA: buscando «mi» aparecía «Francisco Rivas» y no había forma
   * de saber que era Mitsubishi Hitachi.
   */
  it('viaja cuando es distinta del nombre que se muestra', async () => {
    const r = await buscarClientes('c1', 'mi')
    expect(r.find((c) => c.id === 'c2')?.razonSocial).toBe('Mitsubishi Hitachi')
  })

  it('y no cuando sería repetir el mismo texto dos veces', async () => {
    const r = await buscarClientes('c1', 'mi')
    expect(r.find((c) => c.id === 'c1')?.razonSocial).toBeNull()
    expect(r.find((c) => c.id === 'c3')?.razonSocial).toBeNull()
  })
})
