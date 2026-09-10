import { formatearFecha } from '../lib/formato'
import type { RelacionadosCliente } from '../types'
import styles from './PanelRelacionados.module.css'

export interface PanelRelacionadosProps {
  datos: RelacionadosCliente | undefined
  cargando: boolean
}

/**
 * Lo que cuelga del cliente y no son documentos ni contactos.
 *
 * Las tres cosas ya existen en la base con su `customer_id`:
 *
 * - **direcciones**: hoy la tabla está vacía. El legacy no tenía direcciones
 *   estructuradas y no se inventa ninguna a partir de un texto o un dominio.
 * - **alias de producto**: cómo llama el cliente a cada SKU. La pantalla
 *   completa es la entrega 4; acá se ven en modo lectura.
 * - **candidatos de orden de compra**: los que detectó la migración leyendo
 *   los documentos. Ninguna OC se crea sola a partir de ellos.
 */
export function PanelRelacionados({ datos, cargando }: PanelRelacionadosProps) {
  if (cargando) return <p className={styles.nota}>Cargando…</p>
  if (!datos) return null

  const vacio =
    datos.direcciones.length === 0 &&
    datos.alias.length === 0 &&
    datos.candidatosDeOc.length === 0

  if (vacio) {
    return (
      <p className={styles.nota}>
        Este cliente no tiene direcciones, alias de producto ni candidatos de orden de
        compra.
      </p>
    )
  }

  return (
    <div className={styles.wrap}>
      <section className={styles.seccion}>
        <h3 className={styles.h3}>Direcciones ({datos.direcciones.length})</h3>
        {datos.direcciones.length === 0 ? (
          <p className={styles.nota}>
            Sin direcciones cargadas. El legacy no las guardaba estructuradas y no se
            deducen de otro dato.
          </p>
        ) : (
          <ul className={styles.lista}>
            {datos.direcciones.map((d) => (
              <li key={d.id}>
                {d.etiqueta ? <span className={styles.etiqueta}>{d.etiqueta}</span> : null}
                <span>{d.texto || '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.seccion}>
        <h3 className={styles.h3}>Alias de producto ({datos.alias.length})</h3>
        {datos.alias.length === 0 ? (
          <p className={styles.nota}>Sin alias registrados.</p>
        ) : (
          <ul className={styles.lista}>
            {datos.alias.map((a) => (
              <li key={a.id}>
                <span className={styles.etiqueta}>{a.textoCliente || '—'}</span>
                <span>
                  {a.sku ? `${a.sku}${a.nombreProducto ? ` · ${a.nombreProducto}` : ''}` : 'sin producto asociado'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.seccion}>
        <h3 className={styles.h3}>
          Candidatos de orden de compra ({datos.candidatosDeOc.length})
        </h3>
        {datos.candidatosDeOc.length === 0 ? (
          <p className={styles.nota}>Sin candidatos detectados.</p>
        ) : (
          <ul className={styles.lista}>
            {datos.candidatosDeOc.map((c) => (
              <li key={c.id}>
                <span className={styles.etiqueta}>{c.archivo ?? '—'}</span>
                <span>
                  {c.estado ?? 'sin estado'} · {formatearFecha(c.detectadoEn)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
