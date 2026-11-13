import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { registrarVisita } from '../services/registrarVisita'

/**
 * Registra una visita cada vez que cambia la ruta del sitio público (Fase 115).
 *
 * En `useEffect`, así que sólo corre en el navegador real: durante el prerender
 * (que renderiza a string) los efectos no se ejecutan, y las visitas del build
 * no se cuentan.
 */
export function useRegistrarVisita(habilitado = true): void {
  const { pathname, search } = useLocation()
  useEffect(() => {
    if (habilitado) registrarVisita(pathname + search)
  }, [pathname, search, habilitado])
}
