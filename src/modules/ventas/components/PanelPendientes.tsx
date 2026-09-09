import { formatearCantidad } from '../lib/formato'
import type { ResultadoPendientes } from '../lib/pendientes'
import type { LineaDocumento } from '../types'
import styles from './PanelPendientes.module.css'

export interface PanelPendientesProps {
  lineas: readonly LineaDocumento[]
  resultado: ResultadoPendientes | undefined
  cargando: boolean
}

/**
 * Pedido / entregado / pendiente por línea — o el motivo por el que no se
 * puede calcular.
 *
 * Este componente no calcula nada: recibe el resultado de `calcularPendientes`,
 * que es una función pura y probada aparte. Acá sólo se elige qué mostrar, y
 * hay dos estados en los que lo correcto es **no mostrar ningún número**.
 *
 *   NO CONSTA ENTREGA  ≠  NO ENTREGADO
 */
export function PanelPendientes({ lineas, resultado, cargando }: PanelPendientesProps) {
  if (cargando || !resultado) {
    return <p className={styles.nota}>Calculando entregas…</p>
  }

  if (resultado.estado === 'NO_CONSTA_ENTREGA') {
    return (
      <div className={styles.aviso} role="note">
        <p className={styles.avisoTitulo}>No consta entrega</p>
        <p className={styles.avisoTexto}>
          Este pedido no tiene ninguna entrega asociada, pero el cliente tiene remitos que el
          sistema anterior nunca enlazó a un pedido. <strong>No es lo mismo que «no entregado»</strong>:
          puede haberse entregado sin que quede registrado el vínculo, así que no se muestra una
          cantidad pendiente.
        </p>
      </div>
    )
  }

  if (resultado.estado === 'DETALLE_NO_RECONSTRUIDO') {
    return (
      <div className={styles.aviso} role="note">
        <p className={styles.avisoTitulo}>Entrega histórica no reconstruida</p>
        <p className={styles.avisoTexto}>
          Hay entregas asociadas a este pedido, pero {resultado.lineasSinEnlazar}{' '}
          {resultado.lineasSinEnlazar === 1
            ? 'línea de entrega no se pudo asociar'
            : 'líneas de entrega no se pudieron asociar'}{' '}
          a una línea concreta: el sistema anterior sólo guardaba la relación a nivel de documento.
          Esas cantidades podrían corresponder a cualquier línea, así que{' '}
          <strong>no se calcula el pendiente por línea</strong>. Las entregas se ven completas en
          «Relacionados».
        </p>
      </div>
    )
  }

  const porLinea = new Map(resultado.porLinea.map((p) => [p.lineaId, p]))
  const visibles = lineas.filter((l) => l.tipoLinea !== 'chapter')

  return (
    <>
      {resultado.hayExceso ? (
        <div className={styles.exceso} role="note">
          <p className={styles.avisoTitulo}>Se entregó más de lo pedido</p>
          <p className={styles.avisoTexto}>
            Es una inconsistencia del histórico y se muestra tal cual.{' '}
            <strong>Las cantidades originales no se corrigieron.</strong>
          </p>
        </div>
      ) : null}

      <div className={styles.scroll}>
        <table className={styles.tabla}>
          <thead>
            <tr>
              <th scope="col">Referencia</th>
              <th scope="col" className={styles.derecha}>
                Pedido
              </th>
              <th scope="col" className={styles.derecha}>
                Entregado
              </th>
              <th scope="col" className={styles.derecha}>
                Pendiente
              </th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((l) => {
              const p = porLinea.get(l.id)
              return (
                <tr key={l.id}>
                  <td>
                    <span className={styles.sku}>{l.sku ?? '—'}</span>
                    <span className={styles.nombre}>{l.nombre ?? ''}</span>
                  </td>
                  <td className={styles.derecha}>{formatearCantidad(p?.pedido ?? l.cantidad)}</td>
                  <td className={styles.derecha}>{formatearCantidad(p?.entregado ?? 0)}</td>
                  <td className={styles.derecha}>
                    {p && p.exceso > 0 ? (
                      <span className={styles.marcaExceso}>
                        +{formatearCantidad(p.exceso)} de más
                      </span>
                    ) : (
                      formatearCantidad(p?.pendiente ?? l.cantidad)
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
