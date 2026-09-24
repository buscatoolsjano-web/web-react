import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from '@/components/icons/Icon'
import { Select } from '@/components/forms/controls'
import type { EtiquetaEmail, FilaBandeja, UsuarioAsignable } from '../types'
import styles from './Emails.module.css'

export interface AccionesFilaProps {
  fila: FilaBandeja
  asignables: UsuarioAsignable[]
  etiquetas: EtiquetaEmail[]
  onAsignar: (fila: FilaBandeja, usuario: string | null, nombre: string | null) => void
  onEtiquetar: (fila: FilaBandeja, etiqueta: EtiquetaEmail, poner: boolean) => void
  onEliminar: (fila: FilaBandeja, eliminar: boolean) => void
  /** El hilo sobre el que hay algo en curso: bloquea sus controles. */
  trabajando: boolean
}

/**
 * Asignar, etiquetar y eliminar, sin abrir el hilo (Fase 28 · E8).
 *
 * Van FUERA del enlace de la fila —un control dentro de un `<a>` no es HTML
 * válido y el teclado no llega a los dos—, en su propia columna.
 *
 * Asignar es un `<select>` nativo y no un menú propio: veinticinco filas con
 * su desplegable hecho a mano es mucho JavaScript para algo que el navegador
 * ya sabe hacer, con su teclado y su comportamiento en mobile.
 */
export function AccionesFila({
  fila,
  asignables,
  etiquetas,
  onAsignar,
  onEtiquetar,
  onEliminar,
  trabajando,
}: AccionesFilaProps) {
  return (
    <div className={styles.accionesFila}>
      {asignables.length > 0 ? (
        <Select
          className={styles.asignarRapido}
          value={fila.asignadoA ?? ''}
          disabled={trabajando}
          aria-label={`Asignar: ${fila.asunto?.trim() || '(sin asunto)'}`}
          onChange={(e) => {
            const id = e.target.value || null
            onAsignar(fila, id, asignables.find((u) => u.id === id)?.nombre ?? null)
          }}
        >
          <option value="">Sin asignar</option>
          {asignables.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nombre}
            </option>
          ))}
        </Select>
      ) : null}

      {etiquetas.length > 0 ? (
        <MenuEtiquetas fila={fila} etiquetas={etiquetas} onEtiquetar={onEtiquetar} disabled={trabajando} />
      ) : null}

      <button
        type="button"
        className={styles.accionFila}
        disabled={trabajando}
        // El nombre lleva el asunto: con veinticinco botones «Eliminar»
        // seguidos, «Eliminar» solo no dice cuál.
        aria-label={`${fila.eliminado ? 'Restaurar' : 'Eliminar'}: ${fila.asunto?.trim() || '(sin asunto)'}`}
        title={fila.eliminado ? 'Devolver a la bandeja' : 'Sacar de la bandeja del ERP (no se borra de Gmail)'}
        onClick={() => onEliminar(fila, !fila.eliminado)}
      >
        <Icon name={fila.eliminado ? 'refresh' : 'trash'} size={16} />
      </button>
    </div>
  )
}

/**
 * Las etiquetas del hilo, para marcar y desmarcar.
 *
 * Es un desplegable con checkboxes, no un `role="menu"`: un menú ARIA obliga
 * a que cada hijo sea un `menuitem`, y lo que hay adentro son casillas que se
 * marcan sin cerrar nada.
 */
function MenuEtiquetas({
  fila,
  etiquetas,
  onEtiquetar,
  disabled,
}: {
  fila: FilaBandeja
  etiquetas: EtiquetaEmail[]
  onEtiquetar: (fila: FilaBandeja, etiqueta: EtiquetaEmail, poner: boolean) => void
  disabled: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement>(null)
  const disparador = useRef<HTMLButtonElement>(null)
  const id = useId()
  const puestas = new Set(fila.etiquetas.map((e) => e.id))

  useEffect(() => {
    if (!abierto) return
    const afuera = (e: MouseEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false)
    }
    // Escape cierra y devuelve el foco: si no, queda en un nodo que ya no está.
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setAbierto(false)
      disparador.current?.focus()
    }
    document.addEventListener('mousedown', afuera)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', afuera)
      document.removeEventListener('keydown', escape)
    }
  }, [abierto])

  return (
    <div className={styles.menuEtiquetas} ref={caja}>
      <button
        ref={disparador}
        type="button"
        className={styles.accionFila}
        disabled={disabled}
        aria-expanded={abierto}
        aria-controls={id}
        aria-label={`Etiquetas: ${fila.asunto?.trim() || '(sin asunto)'}`}
        title="Etiquetas"
        onClick={() => setAbierto((v) => !v)}
      >
        <Icon name="star" size={16} />
      </button>
      <div id={id} className={styles.panelEtiquetas} hidden={!abierto}>
        {etiquetas.map((e) => (
          <label key={e.id} className={styles.opcionEtiqueta}>
            <input
              type="checkbox"
              checked={puestas.has(e.id)}
              onChange={(ev) => onEtiquetar(fila, e, ev.target.checked)}
            />
            <span className={`${styles.puntoEtiqueta} ${styles[`punto_${e.color}`]}`} aria-hidden="true" />
            {e.nombre}
          </label>
        ))}
      </div>
    </div>
  )
}
