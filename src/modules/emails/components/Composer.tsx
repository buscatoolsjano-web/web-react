import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Field } from '@/components/forms/Field'
import { Input, Textarea } from '@/components/forms/controls'
import { Alert } from '@/components/feedback/Alert'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Spinner } from '@/components/ui/Spinner'
import { Icon } from '@/components/icons/Icon'
import { CampoDestinatarios } from './CampoDestinatarios'
import { nuevaClave, useComposer, type OpcionesComposer } from '../hooks/useComposer'
import { TOPE_ADJUNTOS_BYTES, totalAdjuntos } from '../lib/destinatarios'
import { tamanoLegible } from '../lib/formato'
import type { AdjuntoRedaccion, MotivoIncierto } from '../types'
import styles from './Composer.module.css'

export interface ComposerProps {
  opciones: OpcionesComposer
  titulo: string
  /** Sin título visible cuando la página ya lo dice en su encabezado. */
  mostrarTitulo?: boolean
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
 *
 * Fase 13 · E5: sólo presentación. El autoguardado, la idempotencia del envío
 * (`client_request_id`), la conciliación de inciertos y los borradores siguen
 * en `useComposer` sin cambios. Descartar con contenido pide confirmación en
 * un `ConfirmDialog` (antes `window.confirm`) con el mismo texto y la misma
 * consecuencia.
 */
export function Composer({ opciones, titulo, mostrarTitulo = true, onCerrar, onEnviado }: ComposerProps) {
  const c = useComposer(opciones)
  const idArchivos = useId()
  const [mostrarCopias, setMostrarCopias] = useState(false)
  const [pendientes, setPendientes] = useState({ para: false, cc: false, cco: false })
  const [errorAdjunto, setErrorAdjunto] = useState<string | null>(null)
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false)
  const [descartando, setDescartando] = useState(false)
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

  // Igual que antes: sin contenido se descarta directo; con contenido, se confirma.
  const ejecutarDescarte = async () => {
    setDescartando(true)
    try {
      await c.descartar()
    } finally {
      setDescartando(false)
      setConfirmandoDescarte(false)
      onCerrar()
    }
  }
  const descartar = () => {
    if (c.tieneContenido) setConfirmandoDescarte(true)
    else void ejecutarDescarte()
  }

  const estadoGuardado =
    c.guardado === 'guardando' ? (
      <>
        <Spinner size={16} /> Guardando…
      </>
    ) : c.guardado === 'guardado' ? (
      <>
        <Icon name="check" size={16} /> Borrador guardado
      </>
    ) : c.guardado === 'error' ? (
      <>
        <Icon name="alert-circle" size={16} /> Borrador no guardado
      </>
    ) : c.guardado === 'sucio' ? (
      'Cambios sin guardar'
    ) : (
      ''
    )

