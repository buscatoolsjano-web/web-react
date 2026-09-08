import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
      <h1>404</h1>
      <p style={{ color: 'var(--text-soft)', margin: 'var(--space-3) 0 var(--space-5)' }}>
        Esta pantalla no existe o todavía no fue migrada.
      </p>
      <Link to="/">Volver al inicio</Link>
    </div>
  )
}
