import type { ReactNode } from 'react'
import { Dialog } from '@/components/modals/Dialog'

export interface DialogoProps {
  titulo: string
  children: ReactNode
  /** Botones del pie. */
  pie: ReactNode
  onCerrar: () => void
  /** Mientras se guarda no se cierra con Escape ni tocando afuera. */
  bloqueado?: boolean
}

/**
 * Diálogo modal de Configuración.
 *
 * Fase 13 · E5: el mismo contrato de siempre sobre el `Dialog` común (foco
 * atrapado, Escape, fondo inerte, hoja inferior en mobile). Se monta sólo
 * cuando hace falta, así que siempre está abierto.
 */
export function Dialogo({ titulo, children, pie, onCerrar, bloqueado = false }: DialogoProps) {
  return (
    <Dialog open title={titulo} onClose={onCerrar} footer={pie} busy={bloqueado} size="sm">
      {children}
    </Dialog>
  )
}
