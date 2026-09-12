/**
 * Sincronización incremental de un buzón.
 *
 * Tres propiedades que el algoritmo tiene que cumplir, y que están probadas:
 *
 *   1. **Idempotente.** El mismo evento repetido da el mismo resultado. Pub/Sub
 *      reenvía y no garantiza orden.
 *   2. **No retrocede.** Un `historyId` menor o repetido nunca mueve el cursor
 *      para atrás.
 *   3. **Un resync NUNCA borra `email_thread_state`.** El índice es
 *      descartable; el estado del ERP no. Es la lección de las 91 filas del
 *      legacy: de 65 MB, lo único irrecuperable eran 91 estados.
 *
 * Lo que hace que perder una notificación no pierda correo: **el push no trae
 * los cambios, trae el cursor**. `history.list` devuelve todo lo ocurrido desde
 * `last_history_id`, no sólo lo del evento. Es lo contrario de Make, que tomaba
 * «los 25 más recientes» sin cursor y perdía en silencio al desbordar.
 */
import type { ClienteGmail, HiloGmail, MensajeGmail } from './google/gmail.js'
import { HistorialVencido } from './google/gmail.js'
import type { Almacen, CuentaEmail, FilaHilo } from './almacen.js'

/** Tope de páginas, para que un historial patológico no cuelgue el proceso. */
const MAX_PAGINAS = 50

export interface ResultadoSync {
  hilosTocados: number
  historyIdFinal: string | null
  historialVencido: boolean
  resyncCompleto: boolean
  /** Cuando otro proceso tenía el lease. No es un error. */
  omitidoPorLease: boolean
}

/** `'9'` > `'10'` como texto. El historyId se compara como número. */
export function historyIdMayor(a: string | null, b: string | null): boolean {
  if (b === null) return false
  if (a === null) return true
  try {
    return BigInt(b) > BigInt(a)
  } catch {
    return false
  }
}

function direccionDe(crudo: string | undefined): string | null {
  if (!crudo) return null
  const m = /<([^>]+)>/.exec(crudo)
  const dir = (m?.[1] ?? crudo).trim().toLowerCase()
  return dir.includes('@') ? dir : null
}

/**
 * De un hilo de Gmail a la fila del índice.
 *
 * Sólo metadata. Ni un cuerpo, ni un byte de adjunto.
 */
export function filaDesdeHilo(cuenta: CuentaEmail, hilo: HiloGmail): FilaHilo {
  const ordenados = [...hilo.mensajes].sort(
    (a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0),
  )
  const ultimo: MensajeGmail | undefined = ordenados[ordenados.length - 1]

  const participantes = new Set<string>()
  for (const m of ordenados) {
    for (const campo of ['from', 'to', 'cc']) {
      for (const parte of (m.headers[campo] ?? '').split(',')) {
        const d = direccionDe(parte)
        if (d) participantes.add(d)
      }
    }
  }

  const etiquetas = new Set<string>()
  for (const m of ordenados) for (const l of m.labelIds) etiquetas.add(l)

  const deQuien = direccionDe(ultimo?.headers['from'])
  return {
    company_id: cuenta.company_id,
    account_id: cuenta.id,
    gmail_thread_id: hilo.id,
    // El asunto del PRIMER mensaje: es el del hilo. Los "Re:" del último no
    // aportan y hacen que la lista parpadee al llegar una respuesta.
    subject: ordenados[0]?.headers['subject'] ?? null,
    snippet: ultimo?.snippet ?? null,
    // internalDate, que la documentación describe como «more reliable than the
    // Date header».
    last_message_at: ultimo ? new Date(Number(ultimo.internalDate)).toISOString() : null,
    last_message_from: deQuien,
    last_message_dir: deQuien === cuenta.email_address.toLowerCase() ? 'out' : 'in',
    participants: [...participantes],
    gmail_labels: [...etiquetas],
    message_count: ordenados.length,
    has_attachments: ordenados.some((m) => m.tieneAdjuntos),
    size_estimate: ordenados.reduce((a, m) => a + (m.sizeEstimate ?? 0), 0),
  }
}

interface Opciones {
  cuenta: CuentaEmail
  gmail: ClienteGmail
  almacen: Almacen
  duenoLease: string
  /** El historyId que trajo la notificación, si vino de un push. */
  historyIdEvento?: string | null
  origen: 'push' | 'cron' | 'manual'
}

/**
 * Sincroniza una cuenta. Toma el lease, trabaja, lo suelta.
 *
 * Devuelve sin hacer nada —y sin error— si otro proceso está sincronizando el
 * mismo buzón: para eso está el lease.
 */
