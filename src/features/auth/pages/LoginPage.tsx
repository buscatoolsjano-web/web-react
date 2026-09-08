/**
 * FASE 1: placeholder.
 *
 * El login real con Supabase Auth (email + password, recuperación de
 * contraseña, sesión persistente) es FASE 2.5, después de diseñar
 * profiles / companies / memberships / roles. Ver ADR-004.
 *
 * No se implementa nada de auth acá para no fijar decisiones de schema
 * antes de que estén aprobadas.
 */
export function LoginPage() {
  return (
    <div>
      <h1 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-3)' }}>Iniciar sesión</h1>
      <p style={{ color: 'var(--text-soft)' }}>
        Pendiente de Fase 2.5 — Supabase Auth, perfiles, empresas y roles.
      </p>
    </div>
  )
}
