import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { esVideo, limiteDe } from '../services/adjuntos'
import styles from './CapturaFotosIngreso.module.css'

export interface CapturaFotosIngresoProps {
  fotos: File[]
  onCambio: (fotos: File[]) => void
  deshabilitado?: boolean
}

/** Lo más largo que se deja grabar de una vez: ~30 MB a la tasa de abajo. */
const MAX_SEGUNDOS = 120
/** ~2 Mbps: se ve bien una placa o un ruido y no se pasa del tope del bucket. */
const BITS_POR_SEGUNDO = 2_000_000

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/**
 * El formato que graba ESTE navegador. Safari/iPhone graba mp4; Chrome y
 * Android, webm. Se pide el primero que soporte, y si no hay forma de saberlo
 * se deja elegir al navegador.
 */
function formatoDeGrabacion(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined
  return ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) =>
    MediaRecorder.isTypeSupported(t),
  )
}

/**
 * Fotos y videos del ingreso: sacar con la cámara, grabar, o adjuntar desde el
 * equipo (Fase 212 · video en la Fase 228).
 *
 * Un servicio técnico necesita dejar registrado CÓMO llegó la máquina. La foto
 * muestra golpes y placas; el video, además, el ruido de un motor o una falla
 * que aparece al andar. Tres caminos:
 *
 *   · **Sacar foto**: abre la cámara (`getUserMedia`, la trasera en el
 *     teléfono), muestra el vivo y captura un cuadro a JPEG.
 *   · **Grabar video**: la misma cámara, con sonido si hay permiso de
 *     micrófono, grabada con `MediaRecorder`. Corta sola a los 2 minutos.
 *   · **Adjuntar**: imágenes o videos que ya están en el equipo. Varios de una.
 *
 * Al cerrar, la cámara se apaga (corta el stream): no queda la luz prendida.
 * Todo se junta acá como borrador; recién se sube cuando la orden se crea y
 * tiene id, por el mismo camino que cualquier adjunto (`subirAdjunto`, bucket
 * privado).
 *
 * Las reglas de hooks del repo: abrir/cerrar, capturar y grabar van en los
 * event handlers; los efectos sólo conectan el stream al `<video>` y limpian al
 * desmontar, sin setState.
 */
