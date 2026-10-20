import { useCallback, useEffect, useReducer, useRef } from 'react'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { DESPEDIDA, SALUDO, textoParaDecir } from '../lib/dicho'
import {
  escucha,
  historial,
  type EventoLlamada,
  type Llamada,
  LLAMADA_INICIAL,
  siguiente,
} from '../lib/llamada'
import { abrirOido, hayOido, type OidoAbierto } from '../lib/reconocedor'
import { callar, decir, hayVoz } from '../lib/voz'
import { FalloCata, hablarConCata } from '../services/cata'

/**
 * La llamada, cableada (Fase 85).
 *
 * Todo lo que decide está en `lib/llamada.ts`, que es puro y tiene sus
 * pruebas. Esto es sólo el cable: abre el micrófono cuando el estado dice
 * «escuchando», lo cierra cuando no, manda lo que se oyó y dice lo que vuelve.
 *
 * ── LA REF QUE PARECE DE MÁS Y NO LO ES ─────────────────────────────────────
 *
 * El oído vive en una `ref` y no en el estado porque sus avisos —`onresult`,
 * `onend`— llegan desde fuera de React, en cualquier momento, incluso después
 * de que el componente se desmontó. Si fuera estado, cada aviso dispararía un
 * pintado y el reconocedor se recrearía a mitad de una frase.
 *
 * Y los turnos también van en una `ref` además del estado: cuando llega una
 * frase hay que mandar la conversación ENTERA, y el `dispatch` de React es
 * asincrónico —el estado nuevo no está disponible en la misma vuelta—. Sin la
 * ref, la consulta viajaría siempre un turno atrasada.
 */
export interface LlamadaEnCurso extends Llamada {
  /** Si esta máquina puede siquiera llamar. */
  sePuede: boolean
  /** Por qué no se puede, para decirlo antes de que alguien lo intente. */
  porQueNo: string
  llamar: () => void
  colgar: () => void
}

export function useLlamada(): LlamadaEnCurso {
  const companyId = useEmpresa().activa?.companyId ?? null
  const [llamada, despachar] = useReducer(siguiente, LLAMADA_INICIAL)

  const oido = useRef<OidoAbierto | null>(null)
  /** El estado de verdad, para los avisos que llegan de afuera de React. */
  const actual = useRef<Llamada>(LLAMADA_INICIAL)
  /** Para no decir dos veces la misma respuesta si React vuelve a pintar. */
  const yaDicho = useRef<number>(0)
  const vivo = useRef(true)

  const sePuede = hayOido() && hayVoz() && companyId !== null
  const porQueNo = !hayOido()
    ? 'Este navegador no puede escuchar. Probá con Chrome.'
    : !hayVoz()
      ? 'Este navegador no puede hablar. Probá con Chrome.'
      : companyId === null
        ? 'Elegí una empresa antes de llamar.'
        : ''

  /**
   * Despachar y guardar. Siempre juntos: el estado de React es para pintar y
   * la ref es para los avisos de afuera, y que se separen es el bug que no se
   * ve hasta que falta un turno en la consulta.
   */
  const paso = useCallback((e: EventoLlamada) => {
    if (!vivo.current) return
    actual.current = siguiente(actual.current, e)
    despachar(e)
  }, [])

  /** El micrófono sigue al estado: abierto sólo mientras se escucha. */
  useEffect(() => {
    if (!oido.current) return
    if (escucha(llamada)) oido.current.escuchar()
    else oido.current.pausar()
  }, [llamada])

  /**
   * Lo que se dice en voz alta, y la consulta.
   *
   * Las dos cosas cuelgan del MISMO efecto, que mira el último turno, porque
   * las dos son consecuencia de lo mismo: apareció un turno nuevo. Separarlas
   * en dos efectos haría que un fallo de la consulta pudiera llegar antes de
   * que la voz terminara de decir la respuesta anterior.
   *
   * `yaDicho` cuenta turnos ya atendidos: React puede volver a pintar por
   * cualquier motivo y sin eso la misma respuesta se diría dos veces.
   */
  useEffect(() => {
    const n = llamada.turnos.length
    if (n === 0 || n === yaDicho.current) return
    const ultimo = llamada.turnos[n - 1]
    if (!ultimo) return
    yaDicho.current = n

    if (ultimo.rol === 'cata') {
      // Lo que se MUESTRA es el texto tal cual; lo que se DICE va limpio de
      // asteriscos. Ver `lib/dicho.ts`.
      void decir(textoParaDecir(ultimo.texto)).then(() => paso({ tipo: 'termine_de_hablar' }))
      return
    }

    if (companyId === null) return
    void hablarConCata({ companyId, turnos: historial(actual.current) })
      .then((r) => paso({ tipo: 'conteste', texto: r.texto }))
      .catch((e: unknown) => {
        if (e instanceof FalloCata) {
          // Lo que se dice no es lo que se muestra: ver `QUE_DECIR` en el
          // servicio. Y el `error` queda en el estado para la pantalla.
          paso({ tipo: 'fallo', mensaje: e.corta ? e.message : e.dicho, cortada: e.corta })
          if (e.corta) void decir(textoParaDecir(e.dicho))
          return
        }
        paso({ tipo: 'fallo', mensaje: 'Se me cortó la línea con el sistema. Probá de nuevo.' })
      })
  }, [llamada.turnos, companyId, paso])

  const llamar = useCallback(() => {
    if (!sePuede) return

    // El oído se abre una vez y se reusa: crear un `SpeechRecognition` nuevo
    // por llamada vuelve a pedir el permiso del micrófono en algunos
    // navegadores, y eso delante de alguien que ya apretó «Llamar» parece que
    // algo se rompió.
    oido.current ??= abrirOido({
      parcial: (texto) => paso({ tipo: 'oyendo', texto }),
      frase: (texto) => paso({ tipo: 'escuche', texto }),
      fallo: (mensaje, corta) => paso({ tipo: 'fallo', mensaje, cortada: corta }),
    })
    if (!oido.current) return

    yaDicho.current = 0
    paso({ tipo: 'atender' })
    // El saludo se dice sin pasar por los turnos: no es una respuesta a nada y
    // no tiene que viajar como contexto al modelo. Y se dice MIENTRAS el
    // micrófono ya está abierto, porque lo normal es que alguien hable encima.
    void decir(SALUDO)
  }, [sePuede, paso])

  const colgar = useCallback(() => {
    paso({ tipo: 'colgar' })
    oido.current?.pausar()
    callar()
    void decir(DESPEDIDA)
  }, [paso])

  /** Al desmontar: el micrófono se cierra y la voz se calla. Sin excepciones. */
  useEffect(() => {
    vivo.current = true
    return () => {
      vivo.current = false
      oido.current?.cerrar()
      oido.current = null
      callar()
    }
  }, [])

  return { ...llamada, sePuede, porQueNo, llamar, colgar }
}
