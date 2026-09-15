import { useId } from 'react'
import { Input } from '@/components/forms/controls'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Icon } from '@/components/icons/Icon'
import styles from './ListaDeTextos.module.css'

export interface ListaDeTextosProps {
  etiqueta: string
  valores: string[]
  placeholder: string
  tipo?: 'email' | 'text'
  ayuda?: string
  /** Error de validación de la lista entera (p. ej. un email repetido). */
  error?: string | null
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
  error = null,
  onCambiar,
}: ListaDeTextosProps) {
  const id = useId()
  // Siempre una fila vacía al final para poder escribir sin apretar «Agregar».
  const filas = valores.length === 0 ? [''] : valores
  const idAyuda = ayuda ? `${id}-ayuda` : undefined
  const idError = error ? `${id}-error` : undefined
  const describe = [idError, idAyuda].filter(Boolean).join(' ') || undefined

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
          <Input
            id={`${id}-${i}`}
            type={tipo === 'email' ? 'email' : 'text'}
            value={v}
            placeholder={placeholder}
            aria-label={`${etiqueta} ${i + 1}`}
            aria-invalid={error ? true : undefined}
            aria-describedby={describe}
            onChange={(e) => cambiar(i, e.target.value)}
          />
          <IconButton
            icon="x"
            aria-label={`Quitar ${etiqueta.toLowerCase()} ${i + 1}`}
            onClick={() => quitar(i)}
            disabled={filas.length === 1 && filas[0] === ''}
          />
        </div>
      ))}
      <Button variant="ghost" size="sm" className={styles.agregar} icon={<Icon name="plus" size={16} />} onClick={() => onCambiar([...filas, ''])}>
        Agregar {etiqueta.toLowerCase().replace(/s$/, '')}
      </Button>
      {error ? (
        <p id={idError} className={styles.error}>
          <Icon name="alert-circle" size={16} />
          <span>{error}</span>
        </p>
      ) : null}
      {ayuda ? (
        <p id={idAyuda} className={styles.ayuda}>
          {ayuda}
        </p>
      ) : null}
    </fieldset>
  )
}
