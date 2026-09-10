import { useId } from 'react'
import styles from './ListaDeTextos.module.css'

export interface ListaDeTextosProps {
  etiqueta: string
  valores: string[]
  placeholder: string
  tipo?: 'email' | 'text'
  ayuda?: string
  onCambiar: (valores: string[]) => void
}

/**
 * Un campo con varios valores: los emails y los dominios del cliente.
 *
 * El legacy tenía **un** email por cliente. El modelo nuevo guarda
 * `emails text[]`, y 877 de los 988 migrados traen al menos uno; varios traen
 * más. Este control existe para que se puedan cargar todos sin inventar una
 * persona de contacto por dirección: un `ventas@empresa.com` no es una
 * persona, y convertirlo en contacto sería inventar a alguien.
 *
 * Los duplicados y lo que no tiene forma de email los saca `normalizarEmails`
 * al guardar; acá se escribe libre para no pelearle a la persona mientras
 * tipea.
 */
export function ListaDeTextos({
  etiqueta,
  valores,
  placeholder,
  tipo = 'text',
  ayuda,
  onCambiar,
}: ListaDeTextosProps) {
  const id = useId()
  // Siempre una fila vacía al final para poder escribir sin apretar «Agregar».
  const filas = valores.length === 0 ? [''] : valores

  const cambiar = (indice: number, texto: string) => {
    const siguiente = [...filas]
    siguiente[indice] = texto
    onCambiar(siguiente)
  }

  const quitar = (indice: number) => {
    const siguiente = filas.filter((_, i) => i !== indice)
    onCambiar(siguiente)
  }

  return (
    <fieldset className={styles.grupo}>
      <legend className={styles.etiqueta}>{etiqueta}</legend>
      {filas.map((v, i) => (
        <div className={styles.fila} key={`${id}-${i}`}>
          <input
            id={`${id}-${i}`}
            className={styles.input}
            type={tipo === 'email' ? 'email' : 'text'}
            value={v}
            placeholder={placeholder}
            aria-label={`${etiqueta} ${i + 1}`}
            onChange={(e) => cambiar(i, e.target.value)}
          />
          <button
            type="button"
            className={styles.quitar}
            onClick={() => quitar(i)}
            aria-label={`Quitar ${etiqueta.toLowerCase()} ${i + 1}`}
            disabled={filas.length === 1 && filas[0] === ''}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className={styles.agregar} onClick={() => onCambiar([...filas, ''])}>
        + Agregar
      </button>
      {ayuda ? <p className={styles.ayuda}>{ayuda}</p> : null}
    </fieldset>
  )
}
