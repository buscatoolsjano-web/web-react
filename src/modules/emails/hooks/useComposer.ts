import { useCallback, useEffect, useRef, useState } from 'react'
import { ErrorContenido, mensajeDeError } from '../lib/errores'
import { ASUNTO, destinatariosIniciales, sinDuplicados } from '../lib/destinatarios'
import {
  descartarBorrador,
  enviar,
  guardarBorrador,
  obtenerBorrador,
  type DatosRedaccion,
} from '../services/redactar'
import type { AdjuntoRedaccion, MensajeContenido, ModoRedaccion, ResultadoEnvio, MotivoIncierto } from '../types'

/**
 * El composer: estado del formulario, autoguardado en Gmail y envío idempotente.
 *
 *  · El formulario es memoria del componente. **La persistencia es el borrador de
 *    Gmail**: su id va en la URL (`borrador=`), así un refresh lo recupera.
 *  · Autoguardado con debounce de 2,5 s y UNA sola escritura en vuelo: si la
 *    persona sigue tipeando mientras se guarda, al terminar se guarda de nuevo.
 *    Nunca dos `create` en carrera para el mismo composer.
 *  · El `client_request_id` se genera UNA vez, al primer «Enviar», y va a la URL
 *    (`envio=`). Un doble click, un reintento o un refresh a mitad de envío usan
 *    el mismo id: el backend no manda dos veces.
 */

export const DEBOUNCE_GUARDADO_MS = 2_500

export type EstadoGuardado = 'inicial' | 'sucio' | 'guardando' | 'guardado' | 'error'
export type EstadoEnvioUi =
  | { estado: 'idle' }
  | { estado: 'enviando' }
  | { estado: 'en_curso' }
  | { estado: 'enviado'; resultado: Extract<ResultadoEnvio, { estado: 'enviado' }> }
  | { estado: 'incierto'; motivo: MotivoIncierto }
  | { estado: 'error'; mensaje: string }

export interface OpcionesComposer {
  accountId: string
  propia: string
  modo: ModoRedaccion
  threadId: string | null
  refMensaje: MensajeContenido | null
  draftId: string | null
  clientRequestId: string | null
  /** Refleja borrador y envío en la URL; `null` los quita. */
  alCambiarUrl: (cambios: { borrador?: string | null; envio?: string | null }) => void
}

let contadorClaves = 0
export const nuevaClave = () => `adj-${Date.now()}-${++contadorClaves}`

/** Valores iniciales de un composer SIN borrador: los de la respuesta o el reenvío. */
export function valoresIniciales(o: Pick<OpcionesComposer, 'modo' | 'refMensaje' | 'propia'>) {
  const ref = o.refMensaje
  if (ref && (o.modo === 'responder' || o.modo === 'responder_todos')) {
    const d = destinatariosIniciales(o.modo, ref, o.propia)
    return { para: d.para, cc: d.cc, asunto: ASUNTO.respuesta(ref.asunto), adjuntos: [] as AdjuntoRedaccion[] }
  }
  if (ref && o.modo === 'reenviar') {
    return {
      para: [],
      cc: [],
      asunto: ASUNTO.reenvio(ref.asunto),
      adjuntos: ref.adjuntos
        .filter((a) => !a.inline)
        .map<AdjuntoRedaccion>((a) => ({ clave: nuevaClave(), tipo: 'original', nombre: a.nombre, mime: a.mime, tamano: a.tamano, messageId: ref.id, partId: a.partId })),
    }
  }
  return { para: [], cc: [], asunto: '', adjuntos: [] as AdjuntoRedaccion[] }
}