  return (
    <section className={styles.composer} aria-label={titulo}>
      <header className={mostrarTitulo ? styles.cabecera : styles.cabeceraSinTitulo}>
        {mostrarTitulo ? <h2 className={styles.titulo}>{titulo}</h2> : null}
        <span className={c.guardado === 'error' ? styles.estadoError : styles.estado} role="status" aria-live="polite">
          {estadoGuardado}
        </span>
      </header>

      {c.cargando ? (
        <p className={styles.estado} role="status">
          <Spinner size={16} /> Recuperando el borrador de Gmail…
        </p>
      ) : null}
      {c.errorCarga ? (
        <Alert tone="danger" role="alert" title="No se pudo recuperar el borrador">
          <p>{c.errorCarga}</p>
        </Alert>
      ) : null}
      {c.recreado ? (
        <Alert tone="info" role="status" title="Borrador recreado">
          <p>El borrador se había borrado fuera del ERP. Se creó uno nuevo con lo que tenías escrito.</p>
        </Alert>
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
        <Button variant="ghost" size="sm" className={styles.inicio} icon={<Icon name="plus" size={16} />} onClick={() => setMostrarCopias(true)}>
          Agregar Cc / Cco
        </Button>
      )}

      {esRespuesta ? (
        // Gmail sólo mantiene el hilo si el asunto coincide: en una respuesta no se edita.
        <div className={styles.campo}>
          <span className={styles.etiqueta}>Asunto</span>
          <p className={styles.asuntoFijo}>{asunto}</p>
        </div>
      ) : (
        <Field label="Asunto">
          <Input value={asunto} maxLength={500} disabled={bloqueado} onChange={(e) => c.set.asunto(e.target.value)} />
        </Field>
      )}

      <Field
        label="Mensaje"
        help={
          modo !== 'nuevo'
            ? modo === 'reenviar'
              ? 'Debajo se agrega el mensaje reenviado, con sus datos.'
              : 'Debajo se agrega la cita del mensaje al que respondés.'
            : undefined
        }
      >
        <Textarea className={styles.texto} value={texto} disabled={bloqueado} rows={10} onChange={(e) => c.set.texto(e.target.value)} />
      </Field>

      <div className={styles.campo}>
        <span className={styles.etiqueta}>Adjuntos</span>
        {adjuntos.length > 0 ? (
          <ul className={styles.adjuntos}>
            {adjuntos.map((a) => (
              <li key={a.clave} className={styles.adjunto}>
                <Icon name="paperclip" size={16} className={styles.adjuntoIcono} />
                <span className={styles.adjuntoTexto}>
                  <span>{a.nombre}</span>
                  <span className={styles.nota}>
                    {tamanoLegible(a.tamano)}
                    {a.tipo === 'original' ? ' · del mensaje original' : ''}
                  </span>
                </span>
                <IconButton icon="x" size="sm" disabled={bloqueado}
                  aria-label={`Quitar el adjunto ${a.nombre}`}
                  onClick={() => c.set.adjuntos(adjuntos.filter((x) => x.clave !== a.clave))} />
              </li>
            ))}
          </ul>
        ) : null}
        <label htmlFor={idArchivos} className={styles.botonArchivo} aria-disabled={bloqueado}>
          <Icon name="upload" size={16} />
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
        <Alert
          tone="warning"
          role="alert"
          title="El borrador no se guardó"
          action={
            <Button variant="secondary" size="sm" onClick={() => void c.guardarAhora()}>
              Reintentar guardado
            </Button>
          }
        >
          <p>{c.errorGuardado} Lo escrito sigue acá.</p>
        </Alert>
      ) : null}

      {c.envio.estado === 'incierto' ? (
        <Alert
          tone="warning"
          role="alert"
          title="Envío sin confirmar"
          action={
            <Button variant="secondary" size="sm" onClick={() => void c.comprobar()}>
              Verificar
            </Button>
          }
        >
          <p>{AVISO_INCIERTO[c.envio.motivo]}</p>
        </Alert>
      ) : null}
      {c.envio.estado === 'error' ? (
        <Alert tone="danger" role="alert" title="No se pudo enviar">
          <p>{c.envio.mensaje}</p>
        </Alert>
      ) : null}
      {hayInvalidos ? <p className={styles.error} role="alert">Corregí las direcciones marcadas antes de enviar.</p> : null}

      <footer className={styles.acciones}>
        {enviado ? (
          <span className={styles.enviado} role="status">
            <Icon name="check-circle" size={20} /> Enviado
          </span>
        ) : (
          <Button variant="primary" loading={enviando} disabled={bloqueado || hayInvalidos || c.envio.estado === 'incierto'}
            icon={<Icon name="arrow-right" size={16} />}
            onClick={() => void c.enviarAhora()}>
            {enviando ? 'Enviando…' : TITULO_ENVIO[modo]}
          </Button>
        )}
        {!enviado && c.guardado !== 'guardado' && c.guardado !== 'inicial' ? (
          <Button variant="secondary" disabled={bloqueado || c.guardado === 'guardando'} onClick={() => void c.guardarAhora()}>
            Guardar borrador
          </Button>
        ) : null}
        {!enviado ? (
          <Button variant="ghost" disabled={enviando} onClick={onCerrar}>
            Cerrar
          </Button>
        ) : null}
        {!enviado ? (
          <Button variant="ghost" className={styles.peligro} icon={<Icon name="trash" size={16} />} disabled={enviando} onClick={descartar}>
            Descartar
          </Button>
        ) : null}
      </footer>

      <ConfirmDialog
        open={confirmandoDescarte}
        tone="danger"
        title="¿Descartar este borrador?"
        description="Se borra de Gmail y no se puede recuperar."
        confirmLabel="Descartar borrador"
        cancelLabel="Volver"
        busy={descartando}
        onConfirm={() => void ejecutarDescarte()}
        onCancel={() => setConfirmandoDescarte(false)}
      />
    </section>
  )
}
