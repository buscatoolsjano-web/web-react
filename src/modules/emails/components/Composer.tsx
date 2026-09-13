import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { CampoDestinatarios } from './CampoDestinatarios'
import { nuevaClave, useComposer, type OpcionesComposer } from '../hooks/useComposer'
import { TOPE_ADJUNTOS_BYTES, totalAdjuntos } from '../lib/destinatarios'
import { tamanoLegible } from '../lib/formato'
import type { AdjuntoRedaccion, MotivoIncierto } from '../types'
import styles from './Composer.module.css'

export interface ComposerProps {
  opciones: OpcionesComposer
  titulo: string
  onCerrar: () => void
  onEnviado: (gmailThreadId: string) => void
}

/** El envío sin confirmar, según lo que encontró la verificación en Enviados de Gmail. */
const AVISO_INCIERTO: Record<MotivoIncierto, ReactNode> = {
  resultado_perdido: <>No pudimos confirmar si el mail salió. <strong>No lo reenvíes:</strong> verificá en unos segundos.</>,
  sin_coincidencia: <>Todavía no aparece en Enviados de Gmail. Puede tardar unos segundos. <strong>No lo reenvíes</strong> sin revisar Enviados.</>,
  conflicto: <>Hay <strong>más de un mensaje</strong> en Enviados de Gmail para este mismo envío. No marcamos ninguno: revisalo en Gmail.</>,
  busqueda_incompleta: <>No pudimos revisar todos los Enviados de ese momento. <strong>No lo reenvíes:</strong> revisá Enviados en Gmail.</>,
  busqueda_fallida: <>Gmail no respondió al verificar. <strong>No lo reenvíes:</strong> probá verificar de nuevo en un momento.</>,
}

const TITULO_ENVIO: Record<string, string> = {
  nuevo: 'Enviar',
  responder: 'Enviar respuesta',
  responder_todos: 'Responder a todos',
  reenviar: 'Reenviar',
}

function leerArchivo(archivo: File): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader()
    lector.onload = () => resolver(typeof lector.result === 'string' ? (lector.result.split(',')[1] ?? '') : '')
    lector.onerror = () => rechazar(lector.error ?? new Error('No se pudo leer el archivo'))
    lector.readAsDataURL(archivo)
  })
}

/**
 * El composer: nuevo, responder, responder a todos y reenviar.
 *
 * Texto plano. El HTML del mensaje lo arma el servidor escapando lo escrito:
 * no hay editor que pueda colar un `<script>`.
 */
