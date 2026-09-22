import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import doc from '@/components/document/Document.module.css'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Button } from '@/components/ui/Button'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { TabPanel } from '@/components/ui/Tabs'
import { Icon } from '@/components/icons/Icon'
import { ID_PESTANAS_INFORMES, NavegacionInformes } from '../components/NavegacionInformes'
import { SelectorMes } from '../components/SelectorMes'
import { useMesInformes } from '../hooks/useMesInformes'
import { ResumenComercial } from '../components/ResumenComercial'
import { SeccionDocumentos } from '../components/SeccionDocumentos'
import { SelectorMoneda } from '../components/SelectorMoneda'
import { TablaDocumentos } from '../components/TablaDocumentos'
import { FichaDesdeInforme } from '../components/FichaDesdeInforme'
import { useDocumentosInforme } from '../hooks/useActividad'
import { useFiltrosInformes } from '../hooks/useFiltrosInformes'
import type { FiltrosInformes } from '../lib/filtrosInformes'
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
      <div className={doc.listado}>
        <PageHeader title="Informes" />
        <EmptyState icon="bar-chart" title="Sin acceso a Informes" description="Tu rol en esta empresa no tiene acceso a Informes." />
      </div>
    )
  }
  return <VistasInformes />
}

function VistasInformes() {
  const [params] = useSearchParams()
  const vista = leerVista(params.get('vista'))
  // Un solo h1 para la sección; cada pestaña titula su vista con un h2.
  return (
    <div className={doc.listado}>
      <PageHeader title="Informes" subtitle="Actividad comercial y stock, calculados en el servidor." />
      <div>
        <NavegacionInformes vista={vista} />
        <TabPanel tabsId={ID_PESTANAS_INFORMES} tabKey={vista}>
          {vista === 'stock' ? <StockVista /> : <ActividadComercialVista />}
        </TabPanel>
      </div>
    </div>
  )
}

/**
 * La métrica de la pantalla y la fuente del ranking son la MISMA cosa con dos
 * nombres: el ranking nació antes y usa «entregado/pedido/cotizado». Se
 * traducen acá, una vez, en vez de dejar que convivan dos vocabularios.
 */
const FUENTE_DE: Record<TipoActividad, ParametrosRanking['fuente']> = {
  cotizaciones: 'cotizado',
  pedidos: 'pedido',
  entregas: 'entregado',
}
const METRICA_DE: Record<ParametrosRanking['fuente'], TipoActividad> = {
  cotizado: 'cotizaciones',
  pedido: 'pedidos',
  entregado: 'entregas',
}

const RUTA_LISTADO: Record<TipoActividad, string> = {
  entregas: '/ventas/entregas',
  pedidos: '/ventas/pedidos',
  cotizaciones: '/ventas/cotizaciones',
}

