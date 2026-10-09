import type { FacetaAtributo, OpcionFaceta, RangoNumerico } from '../types'

/**
 * Dos atributos que son los extremos de UN rango (Fase 57).
 *
 * EL PROBLEMA. En Atornilladores el filtro mostraba cuatro controles:
 *
 *   «Torque mín. desde» · «Torque mín. hasta» · «Torque máx. desde» · «Torque máx. hasta»
 *
 * Son dos atributos numéricos, cada uno con su par desde/hasta. Leído parece
 * repetido y, peor, no sirve para lo que uno quiere preguntar.
 *
 * QUÉ SE QUIERE PREGUNTAR. «Mostrame los atornilladores que sirven para 10 Nm»
 * son los que PUEDEN dar 10: los que tienen `torq_min ≤ 10 ≤ torq_max`. Con
 * cuatro controles hay que razonar al revés —poner 10 en «Torque mín. hasta» y
 * 10 en «Torque máx. desde»— y nadie lo hace.
 *
 * LA CUENTA. Un pedido «entre DESDE y HASTA» devuelve los productos cuyo
 * intervalo SE SOLAPA con él, que es:
 *
 *     torq_min ≤ HASTA    y    torq_max ≥ DESDE
 *
 * O sea que el HASTA del usuario acota por arriba al extremo MÍNIMO, y el
 * DESDE acota por abajo al extremo MÁXIMO. Está cruzado, y por eso vive acá
 * con un test en vez de suelto en el componente.
 *
 * El filtro se guarda en las DOS claves reales, no en una clave inventada del
 * par: así el plan de consulta no cambia y las URLs con filtros que ya andan
 * siguen andando.
 */
export interface ParDeRango {
  /** La clave del extremo inferior del producto, p. ej. `torq_min`. */
  claveMin: string
  /** La clave del extremo superior del producto, p. ej. `torq_max`. */
  claveMax: string
}

/** Lo que el usuario escribe: un solo desde/hasta. */
export type RangoPedido = RangoNumerico

/**
 * Traduce el rango que pidió el usuario a los dos rangos por clave.
 *
 * Devolver `null` para una clave significa «sacá este filtro»: un extremo sin
 * valor no tiene que dejar un rango vacío puesto, porque el contador de
 * filtros activos lo contaría igual.
 */
export function aFiltrosPorClave(
  par: ParDeRango,
  pedido: RangoPedido,
): Record<string, RangoNumerico | null> {
  const { min: desde, max: hasta } = pedido

  return {
    // El extremo MÍNIMO del producto tiene que quedar por debajo del HASTA.
    [par.claveMin]: hasta === null ? null : { min: null, max: hasta },
    // El extremo MÁXIMO del producto tiene que quedar por encima del DESDE.
    [par.claveMax]: desde === null ? null : { min: desde, max: null },
  }
}

/**
 * Lee de vuelta el rango del usuario desde los dos filtros por clave.
 *
 * Es la inversa de `aFiltrosPorClave`, y está cruzada igual: el DESDE que se
 * muestra en el control sale del `min` de la clave MÁXIMA.
 */
export function desdeFiltrosPorClave(
  par: ParDeRango,
  rangos: Readonly<Record<string, RangoNumerico>>,
): RangoPedido {
  return {
    min: rangos[par.claveMax]?.min ?? null,
    max: rangos[par.claveMin]?.max ?? null,
  }
}

/**
 * ¿Un producto con este intervalo entra en lo pedido?
 *
 * No se usa para consultar —eso lo hace la base— sino para poder afirmar en un
 * test que la traducción de arriba significa lo que se dice que significa.
 */
export function solapa(
  producto: { min: number | null; max: number | null },
  pedido: RangoPedido,
): boolean {
  const pMin = producto.min ?? Number.NEGATIVE_INFINITY
  const pMax = producto.max ?? Number.POSITIVE_INFINITY
  const dDesde = pedido.min ?? Number.NEGATIVE_INFINITY
  const dHasta = pedido.max ?? Number.POSITIVE_INFINITY
  return pMin <= dHasta && pMax >= dDesde
}

