import type { QueryClient } from '@tanstack/react-query'

/**
 * La cola de SEGUNDO PLANO (auditoría de rendimiento, 2026-11).
 *
 * Medido en producción, con sesión real y la caché persistida borrada: al
 * entrar a cualquier pantalla salían ~15 requests a la vez —los contadores del
 * menú, la campana (cinco consultas), la presencia del chat y el precalentado
 * del catálogo— junto con las DOS O TRES que dibujan la pantalla pedida.
 *
 * La base es una instancia chica y con la CPU limitada, y se satura con la
 * concurrencia, no con la cantidad:
 *
 *  · un request trivial tarda 120 ms solo; quince en paralelo, hasta 2,2 s;
 *  · `search_products` tarda ~300 ms sola; cuatro en paralelo, 5,5 s cada una;
 *  · `company_memberships` tarda 1–2 ms en la base y 1,15 s en el navegador
 *    al arrancar, y `listas_planilla` 170–320 ms contra 3,8 s: es cola.
 *
 * O sea que la pantalla que uno quiere ver esperaba en la fila detrás de un
 * contador de mails. Esto la pone primera: lo que no se ve en la pantalla
 * espera a que la pantalla haya terminado de pedir lo suyo.
 *
 * Reglas:
 *  1. Una tarea de segundo plano arranca recién cuando no hay ninguna consulta
 *     de PRIMER plano en vuelo desde hace `SILENCIO_MS`.
 *  2. Nunca más de `MAX_EN_PARALELO` tareas de segundo plano a la vez.
 *  3. Nadie espera para siempre: a los `ESPERA_MAXIMA_MS` sale igual (una
 *     pantalla que se queda pidiendo no puede dejar sin campana a nadie).
 *
 * Primer plano = cualquier consulta de React Query sin `meta.segundoPlano`.
 * Las de segundo plano llevan esa marca (ver `META_SEGUNDO_PLANO`) para no
 * bloquearse a sí mismas mientras esperan en la cola.
 */

/** La marca que distingue una consulta de segundo plano. Va en `meta`. */
export const META_SEGUNDO_PLANO = { segundoPlano: true } as const

const SILENCIO_MS = 300
const ESPERA_MAXIMA_MS = 6_000
const MAX_EN_PARALELO = 2
/** Lo más que una tarea retiene su lugar en la cola, termine o no. */
const LIBERAR_MS = 10_000

interface Tarea {
  correr: () => void
  desde: number
  /** La clave de la consulta que espera esta tarea, si es una consulta. */
  clave?: readonly unknown[] | undefined
}

let cliente: QueryClient | null = null
let desuscribir: (() => void) | null = null
let ultimoPrimerPlano = 0
let corriendo = 0
let generacion = 0
let temporizador: ReturnType<typeof setTimeout> | undefined
const cola: Tarea[] = []