function ActividadComercialVista() {
  const { tope } = useMesInformes()
  // Fase 21 · E3: el informe entero vive en la URL. El ranking también, así
  // que un link comparte exactamente la pantalla que uno estaba mirando.
  const { filtros, overlay, cambiar, abrir, cerrar } = useFiltrosInformes()
  const mes = filtros.mes
  const actividad = useActividad(mes)
  const pipeline = usePipeline(mes)
  const queryClient = useQueryClient()
  const ranking: ParametrosRanking = {
    ...RANKING_INICIAL,
    dimension: filtros.dimension,
    medida: filtros.medida,
    periodo: filtros.periodo,
    fuente: FUENTE_DE[filtros.metrica],
    moneda: filtros.moneda,
  }
  const cambiarRanking = (c: Partial<ParametrosRanking>) =>
    cambiar({
      ...(c.dimension !== undefined && { dimension: c.dimension }),
      ...(c.medida !== undefined && { medida: c.medida }),
      ...(c.periodo !== undefined && { periodo: c.periodo }),
      ...(c.moneda !== undefined && { moneda: c.moneda }),
      ...(c.fuente !== undefined && { metrica: METRICA_DE[c.fuente] }),
    })
  const actualizando = useIsFetching({ queryKey: ['informes'] }) > 0

  /*
   * Qué monedas TIENEN documentos en este período, sacadas de los datos.
   * Y cuál se está mirando: la de la URL si sigue existiendo, o la primera.
   * Elegir una moneda que este mes no tuvo operaciones deja la pantalla vacía
   * sin decir por qué.
   */
  const monedasDelPeriodo = actividad.data
    ? [...new Set(actividad.data.kpis.flatMap((k) => k.monedas.map((m) => m.moneda)))].sort()
    : []
  const monedaEfectiva =
    filtros.moneda && monedasDelPeriodo.includes(filtros.moneda) ? filtros.moneda : (monedasDelPeriodo[0] ?? null)

  return (
    <div className={styles.vista}>
      <header className={styles.encabezado}>
        <div>
          <h2 className={styles.tituloVista}>Actividad comercial</h2>
          {/* Con error no hay período que mostrar: la alerta de abajo lo explica. */}
          {actividad.data ? (
            <p className={styles.subtitulo}>{`${etiquetaTramo(actividad.data.actual)} contra ${etiquetaTramo(actividad.data.anterior)}`}</p>
          ) : actividad.isPending ? (
            <p className={styles.subtitulo}>Cargando…</p>
          ) : null}
        </div>
        <div className={styles.accionesEncabezado}>
          <SelectorMoneda monedas={monedasDelPeriodo} valor={monedaEfectiva} onCambiar={(m) => cambiar({ moneda: m })} />
          <SelectorMes />
          <Button
            variant="ghost"
            icon={<Icon name="refresh" size={16} />}
            // Actividad, pipeline y el ranking a la vista: todo lo de Informes.
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['informes'] })}
            loading={actualizando && !actividad.isPending}
            disabled={actualizando}
          >
            {actualizando && !actividad.isPending ? 'Actualizando…' : 'Actualizar'}
          </Button>
          <ExportarInforme
            mes={mes}
            mesEfectivo={mes ?? tope}
            /* El universo que se está viendo: mismo período, misma métrica,
               misma moneda y mismos filtros que la sección Documentos. */
            universo={
              actividad.data
                ? {
                    desde: actividad.data.actual.desde,
                    hasta: actividad.data.actual.hasta,
                    tipo: filtros.metrica,
                    moneda: monedaEfectiva,
                    estado: filtros.estado,
                    serie: filtros.serie,
                    origen: filtros.origen,
                  }
                : null
            }
            etiquetaUniverso={actividad.data ? etiquetaTramo(actividad.data.actual) : 'el período'}
          />
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
        <div className={styles.cargando}>
          <SkeletonRows rows={4} columns={4} label="Leyendo el informe…" />
        </div>
      ) : actividad.error ? (
        <ErrorState
          title={actividad.error instanceof ErrorInforme ? actividad.error.message : 'No se pudo leer el informe.'}
          // Sin permiso o mes futuro no se arreglan reintentando.
          onRetry={actividad.error instanceof ErrorInforme && actividad.error.codigo !== 'desconocido' ? undefined : () => void actividad.refetch()}
          retrying={actividad.isFetching}
        />
      ) : (
        <Contenido
          datos={actividad.data}
          pipeline={pipeline}
          mes={mes}
          mesEfectivo={mes ?? tope}
          ranking={ranking}
          onCambiarRanking={cambiarRanking}
          filtros={filtros}
          moneda={monedaEfectiva}
          onCambiar={cambiar}
          onAbrirFicha={abrir}
        />
      )}

      {/* La ficha abierta vive en la URL, así que se monta acá y no dentro de
          una sección: se llega a ella desde el ranking, desde el drill-down o
          desde un link pegado en un chat, y cerrarla no toca los filtros. */}
      <FichaDesdeInforme
        ficha={overlay ? { tipo: overlay.tipo, id: overlay.id } : null}
        onCerrar={cerrar}
      />
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
  filtros: FiltrosInformes
  moneda: string | null
  onCambiar: (c: Partial<FiltrosInformes>) => void
  onAbrirFicha: (tipo: 'cliente' | 'producto', id: string) => void
}

