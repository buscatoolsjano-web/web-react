import { etiquetaDeAccion, formatearFechaHora } from '../lib/formato'
import { etiquetaDeEstado, etiquetaDeEtapa } from '../lib/estados'
import type { EventoDeMantenimiento } from '../types'
import styles from './PanelHistorial.module.css'

export interface PanelHistorialProps {
  eventos: readonly EventoDeMantenimiento[]
  cargando: boolean
}

/**
 * El historial: lo que dice `maintenance_audit`.
 *
 * Se auditan **eventos de negocio**, no cada UPDATE. Cambiar una nota no deja
 * rastro; cambiarle el dueño a un equipo, avanzar de etapa, marcar una etapa
 * como no requerida, pausar, cerrar o cancelar, sí.
 *
 * Los estados se traducen sólo cuando son etapas. Un `from_status` que es
 * `open` o `closed` ya se lee, y adivinar de qué eje viene cada valor sería
 * inventar: se muestra crudo antes que mal.
 */
const ACCIONES_DE_ETAPA = ['stage_changed', 'stage_reverted', 'order_put_on_hold', 'order_resumed']
const ACCIONES_DE_ESTADO = ['create', 'status_changed', 'order_closed', 'order_cancelled']

function traducirEstado(accion: string, valor: string | null): string {
  if (valor === null) return '—'
  if (ACCIONES_DE_ETAPA.includes(accion)) return etiquetaDeEtapa(valor)
  if (ACCIONES_DE_ESTADO.includes(accion)) return etiquetaDeEstado(valor)
  return valor
}

/**
 * El texto del medio de cada evento.
 *
 * La espera guarda la misma etapa en los dos extremos —es donde quedó
 * parada—, así que «Cotización → Cotización» sería ruido: se dice «en
 * Cotización». Y un `diff` de `stage_marked_not_required` dice cuál etapa.
 */
function detalle(e: EventoDeMantenimiento): string | null {
  if (e.accion === 'order_put_on_hold' || e.accion === 'order_resumed') {
    return e.estadoNuevo ? `en ${etiquetaDeEtapa(e.estadoNuevo)}` : null
  }
  if (e.accion !== 'stage_marked_not_required' || !e.diff) return null
  const partes: string[] = []
  if (e.diff['repair'] === true) partes.push('Reparación')
  if (e.diff['torque'] === true) partes.push('Torque')
  if (partes.length === 0) return null
  const cuando = e.diff['al_crear'] === true ? ' (al crear la orden)' : ''
  return `${partes.join(' y ')}${cuando}`
}

export function PanelHistorial({ eventos, cargando }: PanelHistorialProps) {
  if (cargando) return <p className={styles.nota}>Cargando historial…</p>

  if (eventos.length === 0) {
    return <p className={styles.nota}>Sin movimientos registrados todavía.</p>
  }

  return (
    <ol className={styles.linea}>
      {eventos.map((e) => {
        const extra = detalle(e)
        return (
          <li key={e.id} className={styles.evento}>
            <span className={styles.accion}>{etiquetaDeAccion(e.accion)}</span>
            <span className={styles.estados}>
              {extra ??
                (e.estadoAnterior || e.estadoNuevo
                  ? `${traducirEstado(e.accion, e.estadoAnterior)} → ${traducirEstado(e.accion, e.estadoNuevo)}`
                  : '')}
            </span>
            <span className={styles.meta}>
              {formatearFechaHora(e.fecha)}
              {e.autor ? ` · ${e.autor}` : ''}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
