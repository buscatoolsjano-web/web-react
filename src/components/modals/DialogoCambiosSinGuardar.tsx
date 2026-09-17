import { ConfirmDialog } from './ConfirmDialog'

export interface DialogoCambiosSinGuardarProps {
  open: boolean
  /** Descartar el borrador y seguir a donde se iba. */
  onSalir: () => void
  /** Quedarse donde está, con el borrador intacto. */
  onQuedarse: () => void
}

/**
 * «Hay cambios sin guardar», el mismo diálogo en todos lados.
 *
 * Reemplaza a `window.confirm`, que no es accesible, no se puede probar y el
 * navegador puede bloquear. El botón que destruye trabajo es el secundario y
 * el foco arranca en «Seguir editando».
 */
export function DialogoCambiosSinGuardar({ open, onSalir, onQuedarse }: DialogoCambiosSinGuardarProps) {
  return (
    <ConfirmDialog
      open={open}
      tone="danger"
      title="Hay cambios sin guardar"
      description="Si salís ahora, los cambios que hiciste se van a perder."
      confirmLabel="Descartar y salir"
      cancelLabel="Seguir editando"
      onConfirm={onSalir}
      onCancel={onQuedarse}
    />
  )
}
