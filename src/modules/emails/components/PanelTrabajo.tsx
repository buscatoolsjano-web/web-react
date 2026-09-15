import { useId } from 'react'
import { Field } from '@/components/forms/Field'
import { Select } from '@/components/forms/controls'
import { ESTADOS_TRABAJO, type EstadoHilo, type EstadoTrabajo, type HiloIndice } from '../types'
import { ETIQUETA_ESTADO } from '../lib/formato'
import { useAsignables, useAsignar, useCambiarEstado } from '../hooks/useEmails'
import styles from './Emails.module.css'

export interface PanelTrabajoProps {
  hilo: HiloIndice
  estado: EstadoHilo | undefined
}

/**
 * Estado de trabajo y asignación. Las dos, por RPC: nada de UPDATE desde el
 * navegador. Cada cambio real queda en `email_events`; elegir lo mismo que ya
 * estaba no deja evento.
 *
 * `assigned_to` reparte trabajo y NADA MÁS: no da ni quita acceso a nadie.
 */
export function PanelTrabajo({ hilo, estado }: PanelTrabajoProps) {
  const idTitulo = useId()
  const asignables = useAsignables()
  const asignar = useAsignar(hilo)
  const cambiar = useCambiarEstado(hilo)
  const lista = asignables.data ?? []
  const asignadoFueraDeLista = !!estado?.asignadoA && !lista.some((u) => u.id === estado.asignadoA)
  const error = asignar.error ?? cambiar.error

  return (
    <section className={styles.panel} aria-labelledby={idTitulo}>
      <h2 id={idTitulo} className={styles.panelTitulo}>
        Trabajo
      </h2>

      <Field label="Estado">
        <Select
          value={estado?.estado ?? 'pendiente'}
          disabled={!estado || cambiar.isPending}
          onChange={(e) => cambiar.mutate(e.target.value as EstadoTrabajo)}
        >
          {ESTADOS_TRABAJO.map((e) => (
            <option key={e} value={e}>
              {ETIQUETA_ESTADO[e]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Asignado a">
        <Select
          value={estado?.asignadoA ?? ''}
          disabled={!estado || asignar.isPending || asignables.isPending}
          onChange={(e) => asignar.mutate(e.target.value || null)}
        >
          <option value="">Sin asignar</option>
          {asignadoFueraDeLista ? <option value={estado.asignadoA!}>(usuario sin acceso a Emails)</option> : null}
          {lista.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nombre}
            </option>
          ))}
        </Select>
      </Field>

      {error ? (
        <p className={styles.errorTexto} role="alert">
          {error.message}
        </p>
      ) : null}
    </section>
  )
}
