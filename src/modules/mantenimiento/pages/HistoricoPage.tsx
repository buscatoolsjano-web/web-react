import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Icon } from '@/components/icons/Icon'
import doc from '@/components/document/Document.module.css'
import { permisosDe } from '../lib/permisos'
import { formatearFecha, formatearNumero } from '../lib/formato'
import { etiquetaDeEstado, etiquetaDeResultado, etiquetaDeServicio } from '../lib/estados'
import { celda, descargarCsv } from '../lib/csv'
import { historicoGlobal, type FilaHistorico } from '../services/historicoGlobal'
import { cx } from '@/utils/cx'
import styles from './Historico.module.css'

/** El estado de una parte, con su color. En blanco cuando no se marcó. */
function Parte({ valor }: { valor: FilaHistorico['carcasa'] }) {
  if (valor === null) return <span className={styles.vacio}>—</span>
  return (
    <span
      className={cx(
        styles.parte,
        valor === 'ok' ? styles.ok : valor === 'nok' ? styles.nok : styles.na,
      )}
    >
      {etiquetaDeResultado(valor)}
    </span>
  )
}

/** El CP/CPK, con «N/D» cuando no hay (sin torque o sin mediciones). */
const capacidad = (v: number | null) => (v === null ? 'N/D' : formatearNumero(v))

function historicoACsv(filas: readonly FilaHistorico[]): string {
  const cabecera = [
    'N°', 'Equipo', 'Serie', 'Cliente', 'Fecha', 'Tipo', 'Técnico',
    'Carcasa', 'Tornillos', 'Embrague', 'Firmware', 'Aprietes', 'Cp', 'Cpk', 'Horas', 'Estado',
  ]
  const lineas = filas.map((f) =>
    [
      f.numero, f.equipoRef, f.serie, f.cliente, f.fecha,
      etiquetaDeServicio(f.tipoServicio), f.tecnico,
      f.carcasa ? etiquetaDeResultado(f.carcasa) : '',
      f.tornillos ? etiquetaDeResultado(f.tornillos) : '',
      f.embrague ? etiquetaDeResultado(f.embrague) : '',
      f.firmware ? etiquetaDeResultado(f.firmware) : '',
      f.aprietes, f.cp, f.cpk, f.horasTrabajo, etiquetaDeEstado(f.estado),
    ]
      .map(celda)
      .join(';'),
  )
  return [cabecera.join(';'), ...lineas].join('\n')
}

/**
 * El histórico global de todas las órdenes (Fase 219), como el «Histórico» del
 * app FEIN AccuTec: una tabla con el equipo, la fecha, el tipo, el técnico, el
 * estado de las partes al diagnóstico, los aprietes, el CP/CPK del torque, las
 * horas de trabajo y el estado. Se puede acotar a las cerradas y exportar a CSV.
 */
export function HistoricoPage() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const permisos = permisosDe(activa)
  const [soloCerradas, setSoloCerradas] = useState(false)

  const { data, isPending, error } = useQuery({
    queryKey: ['mantenimiento', companyId, 'historico', soloCerradas],
    queryFn: () => historicoGlobal(companyId!, soloCerradas),
    enabled: companyId !== null && permisos.ver,
    staleTime: 60_000,
  })

  if (!permisos.ver) {
    return (
      <div className={doc.listado}>
        <PageHeader title="Histórico" />
        <Alert tone="neutral">
          <p>Tu rol no tiene acceso a Mantenimiento. La sección es de administradores y empleados.</p>
        </Alert>
      </div>
    )
  }

  const filas = data ?? []

  return (
    <div className={doc.listado}>
      <PageHeader
        title="Histórico"
        subtitle={isPending ? 'Cargando…' : `${filas.length} ${filas.length === 1 ? 'servicio' : 'servicios'}`}
        actions={
          <>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={soloCerradas}
                onChange={(e) => setSoloCerradas(e.target.checked)}
              />
              Sólo cerradas
            </label>
            <Button
              variant="secondary"
              icon={<Icon name="download" size={16} />}
              disabled={filas.length === 0}
              onClick={() => descargarCsv('historico-mantenimiento', historicoACsv(filas))}
            >
              Exportar a CSV
            </Button>
          </>
        }
      />

      {error ? (
        <ErrorState title="No se pudo leer el histórico." description={error.message} />
      ) : isPending ? (
        <SkeletonRows rows={8} columns={6} label="Cargando histórico…" />
      ) : filas.length === 0 ? (
        <EmptyState
          icon="search"
          title={soloCerradas ? 'No hay servicios cerrados' : 'Todavía no hay servicios'}
          description="El histórico se arma solo a medida que se crean órdenes y se las trabaja."
        />
      ) : (
        <div className={styles.scroll}>
          <table className={styles.tabla}>
            <thead>
              <tr>
                <th>N°</th>
                <th>Equipo</th>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Técnico</th>
                <th>Carcasa</th>
                <th>Tornillos</th>
                <th>Embrague</th>
                <th>Firmware</th>
                <th className={styles.der}>Aprietes</th>
                <th className={styles.der}>Cp</th>
                <th className={styles.der}>Cpk</th>
                <th className={styles.der}>Horas</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td className={styles.mono}>
                    <Link to={`/mantenimiento/ordenes/${f.id}`} className={doc.enlace}>
                      {f.numero}
                    </Link>
                  </td>
                  <td>
                    <Link to={`/mantenimiento/activos/${f.equipoId}`} className={doc.enlace}>
                      {f.equipoRef}
                    </Link>
                    {f.modelo ? <span className={styles.sub}>{f.modelo}</span> : null}
                  </td>
                  <td className={styles.mono}>{formatearFecha(f.fecha)}</td>
                  <td>{etiquetaDeServicio(f.tipoServicio)}</td>
                  <td>{f.tecnico ?? <span className={styles.vacio}>—</span>}</td>
                  <td><Parte valor={f.carcasa} /></td>
                  <td><Parte valor={f.tornillos} /></td>
                  <td><Parte valor={f.embrague} /></td>
                  <td><Parte valor={f.firmware} /></td>
                  <td className={cx(styles.der, styles.mono)}>
                    {f.aprietes === null ? <span className={styles.vacio}>—</span> : formatearNumero(f.aprietes)}
                  </td>
                  <td className={cx(styles.der, styles.mono)}>{capacidad(f.cp)}</td>
                  <td className={cx(styles.der, styles.mono)}>{capacidad(f.cpk)}</td>
                  <td className={cx(styles.der, styles.mono)}>
                    {f.horasTrabajo === null ? <span className={styles.vacio}>—</span> : formatearNumero(f.horasTrabajo)}
                  </td>
                  <td>{etiquetaDeEstado(f.estado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
