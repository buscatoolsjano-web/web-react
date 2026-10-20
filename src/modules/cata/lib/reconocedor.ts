/**
 * El oído de Cata, con `SpeechRecognition` (Fase 85).
 *
 * ── POR QUÉ ÉSTE Y NO WHISPER ───────────────────────────────────────────────
 *
 * El asistente escrito ya sabe transcribir: `proveedor.ts` tiene `transcribir`
 * y manda el audio a Whisper. Eso se paga por minuto y, peor para una llamada,
 * es por tandas: hay que grabar, cortar, subir y esperar. Una conversación con
 * tres segundos de espera entre cada frase no es una conversación.
 *
 * `SpeechRecognition` transcribe mientras se habla, no cuesta nada y ya está
 * en Chrome. Transcribe peor —parte los modelos, escribe las marcas mal—, y
 * eso está asumido: el prompt de Cata se lo dice de frente («lo que te llega
 * es una transcripción de voz y se equivoca»).
 *
 * Lo que sí hay que saber: NO es local. Chrome manda el audio a los servidores
 * de Google para transcribirlo. Por eso Cata no sabe de clientes: lo que se
 * dice por acá sale de la empresa, y mientras lo que se diga sean nombres de
 * productos del catálogo, no hay nada que no esté ya en la web pública.
 *
 * ── LOS TIPOS ───────────────────────────────────────────────────────────────
 *
 * `lib.dom.d.ts` de TypeScript 5.9 trae `SpeechRecognitionResult` y sus
 * hermanos, pero NO `SpeechRecognition` ni su evento: la API todavía no es
 * estándar. Así que se declaran acá, mínimos, en vez de un `any` —que el
 * proyecto no admite— o un `.d.ts` global, que haría parecer que esto es parte
 * del navegador en todas las pantallas.
 */

interface EventoDeResultado extends Event {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultList
}

interface EventoDeError extends Event {
  readonly error: string
}

interface Reconocedor extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: EventoDeResultado) => void) | null
  onerror: ((e: EventoDeError) => void) | null
  onend: (() => void) | null
}

type ConstructorDeReconocedor = new () => Reconocedor

/** El constructor, con el prefijo de Chrome como alternativa. */
function constructor(): ConstructorDeReconocedor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: ConstructorDeReconocedor
    webkitSpeechRecognition?: ConstructorDeReconocedor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Si esta máquina puede escuchar. Lo usa la pantalla para decirlo antes. */
export function hayOido(): boolean {
  return constructor() !== null
}

export interface OidoAbierto {
  /** Abrir el micrófono. Se puede llamar varias veces sin romper nada. */
  escuchar(): void
  /** Dejar de escuchar, sin cerrar el oído: se puede volver a `escuchar()`. */
  pausar(): void
  /** Cerrar del todo. Después de esto el objeto no sirve más. */
  cerrar(): void
}

export interface Oyentes {
  /** Lo que va oyendo, todavía sin cerrar la frase. */
  parcial: (texto: string) => void
  /** Una frase cerrada. */
  frase: (texto: string) => void
  /** Algo falló. `corta` cuando no se puede seguir: sin permiso, sin micrófono. */
  fallo: (mensaje: string, corta: boolean) => void
}

/**
 * Qué se dice de cada error del reconocedor.
 *
 * `not-allowed` y `audio-capture` cortan la llamada: no hay nada que
 * reintentar, falta el permiso o falta el micrófono. Los demás son de una vez
 * —un corte de red, un silencio largo— y la llamada sigue, que es lo que hace
 * el `escuchar()` de `onend`.
 */
const ERRORES: Record<string, { mensaje: string; corta: boolean }> = {
  'not-allowed': {
    mensaje: 'No me diste permiso para usar el micrófono. Está en el candado de la barra.',
    corta: true,
  },
  'service-not-allowed': {
    mensaje: 'El navegador no deja usar el micrófono acá.',
    corta: true,
  },
  'audio-capture': { mensaje: 'No encuentro ningún micrófono conectado.', corta: true },
  network: { mensaje: 'Se cortó la conexión mientras te escuchaba.', corta: false },
  // `no-speech` y `aborted` son lo más común de todo y NO son errores: es el
  // reconocedor cortándose solo tras unos segundos de silencio. No se avisan,
  // se vuelve a escuchar.
}

/**
 * Abrir el oído.
 *
 * ── LO QUE HACE QUE ESTO FUNCIONE ───────────────────────────────────────────
 *
 * `continuous = true` no alcanza: Chrome corta igual a los pocos segundos de
 * silencio y dispara `onend`. Un micrófono que se apaga solo a mitad de una
 * llamada es inservible, así que `onend` vuelve a arrancarlo mientras la
 * llamada siga queriendo escuchar. Eso es lo que convierte una API de «apretá
 * y hablá» en un teléfono abierto.
 *
 * Y `start()` sobre uno que ya está escuchando LANZA. Por eso hay una bandera
 * de si está andando: el `escuchar()` del `onend` y el de la máquina de
 * estados pueden pisarse, y la excepción cortaría la llamada.
 */
export function abrirOido(oyentes: Oyentes): OidoAbierto | null {
  const Ctor = constructor()
  if (Ctor === null) return null

  const r = new Ctor()
  r.lang = 'es-AR'
  r.continuous = true
  r.interimResults = true
  r.maxAlternatives = 1

  let quiere = false
  let andando = false
  let cerrado = false

  const arrancar = () => {
    if (cerrado || andando || !quiere) return
    try {
      r.start()
      andando = true
    } catch {
      // Ya estaba escuchando. No es un problema: era justamente lo que se
      // quería.
      andando = true
    }
  }

  r.onresult = (e) => {
    let parcial = ''
    for (let i = e.resultIndex; i < e.results.length; i += 1) {
      const res = e.results[i]
      const alt = res?.[0]
      if (!res || !alt) continue
      if (res.isFinal) {
        oyentes.frase(alt.transcript)
      } else {
        parcial += alt.transcript
      }
    }
    if (parcial !== '') oyentes.parcial(parcial)
  }

  r.onerror = (e) => {
    const conocido = ERRORES[e.error]
    if (!conocido) return
    if (conocido.corta) quiere = false
    oyentes.fallo(conocido.mensaje, conocido.corta)
  }

  r.onend = () => {
    andando = false
    // Acá está el teléfono abierto: si la llamada sigue, se vuelve a escuchar.
    arrancar()
  }

  return {
    escuchar() {
      quiere = true
      arrancar()
    },
    pausar() {
      quiere = false
      if (andando) r.stop()
    },
    cerrar() {
      quiere = false
      cerrado = true
      r.onresult = null
      r.onerror = null
      r.onend = null
      try {
        r.abort()
      } catch {
        // Cerrando no importa por qué falló.
      }
    },
  }
}
