import { useId } from 'react'
import { Icon } from '@/components/icons/Icon'
import { formatearImporte, formatearVariacion } from '../lib/actividad'
import type { ActividadComercial, KpiActividad, Moneda, TipoActividad } from '../types'
import styles from './Informes.module.css'

/** Cómo se llama cada métrica a la vista, y en qué orden se lee. */
const METRICAS: { tipo: TipoActividad; titulo: string; nota: string }[] = [
  { tipo: 'cotizaciones', titulo: 'Cotizado', nota: 'emitidas, sin borradores' },
  { tipo: 'pedidos', titulo: 'Pedidos', nota: 'confirmados' },
  { tipo: 'entregas', titulo: 'Entregado', nota: 'remitos despachados' },
]

export interface ResumenComercialProps {
  datos: ActividadComercial
  moneda: Moneda | null
  etiquetaActual: string
  etiquetaAnterior: string
  /** Qué métrica está seleccionada: la seleccionada manda en toda la pantalla. */
  metrica: TipoActividad
  onMetrica: (t: TipoActividad) => void
  /** Abrir el drill-down de esa métrica. */
  onDrilldown: (t: TipoActividad) => void
  abierto: TipoActividad | null
}

/**
 * El resumen comercial del período (Fase 21 · E3).
 *
 * Tres números en una moneda: cotizado, pedidos y entregado. **Cotizado es el
 * principal** —es lo que se puede accionar hoy— y los otros dos acompañan;
 * antes eran tres tarjetas del mismo tamaño y ninguna decía qué mirar primero.
 *
 * Cada uno abre la lista EXACTA de documentos que lo suman. Ese click es la
 * diferencia entre un número que hay que creer y uno que se puede verificar.
 *
 * Nunca se suman monedas: si un mes tiene pesos y dólares son dos informes,
 * no un total. El selector de arriba elige cuál se está mirando.
 */
export function ResumenComercial({
  datos,
  moneda,
  etiquetaActual,
  etiquetaAnterior,
  metrica,
  onMetrica,
  onDrilldown,
  abierto,
}: ResumenComercialProps) {
  const idTitulo = useId()

  return (
    <section className={styles.bloque} aria-labelledby={idTitulo}>
      <header className={styles.bloqueCabecera}>
        <h2 id={idTitulo} className={styles.bloqueTitulo}>
          Resumen de {etiquetaActual}
        </h2>
        <p className={styles.nota}>
          En {moneda ?? 'la moneda elegida'}, contra {etiquetaAnterior}. Cada número abre los
          documentos que lo forman.
        </p>
      </header>

      <div className={styles.resumen}>
        {METRICAS.map(({ tipo, titulo, nota }, i) => {
          const kpi = datos.kpis.find((k) => k.tipo === tipo)
          return (
            <Kpi
              key={tipo}
              titulo={titulo}
              nota={nota}
              kpi={kpi}
              moneda={moneda}
              principal={i === 0}
              seleccionada={metrica === tipo}
              abierto={abierto === tipo}
              etiquetaAnterior={etiquetaAnterior}
              onSeleccionar={() => onMetrica(tipo)}
              onDrilldown={() => onDrilldown(tipo)}
            />
          )
        })}
      </div>
    </section>
  )
}

interface KpiProps {
  titulo: string
  nota: string
  kpi: KpiActividad | undefined
  moneda: Moneda | null
  principal: boolean
  seleccionada: boolean
  abierto: boolean
  etiquetaAnterior: string
  onSeleccionar: () => void
  onDrilldown: () => void
}

function Kpi({
  titulo,
  nota,
  kpi,
  moneda,
  principal,
  seleccionada,
  abierto,
  etiquetaAnterior,
  onSeleccionar,
  onDrilldown,
}: KpiProps) {
  const cifra = moneda ? kpi?.monedas.find((m) => m.moneda === moneda) : undefined
  const clases = [
    styles.kpiResumen,
    principal ? styles.kpiPrincipal : styles.kpiSecundario,
    seleccionada ? styles.kpiSeleccionado : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <article className={clases} aria-current={seleccionada ? 'true' : undefined}>
      <button type="button" className={styles.kpiCuerpo} onClick={onSeleccionar}>
        <h3 className={styles.kpiTituloResumen}>{titulo}</h3>
        <span className={styles.kpiNota}>{nota}</span>

        {cifra ? (
          <>
            <p className={styles.kpiImporte}>
              <span className={styles.kpiMoneda}>{moneda}</span> {formatearImporte(cifra.actual.importe)}
            </p>
            <p className={styles.kpiDocumentos}>
              {cifra.actual.documentos} {cifra.actual.documentos === 1 ? 'documento' : 'documentos'}
            </p>
            <Variacion variacion={cifra.variacion} anterior={etiquetaAnterior} />
          </>
        ) : (
          /* Sin datos en esta moneda no se escribe «0»: que no haya
             cotizaciones en dólares no es lo mismo que haber cotizado cero. */
          <p className={styles.kpiVacio}>Sin documentos en {moneda ?? 'esta moneda'}</p>
        )}
      </button>

      {cifra ? (
        <button
          type="button"
          className={styles.kpiDrill}
          onClick={onDrilldown}
          aria-expanded={abierto}
        >
          <Icon name={abierto ? 'chevron-up' : 'chevron-down'} size={16} />
          {abierto ? 'Ocultar documentos' : `Ver los ${cifra.actual.documentos} documentos`}
        </button>
      ) : null}
    </article>
  )
}

/**
 * La comparación contra la ventana equivalente.
 *
 * `null` no es 0 %: es que el período anterior no tuvo nada en esta moneda, y
 * ahí no hay porcentaje que calcular. Decir «+100 %» o «∞» sería inventar una
 * base que no existe.
 */
function Variacion({ variacion, anterior }: { variacion: number | null; anterior: string }) {
  if (variacion === null) {
    return <p className={styles.kpiVariacion}>Sin base de comparación en {anterior}</p>
  }
  const signo = variacion > 0 ? 'sube' : variacion < 0 ? 'baja' : 'igual'
  return (
    <p className={styles.kpiVariacion} data-direccion={signo}>
      {formatearVariacion(variacion)} vs. {anterior}
    </p>
  )
}
