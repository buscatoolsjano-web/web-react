import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Paginador } from './Paginador'
import { SkeletonRows } from '@/components/ui/Skeleton'
import tabla from '@/components/tables/Tabla.module.css'
import { formatearImporte } from '../lib/actividad'
import type { FilaDocumentoInforme, PaginaDocumentosInforme } from '../services/documentos'
import styles from './Informes.module.css'

/** Adónde lleva cada tipo. El drill-down termina en el documento real. */
const RUTA: Record<FilaDocumentoInforme['tipo'], string> = {
  cotizaciones: '/ventas/cotizaciones',
  pedidos: '/ventas/pedidos',
  entregas: '/ventas/entregas',
}

const ETIQUETA_TIPO: Record<FilaDocumentoInforme['tipo'], string> = {
  cotizaciones: 'Cotización',
  pedidos: 'Pedido',
  entregas: 'Remito',
}

export interface TablaDocumentosProps {
  datos: PaginaDocumentosInforme | undefined
  cargando: boolean
  pagina: number
  porPagina: number
  onPagina: (p: number) => void
  /**
   * El importe que el KPI afirma. Si se pasa, el pie compara y **avisa** si no
   * coincide: la lista tiene que sumar el número del que salió.
   */
  kpiImporte?: number
  moneda: string | null
  vacio: string
}

/**
 * Los documentos que forman el número (Fase 21 · E3).
 *
 * Es el drill-down de los KPI y también la sección DOCUMENTOS. La misma tabla
 * porque es la misma pregunta: qué documentos hay en el universo que estoy
 * mirando.
 *
 * El pie no es decorativo: dice cuánto suma la lista COMPLETA —no la página—
 * y, cuando viene de un KPI, lo compara contra él. Si alguna vez se separan,
 * la pantalla lo dice en lugar de mostrar dos números distintos en silencio.
 */
export function TablaDocumentos({
  datos,
  cargando,
  pagina,
  porPagina,
  onPagina,
  kpiImporte,
  moneda,
  vacio,
}: TablaDocumentosProps) {
  if (cargando && !datos) return <SkeletonRows rows={5} columns={6} label="Buscando documentos…" />
  if (!datos || datos.total === 0) return <p className={styles.vacio}>{vacio}</p>

  // Se comparan centavos: dos numéricos que vienen del mismo `sum()` no deberían
  // diferir nunca, pero un redondeo en el camino se vería acá y no en producción.
  const cuadra = kpiImporte === undefined || Math.abs(kpiImporte - datos.totalImporte) < 0.005

  return (
    <>
      <div className={tabla.contenedor}>
        <table className={tabla.tabla}>
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">Tipo</th>
              <th scope="col">Número</th>
              <th scope="col">Cliente</th>
              <th scope="col">Estado</th>
              <th scope="col">Serie</th>
              <th scope="col">Origen</th>
              <th scope="col" className={tabla.num}>Importe</th>
              <th scope="col">Moneda</th>
            </tr>
          </thead>
          <tbody>
            {datos.filas.map((d) => (
              <tr key={`${d.tipo}-${d.id}`}>
                <td className={tabla.nowrap}>{d.fecha}</td>
                <td className={tabla.nowrap}>{ETIQUETA_TIPO[d.tipo]}</td>
                <th scope="row" className={tabla.nowrap}>
                  <Link to={`${RUTA[d.tipo]}/${d.id}`} className={styles.enlaceTabla}>
                    {d.numero}
                  </Link>
                  {d.enRevision ? (
                    <Badge tone="warning" dot>
                      A revisar
                    </Badge>
                  ) : null}
                </th>
                <td>{d.cliente ?? <span className={tabla.secundario}>Sin cliente</span>}</td>
                <td className={tabla.nowrap}>{d.estado}</td>
                <td className={tabla.nowrap}>{d.serie ?? <span className={tabla.secundario}>—</span>}</td>
                <td className={tabla.nowrap}>{d.origen ?? <span className={tabla.secundario}>ERP</span>}</td>
                <td className={tabla.num}>{formatearImporte(d.importe)}</td>
                <td className={tabla.nowrap}>{d.moneda}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={styles.pieSuma}>
              <td colSpan={7}>
                {datos.total} {datos.total === 1 ? 'documento' : 'documentos'}
                {kpiImporte !== undefined ? (cuadra ? ' · suma exactamente el indicador' : ' · NO coincide con el indicador') : ''}
              </td>
              <td className={tabla.num}>
                <strong>{formatearImporte(datos.totalImporte)}</strong>
              </td>
              <td className={tabla.nowrap}>{moneda ?? ''}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {!cuadra && kpiImporte !== undefined ? (
        <p className={styles.desajuste} role="alert">
          El indicador dice {formatearImporte(kpiImporte)} y esta lista suma{' '}
          {formatearImporte(datos.totalImporte)}. Es un error: los dos salen de la misma
          definición y no pueden diferir.
        </p>
      ) : null}

      {datos.total > porPagina ? (
        <Paginador
          pagina={pagina - 1}
          porPagina={porPagina}
          total={datos.total}
          onCambiar={(p0) => onPagina(p0 + 1)}
          cargando={cargando}
          sustantivo={{ singular: 'documento', plural: 'documentos' }}
        />
      ) : null}
    </>
  )
}
