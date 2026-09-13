import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { NavegacionInformes } from '../components/NavegacionInformes'
import { SelectorMes } from '../components/SelectorMes'
import { useMesInformes } from '../hooks/useMesInformes'
import { leerVista } from '../lib/vista'
import { StockVista } from '../components/StockVista'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { ConversionCotizaciones } from '../components/ConversionCotizaciones'
import { CumplimientoPedidos } from '../components/CumplimientoPedidos'
import { EtapasPipeline } from '../components/EtapasPipeline'
import { ExportarInforme } from '../components/ExportarInforme'
import { RankingComercial } from '../components/RankingComercial'
import { SerieMensual } from '../components/SerieMensual'
import { TarjetaActividad } from '../components/TarjetaActividad'
import { TicketPromedio } from '../components/TicketPromedio'
import { useActividad, usePipeline } from '../hooks/useActividad'
import { etiquetaTramo, textoRevision } from '../lib/actividad'
import { etiquetaDoceMeses } from '../lib/pipeline'
import { RANKING_INICIAL } from '../lib/rankings'
import { puedeVerInformes } from '../lib/permisos'
import { ErrorInforme } from '../services/actividad'
import type { ActividadComercial, ParametrosRanking, PeriodoCohorte, PipelineComercial, TipoActividad } from '../types'
import styles from '../components/Informes.module.css'

/**
 * Informes · actividad comercial (Entrega 1); pipeline, conversión,
 * cumplimiento y ticket (Entrega 2); rankings y CSV (Entrega 3).
 *
 * Todo lo agregan funciones del servidor (`informe_actividad_comercial`,
 * `informe_pipeline_comercial`, `informe_rankings_comerciales`): la pantalla
 * no baja documentos. Reglas a la vista, porque cambian lo que el legacy mostraba:
 * «vendido» es lo entregado, cada moneda por separado y sin convertir, y el mes
 * sale de la fecha del documento.
 */
export function InformesPage() {
  const { activa } = useEmpresa()
  if (!puedeVerInformes(activa?.rol)) {
    return (
      <div className={styles.page}>
        <h1 className={styles.titulo}>Informes</h1>
        <p className={styles.vacio}>Tu rol en esta empresa no tiene acceso a Informes.</p>
      </div>
    )
  }
  return <VistasInformes />
}

function VistasInformes() {
  const [params] = useSearchParams()
  const vista = leerVista(params.get('vista'))
  return (
    <div className={styles.page}>
      <NavegacionInformes vista={vista} />
      {vista === 'stock' ? <StockVista /> : <ActividadComercialVista />}
    </div>
  )
}

const RUTA_LISTADO: Record<TipoActividad, string> = {
  entregas: '/ventas/entregas',
  pedidos: '/ventas/pedidos',
  cotizaciones: '/ventas/cotizaciones',
}

function ActividadComercialVista() {
  const { mes, tope } = useMesInformes()
  const actividad = useActividad(mes)
  const pipeline = usePipeline(mes)
  const queryClient = useQueryClient()
  const [ranking, setRanking] = useState<ParametrosRanking>(RANKING_INICIAL)
  const cambiarRanking = (c: Partial<ParametrosRanking>) => setRanking((prev) => ({ ...prev, ...c }))
  const actualizando = useIsFetching({ queryKey: ['informes'] }) > 0

  return (
    <div className={styles.vista}>
      <header className={styles.encabezado}>
        <div>
          <h1 className={styles.titulo}>Informes · Actividad comercial</h1>
          <p className={styles.subtitulo}>
            {actividad.data
              ? `${etiquetaTramo(actividad.data.actual)} contra ${etiquetaTramo(actividad.data.anterior)}`
              : 'Cargando…'}
          </p>
        </div>
        <div className={styles.accionesEncabezado}>
          <SelectorMes />
          <button
            type="button"
            className={styles.boton}
            // Actividad, pipeline y el ranking a la vista: todo lo de Informes.
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['informes'] })}
            disabled={actualizando}
          >
            {actualizando && !actividad.isPending ? 'Actualizando…' : 'Actualizar'}
          </button>
          <ExportarInforme mes={mes} mesEfectivo={mes ?? tope} />
        </div>
      </header>

      <details className={styles.reglas}>
        <summary>Cómo se calcula</summary>
        <ul>
          <li><b>Vendido</b> es lo <b>entregado</b>: remitos confirmados. Los pedidos confirmados van aparte.</li>
          <li><b>Cotizado</b>: cotizaciones emitidas (no borradores), también las rechazadas o vencidas.</li>
          <li>Cada moneda por separado y <b>sin conversión</b>. Los documentos sin moneda van en <b>SIN MONEDA</b>.</li>
          <li>El mes sale de la <b>fecha del documento</b>. Importes con impuestos.</li>
          <li>En el mes en curso se compara contra los <b>mismos días</b> del mes anterior.</li>
          <li><b>Pipeline</b>: cotizaciones abiertas (enviadas o aceptadas, sin pedido confirmado) y pedidos pendientes son el estado de <b>hoy</b>; lo entregado es del período. No es un embudo.</li>
          <li><b>Conversión</b>: cotizaciones con fecha en el período que tienen un <b>pedido confirmado enlazado</b>. El estado «aceptada» no alcanza. <b>Denominador</b>: todas las emitidas en el período (no borradores), incluidas rechazadas y vencidas.</li>
          <li><b>Cumplimiento</b>: cada pedido confirmado contra sus remitos confirmados, línea por línea. Los pedidos <b>sin evidencia</b> (no consta entrega o detalle no reconstruido) se muestran aparte y <b>no entran al porcentaje</b>: no se los da por no entregados.</li>
          <li><b>Pendiente</b>: lo que falta de cada línea × precio del pedido, neto de impuestos. Sólo pedidos con evidencia.</li>
          <li><b>Ticket promedio</b>: total de los documentos ÷ cantidad, en cada moneda. Nunca se promedian monedas distintas.</li>
          <li><b>Rankings</b>: clientes por el total de sus documentos (con impuestos), agrupados por el cliente vinculado, no por el nombre. Productos por sus líneas (precio de la línea, con descuentos e IVA; precio 0 = importe 0) o por cantidad, agrupados por producto del catálogo; las líneas históricas sin producto van aparte, por su SKU exacto. Los remitos no tienen precio: productos entregados sólo por cantidad. Líneas con cantidad ≥ 1000 e importe 0 se marcan como <b>dato atípico</b>, sin ocultarlas. Empates: más documentos primero, después por nombre.</li>
          <li><b>CSV</b>: lo pide al servidor con el mes elegido y trae todo, no sólo lo visible. Moneda en su propia columna, importes con punto decimal, fechas AAAA-MM-DD.</li>
        </ul>
      </details>

      {actividad.isPending ? (
        <p className={styles.nota}>Leyendo el informe…</p>
      ) : actividad.error ? (
        <div className={styles.error} role="alert">
          <span>{actividad.error instanceof ErrorInforme ? actividad.error.message : 'No se pudo leer el informe.'}</span>
          {/* Sin permiso o mes futuro no se arreglan reintentando. */}
          {actividad.error instanceof ErrorInforme && actividad.error.codigo !== 'desconocido' ? null : (
            <button type="button" className={styles.boton} onClick={() => void actividad.refetch()}>
              Reintentar
            </button>
          )}
        </div>
      ) : (
        <Contenido datos={actividad.data} pipeline={pipeline} mes={mes} mesEfectivo={mes ?? tope} ranking={ranking} onCambiarRanking={cambiarRanking} />
      )}
    </div>
  )
}

