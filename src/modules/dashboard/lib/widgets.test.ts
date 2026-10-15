import { describe, expect, it } from 'vitest'
import {
  INICIO_POR_DEFECTO,
  WIDGETS,
  esElDeFabrica,
  mover,
  normalizarInicio,
  paraGuardar,
  redimensionar,
  sePuedeAchicar,
  sePuedeAgrandar,
  sePuedeBajar,
  sePuedeSubir,
  type Widget,
} from './widgets'

const claves = (w: readonly Widget[]) => w.map((x) => x.clave)

describe('el inicio que viene de fábrica', () => {
  /*
   * Los dos cambios que se pidieron, fijados acá para que no se desarmen sin
   * querer: los accesos rápidos abren la pantalla —estaban abajo de todo— y el
   * gráfico queda donde estaba pero un escalón más chico.
   */
  it('abre con los accesos rápidos', () => {
    expect(INICIO_POR_DEFECTO[0]?.clave).toBe('accesos')
  })

  it('el gráfico sigue segundo, y no en el tamaño más grande', () => {
    expect(INICIO_POR_DEFECTO[1]?.clave).toBe('evolucion')
    expect(INICIO_POR_DEFECTO[1]?.tamano).toBe('normal')
    expect(sePuedeAgrandar(INICIO_POR_DEFECTO[1]!)).toBe(true)
  })

  it('están todos los widgets, sin repetir', () => {
    expect(new Set(claves(INICIO_POR_DEFECTO))).toEqual(new Set(WIDGETS))
    expect(INICIO_POR_DEFECTO).toHaveLength(WIDGETS.length)
  })
})

describe('normalizarInicio', () => {
  it('sin nada guardado, el de fábrica', () => {
    expect(normalizarInicio(null)).toEqual(INICIO_POR_DEFECTO)
    expect(normalizarInicio(undefined)).toEqual(INICIO_POR_DEFECTO)
    expect(normalizarInicio({ version: 1 })).toEqual(INICIO_POR_DEFECTO)
  })

  it('respeta el orden y el tamaño guardados', () => {
    const guardado = { version: 1, widgets: [{ clave: 'ultimos', tamano: 'chico' }] }
    const r = normalizarInicio(guardado)
    expect(r[0]).toEqual({ clave: 'ultimos', tamano: 'chico' })
  })

  /*
   * LA REGLA QUE HACE QUE ESTO SIGA ANDANDO DENTRO DE UN AÑO.
   *
   * Quien acomodó su inicio hoy tiene siete widgets guardados. Mañana el
   * tablero gana uno nuevo: tiene que APARECER, al final. Sin esto sería
   * invisible para todos los que ya habían guardado algo, que es el error
   * clásico de este patrón y el más difícil de notar: para quien lo programó
   * —que no tiene nada guardado— se ve perfecto.
   */
  it('lo que falta se agrega al final, no se pierde', () => {
    const guardado = { version: 1, widgets: [{ clave: 'ultimos', tamano: 'normal' }] }
    const r = normalizarInicio(guardado)
    expect(r).toHaveLength(WIDGETS.length)
    expect(r[0]?.clave).toBe('ultimos')
    expect(new Set(claves(r))).toEqual(new Set(WIDGETS))
  })

  it('descarta lo que no reconoce: claves viejas y tamaños inventados', () => {
    const guardado = {
      version: 1,
      widgets: [
        { clave: 'unWidgetQueYaNoExiste', tamano: 'normal' },
        { clave: 'kpis', tamano: 'enorme' },
        { clave: 'atencion', tamano: 'chico' },
      ],
    }
    const r = normalizarInicio(guardado)
    expect(claves(r)).not.toContain('unWidgetQueYaNoExiste')
    expect(r[0]).toEqual({ clave: 'atencion', tamano: 'chico' })
    // `kpis` venía con un tamaño inválido: se descarta la entrada y vuelve a
    // entrar por la puerta de los que faltan, con su tamaño de fábrica.
    expect(r.find((w) => w.clave === 'kpis')?.tamano).toBe('normal')
  })

  it('no repite: dos entradas de lo mismo son un solo widget', () => {
    const guardado = {
      version: 1,
      widgets: [
        { clave: 'kpis', tamano: 'chico' },
        { clave: 'kpis', tamano: 'grande' },
      ],
    }
    const r = normalizarInicio(guardado)
    expect(r.filter((w) => w.clave === 'kpis')).toHaveLength(1)
    expect(r[0]?.tamano).toBe('chico')
  })

  /* Quien no puede ver un bloque tampoco lo acomoda: el pendiente del resto es
     de admin, y para un empleado no existe ni en la lista de edición. */
  it('los que esta persona no puede ver no entran', () => {
    const sinEquipo = WIDGETS.filter((w) => w !== 'equipo')
    const r = normalizarInicio(null, sinEquipo)
    expect(claves(r)).not.toContain('equipo')
    expect(r).toHaveLength(WIDGETS.length - 1)
  })

  it('un guardado roto no rompe la pantalla', () => {
    expect(normalizarInicio('[]')).toEqual(INICIO_POR_DEFECTO)
    expect(normalizarInicio({ version: 1, widgets: 'no soy un array' })).toEqual(INICIO_POR_DEFECTO)
    expect(normalizarInicio({ version: 1, widgets: [null, 3, 'kpis'] })).toEqual(INICIO_POR_DEFECTO)
  })
})

