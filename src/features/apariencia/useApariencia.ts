import { useContext } from 'react'
import { AparienciaContext, type AparienciaContextValue } from './aparienciaContext'

export function useApariencia(): AparienciaContextValue {
  const ctx = useContext(AparienciaContext)
  if (!ctx) throw new Error('useApariencia() requiere <AparienciaProvider> más arriba en el árbol.')
  return ctx
}