interface ContenidoProps {
  datos: ActividadComercial
  pipeline: ReturnType<typeof usePipeline>
  mes: string | null
  mesEfectivo: string
  ranking: ParametrosRanking
  onCambiarRanking: (c: Partial<ParametrosRanking>) => void
}

function Contenido({ datos, pipeline, mes, mesEfectivo, ranking, onCambiarRanking }: ContenidoProps) {
  const etiquetaActual = etiquetaTramo(datos.actual)
  const etiquetaAnterior = etiquetaTramo(datos.anterior)
  const enRevision = datos.kpis.filter((k) => k.enRevisionActual > 0)

  return (
    <>
      {enRevision.length > 0 ? (
        <div className={styles.aviso} role="status">
          <span>
            Hay documentos marcados para revisar en {etiquetaActual}. Se muestran tal cual: a los sin moneda no se les asigna una.
            El enlace abre todos los marcados, con o sin moneda.
          </span>
          <span className={styles.enlaces}>
            {enRevision.map((k) => (
              <Link
                key={k.tipo}
                to={`${RUTA_LISTADO[k.tipo]}?revision=1&desde=${datos.actual.desde}&hasta=${datos.actual.hasta}`}
                className={styles.enlace}
              >
                {textoRevision(k)}
              </Link>
            ))}
          </span>
        </div>
      ) : null}

      <div className={styles.tarjetas}>
        {datos.kpis.map((k) => (
          <TarjetaActividad key={k.tipo} kpi={k} etiquetaActual={etiquetaActual} etiquetaAnterior={etiquetaAnterior} />
        ))}
      </div>

      <SerieMensual series={datos.series} />

      {pipeline.isPending ? (
        <p className={styles.nota}>Leyendo pipeline y conversión…</p>
      ) : pipeline.error ? (
        <div className={styles.error} role="alert">
          <span>{pipeline.error instanceof ErrorInforme ? pipeline.error.message : 'No se pudo leer pipeline y conversión.'}</span>
          {pipeline.error instanceof ErrorInforme && pipeline.error.codigo !== 'desconocido' ? null : (
            <button type="button" className={styles.boton} onClick={() => void pipeline.refetch()}>
              Reintentar
            </button>
          )}
        </div>
      ) : (
        <SeccionesPipeline datos={datos} pipeline={pipeline.data} etiquetaActual={etiquetaActual} etiquetaAnterior={etiquetaAnterior} />
      )}

      <RankingComercial
        actividad={datos}
        mes={mes}
        mesEfectivo={mesEfectivo}
        elegidos={ranking}
        onCambiar={onCambiarRanking}
        etiquetaMes={etiquetaActual}
        etiquetaDoceMeses={`12 meses (${etiquetaDoceMeses({ desde: datos.series[0]?.meses[0]?.mes ?? datos.actual.desde, hasta: datos.actual.hasta, parcial: datos.actual.parcial })})`}
      />
    </>
  )
}

function SeccionesPipeline({
  datos,
  pipeline,
  etiquetaActual,
  etiquetaAnterior,
}: {
  datos: ActividadComercial
  pipeline: PipelineComercial
  etiquetaActual: string
  etiquetaAnterior: string
}) {
  const etiquetas: Record<PeriodoCohorte, string> = {
    actual: etiquetaActual,
    anterior: etiquetaAnterior,
    '12m': `12 meses (${etiquetaDoceMeses(pipeline.tramos['12m'])})`,
  }
  return (
    <>
      <EtapasPipeline pipeline={pipeline} actividad={datos} etiquetaActual={etiquetaActual} />
      <ConversionCotizaciones pipeline={pipeline} etiquetas={etiquetas} />
      <CumplimientoPedidos pipeline={pipeline} etiquetas={etiquetas} />
      <TicketPromedio actividad={datos} etiquetas={etiquetas} />
    </>
  )
}
