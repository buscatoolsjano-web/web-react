import { useRouteError } from 'react-router-dom'

/**
 * Pantalla de error de las rutas.
 *
 * Sin esto, React Router muestra su pantalla de desarrollo con el stack
 * trace y un "Hey developer 👋" — que es exactamente lo que no querés que
 * vea alguien del equipo de ventas.
 *
 * El detalle técnico va en un <details> cerrado: sirve para reportar el
 * problema sin ser lo primero que se lee.
 */
export function ErrorPage() {
  const error = useRouteError()
  const detalle =
    error instanceof Error ? error.message : typeof error === 'string' ? error : null

  return (
    <div style={{ padding: 'var(--space-5)', maxWidth: '42rem', margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--text-lg)', margin: '0 0 var(--space-2)' }}>
        Algo salió mal
      </h1>
      <p style={{ color: 'var(--text-soft)', margin: '0 0 var(--space-4)' }}>
        No se pudo cargar esta pantalla. Casi siempre se resuelve recargando la página.
      </p>

      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          minHeight: 44,
          padding: 'var(--space-2) var(--space-4)',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--primary)',
          color: 'var(--primary-text)',
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Recargar
      </button>

      {detalle && (
        <details style={{ marginTop: 'var(--space-5)' }}>
          <summary
            style={{
              cursor: 'pointer',
              color: 'var(--text-muted)',
              fontSize: 'var(--text-sm)',
            }}
          >
            Detalle técnico
          </summary>
          <pre
            style={{
              marginTop: 'var(--space-2)',
              padding: 'var(--space-3)',
              background: 'var(--surface-alt)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-xs)',
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {detalle}
          </pre>
        </details>
      )}
    </div>
  )
}
