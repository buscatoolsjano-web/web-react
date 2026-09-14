import { useRef, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from './Dialog'

export interface ConfirmDialogProps {
  open: boolean
  title: ReactNode
  /** Consecuencia explícita («El documento queda registrado», «No se puede deshacer»). */
  description: ReactNode
  confirmLabel: string
  cancelLabel?: string | undefined
  /** `danger`: botón rojo, `alertdialog` y foco inicial en «Cancelar». */
  tone?: 'default' | 'danger' | undefined
  /** Mientras la acción corre: botón en loading y el diálogo no se cierra. */
  busy?: boolean | undefined
  onConfirm: () => void
  onCancel: () => void
  children?: ReactNode | undefined
}

/** Reemplazo accesible de `window.confirm`. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancelar',
  tone = 'default',
  busy = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const cancelar = useRef<HTMLButtonElement>(null)
  const confirmar = useRef<HTMLButtonElement>(null)
  const peligro = tone === 'danger'

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      size="sm"
      role={peligro ? 'alertdialog' : 'dialog'}
      busy={busy}
      closeOnOverlay={!peligro}
      showClose={false}
      initialFocusRef={peligro ? cancelar : confirmar}
      footer={
        <>
          <Button ref={cancelar} variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button ref={confirmar} variant={peligro ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  )
}
