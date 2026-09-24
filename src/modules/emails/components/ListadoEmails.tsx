import { Link, useLocation } from 'react-router-dom'
import { Icon } from '@/components/icons/Icon'
import { fechaBandeja, resumenParticipantes } from '../lib/formato'
import type { FilaBandeja } from '../types'
import { BadgeEstado } from './BadgeEstado'
import styles from './Emails.module.css'

export interface ListadoEmailsProps {
  filas: FilaBandeja[]
  /** accountId → dirección del buzón, para no mostrarse a sí mismo como participante. */
  buzones: ReadonlyMap<string, string>
  /** Sacar el hilo de la bandeja, o devolverlo. Sin esto no se dibuja el botón. */
  onEliminar?: ((fila: FilaBandeja, eliminar: boolean) => void) | undefined
  /** El hilo que está yendo o volviendo, para bloquear su botón. */
  trabajando?: string | null | undefined
}

/**
 * La bandeja. Una lista de enlaces, no una tabla de ocho columnas: en 390 px
 * una tabla así es ilegible, y en escritorio la fila de dos líneas —remitente,
 * asunto y extracto— se lee mejor que ocho celdas.
 *
 * El no leído no es sólo color: la fila lleva el texto «Sin leer». El clip es
 * un ícono con nombre, no un emoji.
 *
 * Fase 28 · E2: el botón de eliminar va FUERA del enlace —un botón adentro de
 * un `<a>` no es HTML válido y el teclado no llega—, así que la fila es un
 * enlace y un botón, lado a lado.
 */
export function ListadoEmails({ filas, buzones, onEliminar, trabajando }: ListadoEmailsProps) {
  const { search } = useLocation()

  return (
    <ul className={styles.lista} aria-label="Hilos de correo">
      {filas.map((f) => {
        const propia = buzones.get(f.accountId) ?? null
        const quien =
          f.ultimaDireccion === 'out'
            ? `Para: ${resumenParticipantes(f.participantes, propia)}`
            : (f.ultimoRemitente ?? resumenParticipantes(f.participantes, propia))
        const asunto = f.asunto?.trim() || '(sin asunto)'
        return (
          <li key={f.id} className={styles.item}>
            <Link
              to={`/emails/${f.id}`}
              // Volver desde el hilo recupera los filtros y la página.
              state={{ desde: search }}
              className={`${styles.fila} ${f.sinLeer ? styles.filaSinLeer : ''}`}
            >
              <span className={styles.remitente} title={quien}>
                {quien}
              </span>

              <span className={styles.centro}>
                <span className={styles.asunto}>{asunto}</span>
                {f.extracto ? <span className={styles.extracto}>{f.extracto}</span> : null}
                <span className={styles.meta}>
                  {f.sinLeer ? <span className={styles.sinLeer}>Sin leer</span> : null}
                  <BadgeEstado estado={f.estado} />
                  {f.asignadoNombre ? <span>Asignado: {f.asignadoNombre}</span> : null}
                  {f.clienteNombre ? <span>Cliente: {f.clienteNombre}</span> : null}
                </span>
              </span>

              <span className={styles.derecha}>
                <time dateTime={f.ultimoMensajeEn ?? undefined}>{fechaBandeja(f.ultimoMensajeEn)}</time>
                {f.cantidadMensajes > 1 ? (
                  <span aria-label={`${f.cantidadMensajes} mensajes`}>{f.cantidadMensajes} msj.</span>
                ) : null}
                {f.tieneAdjuntos ? (
                  <span className={styles.clip} title="Tiene adjuntos">
                    <Icon name="paperclip" size={16} />
                    <span className="sr-only">Tiene adjuntos</span>
                  </span>
                ) : null}
              </span>
            </Link>

            {onEliminar ? (
              <button
                type="button"
                className={styles.accionFila}
                disabled={trabajando === f.id}
                // El nombre lleva el asunto: con veinticinco botones «Eliminar»
                // seguidos, «Eliminar» solo no dice cuál.
                aria-label={`${f.eliminado ? 'Restaurar' : 'Eliminar'}: ${asunto}`}
                title={f.eliminado ? 'Devolver a la bandeja' : 'Sacar de la bandeja del ERP (no se borra de Gmail)'}
                onClick={() => onEliminar(f, !f.eliminado)}
              >
                <Icon name={f.eliminado ? 'refresh' : 'trash'} size={16} />
              </button>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