export function useComposer(o: OpcionesComposer) {
  const [iniciales] = useState(() => (o.draftId ? null : valoresIniciales(o)))
  const [para, setPara] = useState<string[]>(iniciales?.para ?? [])
  const [cc, setCc] = useState<string[]>(iniciales?.cc ?? [])
  const [cco, setCco] = useState<string[]>([])
  const [asunto, setAsunto] = useState(iniciales?.asunto ?? '')
  const [texto, setTexto] = useState('')
  const [adjuntos, setAdjuntos] = useState<AdjuntoRedaccion[]>(iniciales?.adjuntos ?? [])
  const [modo, setModo] = useState<ModoRedaccion>(o.modo)
  const [threadId, setThreadId] = useState<string | null>(o.threadId)
  const [refMessageId, setRefMessageId] = useState<string | null>(o.refMensaje?.id ?? null)
  const [draftId, setDraftId] = useState<string | null>(o.draftId)
  const [guardado, setGuardado] = useState<EstadoGuardado>(o.draftId ? 'guardado' : 'inicial')
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null)
  const [recreado, setRecreado] = useState(false)
  const [cargando, setCargando] = useState(!!o.draftId)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [envio, setEnvio] = useState<EstadoEnvioUi>(o.clientRequestId ? { estado: 'en_curso' } : { estado: 'idle' })
  const [version, setVersion] = useState(0)

  const crid = useRef<string | null>(o.clientRequestId)
  const enVuelo = useRef<Promise<void> | null>(null)
  const pendiente = useRef(false)
  const draftRef = useRef<string | null>(o.draftId)
  const envioRef = useRef<EstadoEnvioUi>(envio)
  const actual = useRef<DatosRedaccion | null>(null)
  const opcionesRef = useRef(o)
  const enviarRef = useRef<(forzar: boolean) => Promise<void>>(() => Promise.resolve())

  // Los refs se sincronizan DESPUÉS del render: las funciones de guardar y enviar
  // leen siempre lo último que la persona escribió.
  useEffect(() => {
    envioRef.current = envio
  }, [envio])
  useEffect(() => {
    opcionesRef.current = o
  }, [o])
  useEffect(() => {
    actual.current = {
      accountId: o.accountId, modo, threadId, refMessageId, draftId,
      ...sinDuplicados(para, cc, cco), asunto, texto, adjuntos,
    }
  }, [o.accountId, modo, threadId, refMessageId, draftId, para, cc, cco, asunto, texto, adjuntos])

  // ── Recuperar un borrador de Gmail ───────────────────────────────────────
  useEffect(() => {
    if (!o.draftId) return
    let vivo = true
    obtenerBorrador(o.accountId, o.draftId, { modo: o.modo, refMessageId: o.refMensaje?.id ?? null, threadId: o.threadId })
      .then((b) => {
        if (!vivo) return
        setModo(b.modo)
        setThreadId(b.thread_id)
        setRefMessageId(b.ref_message_id)
        setPara(b.para)
        setCc(b.cc)
        setCco(b.cco)
        setAsunto(b.asunto)
        setTexto(b.texto)
        setAdjuntos(b.adjuntos.map((a) => ({ clave: nuevaClave(), tipo: 'borrador', nombre: a.nombre, mime: a.mime, tamano: a.tamano, partId: a.part_id })))
      })
      .catch((e: unknown) => {
        if (!vivo) return
        const codigo = e instanceof ErrorContenido ? e.codigo : 'desconocido'
        // El borrador desapareció fuera del ERP: se sigue con uno nuevo, avisando.
        if (codigo === 'borrador_no_disponible' || (e instanceof ErrorContenido && e.status === 404)) {
          draftRef.current = null
          setDraftId(null)
          setGuardado('inicial')
          opcionesRef.current.alCambiarUrl({ borrador: null })
          setErrorCarga('El borrador ya no existe en Gmail. Empezás uno nuevo.')
        } else {
          setErrorCarga(mensajeDeError(codigo))
        }
      })
      .finally(() => {
        if (vivo) setCargando(false)
      })
    return () => {
      vivo = false
    }
    // Sólo al montar: el borrador inicial no cambia durante la vida del composer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const editar = useCallback(<T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setGuardado('sucio')
    setVersion((n) => n + 1)
  }, [])

  // ── Autoguardado ──────────────────────────────────────────────────────────
  const guardar = useCallback(async (): Promise<void> => {
    if (enVuelo.current) {
      pendiente.current = true
      return enVuelo.current
    }
    const e = envioRef.current.estado
    if (e === 'enviando' || e === 'enviado' || e === 'en_curso') return
    const datos = actual.current
    if (!datos) return
    const tieneAlgo =
      datos.para.length + datos.cc.length + datos.cco.length > 0 ||
      datos.texto.trim() !== '' ||
      datos.adjuntos.length > 0 ||
      (datos.modo === 'nuevo' && datos.asunto.trim() !== '')
    if (!tieneAlgo && !draftRef.current) return

    const foto = datos.adjuntos.map((a) => a.clave)
    setGuardado('guardando')
    const trabajo = (async () => {
      try {
        const r = await guardarBorrador({ ...datos, draftId: draftRef.current })
        if (r.draft_id !== draftRef.current) {
          draftRef.current = r.draft_id
          setDraftId(r.draft_id)
          opcionesRef.current.alCambiarUrl({ borrador: r.draft_id })
        }
        if (r.recreado) setRecreado(true)
        // Los adjuntos que viajaron pasan a ser referencias del borrador (los
        // partId cambian con cada update). Lo agregado mientras tanto se conserva.
        setAdjuntos((previos) => {
          const porClave = new Map(foto.map((clave, i) => [clave, r.adjuntos[i]]))
          return previos.map((a) => {
            const srv = porClave.get(a.clave)
            return srv ? { clave: a.clave, tipo: 'borrador', nombre: srv.nombre, mime: srv.mime, tamano: srv.tamano, partId: srv.part_id } : a
          })
        })
        setErrorGuardado(null)
        setGuardado(pendiente.current ? 'sucio' : 'guardado')
      } catch (err) {
        setErrorGuardado(mensajeDeError(err instanceof ErrorContenido ? err.codigo : 'desconocido'))
        setGuardado('error')
      } finally {
        enVuelo.current = null
        if (pendiente.current) {
          pendiente.current = false
          setVersion((n) => n + 1)
        }
      }
    })()
    enVuelo.current = trabajo
    return trabajo
  }, [])

  useEffect(() => {
    if (version === 0 || guardado !== 'sucio') return
    const t = setTimeout(() => void guardar(), DEBOUNCE_GUARDADO_MS)
    return () => clearTimeout(t)
  }, [version, guardado, guardar])

  // Cerrar la pestaña con cambios sin guardar: se intenta guardar y se avisa. No
  // hay forma de garantizar un guardado síncrono al cerrar; se dice así.
  useEffect(() => {
    const riesgo = guardado === 'sucio' || guardado === 'guardando' || guardado === 'error' || envio.estado === 'enviando'
    if (!riesgo) return
    const alSalir = (ev: BeforeUnloadEvent) => {
      void guardar()
      ev.preventDefault()
      ev.returnValue = ''
    }
    window.addEventListener('beforeunload', alSalir)
    return () => window.removeEventListener('beforeunload', alSalir)
  }, [guardado, envio.estado, guardar])

  // ── Envío ─────────────────────────────────────────────────────────────────
  const reintentos = useRef(0)
  /**
   * `forzar` se usa sólo para VERIFICAR un envío ya iniciado (en curso o
   * incierto): el mismo client_request_id, así que nunca es un envío nuevo.
   */
  const enviarAhora = useCallback(async (forzar = false): Promise<void> => {
    const e = envioRef.current.estado
    if (e === 'enviado' || (!forzar && e === 'enviando')) return
    const datos = actual.current
    if (!datos) return
    if (datos.para.length + datos.cc.length + datos.cco.length === 0) {
      setEnvio({ estado: 'error', mensaje: 'Agregá al menos un destinatario.' })
      return
    }
    if (!crid.current) {
      crid.current = crypto.randomUUID()
      opcionesRef.current.alCambiarUrl({ envio: crid.current })
    }
    const idEnvio = crid.current
    envioRef.current = { estado: 'enviando' }
    setEnvio({ estado: 'enviando' })
    // Un guardado en vuelo termina antes: el envío usa sus referencias de adjuntos.
    if (enVuelo.current) await enVuelo.current.catch(() => undefined)
    try {
      const r = await enviar({ ...actual.current!, draftId: draftRef.current }, idEnvio)
      if (r.estado === 'enviado') {
        envioRef.current = { estado: 'enviado', resultado: r }
        setEnvio({ estado: 'enviado', resultado: r })
        opcionesRef.current.alCambiarUrl({ envio: null, borrador: null })
      } else if (r.estado === 'en_curso') {
        setEnvio({ estado: 'en_curso' })
        if (reintentos.current++ < 10) setTimeout(() => void enviarRef.current(true), 3_000)
      } else if (r.estado === 'incierto') {
        setEnvio({ estado: 'incierto', motivo: r.motivo })
      } else {
        setEnvio({ estado: 'error', mensaje: 'Gmail rechazó el mensaje. Revisá los destinatarios y los adjuntos.' })
      }
    } catch (err) {
      setEnvio({ estado: 'error', mensaje: mensajeDeError(err instanceof ErrorContenido ? err.codigo : 'desconocido') })
    }
  }, [])

  useEffect(() => {
    enviarRef.current = enviarAhora
  }, [enviarAhora])

  /** Mismo client_request_id: verifica o reconcilia. Nunca un envío nuevo. */
  const comprobar = useCallback(() => enviarAhora(true), [enviarAhora])

  // Si la URL ya traía un envío (refresh a mitad de envío), se verifica al cargar.
  const verificadoAlCargar = useRef(false)
  useEffect(() => {
    if (verificadoAlCargar.current || !o.clientRequestId || cargando) return
    verificadoAlCargar.current = true
    void comprobar()
  }, [o.clientRequestId, cargando, comprobar])

  const descartar = useCallback(async () => {
    if (enVuelo.current) await enVuelo.current.catch(() => undefined)
    if (draftRef.current) await descartarBorrador(opcionesRef.current.accountId, draftRef.current)
    opcionesRef.current.alCambiarUrl({ borrador: null, envio: null })
  }, [])

  const tieneContenido =
    texto.trim() !== '' || adjuntos.length > 0 || (modo === 'nuevo' && (para.length + cc.length + cco.length > 0 || asunto.trim() !== ''))

  return {
    campos: { para, cc, cco, asunto, texto, adjuntos, modo, threadId, refMessageId, draftId },
    set: {
      para: editar(setPara),
      cc: editar(setCc),
      cco: editar(setCco),
      asunto: editar(setAsunto),
      texto: editar(setTexto),
      adjuntos: editar(setAdjuntos),
    },
    guardado,
    errorGuardado,
    recreado,
    cargando,
    errorCarga,
    envio,
    tieneContenido,
    guardarAhora: guardar,
    enviarAhora: () => enviarAhora(false),
    comprobar,
    descartar,
  }
}
