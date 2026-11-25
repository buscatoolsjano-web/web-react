import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Alert } from '@/components/feedback/Alert'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { permisosDe } from '../lib/permisos'
import { formatearFecha } from '../lib/formato'
import { preventivosDelPanel, type PreventivoDelPanel } from '../services/preventivos'
import styles from './AvisoPreventivos.module.css'

/** Cuántos se nombran; el resto se cuenta. */
const A_LA_VISTA = 6

function hoyLocal(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function cuando(p: PreventivoDelPanel): string {
  if (p.dias === 0) return 'vence hoy'
  if (p.dias < 0) return `vencido hace ${-p.dias} ${p.dias === -1 ? 'día' : 'días'}`
  return `vence en ${p.dias} ${p.dias === 1 ? 'día' : 'días'}`
}

/**
 * El aviso de preventivos en el inicio (2026-11).
 *
 * Arriba de todo y no como un bloque más de la rejilla: es un pendiente con
 * fecha, no un número para mirar. Si no hay nada que avisar, no existe —ni un
 * «todo en orden»—. Sólo para quien trabaja en Mantenimiento.
 */
export function AvisoPreventivos() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const puede = permisosDe(activa).ver
  const hoy = hoyLocal()

  const q = useQuery({
    queryKey: ['mantenimiento', companyId, 'preventivos-panel', hoy],
    queryFn: () => preventivosDelPanel(companyId!, hoy),
    enabled: companyId !== null && puede,
    staleTime: 5 * 60_000,
  })

  const avisos = q.data ?? []
  if (!puede || avisos.length === 0) return null

  const vencidos = avisos.filter((a) => a.vencido).length
  const porVencer = avisos.length - vencidos
  const titulo = [
    vencidos > 0 ? `${vencidos} ${vencidos === 1 ? 'preventivo vencido' : 'preventivos vencidos'}` : null,
    porVencer > 0 ? `${porVencer} por vencer en los próximos 30 días` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Alert tone={vencidos > 0 ? 'warning' : 'info'} role="status" title={titulo}>
      <ul className={styles.lista}>
        {avisos.slice(0, A_LA_VISTA).map((a) => (
          <li key={a.assetId} className={styles.item}>
            <Link to={`/mantenimiento/activos/${a.assetId}`} className={styles.equipo}>
              {a.equipo}
            </Link>
            {a.cliente ? <span className={styles.cliente}>{a.cliente}</span> : null}
            <span className={a.vencido ? `${styles.cuando} ${styles.vencido}` : styles.cuando}>
              {cuando(a)} · {formatearFecha(a.fecha)}
            </span>
          </li>
        ))}
      </ul>
      {avisos.length > A_LA_VISTA ? (
        <p className={styles.mas}>
          Y {avisos.length - A_LA_VISTA} más.{' '}
          <Link to="/mantenimiento/activos">Ver los equipos</Link>
        </p>
      ) : null}
    </Alert>
  )
}