function Contenido({
  datos,
  pipeline,
  mes,
  mesEfectivo,
  ranking,
  onCambiarRanking,
  filtros,
  moneda,
  onCambiar,
  onAbrirFicha,
}: ContenidoProps) {
  const etiquetaActual = etiquetaTramo(datos.actual)
  const etiquetaAnterior = etiquetaTramo(datos.anterior)
  const enRevision = datos.kpis.filter((k) => k.enRevisionActual > 0)
  // Qué KPI tiene abierto su drill-down. No va a la URL: es de ida y vuelta,
  // como la ficha, y ensuciarla no aporta nada a compartir el informe.
  const [drilldown, setDrilldown] = useState<TipoActividad | null>(null)
  const kpiAbierto = drilldown ? datos.kpis.find((k) => k.tipo === drilldown) : undefined
  const cifraAbierta = kpiAbierto && moneda ? kpiAbierto.monedas.find((m) => m.moneda === moneda) : undefined
  const docsDrill = useDocumentosInforme(
    drilldown && moneda ? { desde: datos.actual.desde, hasta: datos.actual.hasta, tipo: drilldown, moneda } : null,
    1,
    50,
    drilldown !== null,
  )

  return (
    <>
      {enRevision.length > 0 ? (
        <Alert tone="warning" role="status" title={'Hay documentos marcados para revisar en ' + etiquetaActual}>
          <p>Se muestran tal cual: a los sin moneda no se les asigna una. El enlace abre todos los marcados, con o sin moneda.</p>
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
        </Alert>
      ) : null}

      <ResumenComercial
        datos={datos}
        moneda={moneda}
        etiquetaActual={etiquetaActual}
        etiquetaAnterior={etiquetaAnterior}
        metrica={filtros.metrica}
        onMetrica={(t) => onCambiar({ metrica: t, estado: null, serie: null })}
        onDrilldown={(t) => setDrilldown((prev) => (prev === t ? null : t))}
        abierto={drilldown}
      />

      {/* El drill-down: los documentos EXACTOS que suman el indicador que se
          acaba de tocar. El pie de la tabla compara la suma contra el KPI. */}
      {drilldown && cifraAbierta ? (
        <section className={styles.bloque} aria-label={`Documentos que suman ${etiquetaActual}`}>
          <div className={styles.tarjeta}>
            <TablaDocumentos
              datos={docsDrill.data}
              cargando={docsDrill.isPending}
              pagina={1}
              porPagina={50}
              onPagina={() => {}}
              kpiImporte={cifraAbierta.actual.importe}
              moneda={moneda}
              vacio="Sin documentos."
            />
          </div>
        </section>
      ) : null}

      {/* Las tarjetas por moneda siguen: son el detalle de las monedas que NO
          están seleccionadas, y sacarlas escondería que existen. */}
      <details className={styles.reglas}>
        <summary>Ver todas las monedas</summary>
        <div className={styles.tarjetas}>
          {datos.kpis.map((k) => (
            <TarjetaActividad key={k.tipo} kpi={k} etiquetaActual={etiquetaActual} etiquetaAnterior={etiquetaAnterior} />
          ))}
        </div>
      </details>

      <SerieMensual series={datos.series} metrica={filtros.metrica} moneda={moneda} />

      {pipeline.isPending ? (
        <div className={styles.cargando}>
          <SkeletonRows rows={3} columns={4} label="Leyendo pipeline y conversión…" />
        </div>
      ) : pipeline.error ? (
        <ErrorState
          compact
          title={pipeline.error instanceof ErrorInforme ? pipeline.error.message : 'No se pudo leer pipeline y conversión.'}
          onRetry={pipeline.error instanceof ErrorInforme && pipeline.error.codigo !== 'desconocido' ? undefined : () => void pipeline.refetch()}
          retrying={pipeline.isFetching}
        />
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
        onAbrirFicha={onAbrirFicha}
        totalDelUniverso={
          /* El total del MISMO universo que el ranking: misma métrica, misma
             moneda, mismo período. Si no se puede armar, va en nulo y la
             columna de participación no aparece. */
          moneda
            ? (datos.kpis.find((k) => k.tipo === filtros.metrica)?.monedas.find((m) => m.moneda === moneda)?.actual
                .importe ?? null)
            : null
        }
      />

      {/* El universo completo, documento por documento. Misma fuente que los
          indicadores de arriba: lo que se ve acá es lo que ellos suman. */}
      <SeccionDocumentos
        filtros={{ ...filtros, moneda }}
        onCambiar={onCambiar}
        desde={datos.actual.desde}
        hasta={datos.actual.hasta}
        etiquetaPeriodo={etiquetaActual}
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
