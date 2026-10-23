import { useMemo, useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Spinner } from '@/components/ui/Spinner'
import { Alert } from '@/components/feedback/Alert'
import { useMetricasWeb } from '../hooks/useMetricasWeb'
import type { PorDia } from '../services/metricas'
import styles from './WebMetricasPage.module.css'

const RANGOS = [
  { dias: 7, label: '7 días' },
  { dias: 30, label: '30 días' },
  { dias: 90, label: '90 días' },
] as const

const iso = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Panel de métricas del sitio público (Fase 115).
 *
 * Los números de un vistazo —visitas, visitantes, consultas— y un gráfico de
 * visitas por día. Se va llenando a medida que entra tráfico: hoy el sitio
 * recién empieza a registrar, así que puede estar en cero, y se dice así en vez
 * de mostrar un panel vacío sin explicación.
 */
export function WebMetricasPage() {
  const [dias, setDias] = useState(30)
  const { desde, hasta } = useMemo(() => {
    const h = new Date()
    const d = new Date()
    d.setDate(d.getDate() - (dias - 1))
    return { desde: iso(d), hasta: iso(h) }
  }, [dias])

  const { data, isPending, error } = useMetricasWeb(desde, hasta)

  return (
    <div>
      <PageHeader title="Web" subtitle="Lo que pasa en el sitio público: visitas, consultas y qué se muestra." />

      <div className={styles.controles}>
        <div className={styles.rangos} role="group" aria-label="Rango de fechas">
          {RANGOS.map((r) => (
            <button
              key={r.dias}
              type="button"
              className={dias === r.dias ? `${styles.rango} ${styles.rangoActivo}` : styles.rango}
              onClick={() => setDias(r.dias)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <Alert tone="danger">No se pudieron leer las métricas.</Alert>
      ) : isPending ? (
        <div className={styles.cargando}><Spinner /> Cargando métricas…</div>
      ) : data ? (
        <>
          <section className={styles.kpis}>
            <Kpi etiqueta="Visitas" valor={data.visitas} tono="azul" />
            <Kpi etiqueta="Visitantes únicos" valor={data.visitantes} tono="violeta" />
            <Kpi etiqueta="Consultas recibidas" valor={data.consultas} tono="verde" />
            <Kpi etiqueta="Consultas pendientes" valor={data.consultasPendientes} tono="naranja" />
          </section>

          <section className={styles.panel}>
            <h2 className={styles.tituloPanel}>Visitas y consultas por día</h2>
            <GraficoPorDia dias={data.porDia} />
          </section>

          <div className={styles.dosColumnas}>
            <section className={styles.panel}>
              <h2 className={styles.tituloPanel}>Páginas más vistas</h2>
              {data.topPaths.length === 0 ? (
                <p className={styles.vacio}>Todavía no hay visitas registradas.</p>
              ) : (
                <ul className={styles.lista}>
                  {data.topPaths.map((p) => (
                    <li key={p.path}>
                      <span className={styles.listaTexto} title={p.path}>{p.path}</span>
                      <span className={styles.listaNum}>{p.visitas}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={styles.panel}>
              <h2 className={styles.tituloPanel}>Productos más pedidos</h2>
              {data.productosMasPedidos.length === 0 ? (
                <p className={styles.vacio}>Nadie pidió cotización de un producto todavía.</p>
              ) : (
                <ul className={styles.lista}>
                  {data.productosMasPedidos.map((p) => (
                    <li key={p.sku ?? p.nombre ?? ''}>
                      <span className={styles.listaTexto} title={p.nombre ?? ''}>
                        {p.nombre ?? p.sku}{p.sku && p.nombre ? <span className={styles.sku}> · {p.sku}</span> : null}
                      </span>
                      <span className={styles.listaNum}>{p.veces}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      ) : null}
    </div>
  )
}

function Kpi({ etiqueta, valor, tono }: { etiqueta: string; valor: number; tono: 'azul' | 'violeta' | 'verde' | 'naranja' }) {
  return (
    <div className={`${styles.kpi} ${styles[tono]}`}>
      <span className={styles.kpiValor}>{valor.toLocaleString('es-AR')}</span>
      <span className={styles.kpiEtiqueta}>{etiqueta}</span>
    </div>
  )
}

/** Barras de visitas por día, con las consultas marcadas encima. Inline SVG: sin
    dependencias, se lee en claro y oscuro porque usa los tokens de color. */
function GraficoPorDia({ dias }: { dias: PorDia[] }) {
  if (dias.length === 0 || dias.every((d) => d.visitas === 0 && d.consultas === 0)) {
    return <p className={styles.vacio}>Todavía no hay datos en este período. En cuanto entre gente al sitio, aparecen acá.</p>
  }
  const max = Math.max(1, ...dias.map((d) => d.visitas))
  const ancho = 100 / dias.length
  return (
    <div className={styles.grafico}>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className={styles.svg} role="img" aria-label="Visitas por día">
        {dias.map((d, i) => {
          const h = (d.visitas / max) * 38
          return (
            <g key={d.dia}>
              <rect x={i * ancho + ancho * 0.15} y={40 - h} width={ancho * 0.7} height={h} className={styles.barra} rx={0.3}>
                <title>{`${d.dia}: ${d.visitas} visitas, ${d.consultas} consultas`}</title>
              </rect>
              {d.consultas > 0 ? <circle cx={i * ancho + ancho * 0.5} cy={40 - h - 1.5} r={0.9} className={styles.punto} /> : null}
            </g>
          )
        })}
      </svg>
      <div className={styles.ejeX}>
        <span>{dias[0]?.dia.slice(5)}</span>
        <span>{dias[dias.length - 1]?.dia.slice(5)}</span>
      </div>
      <p className={styles.leyenda}>
        <span className={styles.leyendaBarra} /> Visitas
        <span className={styles.leyendaPunto} /> Días con consultas
      </p>
    </div>
  )
}