/**
 * Funde en UNA faceta los pares de atributos que son extremos de un rango.
 *
 * Entra la lista de facetas tal como la devuelve el servidor —una por
 * atributo— y sale la misma lista con los pares colapsados. La faceta
 * resultante se queda con la clave del extremo MÍNIMO, para que tenga una
 * clave estable, y lleva las dos en `par`.
 *
 * SE RESPETA EL ORDEN del extremo que venía primero: la barra de filtros tiene
 * un orden pensado y el apareo no es razón para reordenarla.
 *
 * Un par incompleto —uno de los dos extremos no es filtrable, o no tiene datos
 * en esta categoría— NO se aparea: se deja como estaba. Mostrar «Torque desde
 * … hasta …» cuando sólo existe uno de los dos lados daría resultados que no
 * son los que el control promete.
 */
export function aparearFacetas(
  facetas: readonly FacetaAtributo[],
  definiciones: readonly { key: string; rango: { grupo: string; rol: 'min' | 'max'; label: string } | null }[],
): FacetaAtributo[] {
  const porClave = new Map(definiciones.map((d) => [d.key, d.rango]))

  /* Qué grupos tienen SUS DOS extremos presentes entre las facetas de esta
     categoría. Sin los dos no se aparea. */
  const extremos = new Map<string, { min?: FacetaAtributo; max?: FacetaAtributo }>()
  for (const f of facetas) {
    const r = porClave.get(f.key)
    if (!r) continue
    const g = extremos.get(r.grupo) ?? {}
    g[r.rol] = f
    extremos.set(r.grupo, g)
  }

  const completos = new Set(
    [...extremos.entries()].filter(([, g]) => g.min && g.max).map(([grupo]) => grupo),
  )

  const salida: FacetaAtributo[] = []
  const yaPuesto = new Set<string>()

  for (const f of facetas) {
    const r = porClave.get(f.key)
    if (!r || !completos.has(r.grupo)) {
      salida.push(f)
      continue
    }
    if (yaPuesto.has(r.grupo)) continue
    yaPuesto.add(r.grupo)

    const g = extremos.get(r.grupo)!
    const fMin = g.min!
    const fMax = g.max!

    salida.push({
      // La clave del extremo mínimo, para que la faceta tenga una estable.
      key: fMin.key,
      label: r.label,
      unidad: fMin.unidad ?? fMax.unidad,
      clase: 'range',
      /* Las opciones de los DOS lados: el desplegable tiene que ofrecer tanto
         los mínimos como los máximos que existen, o no se podría pedir «hasta
         120» cuando 120 sólo aparece como máximo de algún producto. */
      opciones: unirOpciones(fMin.opciones, fMax.opciones),
      min: menor(fMin.min, fMax.min),
      max: mayor(fMin.max, fMax.max),
      par: { claveMin: fMin.key, claveMax: fMax.key },
    })
  }

  return salida
}

/** Une dos listas de opciones numéricas sin repetir, en orden creciente. */
function unirOpciones(a: readonly OpcionFaceta[], b: readonly OpcionFaceta[]): OpcionFaceta[] {
  const porValor = new Map<string, OpcionFaceta>()
  for (const o of [...a, ...b]) {
    const previa = porValor.get(o.valor)
    // El mismo valor puede venir de los dos lados: se suman las cuentas, que
    // es cuántos productos tocan ese número.
    porValor.set(o.valor, previa ? { ...previa, cantidad: previa.cantidad + o.cantidad } : o)
  }
  return [...porValor.values()].sort((x, y) => Number(x.valor) - Number(y.valor))
}

const menor = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : Math.min(a, b)
const mayor = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : Math.max(a, b)
