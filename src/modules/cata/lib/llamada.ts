/**
 * La llamada, como máquina de estados (Fase 85). PURA.
 *
 * ── POR QUÉ UNA MÁQUINA Y NO CUATRO `useState` ──────────────────────────────
 *
 * Porque una llamada tiene tres cosas pasando a la vez y ninguna la controla
 * nosotros: el micrófono que escucha, el modelo que tarda y la voz que habla.
 * Las tres avisan cuando terminan, y avisan tarde y a veces dos veces.
 *
 * `SpeechRecognition` es el peor de los tres. Sigue escuchando mientras Cata
 * habla, así que oye a Cata por el parlante y lo manda como si fuera la
 * persona. Y manda resultados vacíos, y repite el último, y en Chrome se corta
 * solo a los pocos segundos de silencio y hay que volver a arrancarlo.
 *
 * Con banderas sueltas eso termina en una llamada que se interrumpe a sí
 * misma. Acá hay UN estado y una regla sola que lo arregla: **lo que se oye
 * sólo cuenta si estamos escuchando**. Todo lo que llegue mientras Cata piensa
 * o habla se tira, porque o es Cata por el parlante o es tarde.
 *
 * ── Y POR QUÉ ES UNA LLAMADA Y NO UN BOTÓN DE MICRÓFONO ─────────────────────
 *
 * Un botón de micrófono es un turno: apretás, hablás, soltás, leés. Una
 * llamada es un bucle: cuando Cata termina de hablar vuelve a escuchar sola,
 * sin que nadie toque nada. Eso es todo lo que hace `termine_de_hablar`, y es
 * la diferencia entre probar una voz y poder tener una conversación.
 */

/** En qué anda la llamada. */
export type EstadoLlamada =
  /** Colgada. Lo que se dijo queda a la vista. */
  | 'inactiva'
  /** El micrófono abierto, esperando que alguien hable. */
  | 'escuchando'
  /** Lo que se dijo ya viajó y el modelo está contestando. */
  | 'pensando'
  /** La voz está diciendo la respuesta. */
  | 'hablando'
  /** Algo se rompió de un modo que no deja seguir. */
  | 'cortada'

export interface Turno {
  rol: 'usuario' | 'cata'
  texto: string
}

export interface Llamada {
  estado: EstadoLlamada
  /** Lo que se dijo, en orden. Es la transcripción que se muestra. */
  turnos: readonly Turno[]
  /**
   * Lo que el micrófono está oyendo AHORA y todavía puede cambiar.
   *
   * Va aparte de los turnos porque no es un turno: es el borrador que el
   * reconocedor va corrigiendo mientras alguien habla. Mostrarlo es lo que
   * hace que no parezca colgado.
   */
  parcial: string
  /** Lo último que falló, para decirlo. Vacío si no falló nada. */
  error: string
}

export const LLAMADA_INICIAL: Llamada = {
  estado: 'inactiva',
  turnos: [],
  parcial: '',
  error: '',
}

export type EventoLlamada =
  /** Se apretó «Llamar». */
  | { tipo: 'atender' }
  /** El reconocedor va oyendo algo, todavía sin cerrar la frase. */
  | { tipo: 'oyendo'; texto: string }
  /** El reconocedor cerró una frase. */
  | { tipo: 'escuche'; texto: string }
  /** El modelo contestó. */
  | { tipo: 'conteste'; texto: string }
  /** La voz terminó de decir la respuesta. */
  | { tipo: 'termine_de_hablar' }
  /**
   * Algo falló. `cortada` para lo que no deja seguir —no hay micrófono, la
   * función no está desplegada—; sin eso, se dice y la llamada sigue.
   */
  | { tipo: 'fallo'; mensaje: string; cortada?: boolean }
  /** Se apretó «Colgar». */
  | { tipo: 'colgar' }

/** Si en este estado el micrófono tiene que estar abierto. */
export function escucha(l: Llamada): boolean {
  return l.estado === 'escuchando'
}

/** Si la llamada está en curso, en cualquiera de sus tres momentos. */
export function enCurso(l: Llamada): boolean {
  return l.estado === 'escuchando' || l.estado === 'pensando' || l.estado === 'hablando'
}

/**
 * Lo que hay que mandarle al modelo: la conversación, con los roles que
 * entiende la Edge Function.
 *
 * Va entera y no sólo el último turno porque «¿y de ese cuánto queda?» no se
 * entiende sin lo anterior. El recorte lo hace el servidor, que es el que sabe
 * cuánto contexto se paga.
 */
export function historial(l: Llamada): { rol: 'usuario' | 'agente'; texto: string }[] {
  return l.turnos.map((t) => ({
    rol: t.rol === 'usuario' ? ('usuario' as const) : ('agente' as const),
    texto: t.texto,
  }))
}

/** El estado siguiente. Sin efectos: sólo datos. */
export function siguiente(l: Llamada, e: EventoLlamada): Llamada {
  switch (e.tipo) {
    case 'atender':
      // Atender dos veces no reinicia nada: el botón se puede apretar de
      // nuevo sin querer y perder la conversación a mitad de la llamada
      // sería el peor momento posible.
      if (enCurso(l)) return l
      return { estado: 'escuchando', turnos: [], parcial: '', error: '' }

    case 'oyendo':
      // Sólo mientras se escucha, y por la misma razón que `escuche`: lo que
      // el micrófono oye mientras Cata habla es Cata.
      if (l.estado !== 'escuchando') return l
      return { ...l, parcial: e.texto }

    case 'escuche': {
      if (l.estado !== 'escuchando') return l
      const texto = e.texto.trim()
      // El silencio no es un turno. El reconocedor manda resultados vacíos
      // cuando alguien tose o cuando se corta solo, y cada uno de esos sería
      // una consulta paga que pregunta nada.
      if (texto === '') return { ...l, parcial: '' }
      return {
        estado: 'pensando',
        turnos: [...l.turnos, { rol: 'usuario', texto }],
        parcial: '',
        error: '',
      }
    }

    case 'conteste': {
      // Si ya se colgó, la respuesta que venía en camino no se dice: alguien
      // apretó «Colgar» justamente para que se callara.
      if (!enCurso(l)) return l
      const texto = e.texto.trim()
      if (texto === '') return { ...l, estado: 'escuchando', parcial: '' }
      return {
        ...l,
        estado: 'hablando',
        turnos: [...l.turnos, { rol: 'cata', texto }],
        parcial: '',
      }
    }

    case 'termine_de_hablar':
      // ACÁ ES DONDE ES UNA LLAMADA: termina de hablar y vuelve a escuchar
      // sola, sin que nadie apriete nada.
      if (l.estado !== 'hablando') return l
      return { ...l, estado: 'escuchando', parcial: '' }

    case 'fallo':
      if (l.estado === 'inactiva') return l
      if (e.cortada === true) {
        return { ...l, estado: 'cortada', parcial: '', error: e.mensaje }
      }
      // Un fallo que no corta se DICE y la llamada sigue: se pone como turno
      // de Cata para que la voz lo lea y el estado quede en `hablando`, que
      // es el camino normal. Así «se me cortó, repetime» se escucha en vez de
      // dejar a alguien hablándole a algo que no contesta.
      return {
        ...l,
        estado: 'hablando',
        turnos: [...l.turnos, { rol: 'cata', texto: e.mensaje }],
        parcial: '',
        error: e.mensaje,
      }

    case 'colgar':
      // Los turnos QUEDAN: después de colgar se quiere poder leer el SKU que
      // Cata acababa de dictar.
      return { ...l, estado: 'inactiva', parcial: '' }
  }
}
