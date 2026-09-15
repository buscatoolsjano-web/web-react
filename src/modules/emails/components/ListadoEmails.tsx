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
}

/**
 * La bandeja. Una lista de enlaces, no una tabla de ocho columnas: en 390 px
 * una tabla así es ilegible, y en escritorio la fila de dos líneas —remitente,
 * asunto y extracto— se lee mejor que ocho celdas.
 *
 * El no leído no es sólo color: la fila lleva el texto «Sin leer». El clip es
 * un ícono con nombre, no un emoji.
 */
export function ListadoEmails({ filas, buzones }: ListadoEmailsProps) {
  const { search } = useLocation()

  return (
    <ul className={styles.lista} aria-label="Hilos de correo">
      {filas.map((f) => {
        const propia = buzones.get(f.accountId) ?? null
        const quien =
          f.ultimaDireccion === 'out'
            ? `Para: ${resumenParticipantes(f.participantes, propia)}`
            : (f.ultimoRemitente ?? resumenParticipantes(f.participantes, propia))
        return (
          <li key={f.id}>
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
                <span className={styles.asunto}>{f.asunto?.trim() || '(sin asunto)'}</span>
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
          </li>
        )
      })}
    </ul>
  )
}
