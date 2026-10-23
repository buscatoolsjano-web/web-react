/**
 * Señal de «una pantalla se está cargando» (Fase 124).
 *
 * La barra de progreso de arriba no se maneja por la ruta de React Router: una
 * ruta cambia al instante aunque el chunk todavía no haya llegado. La señal que
 * de verdad dice «estoy esperando» es el fallback de `<Suspense>` —CargandoRuta—:
 * se MONTA cuando un chunk no está en memoria y se DESMONTA cuando la pantalla
 * ya puede pintar. Si el chunk venía precargado, el fallback no llega a montarse
 * (ver `resuelto` en precarga.ts) y la barra ni aparece: no molesta en la
 * navegación rápida, sólo da señal cuando hay espera de verdad.
 *
 * Un pub/sub de módulo, sin estado de React, para que CargandoRuta —que está
 * adentro de cada Suspense— y la barra —que vive una sola vez en el layout— se
 * hablen sin pasar props por todo el árbol.
 */

let activos = 0
const oyentes = new Set<(cargando: boolean) => void>()

function avisar() {
  const cargando = activos > 0
  for (const oyente of oyentes) oyente(cargando)
}

/** Una pantalla empezó a cargar (su fallback se montó). */
export function iniciarCargaDeRuta(): void {
  activos += 1
  avisar()
}

/** Una pantalla terminó de cargar (su fallback se desmontó). */
export function terminarCargaDeRuta(): void {
  activos = Math.max(0, activos - 1)
  avisar()
}

/** Suscribirse a los cambios de «hay algo cargando». Devuelve la baja. */
export function suscribirProgresoRuta(oyente: (cargando: boolean) => void): () => void {
  oyentes.add(oyente)
  return () => {
    oyentes.delete(oyente)
  }
}
