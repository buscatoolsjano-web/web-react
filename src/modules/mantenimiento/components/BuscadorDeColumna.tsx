import { useEffect, useState } from 'react'
import styles from './Listado.module.css'

export interface BuscadorDeColumnaProps {
  /** Para el lector de pantalla: «Buscar en Referencia». */
  columna: string
  valor: string
  onCambiar: (valor: string) => void
}

/**
 * La cajita de «Buscar» debajo del encabezado de una columna.
 *
 * Es el filtro del sistema anterior, y es el que la gente del taller usa: se
 * busca *dentro de una columna* —«todos los que tengan RZ0 en el
 * identificador»— y no en un buscador general que mezcla la referencia con la
 * marca.
 *
 * Escribe con un retardo de 300 ms para no pedir una página por tecla, y el
 * valor vive en la URL, así que el filtro se comparte y el «atrás» lo deshace.
 */
export function BuscadorDeColumna({ columna, valor, onCambiar }: BuscadorDeColumnaProps) {
  const [texto, setTexto] = useState(valor)

  // Si el filtro cambia desde afuera —«Limpiar», o el «atrás» del navegador—
  // hay que reflejarlo acá. Se ajusta DURANTE el render, no en un efecto.
  const [previo, setPrevio] = useState(valor)
  if (previo !== valor) {
    setPrevio(valor)
    setTexto(valor)
  }

  useEffect(() => {
    if (texto === valor) return
    const id = setTimeout(() => onCambiar(texto), 300)
    return () => clearTimeout(id)
  }, [texto, valor, onCambiar])

  return (
    <input
      type="search"
      className={styles.buscadorColumna}
      placeholder="Buscar"
      aria-label={`Buscar en ${columna}`}
      value={texto}
      onChange={(e) => setTexto(e.target.value)}
      // El encabezado ordena al hacer click; escribir acá no debe ordenar.
      onClick={(e) => e.stopPropagation()}
    />
  )
}
