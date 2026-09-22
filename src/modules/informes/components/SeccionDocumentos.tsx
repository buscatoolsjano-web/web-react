import { useId } from 'react'
import { ErrorState } from '@/components/feedback/ErrorState'
import { useDocumentosInforme, useFacetasDocumentos } from '../hooks/useActividad'
import { ErrorInforme } from '../services/actividad'
import { TablaDocumentos } from './TablaDocumentos'
import type { FiltrosInformes } from '../lib/filtrosInformes'
import type { TipoActividad } from '../types'
import styles from './Informes.module.css'

const POR_PAGINA = 50

/** Cómo se lee cada métrica en los selectores. */
const ETIQUETA_TIPO: Record<TipoActividad, string> = {
  cotizaciones: 'Cotizaciones',
  pedidos: 'Pedidos confirmados',
  entregas: 'Remitos despachados',
}

export interface SeccionDocumentosProps {
  filtros: FiltrosInformes
  onCambiar: (c: Partial<FiltrosInformes>) => void
  desde: string
  hasta: string
  etiquetaPeriodo: string
}

/**
 * DOCUMENTOS: el universo actual, documento por documento (Fase 21 · E3).
 *
 * No es un listado aparte con sus propias reglas — es la misma función que
 * alimenta los KPI y sus drill-downs, con los filtros de la pantalla. Por eso
 * lo que se ve acá SIEMPRE suma lo que dicen los indicadores de arriba.
 *
 * Los filtros de estado, serie y origen salen de los datos, no de una lista
 * escrita a mano: viendo cotizaciones no aparece «despachado», y viendo
 * remitos no aparece la serie PDV. Un selector con opciones imposibles es
 * peor que no tenerlo.
 *
 * El servidor pagina y cuenta. Nunca baja el histórico al navegador.
 */
export function SeccionDocumentos({ filtros, onCambiar, desde, hasta, etiquetaPeriodo }: SeccionDocumentosProps) {
  const idTitulo = useId()

  const consulta = {
    desde,
    hasta,
    tipo: filtros.metrica,
    moneda: filtros.moneda,
    estado: filtros.estado,
    serie: filtros.serie,
    origen: filtros.origen,
  }
  const docs = useDocumentosInforme(consulta, filtros.pagina, POR_PAGINA)
  const facetas = useFacetasDocumentos(desde, hasta, filtros.metrica, filtros.moneda)

  const opciones = (dim: 'estado' | 'serie' | 'origen') =>
    (facetas.data ?? []).filter((f) => f.dimension === dim).sort((a, b) => b.documentos - a.documentos)

  return (
    <section className={styles.bloque} aria-labelledby={idTitulo}>
      <header className={styles.bloqueCabecera}>
        <h2 id={idTitulo} className={styles.bloqueTitulo}>
          Documentos
        </h2>
        <p className={styles.nota}>
          {ETIQUETA_TIPO[filtros.metrica]} de {etiquetaPeriodo}
          {filtros.moneda ? ` en ${filtros.moneda}` : ''}. Es el mismo universo que suman los
          indicadores de arriba.
        </p>
      </header>

      <div className={styles.tarjeta}>
        <div className={styles.controlesRanking}>
          <label className={styles.control}>
            <span className={styles.controlEtiqueta}>Documento</span>
            <select
              className={styles.select}
              value={filtros.metrica}
              onChange={(e) => onCambiar({ metrica: e.target.value as TipoActividad, estado: null, serie: null })}
            >
              {(['cotizaciones', 'pedidos', 'entregas'] as const).map((t) => (
                <option key={t} value={t}>
                  {ETIQUETA_TIPO[t]}
                </option>
              ))}
            </select>
          </label>

          <Filtro
            etiqueta="Estado"
            valor={filtros.estado}
            opciones={opciones('estado')}
            onCambiar={(v) => onCambiar({ estado: v })}
          />
          <Filtro
            etiqueta="Serie"
            valor={filtros.serie}
            opciones={opciones('serie')}
            onCambiar={(v) => onCambiar({ serie: v })}
          />
          <Filtro
            etiqueta="Origen"
            valor={filtros.origen}
            opciones={opciones('origen')}
            onCambiar={(v) => onCambiar({ origen: v })}
          />
        </div>

        {docs.error ? (
          <ErrorState
            compact
            title={docs.error instanceof ErrorInforme ? docs.error.message : 'No se pudieron leer los documentos.'}
            onRetry={() => void docs.refetch()}
            retrying={docs.isFetching}
          />
        ) : (
          <TablaDocumentos
            datos={docs.data}
            cargando={docs.isPending || docs.isFetching}
            pagina={filtros.pagina}
            porPagina={POR_PAGINA}
            onPagina={(p) => onCambiar({ pagina: p })}
            moneda={filtros.moneda}
            vacio={`Sin ${ETIQUETA_TIPO[filtros.metrica].toLowerCase()} con estos filtros en ${etiquetaPeriodo}.`}
          />
        )}
      </div>
    </section>
  )
}

/**
 * Un filtro cuyas opciones son los valores que EXISTEN.
 *
 * Con el conteo al lado: «sent (143)» dice de entrada si vale la pena tocarlo.
 * Si no hay más de una opción no se muestra: un selector con un solo valor no
 * filtra nada y ocupa el lugar de algo útil.
 */
function Filtro({
  etiqueta,
  valor,
  opciones,
  onCambiar,
}: {
  etiqueta: string
  valor: string | null
  opciones: { valor: string; documentos: number }[]
  onCambiar: (v: string | null) => void
}) {
  if (opciones.length <= 1) return null
  return (
    <label className={styles.control}>
      <span className={styles.controlEtiqueta}>{etiqueta}</span>
      <select
        className={styles.select}
        value={valor ?? ''}
        onChange={(e) => onCambiar(e.target.value === '' ? null : e.target.value)}
      >
        <option value="">Todos</option>
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.valor} ({o.documentos})
          </option>
        ))}
      </select>
    </label>
  )
}
