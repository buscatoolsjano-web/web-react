import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cx } from '@/utils/cx'
import { Icon } from '@/components/icons/Icon'
import { useFieldControl } from './fieldContext'
import styles from './Forms.module.css'

export type InputProps = InputHTMLAttributes<HTMLInputElement>

/** Input de texto/número/fecha. Dentro de `Field` toma id y aria-* solo. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, ...rest }, ref) {
  const f = useFieldControl(rest)
  return <input ref={ref} {...rest} {...f} className={cx(styles.control, className)} />
})

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, rows = 3, ...rest }, ref) {
  const f = useFieldControl(rest)
  return <textarea ref={ref} rows={rows} {...rest} {...f} className={cx(styles.control, styles.textarea, className)} />
})

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>

/** Select nativo con flecha propia (accesible y con teclado del sistema). */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, children, ...rest }, ref) {
  const f = useFieldControl(rest)
  return (
    <span className={styles.selectWrap}>
      <select ref={ref} {...rest} {...f} className={cx(styles.control, styles.select, className)}>
        {children}
      </select>
      <Icon name="chevron-down" size={16} className={styles.selectFlecha} />
    </span>
  )
})

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode
  help?: ReactNode | undefined
}

/** Checkbox con su label (área clickeable de 44px de alto). */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, help, className, id, ...rest }, ref) {
  const auto = useId()
  const cid = id ?? `check-${auto}`
  const helpId = help ? `${cid}-ayuda` : undefined
  return (
    <div className={cx(styles.checkField, className)}>
      <label htmlFor={cid} className={styles.checkLabel}>
        <input ref={ref} id={cid} type="checkbox" className={styles.checkbox} aria-describedby={helpId} {...rest} />
        <span>{label}</span>
      </label>
      {help && (
        <p id={helpId} className={styles.checkHelp}>
          {help}
        </p>
      )}
    </div>
  )
})

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'> {
  label: ReactNode
}

/** Interruptor on/off: checkbox nativo con `role="switch"`. */
export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch({ label, className, id, ...rest }, ref) {
  const auto = useId()
  const sid = id ?? `switch-${auto}`
  return (
    <label htmlFor={sid} className={cx(styles.checkLabel, styles.switchLabel, className)}>
      <input ref={ref} id={sid} type="checkbox" role="switch" className={styles.switchInput} {...rest} />
      <span className={styles.switchPista} aria-hidden="true" />
      <span>{label}</span>
    </label>
  )
})