function ahora(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/** Trabajos de primer plano que no son consultas (el código de la pantalla). */
let otrosDePrimerPlano = 0

function hayPrimerPlanoEnVuelo(): boolean {
  if (cliente === null) return false
  if (otrosDePrimerPlano > 0) return true
  // Una consulta de segundo plano que ya adoptó la pantalla (ver
  // `fuePromovida`) cuenta como primer plano: es lo que la pantalla espera.
  return cliente
    .getQueryCache()
    .findAll({ fetchStatus: 'fetching' })
    .some(
      (q) =>
        q.meta?.['segundoPlano'] !== true ||
        q.observers.some((o) => o.options.meta?.['segundoPlano'] !== true),
    )
}

function programar(ms: number): void {
  if (temporizador !== undefined) clearTimeout(temporizador)
  temporizador = setTimeout(
    () => {
      temporizador = undefined
      bombear()
    },
    Math.max(0, ms),
  )
}

/**
 * ¿La pantalla adoptó una consulta que estaba esperando en la cola?
 *
 * Pasa con el precalentado: se encola la primera página del catálogo mientras
 * uno está en el Dashboard, uno entra al catálogo, y la pantalla se engancha a
 * ESA consulta en vuelo (misma clave). Engancharse a un fetch en curso NO le
 * pisa las opciones a la consulta (`Query.fetch` vuelve antes del
 * `setOptions`), así que el `meta` de la consulta sigue diciendo «segundo
 * plano»: lo que cambia es que ahora la mira un observador SIN esa marca.
 * Si siguiera en la cola, la pantalla esperaría a una tarea que espera a que
 * la pantalla termine — y nadie avanza hasta la espera máxima.
 */
function fuePromovida(tarea: Tarea): boolean {
  if (cliente === null || tarea.clave === undefined) return false
  const q = cliente.getQueryCache().find({ queryKey: tarea.clave, exact: true })
  if (q === undefined) return false
  return q.observers.some((o) => o.options.meta?.['segundoPlano'] !== true)
}

function largarPromovidas(): void {
  for (let i = cola.length - 1; i >= 0; i--) {
    const tarea = cola[i]!
    if (!fuePromovida(tarea)) continue
    cola.splice(i, 1)
    corriendo++
    tarea.correr()
  }
}

function bombear(): void {
  largarPromovidas()
  if (cola.length === 0) return
  const t = ahora()
  if (hayPrimerPlanoEnVuelo()) ultimoPrimerPlano = t

  while (corriendo < MAX_EN_PARALELO && cola.length > 0) {
    const primera = cola[0]!
    const silencio = t - ultimoPrimerPlano >= SILENCIO_MS
    const vencida = t - primera.desde >= ESPERA_MAXIMA_MS
    if (!silencio && !vencida) break
    cola.shift()
    corriendo++
    primera.correr()
  }

  if (cola.length > 0 && corriendo < MAX_EN_PARALELO) {
    const primera = cola[0]!
    const hastaSilencio = SILENCIO_MS - (t - ultimoPrimerPlano)
    const hastaVencer = ESPERA_MAXIMA_MS - (t - primera.desde)
    programar(Math.min(hastaSilencio, hastaVencer))
  }
}

/**
 * Engancha la cola al `QueryClient` de la app: desde acá se sabe si la
 * pantalla tiene consultas en vuelo. Sin cliente enganchado (tests, scripts),
 * `enSegundoPlano` corre la tarea al instante.
 */
export function vigilarPrimerPlano(qc: QueryClient): void {
  desuscribir?.()
  cliente = qc
  // Arranca como si recién hubiera habido primer plano: en el primer render
  // todavía no se registró la consulta de la pantalla (espera la membresía),
  // y sin esto la cola vería «silencio» y largaría todo junto, que es
  // exactamente lo que hay que evitar.
  ultimoPrimerPlano = ahora()
  // Lo que hubiera de un cliente anterior (sólo pasa en tests) se descarta: la
  // generación nueva no hereda lugares ocupados por tareas viejas.
  generacion++
  corriendo = 0
  otrosDePrimerPlano = 0
  cola.length = 0
  desuscribir = qc.getQueryCache().subscribe(() => {
    // El sello de «hubo primer plano» se lleva SIEMPRE, haya cola o no: una
    // tarea que llega 50 ms después de que terminó la pantalla también tiene
    // que esperar su silencio.
    if (hayPrimerPlanoEnVuelo()) ultimoPrimerPlano = ahora()
    if (cola.length === 0) return
    largarPromovidas()
    if (cola.length > 0) programar(SILENCIO_MS)
  })
}

/**
 * Marca un trabajo que NO es una consulta pero que la pantalla necesita para
 * pintarse: el chunk de código de la ruta.
 *
 * Medido después del primer deploy de la cola: en Listas de precios el chunk
 * de la pantalla bajó entre los 4,9 y los 8,0 s. Durante ese rato no había
 * ninguna consulta en vuelo —la pantalla todavía no existía para pedirlas—, la
 * cola vio «silencio» y largó la campana entera justo antes de que la
 * pantalla pidiera lo suyo. Con esto, mientras baja el código de la pantalla,
 * lo secundario sigue esperando.
 */
export function enPrimerPlano<T>(trabajo: Promise<T>): Promise<T> {
  if (cliente === null) return trabajo
  otrosDePrimerPlano++
  ultimoPrimerPlano = ahora()
  const terminar = () => {
    otrosDePrimerPlano--
    ultimoPrimerPlano = ahora()
    if (cola.length > 0) programar(SILENCIO_MS)
  }
  trabajo.then(terminar, terminar)
  return trabajo
}

/**
 * Corre `tarea` cuando la pantalla terminó de pedir lo suyo.
 *
 * Para todo lo que NO dibuja la pantalla actual: contadores, la campana,
 * latidos, precalentados. Lo que la pantalla necesita para pintarse nunca
 * pasa por acá.
 */
export function enSegundoPlano<T>(
  tarea: () => Promise<T>,
  /**
   * La clave de la consulta, cuando la tarea es el `queryFn` de una. Con ella
   * la cola se da cuenta si una pantalla adopta la consulta mientras espera,
   * y la larga en el acto (ver `fuePromovida`).
   */
  clave?: readonly unknown[],
): Promise<T> {
  if (cliente === null) return tarea()
  return new Promise<T>((resolver, rechazar) => {
    cola.push({
      clave,
      desde: ahora(),
      correr: () => {
        const suya = generacion
        let liberada = false
        // Una tarea colgada no puede tomar su lugar para siempre: a los
        // `LIBERAR_MS` lo devuelve (la tarea sigue, sólo deja de contar).
        const liberar = () => {
          if (liberada) return
          liberada = true
          clearTimeout(reloj)
          if (suya !== generacion) return
          corriendo--
          bombear()
        }
        const reloj = setTimeout(liberar, LIBERAR_MS)
        tarea().then(resolver, rechazar).finally(liberar)
      },
    })
    bombear()
  })
}
