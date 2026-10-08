import { describe, expect, it } from 'vitest'
import {
  ETIQUETA,
  formatearPct,
  medianaDe,
  ordenarParaMirar,
  resumir,
  tonoDe,
  variacionEntre,
  type CambioDePrecio,
} from './comparativa'

const c = (over: Partial<CambioDePrecio> = {}): CambioDePrecio => ({
  reference: 'S3154C',
  description: 'ADAPTADOR',
  productId: 'p1',
  precio: 110,
  precioAnterior: 100,
  porcentaje: 10,
  movimiento: 'subio',
  ...over,
})

describe('el resumen de una comparativa', () => {
  it('cuenta cada movimiento por separado', () => {
    const r = resumir([
      c({ movimiento: 'subio', porcentaje: 10 }),
      c({ movimiento: 'subio', porcentaje: 20 }),
      c({ movimiento: 'bajo', porcentaje: -5 }),
      c({ movimiento: 'igual', porcentaje: 0 }),
      c({ movimiento: 'entro', porcentaje: null, precioAnterior: null }),
      c({ movimiento: 'salio', porcentaje: null, precio: null }),
    ])
    expect(r).toMatchObject({ total: 6, subieron: 2, bajaron: 1, iguales: 1, entraron: 1, salieron: 1 })
  })

  /*
   * La mediana y no el promedio, y acá se ve por qué.
   *
   * Este catálogo tiene precios cargados 100 veces por debajo de su familia
   * —se encontraron 79—. Uno solo de ésos, al corregirse, da un +10.000 % que
   * se come el promedio y convierte un aumento real del 10 % en uno del 2.500.
   */
  it('un solo renglón disparatado no mueve la mediana, pero sí el promedio', () => {
    const r = resumir([
      c({ porcentaje: 10 }),
      c({ porcentaje: 11 }),
      c({ porcentaje: 12 }),
      c({ porcentaje: 10000 }),
    ])
    expect(r.medianaPct).toBe(11.5)
    expect(r.promedioPct).toBe(2508.25)
  })

  // Los dos se muestran juntos a propósito: que difieran ES la señal.
  it('muestra los dos, porque la diferencia entre ellos es información', () => {
    const r = resumir([c({ porcentaje: 10 }), c({ porcentaje: 10 })])
    expect(r.medianaPct).toBe(10)
    expect(r.promedioPct).toBe(10)
  })

  // «Sin cambio» no es un 0 % que promediar: es que no pasó nada.
  it('los que no cambiaron no entran en el promedio', () => {
    const r = resumir([c({ porcentaje: 20 }), c({ movimiento: 'igual', porcentaje: 0 })])
    expect(r.promedioPct).toBe(20)
  })

  it('destaca los que más se movieron para arriba y para abajo', () => {
    const r = resumir(
      [
        c({ reference: 'A', porcentaje: 50 }),
        c({ reference: 'B', porcentaje: 5 }),
        c({ reference: 'C', porcentaje: -40, movimiento: 'bajo' }),
        c({ reference: 'D', porcentaje: -2, movimiento: 'bajo' }),
      ],
      2,
    )
    expect(r.mayoresSubas.map((x) => x.reference)).toEqual(['A', 'B'])
    expect(r.mayoresBajas.map((x) => x.reference)).toEqual(['C', 'D'])
  })

  it('una lista sin cambios comparables no inventa un cero', () => {
    const r = resumir([c({ movimiento: 'entro', porcentaje: null })])
    expect(r.medianaPct).toBeNull()
    expect(r.promedioPct).toBeNull()
  })
})

describe('la mediana', () => {
  it('con cantidad impar es el del medio', () => {
    expect(medianaDe([3, 1, 2])).toBe(2)
  })
  it('con cantidad par es el promedio de los dos del medio', () => {
    expect(medianaDe([1, 2, 3, 4])).toBe(2.5)
  })
  it('sin valores es null, no cero', () => {
    expect(medianaDe([])).toBeNull()
  })
})

