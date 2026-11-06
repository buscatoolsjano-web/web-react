import { LinkButton } from '@/components/ui/LinkButton'
import { useAltaProductos } from '../hooks/useAltaProductos'
import styles from './Panel.module.css'

export function SaludAltaProductos() {
  const alta = useAltaProductos()
  if (alta.isPending) return <p className={styles.comparacion}>Cargando salud del alta de productos…</p>
  if (alta.error) return <p className={styles.comparacion}>No se pudo consultar la trazabilidad de productos.</p>
  const datos = alta.data
  return (
    <section className={styles.kpis} aria-label="Salud del alta de productos">
      <div className={styles.comparacion}>Alta de productos · últimas 24 horas</div>
      <div className={styles.situacion}>
        <div className={styles.kpiSecundario}><strong>{datos.attempts24h}</strong><span> intentos</span></div>
        <div className={styles.kpiSecundario}><strong>{datos.succeeded24h}</strong><span> completados</span></div>
        <div className={styles.kpiSecundario}><strong>{datos.failed24h}</strong><span> fallidos</span></div>
        <div className={styles.kpiSecundario}><strong>{datos.pending}</strong><span> pendientes</span></div>
      </div>
      <LinkButton to="/catalogo" variant="secondary" size="sm">Abrir catálogo</LinkButton>
    </section>
  )
}
