import { useEffect, useState } from 'react'

/**
 * Devuelve `valor` con un retraso, para no disparar un request por tecla.
 *
 * El legacy filtraba en cada keyup recorriendo los 21.772 productos en
 * memoria. Acá cada búsqueda es un request al servidor, así que esperar a
 * que la persona termine de escribir importa todavía más.
 */
export function useDebounce<T>(valor: T, ms = 300): T {
  const [diferido, setDiferido] = useState(valor)

  useEffect(() => {
    const id = setTimeout(() => setDiferido(valor), ms)
    return () => clearTimeout(id)
  }, [valor, ms])

  return diferido
}
