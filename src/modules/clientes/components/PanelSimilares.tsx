import { Link } from 'react-router-dom'
import { Alert } from '@/components/feedback/Alert'
import { Badge } from '@/components/ui/Badge'
import { formatearCuit } from '../lib/formato'
import type { ClienteSimilar } from '../types'
import styles from './PanelSimilares.module.css'

export interface PanelSimilaresProps {
  candidatos: readonly ClienteSimilar[]
  buscando: boolean
}

const MOTIVO: Record<ClienteSimilar['motivo'], string> = {
  CUIT: 'Mismo CUIT',
  EMAIL: 'Mismo email',
  TELEFONO: 'Mismo teléfono',
  NOMBRE: 'Nombre parecido',
}

/**
 * Clientes que se parecen al que se está cargando (Fase 17 · E5).
 *
 * Esto **propone**, no decide. La única coincidencia que bloquea es el CUIT, y
 * no porque lo diga este panel: lo dice el índice único de la base, porque dos
 * clientes no pueden tener el mismo CUIT. El resto —email, teléfono, nombre
 * parecido— avisa y deja seguir: en producción hay diez grupos de clientes que
 * comparten email y no todos son duplicados; una casa matriz y su sucursal
 * comparten la casilla de compras.
 *
 * Y nunca se ofrece «fusionar»: fusionar dos clientes toca documentos,
 * contactos, direcciones, adjuntos, precios y auditoría. Un botón que prometa
 * eso sin hacerlo entero es peor que no tenerlo.
 */
export function PanelSimilares({ candidatos, buscando }: PanelSimilaresProps) {
  if (candidatos.length === 0) {
    // Mientras busca no se dice nada: un cartel que aparece y desaparece con
    // cada tecla es ruido.
    return buscando ? null : null
  }

  const bloqueante = candidatos.find((c) => c.fuerza === 'fuerte')

  return (
    <Alert
      tone={bloqueante ? 'warning' : 'info'}
      role={bloqueante ? 'alert' : 'status'}
      title={
        bloqueante
          ? 'Ya existe un cliente con este CUIT'
          : candidatos.length === 1
            ? 'Hay un cliente parecido'
            : `Hay ${candidatos.length} clientes parecidos`
      }
    >
      <p className={styles.intro}>
        {bloqueante
          ? 'No se puede crear otro con el mismo CUIT. Abrí el que ya existe.'
          : 'Revisá si es el mismo antes de crear uno nuevo. Si no lo es, seguí adelante.'}
      </p>
      <ul className={styles.lista}>
        {candidatos.map((c) => (
          <li key={c.id} className={styles.item}>
            <Link className={styles.enlace} to={`/clientes/${c.id}`} target="_blank" rel="noreferrer">
              {c.razonSocial}
            </Link>
            <Badge tone={c.fuerza === 'fuerte' ? 'warning' : 'neutral'}>{MOTIVO[c.motivo]}</Badge>
            <span className={styles.meta}>
              {[
                c.referencia,
                c.cuit ? formatearCuit(c.cuit) : null,
                c.dadoDeBaja ? 'dado de baja' : null,
                c.necesitaRevision ? 'marcado para revisión' : null,
              ]
                .filter((x) => x !== null)
                .join(' · ')}
            </span>
          </li>
        ))}
      </ul>
    </Alert>
  )
}