export async function sincronizar(op: Opciones): Promise<ResultadoSync> {
  const arranque = Date.now()
  const vacio: ResultadoSync = {
    hilosTocados: 0,
    historyIdFinal: op.cuenta.last_history_id,
    historialVencido: false,
    resyncCompleto: false,
    omitidoPorLease: false,
  }

  // Si la notificación trae un cursor que ya procesamos, no hay trabajo. Se
  // verifica ANTES de tomar el lease: es el caso más frecuente con Pub/Sub,
  // que reenvía, y no vale la pena serializar por nada.
  if (
    op.historyIdEvento &&
    !historyIdMayor(op.cuenta.last_history_id, op.historyIdEvento)
  ) {
    return vacio
  }

  const cuenta = await op.almacen.tomarLease(op.cuenta.id, op.duenoLease)
  if (!cuenta) {
    return { ...vacio, omitidoPorLease: true }
  }

  try {
    // Se relee desde la fila que devolvió el lease: entre el chequeo de arriba
    // y el lease, otro proceso pudo haber avanzado el cursor.
    if (
      op.historyIdEvento &&
      !historyIdMayor(cuenta.last_history_id, op.historyIdEvento)
    ) {
      return vacio
    }

    if (!cuenta.last_history_id) {
      // Nunca sincronizó: el primer sync es completo por definición.
      return await resyncCompleto(op, cuenta, arranque)
    }

    let pagina: string | null | undefined
    let vueltas = 0
    let mayor: string | null = cuenta.last_history_id
    const hilos = new Set<string>()

    try {
      do {
        const p = await op.gmail.listarHistorial(
          cuenta.email_address,
          cuenta.last_history_id,
          pagina ?? undefined,
        )
        for (const h of p.hilosTocados) hilos.add(h)
        if (historyIdMayor(mayor, p.historyId)) mayor = p.historyId
        pagina = p.siguientePagina
        vueltas++
      } while (pagina && vueltas < MAX_PAGINAS)
    } catch (e) {
      if (e instanceof HistorialVencido) {
        return await resyncCompleto(op, cuenta, arranque, true)
      }
      throw e
    }

    await aplicarHilos(op, cuenta, [...hilos])

    // El cursor se mueve AL FINAL, después de aplicar los cambios. Si el
    // proceso muere en el medio, la próxima corrida vuelve a leer desde el
    // cursor viejo: se repite trabajo, que es idempotente, en vez de saltear
    // cambios, que sería pérdida.
    if (mayor) await op.almacen.avanzarHistory(cuenta.id, mayor, false)

    await op.almacen.registrarSync({
      account_id: cuenta.id,
      kind: op.origen,
      history_id_desde: cuenta.last_history_id,
      history_id_hasta: mayor,
      threads_tocados: hilos.size,
      historial_vencido: false,
      duracion_ms: Date.now() - arranque,
    })

    return {
      hilosTocados: hilos.size,
      historyIdFinal: mayor,
      historialVencido: false,
      resyncCompleto: false,
      omitidoPorLease: false,
    }
  } finally {
    await op.almacen.soltarLease(op.cuenta.id, op.duenoLease)
  }
}

/**
 * Resync completo: rehace el índice desde cero.
 *
 * **`email_thread_state` y `email_thread_reads` no se tocan.** Y sobre
 * `email_threads` se hace `upsert`, nunca `delete`: un hilo que ya no aparezca
 * queda con `synced_at` viejo y se decide aparte qué hacer con él. Borrar filas
 * durante una recuperación de error es cómo se pierde lo que se quería salvar.
 */
async function resyncCompleto(
  op: Opciones,
  cuenta: CuentaEmail,
  arranque: number,
  porVencimiento = false,
): Promise<ResultadoSync> {
  // El historyId se toma ANTES de listar: si se tomara después, los cambios
  // ocurridos durante el listado quedarían por debajo del cursor y se perderían.
  const perfil = await op.gmail.perfil(cuenta.email_address)

  let pagina: string | null | undefined
  let vueltas = 0
  const hilos: string[] = []
  do {
    const p = await op.gmail.listarHilos(cuenta.email_address, pagina ?? undefined)
    hilos.push(...p.hilos)
    pagina = p.siguientePagina
    vueltas++
  } while (pagina && vueltas < MAX_PAGINAS)

  await aplicarHilos(op, cuenta, hilos)
  await op.almacen.avanzarHistory(cuenta.id, perfil.historyId, true)

  await op.almacen.registrarSync({
    account_id: cuenta.id,
    kind: 'resync_completo',
    history_id_desde: cuenta.last_history_id,
    history_id_hasta: perfil.historyId,
    threads_tocados: hilos.length,
    historial_vencido: porVencimiento,
    duracion_ms: Date.now() - arranque,
  })

  return {
    hilosTocados: hilos.length,
    historyIdFinal: perfil.historyId,
    historialVencido: porVencimiento,
    resyncCompleto: true,
    omitidoPorLease: false,
  }
}

async function aplicarHilos(op: Opciones, cuenta: CuentaEmail, hilos: string[]): Promise<void> {
  const filas: FilaHilo[] = []
  for (const id of hilos) {
    const hilo = await op.gmail.hiloMetadata(cuenta.email_address, id)
    // null = el hilo se borró entre el evento y la lectura. Se saltea.
    if (hilo) filas.push(filaDesdeHilo(cuenta, hilo))
  }
  if (filas.length > 0) await op.almacen.upsertHilos(filas)
}