describe('mover', () => {
  const lista: Widget[] = [
    { clave: 'accesos', tamano: 'normal' },
    { clave: 'evolucion', tamano: 'normal' },
    { clave: 'kpis', tamano: 'normal' },
  ]

  it('subir lo intercambia con el de arriba', () => {
    expect(claves(mover(lista, 'kpis', -1))).toEqual(['accesos', 'kpis', 'evolucion'])
  })

  it('bajar, con el de abajo', () => {
    expect(claves(mover(lista, 'accesos', 1))).toEqual(['evolucion', 'accesos', 'kpis'])
  })

  /* En el borde se queda quieto. Dar la vuelta —subir el primero y que
     aparezca al final— sorprende, y nadie lo pidió. */
  it('en los bordes no hace nada', () => {
    expect(claves(mover(lista, 'accesos', -1))).toEqual(claves(lista))
    expect(claves(mover(lista, 'kpis', 1))).toEqual(claves(lista))
    expect(sePuedeSubir(lista, 'accesos')).toBe(false)
    expect(sePuedeBajar(lista, 'kpis')).toBe(false)
  })

  it('nunca pierde ni duplica un widget', () => {
    for (const clave of claves(lista)) {
      for (const d of [-1, 1] as const) {
        const r = mover(lista, clave, d)
        expect(r).toHaveLength(lista.length)
        expect(new Set(claves(r))).toEqual(new Set(claves(lista)))
      }
    }
  })
})

describe('redimensionar', () => {
  const lista: Widget[] = [{ clave: 'evolucion', tamano: 'normal' }]

  it('agranda y achica de a un escalón', () => {
    expect(redimensionar(lista, 'evolucion', 1)[0]?.tamano).toBe('grande')
    expect(redimensionar(lista, 'evolucion', -1)[0]?.tamano).toBe('chico')
  })

  it('no se pasa de los extremos', () => {
    const grande: Widget[] = [{ clave: 'evolucion', tamano: 'grande' }]
    const chico: Widget[] = [{ clave: 'evolucion', tamano: 'chico' }]
    expect(redimensionar(grande, 'evolucion', 1)[0]?.tamano).toBe('grande')
    expect(redimensionar(chico, 'evolucion', -1)[0]?.tamano).toBe('chico')
    expect(sePuedeAgrandar(grande[0]!)).toBe(false)
    expect(sePuedeAchicar(chico[0]!)).toBe(false)
  })

  it('no toca a los demás', () => {
    const dos: Widget[] = [
      { clave: 'kpis', tamano: 'normal' },
      { clave: 'ultimos', tamano: 'chico' },
    ]
    expect(redimensionar(dos, 'kpis', 1)[1]?.tamano).toBe('chico')
  })
})

describe('lo que se guarda', () => {
  it('lleva la versión y sólo las dos claves que la base acepta', () => {
    const r = paraGuardar([{ clave: 'kpis', tamano: 'chico' }])
    expect(r.version).toBe(1)
    expect(Object.keys(r.widgets[0]!).sort()).toEqual(['clave', 'tamano'])
  })

  /* Ida y vuelta: lo que se guarda tiene que volver igual. Si esto se rompe,
     cada recarga le desarma el inicio a quien lo acomodó. */
  it('ida y vuelta por la base', () => {
    const acomodado = mover(redimensionar([...INICIO_POR_DEFECTO], 'evolucion', 1), 'ultimos', -1)
    expect(normalizarInicio(paraGuardar(acomodado))).toEqual(acomodado)
  })

  it('sabe si está como vino de fábrica', () => {
    expect(esElDeFabrica(INICIO_POR_DEFECTO)).toBe(true)
    expect(esElDeFabrica(mover([...INICIO_POR_DEFECTO], 'kpis', -1))).toBe(false)
    expect(esElDeFabrica(redimensionar([...INICIO_POR_DEFECTO], 'kpis', -1))).toBe(false)
  })
})
