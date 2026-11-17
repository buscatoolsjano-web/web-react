import { useState } from 'react'
import { resolverValor, sonTodosNumeros } from '../lib/valorDeAtributo'
import styles from './CampoAtributo.module.css'

const AGREGAR = '__agregar__'

export interface CampoAtributoProps {
  /** El nombre de la característica, para lectores de pantalla. */
  etiqueta: string
  valor: string
  /** Los valores que ya existen en el rubro, con cuántos productos los usan. */
  opciones: readonly { valor: string; cantidad?: number }[]
  /** Numérica (largo, torque…): se escribe el número, no se elige de una lista. */
  numerica?: boolean | undefined
  onCambiar: (valor: string) => void
  className?: string | undefined
}

/**
 * Una característica: se elige de lo que ya existe, o se agrega una nueva.
 *
 * «Lista desplegable con lo que ya está, pero con la opción de agregar un dato
 * nuevo, para que no pase que uno ponga 1/4 Hex y otro 1/4 HEX.» Lo nuevo se
 * compara con lo existente antes de guardarse (`resolverValor`): si es el
 * mismo escrito distinto, queda el que ya existía y se avisa.
 *
 * Las numéricas (largo en mm, torque en Nm) siguen siendo un campo: con
 * doscientos largos distintos, una lista es peor que escribir «50».
 */
export function CampoAtributo({ etiqueta, valor, opciones, numerica, onCambiar, className }: CampoAtributoProps) {
  const [agregando, setAgregando] = useState(false)
  const [escrito, setEscrito] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)

  const valores = opciones.map((o) => o.valor)
  const esNumerica = numerica ?? sonTodosNumeros(valores)

  if (esNumerica) {
    return (
      <input
        className={className}
        aria-label={etiqueta}
        inputMode="decimal"
        value={valor}
        onChange={(e) => onCambiar(e.target.value)}
      />
    )
  }

  const confirmar = () => {
    if (escrito.trim() === '') {
      setAgregando(false)
      return
    }
    const r = resolverValor(escrito, valores)
    onCambiar(r.valor)
    setAviso(r.corregido ? `Ya existía como «${r.valor}»: se usa ese.` : null)
    setAgregando(false)
    setEscrito('')
  }

  if (agregando) {
    return (
      <span className={styles.nuevo}>
        <input
          className={className}
          aria-label={`${etiqueta}: valor nuevo`}
          placeholder="Escribí el valor nuevo"
          // Se abrió a pedido, justo para escribir: el foco va ahí.
          autoFocus
          value={escrito}
          onChange={(e) => setEscrito(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              confirmar()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setAgregando(false)
              setEscrito('')
            }
          }}
          onBlur={confirmar}
        />
      </span>
    )
  }

  // El valor actual va siempre en la lista, aunque sea uno viejo que ya no
  // usa nadie más: si no, el desplegable lo mostraría vacío.
  const conActual = valor !== '' && !valores.includes(valor) ? [{ valor, cantidad: undefined }, ...opciones] : opciones
  const ordenadas = [...conActual].sort((a, b) => a.valor.localeCompare(b.valor, 'es', { numeric: true }))

  return (
    <span className={styles.campo}>
      <select
        className={className}
        aria-label={etiqueta}
        value={valor}
        onChange={(e) => {
          setAviso(null)
          if (e.target.value === AGREGAR) {
            setAgregando(true)
            return
          }
          onCambiar(e.target.value)
        }}
      >
        <option value="">—</option>
        {ordenadas.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.cantidad !== undefined ? `${o.valor} (${o.cantidad.toLocaleString('es-AR')})` : o.valor}
          </option>
        ))}
        <option value={AGREGAR}>+ Agregar otro valor…</option>
      </select>
      {aviso ? (
        <span className={styles.aviso} role="status">
          {aviso}
        </span>
      ) : null}
    </span>
  )
}
