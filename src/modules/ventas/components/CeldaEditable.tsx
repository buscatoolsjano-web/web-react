import { useEffect, useRef, useState } from 'react'
import styles from './VistaImpresion.module.css'

export interface CeldaEditableProps {
  /** Lo que se ve cuando no se está editando: ya formateado. */
  children: React.ReactNode
  valor: number
  /** Qué se está editando, para el lector de pantalla: «Cantidad», «Precio»… */
  etiqueta: string
  min?: number
  max?: number
  paso?: number
  onCambiar: (valor: number) => void
}

/**
 * Un número del documento que se puede corregir tocándolo (Fase 22 · A4).
 *
 * La hoja tiene que seguir pareciendo una cotización, no una planilla: si cada
 * cantidad fuera un `<input>` con su marco, el documento dejaría de leerse como
 * documento. Entonces el valor se muestra como texto y **recién al tocarlo**
 * aparece el campo; con Enter o al salir vuelve a ser texto.
 *
 * Escape cancela y deja el valor que había: alguien que empezó a escribir y se
 * arrepintió no tiene por qué acordarse de cuánto era.
 *
 * Nada de esto se imprime: en papel es un número y nada más.
 */
export function CeldaEditable({ children, valor, etiqueta, min = 0, max, paso = 1, onCambiar }: CeldaEditableProps) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(String(valor))
  const input = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (editando) {
      input.current?.focus()
      input.current?.select()
    }
  }, [editando])

  const abrir = () => {
    setTexto(String(valor))
    setEditando(true)
  }

  const confirmar = () => {
    setEditando(false)
    // Un campo vacío no es un cero. Borrar el precio y salir sin escribir nada
    // dejaría el producto en 0 sin que nadie lo haya pedido; se queda como
    // estaba. (Un campo numérico además entrega '' cuando lo que se tecleó no
    // es un número, así que esto cubre los dos casos.)
    if (texto.trim() === '') return
    const n = Number(texto.replace(',', '.'))
    if (!Number.isFinite(n)) return
    const acotado = Math.min(Math.max(n, min), max ?? Number.POSITIVE_INFINITY)
    if (acotado !== valor) onCambiar(acotado)
  }

  if (!editando) {
    return (
      <button type="button" className={styles.editable} onClick={abrir} aria-label={`${etiqueta}: ${valor}. Tocar para cambiar`}>
        {children}
      </button>
    )
  }

  return (
    <input
      ref={input}
      type="number"
      className={styles.entrada}
      value={texto}
      min={min}
      {...(max === undefined ? {} : { max })}
      step={paso}
      aria-label={etiqueta}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          confirmar()
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setEditando(false)
        }
      }}
    />
  )
}
