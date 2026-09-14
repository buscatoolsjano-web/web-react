import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import styles from './Shell.module.css'

export interface EstadoEmpresaProps {
  cargando: boolean
  error: Error | null
  sinEmpresa: boolean
  onReintentar: () => void
  onSalir: () => void
  children: ReactNode
}

/**
 * Antes de mostrar una pantalla del ERP hace falta una empresa activa. Hasta
 * Fase 12 un usuario sin membresía activa veía «Cargando…» para siempre; acá
 * cada caso tiene su estado explícito. No cambia permisos: sin membresía, RLS
 * ya devolvía cero filas en todas las pantallas.
 */
export function EstadoEmpresa({ cargando, error, sinEmpresa, onReintentar, onSalir, children }: EstadoEmpresaProps) {
  if (cargando) {
    return (
      <div className={styles.estadoCentro} role="status">
        <Spinner size={24} />
        <span>Cargando tu empresa…</span>
      </div>
    )
  }

  if (error) {
    // El detalle técnico no se muestra: sólo un mensaje humano y reintentar.
    return <ErrorState title="No pudimos leer tus empresas." description="Revisá la conexión y volvé a intentar." onRetry={onReintentar} />
  }

  if (sinEmpresa) {
    return (
      <EmptyState
        headingLevel={1}
        icon="building"
        title="Tu usuario no tiene una empresa activa"
        description="Para usar Buscatools ERP un administrador tiene que agregarte a una empresa. Si ya lo hizo, reintentá o volvé a iniciar sesión."
        action={
          <>
            <Button variant="secondary" onClick={onReintentar}>
              Reintentar
            </Button>
            <Button variant="ghost" onClick={onSalir}>
              Cerrar sesión
            </Button>
          </>
        }
      />
    )
  }

  return <>{children}</>
}
