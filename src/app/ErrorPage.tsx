import { useRouteError } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import styles from './ErrorPage.module.css'

/**
 * Pantalla de error de las rutas.
 *
 * Sin esto, React Router muestra su pantalla de desarrollo con el stack
 * trace y un "Hey developer 👋" — que es exactamente lo que no querés que
 * vea alguien del equipo de ventas.
 *
 * El detalle técnico va en un <details> cerrado: sirve para reportar el
 * problema sin ser lo primero que se lee.
 *
 * Fase 13 · E6: estilos del sistema en lugar de estilos inline; el mismo
 * «Recargar» y el mismo detalle plegado.
 */
export function ErrorPage() {
  const error = useRouteError()
  const detalle =
    error instanceof Error ? error.message : typeof error === 'string' ? error : null

  return (
    <main className={styles.wrap}>
      <div className={styles.caja} role="alert">
        <span className={styles.icono} aria-hidden="true">
          <Icon name="alert-triangle" size={32} />
        </span>
        <h1 className={styles.titulo}>Algo salió mal</h1>
        <p className={styles.texto}>No se pudo cargar esta pantalla. Casi siempre se resuelve recargando la página.</p>
        <Button icon={<Icon name="refresh" size={16} />} onClick={() => window.location.reload()}>
          Recargar
        </Button>

        {detalle && (
          <details className={styles.detalle}>
            <summary>Detalle técnico</summary>
            <pre>{detalle}</pre>
          </details>
        )}
      </div>
    </main>
  )
}
