/**
 * Un lote del worker de análisis automático, sin HTTP y sin Deno adentro.
 *
 * Lo usa la Edge Function `whatsapp-ai-worker` y la suite de la base con Node,
 * con el mismo patrón que `analisis.ts`: recibe un cliente con service_role y
 * un proveedor.
 *
 *   1. reclamar hasta N trabajos listos (lock atómico en la base);
 *   2. por cada uno, el MISMO análisis incremental que el botón manual —con
 *      sus guardas de IA apagada y límites diarios—;
 *   3. completar el trabajo con el resultado: la base decide done, reintento
 *      con espera o failed.
 *
 * Un trabajo que no se llega a empezar antes del presupuesto de tiempo se
 * LIBERA (vuelve a pending ya). Uno que explota sin clasificar se completa como
 * `worker_excepcion`, que se reintenta con espera. Si el proceso muere a mitad
 * de camino, el lock vence a los 10 minutos y otro worker lo retoma: el
 * análisis es idempotente (checkpoint + huella de ítems).
 */
import { analizarConversacion } from '../whatsapp-ai-analyze/analisis.ts'
import { resultadoParaCola, type ProveedorIA } from '../whatsapp-ai-analyze/logica.ts'

// deno-lint-ignore no-explicit-any
type Cliente = any

export const LOTE_POR_DEFECTO = 5
/** Por debajo del límite de una Edge Function, con margen para la última llamada. */
export const PRESUPUESTO_MS_POR_DEFECTO = 90_000

export interface OpcionesLote {
  admin: Cliente
  proveedor: ProveedorIA
  worker: string
  limite?: number
  presupuestoMs?: number
  ahora?: () => number
  /** Sólo pruebas: mover el reloj de la cola de UNA empresa. */
  reloj?: { ahora: string; empresa: string }
}

export interface ResumenLote {
  reclamados: number
  resultados: Record<string, number>
  llamadasProveedor: number
  lockPerdido: number
}

interface Trabajo {
  conversation_id: string
  company_id: string
  attempts: number
  locked_at: string
}

export async function procesarLote(o: OpcionesLote): Promise<ResumenLote> {
  const ahora = o.ahora ?? Date.now
  const inicio = ahora()
  const presupuesto = o.presupuestoMs ?? PRESUPUESTO_MS_POR_DEFECTO
  const resumen: ResumenLote = { reclamados: 0, resultados: {}, llamadasProveedor: 0, lockPerdido: 0 }

  const { data, error } = await o.admin.rpc('reclamar_analisis_whatsapp', {
    p_limite: o.limite ?? LOTE_POR_DEFECTO,
    p_worker: o.worker,
    p_ahora: o.reloj?.ahora ?? null,
    p_empresa: o.reloj?.empresa ?? null,
  })
  if (error) throw new Error('no se pudo reclamar la cola')
  const trabajos = (data ?? []) as Trabajo[]
  resumen.reclamados = trabajos.length

  const contar = (k: string) => { resumen.resultados[k] = (resumen.resultados[k] ?? 0) + 1 }

  for (const t of trabajos) {
    let resultado: string
    let codigo: string | null = null

    if (ahora() - inicio > presupuesto) {
      resultado = 'liberado'
    } else {
      try {
        const r = await analizarConversacion({
          admin: o.admin,
          proveedor: o.proveedor,
          conversacionId: t.conversation_id,
          completo: false,
          solicitadoPor: null,
          ahora,
        })
        if ((r.mensajesEnviados ?? 0) > 0) resumen.llamadasProveedor++
        ;({ resultado, codigo } = resultadoParaCola(r))
      } catch {
        resultado = 'error'
        codigo = 'worker_excepcion'
      }
    }

    const { data: fin, error: eFin } = await o.admin.rpc('completar_analisis_whatsapp', {
      p_conversacion: t.conversation_id,
      p_locked_at: t.locked_at,
      p_resultado: resultado,
      p_codigo: codigo,
      p_ahora: o.reloj?.ahora ?? null,
    })
    if (eFin || fin === 'lock_perdido') resumen.lockPerdido++
    contar(codigo ? `${resultado}:${codigo}` : resultado)
  }

  return resumen
}