describe('cómo se escribe un porcentaje', () => {
  /*
   * El signo va SIEMPRE, incluso cuando sube. Un «12,4 %» suelto no dice si
   * subió o bajó, que es exactamente lo que se está preguntando.
   */
  it('lleva el signo aunque sea positivo', () => {
    expect(formatearPct(12.4)).toBe('+12,4 %')
  })

  // Menos tipográfico, no guion: en una columna de números el guion se lee
  // como un «sin dato».
  it('usa el menos de verdad para las bajas', () => {
    expect(formatearPct(-3.1)).toBe('−3,1 %')
  })

  it('sin cambio no lleva signo', () => {
    expect(formatearPct(0)).toBe('0,0 %')
  })

  it('sin dato es una raya, no un cero', () => {
    expect(formatearPct(null)).toBe('—')
    expect(formatearPct(NaN)).toBe('—')
  })
})

describe('el tono', () => {
  // Un costo que sube NO es una buena noticia: se pinta como alerta.
  it('subir un costo es la alerta, no el verde', () => {
    expect(tonoDe('subio')).toBe('sube')
    expect(tonoDe('bajo')).toBe('baja')
  })
  it('lo que entra o sale es otra cosa, ni buena ni mala', () => {
    expect(tonoDe('entro')).toBe('nuevo')
    expect(tonoDe('salio')).toBe('nuevo')
  })
})

describe('el orden con el que se mira', () => {
  /*
   * Lo que entró y lo que salió va ARRIBA aunque no tenga %: son las
   * decisiones —un producto nuevo que cotizar, uno que dejó de existir— y
   * ordenados por porcentaje quedarían al final, donde nadie llega.
   */
  it('lo que entró y lo que salió va primero, aunque no tengan porcentaje', () => {
    const orden = ordenarParaMirar([
      c({ reference: 'SUBE', porcentaje: 80 }),
      c({ reference: 'ENTRO', movimiento: 'entro', porcentaje: null }),
      c({ reference: 'SALIO', movimiento: 'salio', porcentaje: null }),
    ])
    expect(orden.slice(0, 2).map((x) => x.reference).sort()).toEqual(['ENTRO', 'SALIO'])
    expect(orden[2]?.reference).toBe('SUBE')
  })

  it('después, por cuánto se movieron, sin importar el signo', () => {
    const orden = ordenarParaMirar([
      c({ reference: 'POCO', porcentaje: 2 }),
      c({ reference: 'BAJON', porcentaje: -60, movimiento: 'bajo' }),
      c({ reference: 'SUBON', porcentaje: 30 }),
    ])
    expect(orden.map((x) => x.reference)).toEqual(['BAJON', 'SUBON', 'POCO'])
  })

  it('no toca la lista que recibe', () => {
    const original = [c({ reference: 'B', porcentaje: 1 }), c({ reference: 'A', porcentaje: 9 })]
    ordenarParaMirar(original)
    expect(original.map((x) => x.reference)).toEqual(['B', 'A'])
  })
})

describe('las etiquetas', () => {
  it('cubren todos los movimientos que devuelve la vista', () => {
    for (const m of ['subio', 'bajo', 'igual', 'entro', 'salio', 'sin dato', 'primera lista'] as const) {
      expect(ETIQUETA[m]).toBeTruthy()
    }
  })
})

describe('la variación entre dos columnas de la planilla', () => {
  it('es el cambio porcentual del anterior al actual', () => {
    expect(variacionEntre(110, 100)).toBe(10)
    expect(variacionEntre(90, 100)).toBe(-10)
  })

  it('redondea a dos decimales', () => {
    expect(variacionEntre(100.555, 100)).toBe(0.56)
  })

  /*
   * Null y no cero. Un 0 % diría «no cambió», que es una afirmación distinta
   * de «no sé»: el producto puede no haber estado en la lista anterior.
   */
  it('sin precio anterior devuelve null, no cero', () => {
    expect(variacionEntre(100, null)).toBeNull()
    expect(variacionEntre(100, undefined)).toBeNull()
  })

  it('sin precio actual devuelve null', () => {
    expect(variacionEntre(null, 100)).toBeNull()
  })

  /*
   * Hay productos cargados en 0 —el catálogo tiene varios—. Dividir por cero
   * ahí convierte la columna entera en «Infinity %».
   */
  it('un precio anterior en cero no divide: devuelve null', () => {
    expect(variacionEntre(100, 0)).toBeNull()
  })

  it('sin cambio es cero, que sí es un dato', () => {
    expect(variacionEntre(100, 100)).toBe(0)
  })
})
