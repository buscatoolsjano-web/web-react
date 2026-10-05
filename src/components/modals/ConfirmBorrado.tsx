import { useState, type ReactNode } from 'react'
import { Textarea } from '@/components/forms/controls'
import { MINIMO_MOTIVO, MOTIVOS_FRECUENTES } from '@/services/borrado'
import { ConfirmDialog } from './ConfirmDialog'
import styles from './ConfirmBorrado.module.css'

export interface ConfirmBorradoProps {
  open: boolean
  /** Qué se borra, tal como se lee en el título: «la cotización COTI02581». */
  que: ReactNode
  /** Lo que pasa además del borrado, si hay algo que avisar. */
  description?: ReactNode | undefined
  confirmLabel?: string | undefined
  busy?: boolean | undefined
  onCancel: () => void
  onConfirm: (motivo: string) => void
}

/**
 * Confirmar un borrado diciendo por qué.
 *
 * El motivo no es burocracia: es lo único que queda cuando la cosa ya no está.
 * «Se borró la cotización COTI02581» no le sirve a nadie dentro de tres meses;
 * «era una prueba del cutover» sí.
 *
 * Es obligatorio y lo exige también la base (`DELETION_REASON_REQUIRED`), así
 * que el botón deshabilitado no es la única defensa: es sólo el aviso temprano.
 */
export function ConfirmBorrado({
  open,
  que,
  description,
  confirmLabel = 'Eliminar',
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmBorradoProps) {
  const [motivo, setMotivo] = useState('')

  // El motivo se limpia cada vez que el diálogo se abre. Sin esto, el de la
  // vez pasada quedaba escrito y se confirmaba sin leerlo: justo el registro
  // que miente. Se ajusta durante el render (patrón oficial de estado
  // derivado) y no en un efecto, que provocaría un render en cascada.
  const [abiertoPrevio, setAbiertoPrevio] = useState(open)
  if (abiertoPrevio !== open) {
    setAbiertoPrevio(open)
    if (open) setMotivo('')
  }

  const limpio = motivo.trim()

  return (
    <ConfirmDialog
      open={open}
      tone="danger"
      title={<>¿Eliminar {que}?</>}
      description={description ?? 'No se puede deshacer.'}
      confirmLabel={confirmLabel}
      cancelLabel="Volver"
      busy={busy}
      confirmDisabled={limpio.length < MINIMO_MOTIVO}
      onCancel={onCancel}
      onConfirm={() => onConfirm(limpio)}
    >
      <div className={styles.caja}>
        <p className={styles.pregunta}>
          ¿Por qué se borra? Queda registrado con tu nombre y la fecha.
        </p>
        <div className={styles.motivos}>
          {MOTIVOS_FRECUENTES.map((m) => (
            <button
              key={m}
              type="button"
              className={styles.chip}
              aria-pressed={limpio === m}
              onClick={() => setMotivo(m)}
            >
              {m}
            </button>
          ))}
        </div>
        <Textarea
          rows={2}
          value={motivo}
          aria-label="Motivo del borrado"
          placeholder="Escribí el motivo…"
          onChange={(e) => setMotivo(e.target.value)}
        />
      </div>
    </ConfirmDialog>
  )
}
