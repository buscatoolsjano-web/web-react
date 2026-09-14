import { createContext, useContext } from 'react'

export interface FieldContext {
  id: string
  describedBy: string | undefined
  invalid: boolean
  required: boolean
}

export const FieldCtx = createContext<FieldContext | null>(null)

/** Lo que un control necesita para quedar conectado a su `Field` (id, aria-*). */
export function useFieldControl(props: { id?: string | undefined; 'aria-describedby'?: string | undefined; 'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling' | undefined; required?: boolean | undefined }) {
  const f = useContext(FieldCtx)
  const describedBy = [props['aria-describedby'], f?.describedBy].filter(Boolean).join(' ') || undefined
  return {
    id: props.id ?? f?.id,
    'aria-describedby': describedBy,
    'aria-invalid': props['aria-invalid'] ?? (f?.invalid ? true : undefined),
    required: props.required ?? f?.required,
  }
}
