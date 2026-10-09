import type { FilaBandeja } from '../types'

/**
 * Elegir varios hilos con casillas, para hacerles algo a todos (Fase 59 · E3).
 *
 * «Al igual que en el mail, quiero poder ir cliqueando, tipo marcando con
 * cuadraditos X los mails que quiera, para poder hacer acciones rápidas con
 * varios. Por ejemplo, marcar como leído. Si quiero agarrar varios y marcarlos
 * como leído, como pasa en Gmail, lo tengo que poder hacer».
 *
 * La selección se guarda por ID y no por índice: la bandeja se refresca sola
 * —hay tiempo real— y con índices, un correo nuevo que entra arriba correría
 * todo y las casillas terminarían marcando otros hilos.
 */

export type Seleccion = ReadonlySet<string>

export const VACIA: Seleccion = new Set<string>()

export function alternar(seleccion: Seleccion, id: string): Set<string> {
  const s = new Set(seleccion)
  if (!s.delete(id)) s.add(id)
  return s
}

/**
 * Las filas elegidas, EN EL ORDEN DE LA LISTA y sólo las que siguen estando.
 *
 * Un hilo que se eliminó o que se fue de la página sigue en el conjunto —nadie
 * destildó su casilla— pero ya no se puede actuar sobre él desde acá.
 */
export function elegidas(filas: readonly FilaBandeja[], seleccion: Seleccion): FilaBandeja[] {
  return filas.filter((f) => seleccion.has(f.id))
}

export type EstadoMaestra = 'ninguna' | 'algunas' | 'todas'

/** Cómo se ve la casilla de arriba: vacía, a medias o llena. */
export function estadoMaestra(filas: readonly FilaBandeja[], seleccion: Seleccion): EstadoMaestra {
  const cuantas = elegidas(filas, seleccion).length
  if (cuantas === 0) return 'ninguna'
  return cuantas === filas.length ? 'todas' : 'algunas'
}

/**
 * Qué hace la casilla de arriba.
 *
 * Con algunas marcadas, marca TODAS en vez de limpiar. Es lo que hace Gmail y
 * lo que uno espera: si ya elegí tres y aprieto la de arriba, quiero las de la
 * página, no perder las tres.
 */
export function alternarTodas(filas: readonly FilaBandeja[], seleccion: Seleccion): Set<string> {
  if (estadoMaestra(filas, seleccion) === 'todas') {
    const s = new Set(seleccion)
    for (const f of filas) s.delete(f.id)
    return s
  }
  return new Set([...seleccion, ...filas.map((f) => f.id)])
}

/**
 * Lo que se puede hacer con lo elegido.
 *
 * Cada acción se ofrece SÓLO si va a cambiar algo. «Marcar como leído» con
 * todos ya leídos sería un botón que manda llamadas para no hacer nada.
 *
 * ELIMINAR Y RESTAURAR SALEN DE LAS FILAS, no de qué carpeta se está mirando.
 * Cada fila sabe si está eliminada, así que no hace falta que la pantalla lo
 * cuente —una cosa menos que se puede desincronizar— y además queda bien
 * resuelto el caso raro de una selección mezclada: cada botón actúa sobre su
 * parte, en vez de que uno de los dos haga algo equivocado con la otra mitad.
 */
export interface AccionesPosibles {
  cuantas: number
  sinLeer: number
  /** Cuántas se eliminarían: las elegidas que todavía no lo están. */
  aEliminar: number
  /** Cuántas se restaurarían: las elegidas que están en Eliminados. */
  aRestaurar: number
  marcarLeido: boolean
  eliminar: boolean
  restaurar: boolean
}

export function accionesPosibles(filas: readonly FilaBandeja[], seleccion: Seleccion): AccionesPosibles {
  const sel = elegidas(filas, seleccion)
  const sinLeer = sel.filter((f) => f.sinLeer).length
  const aRestaurar = sel.filter((f) => f.eliminado).length
  const aEliminar = sel.length - aRestaurar
  return {
    cuantas: sel.length,
    sinLeer,
    aEliminar,
    aRestaurar,
    marcarLeido: sinLeer > 0,
    eliminar: aEliminar > 0,
    restaurar: aRestaurar > 0,
  }
}

/**
 * Corre una tarea por cada cosa, de a `ancho` a la vez.
 *
 * No hay endpoint de lote: marcar 25 hilos son 25 llamadas, y desde Argentina
 * cada una cuesta ~220 ms. En fila serían más de cinco segundos; de a seis,
 * alrededor de uno. Todas a la vez tampoco: 25 conexiones simultáneas a la
 * misma RPC es la forma de que el servidor empiece a rechazar.
 *
 * NO CORTA ANTE UN ERROR. Si uno falla, los otros 24 igual se hacen: dejar la
 * mitad del lote sin tocar porque el tercero falló es peor que informar
 * cuántos fallaron. Devuelve los que fallaron.
 */
export async function enTandas<T>(
  cosas: readonly T[],
  ancho: number,
  tarea: (cosa: T) => Promise<unknown>,
): Promise<T[]> {
  const fallaron: T[] = []
  const cola = [...cosas]

  async function obrero(): Promise<void> {
    for (;;) {
      const cosa = cola.shift()
      if (cosa === undefined) return
      try {
        await tarea(cosa)
      } catch {
        fallaron.push(cosa)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(ancho, cosas.length)) }, obrero))
  return fallaron
}

/** Cuántos quedaron, para contarlo en pantalla. */
export function resumenLote(total: number, fallaron: number, accion: string): string {
  if (fallaron === 0) {
    return total === 1 ? `1 hilo ${accion}.` : `${total} hilos ${accion}.`
  }
  const bien = total - fallaron
  if (bien === 0) return `No se pudo: ${fallaron === 1 ? '1 hilo falló' : `fallaron los ${fallaron}`}.`
  return `${bien} de ${total} ${accion}. ${fallaron === 1 ? '1 falló' : `${fallaron} fallaron`}: probá de nuevo.`
}
