import { supabase } from '@/services/supabase/client'

/**
 * La única puerta desde el navegador hacia Cata (Fase 85).
 *
 * Igual que `services/asistente.ts`: acá no hay prompts, ni claves, ni lista
 * de herramientas. Lo único que se manda son los turnos de la llamada, y lo
 * único que vuelve es lo que hay que decir en voz alta.
 */

export interface TurnoParaCata {
  rol: 'usuario' | 'agente'
  texto: string
}

export interface RespuestaDeCata {
  texto: string
  /** Qué consultó. Se muestra chiquito, no se dice. */
  pasos: string[]
}

export class FalloCata extends Error {
  constructor(
    readonly motivo: string,
    mensaje: string,
    /** Si la llamada no puede seguir. Ver `siguiente()` en `lib/llamada.ts`. */
    readonly corta: boolean,
    /** Lo que se DICE en voz alta, que no es lo mismo que lo que se muestra. */
    readonly dicho: string,
  ) {
    super(mensaje)
    this.name = 'FalloCata'
  }
}

/**
 * Qué se dice en voz alta según qué falló.
 *
 * No es el mismo texto que se muestra, y por eso son dos campos. «La función
 * no está desplegada» es lo que hay que leer en la pantalla para arreglarlo;
 * por el parlante, lo que corresponde es «no me puedo conectar», que es lo que
 * le pasa a quien llamó.
 */
const QUE_DECIR: Record<string, { dicho: string; corta: boolean }> = {
  sin_configurar: { dicho: 'Todavía no estoy configurada. Avisale a sistemas.', corta: true },
  sin_desplegar: { dicho: 'Todavía no estoy disponible. Avisale a sistemas.', corta: true },
  sin_sesion: { dicho: 'Se me venció la sesión. Volvé a entrar y llamame de nuevo.', corta: true },
  sin_empresa: { dicho: 'No encuentro tu empresa. Avisale a sistemas.', corta: true },
  limite: { dicho: 'Estoy saturada en este momento. Llamame en un rato.', corta: true },
  /*
   * Los de abajo NO cortan: pueden ser de una sola vez, y en una llamada lo
   * natural es decirlo y seguir hablando.
   *
   * Y dicen LA VERDAD, que es lo que antes no pasaba. Decían «no te escuché
   * bien»: «le pregunto algo y me dice, no te escuché, ¿puedes repetir? Y no
   * me gusta eso». Tenía razón —se había escuchado perfecto, lo que falló fue
   * el servidor—, y encima manda a repetir lo mismo, que vuelve a fallar.
   */
  caido: { dicho: 'Se me cortó la línea con el sistema. Probá de nuevo en un segundo.', corta: false },
  error: { dicho: 'Se me cortó la línea con el sistema. Probá de nuevo en un segundo.', corta: false },
}

const fallo = (motivo: string, mensaje: string): FalloCata => {
  const q = QUE_DECIR[motivo] ?? QUE_DECIR['error']!
  return new FalloCata(motivo, mensaje, q.corta, q.dicho)
}

/**
 * Pasarle la llamada a Cata.
 *
 * El historial va entero: lo recorta el servidor, que es el que sabe cuánto
 * contexto se paga. Sin streaming a propósito —una voz no se puede empezar a
 * decir a medias y corregirla después—, así que esto tarda lo que tarda y es
 * el momento en que la pantalla dice «pensando».
 */
export async function hablarConCata(params: {
  companyId: string
  turnos: readonly TurnoParaCata[]
}): Promise<RespuestaDeCata> {
  const r: { data: unknown; error: Error | null } = await supabase.functions.invoke<unknown>(
    'cata',
    { body: { companyId: params.companyId, turnos: params.turnos } },
  )

  if (r.error) {
    /**
     * El motivo viene en el CUERPO, no en el error.
     *
     * `functions.invoke` trata cualquier respuesta no-2xx como fallo y deja el
     * `Response` en `error.context`; su `.message` es genérico. Sin leer el
     * cuerpo, «se alcanzó el límite» se escucharía como «se me cortó», y
     * llamar de nuevo no arreglaría nada.
     */
    const ctx = (r.error as { context?: unknown }).context
    if (ctx instanceof Response) {
      const cuerpo: unknown = await ctx.json().catch(() => null)
      const e = (cuerpo as { error?: { motivo?: unknown; mensaje?: unknown } } | null)?.error
      if (typeof e?.mensaje === 'string') {
        throw fallo(typeof e.motivo === 'string' ? e.motivo : 'error', e.mensaje)
      }
      if (ctx.status === 404) {
        throw fallo('sin_desplegar', 'Falta desplegar la función «cata».')
      }
    }
    throw fallo('error', `No pude hablar con Cata: ${r.error.message}`)
  }

  const o = (r.data ?? {}) as Record<string, unknown>
  const pasos = Array.isArray(o['pasos']) ? o['pasos'] : []
  return {
    texto: typeof o['texto'] === 'string' ? o['texto'] : '',
    pasos: pasos
      .map((p) => {
        const n = (p as { nombre?: unknown } | null)?.nombre
        return typeof n === 'string' ? n : ''
      })
      .filter((n) => n !== ''),
  }
}
