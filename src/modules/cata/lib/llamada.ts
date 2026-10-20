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
 * ── POR QUÉ EL MICRÓFONO NO SE CIERRA NUNCA ────────────────────────────────
 *
 * La primera versión lo cerraba mientras Cata hablaba, que es la forma obvia
 * de no oírse a sí misma. No sirve: se pidió poder interrumpirla —«si yo
 * hablo mientras ella está hablando, la quiero interrumpir y que se calle»—,
 * y para eso el micrófono tiene que estar abierto justo cuando suena el
 * parlante, que es exactamente cuando entra el eco.
 *
 * Así que el micrófono queda abierto toda la llamada —como dice la pantalla,
 * y como en un teléfono— y lo que distingue a Cata de quien la llama es
 * `lib/eco.ts`, comparando contra lo que Cata está diciendo en ese momento.
 * Por eso el estado lleva un campo `diciendo`: sin saber qué está saliendo
 * por el parlante no hay forma de reconocerlo cuando vuelve por el micrófono.
 *
 * ── Y POR QUÉ ES UNA LLAMADA Y NO UN BOTÓN DE MICRÓFONO ─────────────────────
 *
 * Un botón de micrófono es un turno: apretás, hablás, soltás, leés. Una
 * llamada es un bucle: cuando Cata termina de hablar vuelve a escuchar sola,
 * sin que nadie toque nada. Eso es todo lo que hace `termine_de_hablar`, y es
 * la diferencia entre probar una voz y poder tener una conversación.
 */
import { loQueDijoLaPersona } from './eco'

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
  /**
   * Lo que está saliendo por el parlante AHORA. Vacío si Cata está callada.
   *
   * No es para mostrarlo: es contra lo que se compara lo que entra por el
   * micrófono, para saber si es ella o es alguien. Sin esto no se puede tener
   * el micrófono abierto mientras habla, y sin eso no se la puede interrumpir.
   */
  diciendo: string
  /** Lo último que falló, para decirlo. Vacío si no falló nada. */
  error: string
}

export const LLAMADA_INICIAL: Llamada = {
  estado: 'inactiva',
  turnos: [],
  parcial: '',
  diciendo: '',
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

/**
 * Si en este estado el micrófono tiene que estar abierto: TODA la llamada.
 *
 * Incluso mientras habla, que es lo que permite interrumpirla. Lo que se oye
 * de más lo filtra `eco.ts`, no el micrófono.
 */
export function escucha(l: Llamada): boolean {
  return enCurso(l)
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
      return { estado: 'escuchando', turnos: [], parcial: '', diciendo: '', error: '' }

    case 'oyendo': {
      if (!enCurso(l)) return l
      // El borrador que se muestra es lo que dijo la PERSONA. Si lo que entra
      // es el parlante, no se muestra nada: ver cómo se escribe sola lo que
      // Cata está diciendo es desconcertante.
      const suyo = loQueDijoLaPersona(e.texto, l.diciendo)
      return { ...l, parcial: suyo }
    }

    case 'escuche': {
      if (!enCurso(l)) return l

      /*
       * Acá se decide si habló alguien o si se oyó a sí misma.
       *
       * Mientras Cata habla, `diciendo` tiene lo que sale por el parlante y
       * el filtro devuelve sólo lo que no estaba ahí. Mientras está callada
       * —`diciendo` vacío— devuelve todo, que es lo que corresponde.
       */
      const texto = loQueDijoLaPersona(e.texto, l.diciendo).trim()

      // El silencio no es un turno. El reconocedor manda resultados vacíos
      // cuando alguien tose o cuando se corta solo, y cada uno de esos sería
      // una consulta paga que pregunta nada. Y el eco tampoco: eso era ella.
      if (texto === '') return { ...l, parcial: '' }

      // Mientras PIENSA no se acepta nada: la consulta ya salió y viene una
      // respuesta en camino. Aceptar otro turno acá dejaría dos preguntas
      // vivas y la respuesta de la primera contestando a la segunda.
      if (l.estado === 'pensando') return { ...l, parcial: '' }

      /*
       * Y si estaba hablando, esto es una INTERRUPCIÓN: se calla y atiende.
       * La parte de callarse la hace quien tiene el parlante; acá lo que
       * cambia es que `diciendo` se vacía, que es lo que dice que ya no hay
       * nada sonando.
       */
      return {
        estado: 'pensando',
        turnos: [...l.turnos, { rol: 'usuario', texto }],
        parcial: '',
        diciendo: '',
        error: '',
      }
    }

    case 'conteste': {
      // Si ya se colgó, la respuesta que venía en camino no se dice: alguien
      // apretó «Colgar» justamente para que se callara.
      if (!enCurso(l)) return l
      const texto = e.texto.trim()
      if (texto === '') return { ...l, estado: 'escuchando', parcial: '', diciendo: '' }
      return {
        ...l,
        estado: 'hablando',
        turnos: [...l.turnos, { rol: 'cata', texto }],
        parcial: '',
        diciendo: texto,
      }
    }

    case 'termine_de_hablar':
      // ACÁ ES DONDE ES UNA LLAMADA: termina de hablar y vuelve a escuchar
      // sola, sin que nadie apriete nada.
      //
      // Sólo si todavía estaba hablando: cuando la interrumpieron, la voz
      // avisa igual que terminó —porque la cortaron— y eso no puede pisar la
      // pregunta que ya está en camino.
      if (l.estado !== 'hablando') return l
      return { ...l, estado: 'escuchando', parcial: '', diciendo: '' }

    case 'fallo':
      if (l.estado === 'inactiva') return l
      if (e.cortada === true) {
        return { ...l, estado: 'cortada', parcial: '', diciendo: '', error: e.mensaje }
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
        diciendo: e.mensaje,
        error: e.mensaje,
      }

    case 'colgar':
      // Los turnos QUEDAN: después de colgar se quiere poder leer el SKU que
      // Cata acababa de dictar.
      return { ...l, estado: 'inactiva', parcial: '', diciendo: '' }
  }
}