export function CapturaFotosIngreso({ fotos, onCambio, deshabilitado = false }: CapturaFotosIngresoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const grabadorRef = useRef<MediaRecorder | null>(null)
  const relojRef = useRef<number | null>(null)
  const inicioRef = useRef(0)
  // `null` = cámara cerrada; si no, para qué se abrió.
  const [camara, setCamara] = useState<'foto' | 'video' | null>(null)
  const [grabando, setGrabando] = useState(false)
  const [segundos, setSegundos] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // El archivo abierto a tamaño completo en el visor (índice), o null si cerrado.
  const [ampliada, setAmpliada] = useState<number | null>(null)

  // Una URL por archivo, para la miniatura y el visor. Se revocan al cambiar o
  // desmontar para no filtrar memoria.
  const urls = useMemo(() => fotos.map((f) => URL.createObjectURL(f)), [fotos])
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls])

  // Conecta el stream al elemento de video cuando la cámara se abre. Sin
  // setState: sólo se asigna `srcObject`, que es un efecto del DOM.
  useEffect(() => {
    const v = videoRef.current
    if (camara !== null && v && streamRef.current) v.srcObject = streamRef.current
  }, [camara])

  // Al desmontar, cortar la grabación y apagar la cámara pase lo que pase.
  useEffect(
    () => () => {
      if (relojRef.current !== null) window.clearInterval(relojRef.current)
      const g = grabadorRef.current
      if (g && g.state !== 'inactive') {
        g.ondataavailable = null
        g.onstop = null
        g.stop()
      }
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    },
    [],
  )

  const agregar = (nuevas: File[]) => {
    const validas = nuevas.filter(
      (f) => (f.type.startsWith('image/') || esVideo(f)) && f.size <= limiteDe(f),
    )
    const rechazadas = nuevas.length - validas.length
    if (rechazadas > 0) {
      setError(
        `Se ignoraron ${rechazadas} archivo(s): sólo imágenes de hasta 20 MB o videos de hasta 50 MB.`,
      )
    } else {
      setError(null)
    }
    if (validas.length > 0) onCambio([...fotos, ...validas])
  }

  const abrirCamara = async (modo: 'foto' | 'video') => {
    setError(null)
    const video = { facingMode: 'environment' }
    try {
      let stream: MediaStream
      if (modo === 'video') {
        // Con sonido si se puede: el ruido de la máquina es parte del ingreso.
        // Sin permiso de micrófono se graba igual, mudo.
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video, audio: true })
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video, audio: false })
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: false })
      }
      streamRef.current = stream
      setCamara(modo)
    } catch {
      setError(
        'No se pudo abrir la cámara. Revisá el permiso del navegador, o adjuntá el archivo desde el equipo.',
      )
    }
  }

  const cerrarCamara = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCamara(null)
  }

  const capturar = () => {
    const v = videoRef.current
    if (!v || v.videoWidth === 0) return
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        const archivo = new File([blob], `ingreso-${Date.now()}.jpg`, { type: 'image/jpeg' })
        agregar([archivo])
      },
      'image/jpeg',
      0.85,
    )
  }

  const detenerGrabacion = () => {
    if (relojRef.current !== null) window.clearInterval(relojRef.current)
    relojRef.current = null
    const g = grabadorRef.current
    if (g && g.state !== 'inactive') g.stop()
    setGrabando(false)
  }

  const empezarGrabacion = () => {
    const stream = streamRef.current
    if (!stream || typeof MediaRecorder === 'undefined') {
      setError('Este navegador no puede grabar video. Grabalo con el teléfono y adjuntalo.')
      return
    }
    const formato = formatoDeGrabacion()
    let grabador: MediaRecorder
    try {
      grabador = new MediaRecorder(stream, {
        ...(formato ? { mimeType: formato } : {}),
        videoBitsPerSecond: BITS_POR_SEGUNDO,
      })
    } catch {
      setError('No se pudo empezar a grabar. Grabalo con el teléfono y adjuntalo.')
      return
    }
    const partes: Blob[] = []
    grabador.ondataavailable = (e) => {
      if (e.data.size > 0) partes.push(e.data)
    }
    grabador.onstop = () => {
      // El bucket compara el tipo SIN parámetros: «video/webm», no
      // «video/webm;codecs=vp9,opus».
      const tipo = (grabador.mimeType || formato || 'video/webm').split(';')[0]?.trim() || 'video/webm'
      const ext = tipo === 'video/mp4' ? 'mp4' : 'webm'
      const blob = new Blob(partes, { type: tipo })
      if (blob.size > 0) agregar([new File([blob], `ingreso-${Date.now()}.${ext}`, { type: tipo })])
    }
    grabador.start(1000)
    grabadorRef.current = grabador
    inicioRef.current = Date.now()
    setSegundos(0)
    setGrabando(true)
    relojRef.current = window.setInterval(() => {
      const s = Math.floor((Date.now() - inicioRef.current) / 1000)
      setSegundos(s)
      if (s >= MAX_SEGUNDOS) detenerGrabacion()
    }, 500)
  }

  return (
    <div className={styles.caja}>
      <div className={styles.acciones}>
        {camara !== null ? null : (
          <>
            <Button
              variant="secondary"
              disabled={deshabilitado}
              icon={<Icon name="image" size={16} />}
              onClick={() => void abrirCamara('foto')}
            >
              Sacar foto
            </Button>
            <Button
              variant="secondary"
              disabled={deshabilitado}
              icon={<Icon name="video" size={16} />}
              onClick={() => void abrirCamara('video')}
            >
              Grabar video
            </Button>
          </>
        )}

        <label className={styles.adjuntar} aria-disabled={deshabilitado || grabando}>
          <Icon name="paperclip" size={16} aria-hidden="true" />
          Adjuntar imagen o video
          <input
            type="file"
            accept="image/*,video/*"
            multiple
            disabled={deshabilitado || grabando}
            className={styles.inputOculto}
            onChange={(e) => {
              agregar(Array.from(e.target.files ?? []))
              // Limpiar el valor permite volver a elegir el mismo archivo.
              e.target.value = ''
            }}
          />
        </label>
      </div>

      {camara !== null ? (
        <div className={styles.camara}>
          <video ref={videoRef} className={styles.video} autoPlay playsInline muted />
          <div className={styles.acciones}>
            {camara === 'foto' ? (
              <Button icon={<Icon name="image" size={16} />} onClick={capturar}>
                Capturar
              </Button>
            ) : grabando ? (
              <Button variant="danger" icon={<Icon name="circle" size={16} />} onClick={detenerGrabacion}>
                Detener · {mmss(segundos)} / {mmss(MAX_SEGUNDOS)}
              </Button>
            ) : (
              <Button icon={<Icon name="video" size={16} />} onClick={empezarGrabacion}>
                Empezar a grabar
              </Button>
            )}
            <Button variant="secondary" onClick={cerrarCamara} disabled={grabando}>
              Cerrar cámara
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {fotos.length > 0 ? (
        <div className={styles.galeria}>
          {fotos.map((f, i) => {
            const video = esVideo(f)
            const que = video ? 'el video' : 'la foto'
            return (
              <div key={`${f.name}-${i}`} className={styles.miniatura}>
                {/* Tocar la miniatura la abre a tamaño completo en el visor: en
                    chico no se lee un número de serie ni se oye un ruido. */}
                <button
                  type="button"
                  className={styles.verFoto}
                  aria-label={`Ver ${que} del ingreso ${i + 1} a tamaño completo`}
                  onClick={() => setAmpliada(i)}
                >
                  {video ? (
                    <>
                      <video src={urls[i]} muted playsInline preload="metadata" />
                      <span className={styles.marcaVideo} aria-hidden="true">
                        <Icon name="video" size={16} />
                      </span>
                    </>
                  ) : (
                    <img src={urls[i]} alt={`Foto del ingreso ${i + 1}`} />
                  )}
                </button>
                {!deshabilitado && !grabando ? (
                  <button
                    type="button"
                    className={styles.quitar}
                    aria-label={`Quitar ${que} ${i + 1}`}
                    onClick={() => onCambio(fotos.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : (
        <p className={styles.ayuda}>
          Sacá fotos o grabá un video de cómo entró la máquina, o adjuntá los que ya tengas. Se
          guardan con la orden al crearla.
        </p>
      )}

      {/* El visor a tamaño completo (Fase 221): un overlay in-page —no una
          pestaña nueva, para no depender del bloqueador de popups—. Se cierra
          tocando el fondo, la ✕ o Escape. El video va con sus controles y SÍ
          recibe los clics (para dar play o adelantar); la foto los deja pasar
          al fondo, que cierra. */}
      {ampliada !== null && ampliada < fotos.length
        ? createPortal(
            <div
              className={styles.visor}
              role="dialog"
              aria-modal="true"
              aria-label={`${esVideo(fotos[ampliada]!) ? 'Video' : 'Foto'} del ingreso ${ampliada + 1}`}
            >
              <button
                type="button"
                className={styles.visorFondo}
                aria-label="Cerrar"
                autoFocus
                onClick={() => setAmpliada(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setAmpliada(null)
                }}
              />
              {esVideo(fotos[ampliada]!) ? (
                <video className={styles.visorVideo} src={urls[ampliada]} controls autoPlay playsInline />
              ) : (
                <img
                  className={styles.visorImg}
                  src={urls[ampliada]}
                  alt={`Foto del ingreso ${ampliada + 1}`}
                />
              )}
              <span className={styles.cerrarVisor} aria-hidden="true">
                ×
              </span>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
