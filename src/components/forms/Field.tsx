import { useId, type ReactNode } from 'react'
import { cx } from '@/utils/cx'
import { Icon } from '@/components/icons/Icon'
import { FieldCtx } from './fieldContext'
import styles from './Forms.module.css'

export interface FieldProps {
  label: ReactNode
  children: ReactNode
  /** Ayuda permanente debajo del control. */
  help?: ReactNode | undefined
  /** Mensaje de error; marca el control con `aria-invalid`. */
  error?: ReactNode | undefined
  required?: boolean | undefined
  /** Muestra «(opcional)» junto al label. Preferido sobre marcar los obligatorios. */
  optional?: boolean | undefined
  /** Oculta el label visualmente (sigue siendo el nombre accesible). */
  hideLabel?: boolean | undefined
  id?: string | undefined
  className?: string | undefined
}

/**
 * Campo de formulario: label + control + ayuda + error, conectados por id.
 *
 *   <Field label="Email" error={err}><Input type="email" … /></Field>
 */
export function Field({ label, children, help, error, required = false, optional = false, hideLabel = false, id, className }: FieldProps) {
  const auto = useId()
  const controlId = id ?? `campo-${auto}`
  const helpId = help ? `${controlId}-ayuda` : undefined
  const errorId = error ? `${controlId}-error` : undefined
  const describedBy = [errorId, helpId].filter(Boolean).join(' ') || undefined

  return (
    <FieldCtx.Provider value={{ id: controlId, describedBy, invalid: Boolean(error), required }}>
      <div className={cx(styles.field, className)}>
        <label htmlFor={controlId} className={cx(styles.label, hideLabel && 'sr-only')}>
          {label}
          {optional && <span className={styles.opcional}> (opcional)</span>}
        </label>
        {children}
        {help && (
          <p id={helpId} className={styles.help}>
            {help}
          </p>
        )}
        {error && (
          <p id={errorId} className={styles.error}>
            <Icon name="alert-circle" size={16} />
            <span>{error}</span>
          </p>
        )}
      </div>
    </FieldCtx.Provider>
  )
}
