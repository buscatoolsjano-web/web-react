import { useId, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { NOMBRE_MAX, buscarDuplicado, normalizarNombre, validarNombre } from '../lib/maestros'
import { Dialogo } from './Dialogo'
import styles from './Configuracion.module.css'

export interface DialogoNombreProps {
  titulo: string
  etiqueta: string
  textoBoton: string
  inicial?: string
  /** Para avisar antes de enviar; la base igual lo vuelve a controlar. */
  existentes: readonly { id: string; nombre: string }[]
  excluirId?: string
  ayuda?: string
  guardando: boolean
  error: string | null
  onGuardar: (nombre: string) => void
  onCerrar: () => void
}

/** Alta o renombre de un maestro con un solo campo: el nombre. */
export function DialogoNombre({ titulo, etiqueta, textoBoton, inicial = '', existentes, excluirId, ayuda, guardando, error, onGuardar, onCerrar }: DialogoNombreProps) {
  const id = useId()
  const [valor, setValor] = useState(inicial)
  const [tocado, setTocado] = useState(false)

  const invalido = validarNombre(valor)
  const duplicado = invalido ? null : buscarDuplicado(existentes, valor, excluirId)
  const sinCambios = inicial !== '' && normalizarNombre(valor) === normalizarNombre(inicial)
  const errorCampo = tocado ? (invalido ?? (duplicado ? `Ya existe «${duplicado.nombre}».` : null)) : null
  const idError = `${id}-error`
  const idAyuda = `${id}-ayuda`

  function enviar(e: FormEvent) {
    e.preventDefault()
    setTocado(true)
    if (invalido || duplicado || sinCambios) return
    onGuardar(normalizarNombre(valor))
  }

  return (
    <Dialogo
      titulo={titulo}
      onCerrar={onCerrar}
      bloqueado={guardando}
      pie={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button type="submit" form={id} disabled={guardando || sinCambios}>
            {guardando ? 'Guardando…' : textoBoton}
          </Button>
        </>
      }
    >
      <form id={id} onSubmit={enviar} noValidate className={styles.campo}>
        <label htmlFor={`${id}-nombre`} className={styles.etiqueta}>
          {etiqueta}
        </label>
        <input
          id={`${id}-nombre`}
          className={styles.control}
          value={valor}
          maxLength={NOMBRE_MAX + 20}
          autoComplete="off"
          aria-invalid={!!errorCampo}
          aria-describedby={[ayuda ? idAyuda : null, errorCampo ? idError : null].filter(Boolean).join(' ') || undefined}
          onChange={(e) => setValor(e.target.value)}
          onBlur={() => setTocado(true)}
        />
        {ayuda && (
          <span id={idAyuda} className={styles.nota}>
            {ayuda}
          </span>
        )}
        {errorCampo && (
          <span id={idError} className={styles.errorCampo} role="alert">
            {errorCampo}
          </span>
        )}
      </form>
      {error && <StatusMessage tono="error" titulo={error} />}
    </Dialogo>
  )
}
