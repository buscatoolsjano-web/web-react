import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Icon } from '@/components/icons/Icon'
import { formatearCuit, nombreVisible } from '../lib/formato'
import type { GrupoCuitLegacy } from '../types'
import styles from './ConflictoCuitLegacy.module.css'

export interface ConflictoCuitLegacyProps {
  /** El CUIT VIGENTE del cliente marcado. Casi siempre `null`. */
  cuitVigente: string | null
  /** La evidencia, si la migración la conservó. */
  grupo: GrupoCuitLegacy | undefined
  /** Mientras la consulta viaja no se dice ni que hay ni que no hay. */
  cargando: boolean
}

/**
 * La comparación que la cola de revisión no podía mostrar (Fase 19 · E3B).
 *
 * El motivo `CUIT_REPETIDO_EN_LEGACY` decía «el sistema anterior usaba este
 * CUIT en más de una ficha» y justo arriba se leía «sin CUIT»: el número se
 * había perdido al migrar —la migración lo descartaba a propósito, para no
 * asignarle a nadie un CUIT que estaba repetido— y la tarjeta prometía una
 * comparación que no tenía con qué hacer.
 *
 * Tres decisiones que se ven acá:
 *
 * - **el crudo se muestra tal cual vino.** Hay un `2024652303-8` real, con el
 *   guión mal puesto. Ver eso es información sobre cómo se cargaban los datos,
 *   no un error de esta pantalla;
 * - **la comparación es por el número normalizado**, porque el legacy escribía
 *   el mismo CUIT de tres formas. Se normaliza al leer y no se guarda;
 * - **no hay ningún botón que decida.** Ni fusionar, ni elegir cuál es «la
 *   buena», ni copiar el número al CUIT vigente. Muestra las dos fichas y las
 *   abre; el resto lo decide una persona.
 */
export function ConflictoCuitLegacy({ cuitVigente, grupo, cargando }: ConflictoCuitLegacyProps) {
  if (cargando) return null

  if (!grupo) {
    return (
      <p className={styles.sinEvidencia}>
        <Icon name="info" size={16} />
        El CUIT original no quedó en los datos migrados, así que no se puede mostrar con cuál
        chocaba.
      </p>
    )
  }

  return (
    <div className={styles.caja}>
      <dl className={styles.comparacion}>
        <div>
          <dt>CUIT vigente</dt>
          <dd>
            {cuitVigente ? (
              formatearCuit(cuitVigente)
            ) : (
              <span className={styles.vacio}>Sin CUIT</span>
            )}
          </dd>
        </div>
        <div>
          <dt>CUIT en el sistema anterior</dt>
          {/* Sin `formatearCuit`: acá el formato es el dato. */}
          <dd className={styles.crudo}>{grupo.crudo}</dd>
        </div>
      </dl>

      {grupo.fichas.length === 0 ? (
        <p className={styles.nota}>
          Las otras fichas que tenían este número no están entre los clientes que podés ver.
        </p>
      ) : (
        <>
          <p className={styles.tituloFichas}>
            {grupo.fichas.length === 1
              ? 'La otra ficha con ese mismo CUIT'
              : `Las otras ${grupo.fichas.length} fichas con ese mismo CUIT`}
          </p>
          <ul className={styles.fichas}>
            {grupo.fichas.map((f) => (
              <li key={f.id} className={styles.ficha}>
                <Link className={styles.enlace} to={`/clientes/${f.id}`}>
                  {nombreVisible(f.razonSocial, f.nombreComercial)}
                </Link>
                <span className={styles.fichaMeta}>
                  {[f.referencia, f.cuit ? formatearCuit(f.cuit) : 'sin CUIT']
                    .filter((x) => x !== null)
                    .join(' · ')}
                </span>
                {f.dadoDeBaja ? (
                  <Badge tone="danger" outline>
                    Dado de baja
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