export function Composer({ opciones, titulo, onCerrar, onEnviado }: ComposerProps) {
  const c = useComposer(opciones)
  const idAsunto = useId()
  const idTexto = useId()
  const idArchivos = useId()
  const [mostrarCopias, setMostrarCopias] = useState(false)
  const [pendientes, setPendientes] = useState({ para: false, cc: false, cco: false })
  const [errorAdjunto, setErrorAdjunto] = useState<string | null>(null)
  const avisado = useRef(false)

  const { para, cc, cco, asunto, texto, adjuntos, modo } = c.campos
  const esRespuesta = modo === 'responder' || modo === 'responder_todos'
  const enviando = c.envio.estado === 'enviando' || c.envio.estado === 'en_curso'
  const enviado = c.envio.estado === 'enviado'
  const bloqueado = enviando || enviado || c.cargando
  const hayInvalidos = pendientes.para || pendientes.cc || pendientes.cco

  const hiloEnviado = c.envio.estado === 'enviado' ? c.envio.resultado.gmail_thread_id : null
  useEffect(() => {
    if (!hiloEnviado || avisado.current) return
    avisado.current = true
    onEnviado(hiloEnviado)
  }, [hiloEnviado, onEnviado])

  const agregarArchivos = async (lista: FileList | null) => {
    if (!lista) return
    setErrorAdjunto(null)
    const nuevos: AdjuntoRedaccion[] = []
    let total = totalAdjuntos(adjuntos)
    for (const archivo of Array.from(lista)) {
      total += archivo.size
      if (total > TOPE_ADJUNTOS_BYTES) {
        setErrorAdjunto(`Los adjuntos no pueden sumar más de ${tamanoLegible(TOPE_ADJUNTOS_BYTES)}. «${archivo.name}» no se agregó.`)
        break
      }
      try {
        nuevos.push({ clave: nuevaClave(), tipo: 'nuevo', nombre: archivo.name, mime: archivo.type || 'application/octet-stream', tamano: archivo.size, datos: await leerArchivo(archivo) })
      } catch {
        setErrorAdjunto(`No se pudo leer «${archivo.name}».`)
      }
    }
    if (nuevos.length) c.set.adjuntos([...adjuntos, ...nuevos])
  }

  const descartar = async () => {
    if (c.tieneContenido && !window.confirm('¿Descartar este borrador? Se borra de Gmail y no se puede recuperar.')) return
    try {
      await c.descartar()
    } finally {
      onCerrar()
    }
  }

  const estadoGuardado =
    c.guardado === 'guardando' ? 'Guardando…'
      : c.guardado === 'guardado' ? 'Borrador guardado'
        : c.guardado === 'error' ? 'Borrador no guardado'
          : c.guardado === 'sucio' ? 'Cambios sin guardar'
            : ''

  return (
    <section className={styles.composer} aria-label={titulo}>
      <header className={styles.cabecera}>
        <h2 className={styles.titulo}>{titulo}</h2>
        <span className={c.guardado === 'error' ? styles.estadoError : styles.estado} role="status" aria-live="polite">
          {estadoGuardado}
        </span>
      </header>

      {c.cargando ? <p className={styles.nota}>Recuperando el borrador de Gmail…</p> : null}
      {c.errorCarga ? <p className={styles.aviso} role="alert">{c.errorCarga}</p> : null}
      {c.recreado ? (
        <p className={styles.aviso} role="status">
          El borrador se había borrado fuera del ERP. Se creó uno nuevo con lo que tenías escrito.
        </p>
      ) : null}

      <CampoDestinatarios etiqueta="Para" valores={para} onCambiar={c.set.para} deshabilitado={bloqueado}
        onPendiente={(v) => setPendientes((p) => ({ ...p, para: v }))} />

      {mostrarCopias || cc.length > 0 || cco.length > 0 ? (
        <>
          <CampoDestinatarios etiqueta="Cc" valores={cc} onCambiar={c.set.cc} deshabilitado={bloqueado}
            onPendiente={(v) => setPendientes((p) => ({ ...p, cc: v }))} />
          <CampoDestinatarios etiqueta="Cco" valores={cco} onCambiar={c.set.cco} deshabilitado={bloqueado}
            onPendiente={(v) => setPendientes((p) => ({ ...p, cco: v }))} />
        </>
      ) : (
        <button type="button" className={styles.enlace} onClick={() => setMostrarCopias(true)}>
          Agregar Cc / Cco
        </button>
      )}

      <div className={styles.campo}>
        <label htmlFor={idAsunto} className={styles.etiqueta}>
          Asunto
        </label>
        {esRespuesta ? (
          // Gmail sólo mantiene el hilo si el asunto coincide: en una respuesta no se edita.
          <p id={idAsunto} className={styles.asuntoFijo}>{asunto}</p>
        ) : (
          <input id={idAsunto} className={styles.entrada} value={asunto} maxLength={500} disabled={bloqueado}
            onChange={(e) => c.set.asunto(e.target.value)} />
        )}
      </div>

      <div className={styles.campo}>
        <label htmlFor={idTexto} className={styles.etiqueta}>
          Mensaje
        </label>
        <textarea id={idTexto} className={styles.texto} value={texto} disabled={bloqueado} rows={10}
          onChange={(e) => c.set.texto(e.target.value)} />
        {modo !== 'nuevo' ? (
          <span className={styles.nota}>
            {modo === 'reenviar' ? 'Debajo se agrega el mensaje reenviado, con sus datos.' : 'Debajo se agrega la cita del mensaje al que respondés.'}
          </span>
        ) : null}
      </div>

      <div className={styles.campo}>
        <span className={styles.etiqueta}>Adjuntos</span>
        {adjuntos.length > 0 ? (
          <ul className={styles.adjuntos}>
            {adjuntos.map((a) => (
              <li key={a.clave} className={styles.adjunto}>
                <span className={styles.adjuntoTexto}>
                  <span>{a.nombre}</span>
                  <span className={styles.nota}>
                    {tamanoLegible(a.tamano)}
                    {a.tipo === 'original' ? ' · del mensaje original' : ''}
                  </span>
                </span>
                <button type="button" className={styles.boton} disabled={bloqueado}
                  aria-label={`Quitar el adjunto ${a.nombre}`}
                  onClick={() => c.set.adjuntos(adjuntos.filter((x) => x.clave !== a.clave))}>
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <label htmlFor={idArchivos} className={styles.botonArchivo} aria-disabled={bloqueado}>
          Adjuntar archivos
          <input id={idArchivos} type="file" multiple className={styles.oculto} disabled={bloqueado}
            onChange={(e) => {
              void agregarArchivos(e.target.files)
              e.target.value = ''
            }} />
        </label>
        <span className={styles.nota}>Hasta {tamanoLegible(TOPE_ADJUNTOS_BYTES)} en total.</span>
        {errorAdjunto ? <span className={styles.error} role="alert">{errorAdjunto}</span> : null}
      </div>

      {c.errorGuardado ? (
        <p className={styles.aviso} role="alert">
          {c.errorGuardado} Lo escrito sigue acá.{' '}
          <button type="button" className={styles.enlace} onClick={() => void c.guardarAhora()}>Reintentar guardado</button>
        </p>
      ) : null}

      {c.envio.estado === 'incierto' ? (
        <p className={styles.aviso} role="alert">
          {AVISO_INCIERTO[c.envio.motivo]}{' '}
          <button type="button" className={styles.enlace} onClick={() => void c.comprobar()}>Verificar</button>
        </p>
      ) : null}
      {c.envio.estado === 'error' ? <p className={styles.aviso} role="alert">{c.envio.mensaje}</p> : null}
      {hayInvalidos ? <p className={styles.error} role="alert">Corregí las direcciones marcadas antes de enviar.</p> : null}

      <footer className={styles.acciones}>
        {enviado ? (
          <span className={styles.enviado} role="status">Enviado</span>
        ) : (
          <button type="button" className={styles.botonPrimario} disabled={bloqueado || hayInvalidos || c.envio.estado === 'incierto'}
            onClick={() => void c.enviarAhora()}>
            {enviando ? 'Enviando…' : TITULO_ENVIO[modo]}
          </button>
        )}
        {!enviado ? (
          <button type="button" className={styles.boton} disabled={enviando} onClick={() => void descartar()}>
            Descartar
          </button>
        ) : null}
        {!enviado && c.guardado !== 'guardado' && c.guardado !== 'inicial' ? (
          <button type="button" className={styles.boton} disabled={bloqueado || c.guardado === 'guardando'} onClick={() => void c.guardarAhora()}>
            Guardar borrador
          </button>
        ) : null}
        {!enviado ? (
          <button type="button" className={styles.boton} disabled={enviando} onClick={onCerrar}>
            Cerrar
          </button>
        ) : null}
      </footer>
    </section>
  )
}
