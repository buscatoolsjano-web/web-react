/**
 * Grabar la voz para preguntar hablando (Fase 36 · E2).
 *
 * Separado del componente porque `MediaRecorder` es puro navegador y hay tres
 * cosas que se olvidan siempre, y que en un micrófono se notan:
 *
 *  1. **Soltar el micrófono al terminar.** Si no se paran las pistas, el
 *     navegador deja el indicador de «grabando» encendido para siempre y
 *     algunos sistemas no lo liberan hasta cerrar la pestaña.
 *  2. **Elegir un formato que el navegador tenga.** No todos soportan los
 *     mismos, y pedir uno que no está hace que la grabación salga vacía sin
 *     dar error.
 *  3. **Distinguir «dijo que no» de «no hay micrófono».** Son dos problemas
 *     distintos y se resuelven distinto.
 */

/** Los formatos que se prueban, del que mejor comprime al más compatible. */
const FORMATOS = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']

export type MotivoGrabacion = 'sin_permiso' | 'sin_microfono' | 'no_soportado' | 'error'

export class FalloGrabacion extends Error {
  constructor(
    readonly motivo: MotivoGrabacion,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'FalloGrabacion'
  }
}

export interface Grabacion {
  /** Corta y devuelve lo grabado. */
  detener(): Promise<Blob>
  /** Corta y tira lo grabado, soltando el micrófono. */
  cancelar(): void
}

function formatoDisponible(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return FORMATOS.find((f) => MediaRecorder.isTypeSupported(f))
}

/** Si este navegador puede grabar. Se usa para no mostrar un botón muerto. */
export function sePuedeGrabar(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices?.getUserMedia !== undefined &&
    formatoDisponible() !== undefined
  )
}

export async function empezarAGrabar(): Promise<Grabacion> {
  const formato = formatoDisponible()
  if (formato === undefined) {
    throw new FalloGrabacion('no_soportado', 'Este navegador no puede grabar audio.')
  }

  let pistas: MediaStream
  try {
    pistas = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (e) {
    // `NotAllowedError` es «dijo que no»; `NotFoundError`, «no hay micrófono».
    const nombre = (e as { name?: string } | null)?.name
    if (nombre === 'NotAllowedError' || nombre === 'SecurityError') {
      throw new FalloGrabacion('sin_permiso', 'No diste permiso para usar el micrófono.')
    }
    if (nombre === 'NotFoundError' || nombre === 'DevicesNotFoundError') {
      throw new FalloGrabacion('sin_microfono', 'No encontré ningún micrófono.')
    }
    throw new FalloGrabacion('error', 'No pude abrir el micrófono.')
  }

  const rec = new MediaRecorder(pistas, { mimeType: formato })
  const trozos: Blob[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) trozos.push(e.data)
  }
  rec.start()

  /* Soltar el micrófono. Va en una función porque hay que hacerlo tanto al
     terminar bien como al cancelar, y olvidarlo en una de las dos ramas deja
     el indicador de grabación prendido. */
  const soltar = () => pistas.getTracks().forEach((t) => t.stop())

  return {
    detener: () =>
      new Promise<Blob>((resolver) => {
        rec.onstop = () => {
          soltar()
          resolver(new Blob(trozos, { type: formato }))
        }
        if (rec.state === 'inactive') {
          soltar()
          resolver(new Blob(trozos, { type: formato }))
        } else {
          rec.stop()
        }
      }),
    cancelar: () => {
      if (rec.state !== 'inactive') rec.stop()
      soltar()
    },
  }
}
