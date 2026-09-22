import styles from './Informes.module.css'

export interface SelectorMonedaProps {
  monedas: readonly string[]
  valor: string | null
  onCambiar: (m: string) => void
}

/**
 * Qué moneda se está mirando (Fase 21 · E3).
 *
 * El informe entero —resumen, evolución, ranking y documentos— habla de UNA
 * moneda a la vez, porque sumar pesos con dólares da un número que no existe.
 * Este selector es lo que elige cuál, y su valor viaja en la URL: un link a
 * «septiembre en dólares» abre septiembre en dólares.
 *
 * Las opciones son las monedas que TIENEN documentos en el período. Ofrecer
 * EUR cuando no hubo una sola operación en euros no es completitud: es una
 * pantalla vacía esperando a que alguien la elija.
 */
export function SelectorMoneda({ monedas, valor, onCambiar }: SelectorMonedaProps) {
  if (monedas.length === 0) return null
  if (monedas.length === 1) {
    return (
      <p className={styles.nota}>
        Todo en <b>{monedas[0]}</b>: es la única moneda con documentos en este período.
      </p>
    )
  }
  return (
    <div className={styles.monedas} role="group" aria-label="Moneda del informe">
      {monedas.map((m) => (
        <button
          key={m}
          type="button"
          className={valor === m ? styles.chipActivo : styles.chip}
          aria-pressed={valor === m}
          onClick={() => onCambiar(m)}
        >
          {m}
        </button>
      ))}
    </div>
  )
}
