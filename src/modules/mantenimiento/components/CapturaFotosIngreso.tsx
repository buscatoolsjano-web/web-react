import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { LIMITE_BYTES } from '../services/adjuntos'
import styles from './CapturaFotosIngreso.module.css'

export interface CapturaFotosIngresoProps {
  fotos: File[]
  onCambio: (fotos: File[]) => void
  deshabilitado?: boolean
}

/**
 * Fotos del ingreso: sacar con la cámara o adjuntar desde el equipo (Fase 212).
 *
 * Un servicio técnico necesita dejar registrado CÓMO llegó la máquina, y la
 * forma natural es una foto en el mostrador. Dos caminos:
 *
 *   · **Sacar foto**: abre la cámara del dispositivo —webcam de la computadora
 *     o la del teléfono (cámara trasera)— con `getUserMedia`, muestra el vivo y
 *     captura un cuadro a JPEG. Al cerrar, apaga la cámara (corta el stream):
 *     no queda la luz prendida ni el permiso en uso.
 *   · **Adjuntar imagen**: para las que ya están en el equipo. Varias de una.
 *
 * Las fotos se juntan acá como borrador; recién se suben cuando la orden se
 * crea y tiene id, por el mismo camino que cualquier adjunto de la orden
 * (`subirAdjunto`, bucket privado).
 *
 * Las reglas de hooks del repo: la cámara se abre/cierra y se captura en los
 * event handlers (ahí se puede leer el ref y hacer setState); los efectos sólo
 * conectan el stream al `<video>` y limpian al desmontar, sin setState.
 */
export function CapturaFotosIngreso({ fotos, onCambio, deshabilitado = false }: CapturaFotosIngresoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [camaraAbierta, setCamaraAbierta] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Las miniaturas: una URL por archivo. Se revocan al cambiar o desmontar para
  // no filtrar memoria. Crear la URL en el render (useMemo) es barato; lo que
  // importa es revocar la anterior, y eso va en el cleanup del efecto.
  const urls = useMemo(() => fotos.map((f) => URL.createObjectURL(f)), [fotos])
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls])

  // Conecta el stream al elemento de video cuando la cámara se abre. No hay
  // setState acá: sólo se asigna `srcObject`, que es un efecto secundario del DOM.
  useEffect(() => {
    const v = videoRef.current
    if (camaraAbierta && v && streamRef.current) v.srcObject = streamRef.current
  }, [camaraAbierta])

  // Al desmontar, apagar la cámara pase lo que pase (si quedó abierta).
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    },
    [],
  )

  const agregar = (nuevas: File[]) => {
    const validas = nuevas.filter((f) => f.type.startsWith('image/') && f.size <= LIMITE_BYTES)
    const rechazadas = nuevas.length - validas.length
    if (rechazadas > 0) {
      setError(`Se ignoraron ${rechazadas} archivo(s): sólo imágenes de hasta 20 MB.`)
    } else {
      setError(null)
    }
    if (validas.length > 0) onCambio([...fotos, ...validas])
  }

  const abrirCamara = async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
      streamRef.current = stream
      setCamaraAbierta(true)
    } catch {
      setError(
        'No se pudo abrir la cámara. Revisá el permiso del navegador, o adjuntá la imagen desde el equipo.',
      )
    }
  }

  const cerrarCamara = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCamaraAbierta(false)
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

  return (
    <div className={styles.caja}>
      <div className={styles.acciones}>
        {camaraAbierta ? null : (
          <Button
            variant="secondary"
            disabled={deshabilitado}
            icon={<Icon name="image" size={16} />}
            onClick={() => void abrirCamara()}
          >
            Sacar foto
          </Button>
        )}

        <label className={styles.adjuntar} aria-disabled={deshabilitado}>
          <Icon name="paperclip" size={16} aria-hidden="true" />
          Adjuntar imagen
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={deshabilitado}
            className={styles.inputOculto}
            onChange={(e) => {
              agregar(Array.from(e.target.files ?? []))
              // Limpiar el valor permite volver a elegir el mismo archivo.
              e.target.value = ''
            }}
          />
        </label>
      </div>

      {camaraAbierta ? (
        <div className={styles.camara}>
          <video ref={videoRef} className={styles.video} autoPlay playsInline muted />
          <div className={styles.acciones}>
            <Button icon={<Icon name="image" size={16} />} onClick={capturar}>
              Capturar
            </Button>
            <Button variant="secondary" onClick={cerrarCamara}>
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
          {fotos.map((f, i) => (
            <div key={`${f.name}-${i}`} className={styles.miniatura}>
              <img src={urls[i]} alt={`Foto del ingreso ${i + 1}`} />
              {!deshabilitado ? (
                <button
                  type="button"
                  className={styles.quitar}
                  aria-label={`Quitar foto ${i + 1}`}
                  onClick={() => onCambio(fotos.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.ayuda}>
          Sacá fotos de cómo entró la máquina o adjuntá las que ya tengas. Se guardan con la orden
          al crearla.
        </p>
      )}
    </div>
  )
}
