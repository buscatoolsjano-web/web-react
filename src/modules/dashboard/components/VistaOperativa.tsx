import type { ReactNode } from 'react'
import { Alert } from '@/components/feedback/Alert'
import { LinkButton } from '@/components/ui/LinkButton'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { useBandeja, useCuentas } from '@/modules/emails/hooks/useEmails'
import { puedeUsarEmails } from '@/modules/emails/lib/permisos'
import { FILTROS_INICIALES as FILTROS_EMAILS } from '@/modules/emails/types'
import { useActividad, usePipeline } from '@/modules/informes/hooks/useActividad'
import { puedeVerConfiguracion } from '@/modules/configuracion/lib/permisos'
import { useAutoridadNumeracion } from '@/modules/ventas/hooks/useAutoridadNumeracion'
import { useDocumentos } from '@/modules/ventas/hooks/useDocumentos'
import { FILTROS_INICIALES as FILTROS_VENTAS } from '@/modules/ventas/types'
import type { DocTypeVentas } from '@/modules/ventas/lib/autoridad'
import { cotizacionesAbiertas, textoAutoridadStel } from '../lib/inicio'
import { avisoDeMesParcial, etiquetaDeTramo, mesLargo } from '../lib/panel'
import { useAtencion, usePendientePorPersona, useUltimosDocumentos } from '../hooks/useDashboard'
import { documentosSinAutor, separarMiFila } from '../services/pendientePorPersona'
import { AtencionHoy, type TarjetaAtencion } from './AtencionHoy'
import { MiTrabajo } from './MiTrabajo'
import { PendientePorPersona } from './PendientePorPersona'
import { EvolucionComercial } from './EvolucionComercial'
import { KpiComercial } from './KpiComercial'
import { UltimosDocumentos } from './UltimosDocumentos'
import { RejillaInicio } from './RejillaInicio'
import type { ClaveWidget, Widget } from '../lib/widgets'
import styles from './Panel.module.css'

/**
 * Los correos que esperan una respuesta nuestra (Fase 40).
 *
 * ANTES ESTA TARJETA MENTÍA, y mentía fuerte: decía 1515 sobre 1516 hilos que
 * existían. Pedía `estado: 'pendiente'` sobre la carpeta «Todos», y
 * `workflow_status` sólo existe si alguien lo tocó —lo tocó 6 veces en la
 * vida—, así que el `coalesce(..., 'pendiente')` de la RPC marcaba como
 * pendiente absolutamente todo: lo que mandamos nosotros, los 311 borradores
 * y el correo archivado de hace dos años.
 *
 * Ahora son tres condiciones, y las tres hacen falta: está en RECIBIDOS, el
 * último que habló fue el otro, y nadie lo dio por resuelto. Da 718, y cada
 * uno de esos 718 es un correo que alguien nos mandó y nadie contestó.
 *
 * Los mismos filtros que `destino`: el número de acá y la lista a la que
 * lleva el link son la misma consulta, no dos definiciones parecidas.
 */
const EMAILS_SIN_RESPONDER = {
  ...FILTROS_EMAILS,
  carpeta: 'recibidos' as const,
  soloSinResponder: true,
  porPagina: 1,
}

/**
 * Los pedidos por entregar salen del MISMO listado al que lleva la tarjeta.
 *
 * No del pipeline, y el motivo se midió: el pipeline los clasifica por lo
 * entregado de cada LÍNEA y da 18, mientras el estado de cumplimiento del
 * servidor dice 28. Las líneas migradas tienen huecos, así que el número
 * bueno es el del encabezado. Y como se pide con los mismos filtros que el
 * destino, la tarjeta y la lista no pueden discrepar: es la misma consulta y
 * la misma caché.
 */
const PEDIDOS_PENDIENTES = { ...FILTROS_VENTAS, pendienteDeEntrega: true, porPagina: 1 }
const TIPOS_STEL: readonly DocTypeVentas[] = ['quote', 'sales_order', 'delivery']

/**
 * El Dashboard de admin y employee (Fase 21 · E2).
 *
 * Seis bloques en este orden, y nada más: período · situación del mes ·
 * atención hoy · evolución · últimos documentos · accesos. El orden ES el
 * diseño: en un segundo se lee el cotizado, en tres lo que hay que resolver.
 *
 * Lo comercial sale de `informe_actividad_comercial` y
 * `informe_pipeline_comercial` —las mismas dos RPC y las mismas claves de
 * caché que Informes—, así que la comparación de períodos equivalentes y la
 * serie de doce meses **no costaron ni una consulta nueva**: ya venían ahí.
 *
 * Cada bloque carga, falla y se vacía por su cuenta: que el gráfico no lea no
 * puede dejar en blanco los pendientes del día.
 */
export interface VistaOperativaProps {
  /** Los accesos rápidos, que ahora son un widget más del inicio. */
  accesos: ReactNode
  /** Cómo está acomodado el inicio de esta persona, y los controles. */
  inicio: {
    widgets: readonly Widget[]
    acomodando: boolean
    subir: (c: ClaveWidget) => void
    bajar: (c: ClaveWidget) => void
    agrandar: (c: ClaveWidget) => void
    achicar: (c: ClaveWidget) => void
  }
}

export function VistaOperativa({ accesos, inicio }: VistaOperativaProps) {
  const { activa } = useEmpresa()
  const rol = activa?.rol ?? null

  const actividad = useActividad(null)
  const pipeline = usePipeline(null)
  const atencion = useAtencion()
  const cuentas = useCuentas()
  const bandeja = useBandeja(EMAILS_SIN_RESPONDER)
  const porPersona = usePendientePorPersona()
  const autoridad = useAutoridadNumeracion()
  const ultimos = useUltimosDocumentos(8)
  const porEntregar = useDocumentos('pedido', PEDIDOS_PENDIENTES)

  const verEmails = puedeUsarEmails(rol) && (cuentas.data?.length ?? 0) > 0
  const tiposStel = autoridad.cargando ? [] : TIPOS_STEL.filter((t) => autoridad.stel(t))

  const abiertas = pipeline.data ? cotizacionesAbiertas(pipeline.data) : null
  const aceptadasSinPedido = (pipeline.data?.abiertas ?? []).reduce((s, a) => s + a.aceptadas, 0)

  const tarjetas: TarjetaAtencion[] = [
    {
      clave: 'cotizaciones',
      icono: 'cart',
      titulo: 'Cotizaciones abiertas',
      valor: abiertas?.documentos ?? null,
      // Fase 21 · E3: el listado ya sabe decir «abierta» con la misma regla que
      // cuenta este número, así que el link lleva exactamente a estas 154.
      detalle: abiertas ? `Enviadas o aceptadas sin pedido confirmado · ${aceptadasSinPedido} ya aceptadas` : null,
      destino: '/ventas/cotizaciones?abierta=1',
      etiquetaDestino: abiertas ? `Ver las ${abiertas.documentos} abiertas` : 'Ver abiertas',
      cargando: pipeline.isPending,
      error: !!pipeline.error,
      onReintentar: () => void pipeline.refetch(),
    },
    {
      clave: 'pedidos',
      icono: 'truck',
      titulo: 'Pedidos por entregar',
      valor: porEntregar.data?.total ?? null,
      detalle: 'Confirmados y todavía sin entregar del todo.',
      destino: '/ventas/pedidos?pendiente=1',
      etiquetaDestino: 'Ver pedidos pendientes',
      cargando: porEntregar.isPending,
      error: !!porEntregar.error,
      onReintentar: () => void porEntregar.refetch(),
    },
    {
      clave: 'revision',
      icono: 'alert-triangle',
      titulo: 'Documentos que requieren atención',
      valor: atencion.data?.total ?? null,
      detalle: atencion.data
        ? atencion.data.conNoVerificable > 0
          ? `${atencion.data.conNoVerificable} tienen algún motivo que no se puede verificar desde el documento.`
          : 'Motivos que todavía se comprueban en el documento de hoy.'
        : null,
      destino: '/informes',
      etiquetaDestino: 'Ver el informe',
      cargando: atencion.isPending,
      error: !!atencion.error,
      onReintentar: () => void atencion.refetch(),
    },
    ...(verEmails
      ? [
          {
            clave: 'emails',
            icono: 'mail' as const,
            titulo: 'Emails sin responder',
            valor: bandeja.data?.total ?? null,
            detalle: bandeja.data && bandeja.data.totalSinLeer > 0 ? `${bandeja.data.totalSinLeer} sin leer.` : null,
            destino: '/emails?sinresponder=1',
            etiquetaDestino: 'Ver la bandeja',
            cargando: bandeja.isPending,
            error: !!bandeja.error,
            onReintentar: () => void bandeja.refetch(),
          },
        ]
      : []),
  ]

  const tramo = actividad.data?.actual
  const parcial = tramo ? avisoDeMesParcial(tramo) : null

  // Mi fila sale del mismo tablero que las demás: la marca el servidor.
  const { mio, resto } = separarMiFila(porPersona.data ?? [])

  return (
    <>
      {tiposStel.length > 0 ? (
        <Alert
          tone="warning"
          title={`STEL numera ${textoAutoridadStel(tiposStel)}`}
          action={
            puedeVerConfiguracion(rol) ? (
              <LinkButton to="/configuracion/numeracion" variant="secondary" size="sm">
                Ver numeración
              </LinkButton>
            ) : undefined
          }
        >
          <p>La emisión desde el ERP está bloqueada para esos documentos hasta completar la migración. Se pueden consultar y editar borradores.</p>
        </Alert>
      ) : null}

      {/* A · El período, explícito. Un mes a medias se dice que está a medias:
          si no, «bajó 22 %» parece un derrumbe y son ocho días que faltan. */}
      <div className={styles.periodo}>
        <p className={styles.periodoTexto}>
          <span className={styles.periodoMes}>{tramo ? mesLargo(tramo.desde) : '…'}</span>
          {parcial ? ` · ${parcial}` : ''}
        </p>
        {actividad.data ? (
          <p className={styles.periodoTexto}>
            Se compara {etiquetaDeTramo(actividad.data.actual)} contra {etiquetaDeTramo(actividad.data.anterior)}
          </p>
        ) : null}
      </div>

      {/*
        B en adelante · LOS BLOQUES, EN EL ORDEN QUE ELIGIÓ QUIEN MIRA
        (Fase 76).

        Hasta acá esto era una pila fija: gráfico, números, atención, lo mío,
        el resto, últimos. El orden estaba discutido bloque por bloque —y los
        comentarios de cada fase lo cuentan— pero era UNO SOLO para todos.

        Ahora la vista arma QUÉ dibuja cada widget y la rejilla decide DÓNDE y
        DE QUÉ TAMAÑO, con lo que esta persona guardó. Las consultas no
        cambian: son las mismas de siempre y se piden igual, acomodar el
        inicio no pide un dato más.

        El período se queda afuera, arriba y fijo: es el marco —de qué mes se
        habla y contra qué se compara— y un marco que se puede mandar al fondo
        deja de ser un marco.
      */}
      <RejillaInicio
        widgets={inicio.widgets}
        acomodando={inicio.acomodando}
        onSubir={inicio.subir}
        onBajar={inicio.bajar}
        onAgrandar={inicio.agrandar}
        onAchicar={inicio.achicar}
        contenido={{
          accesos,
          evolucion: (
            <EvolucionComercial
              actividad={actividad.data}
              cargando={actividad.isPending}
              error={!!actividad.error}
              onReintentar={() => void actividad.refetch()}
            />
          ),
          kpis: (
            /* Un protagonista y dos secundarios. */
            <div className={styles.situacion}>
              <KpiComercial
                actividad={actividad.data}
                tipo="cotizaciones"
                protagonista
                destino="/ventas/cotizaciones"
                cargando={actividad.isPending}
                error={!!actividad.error}
                onReintentar={() => void actividad.refetch()}
              />
              <KpiComercial
                actividad={actividad.data}
                tipo="pedidos"
                destino="/ventas/pedidos"
                cargando={actividad.isPending}
                error={!!actividad.error}
                onReintentar={() => void actividad.refetch()}
              />
              <KpiComercial
                actividad={actividad.data}
                tipo="entregas"
                destino="/ventas/entregas"
                cargando={actividad.isPending}
                error={!!actividad.error}
                onReintentar={() => void actividad.refetch()}
              />
            </div>
          ),
          atencion: <AtencionHoy tarjetas={tarjetas} atencion={atencion.data} />,
          /*
            LO MÍO Y LO DEL RESTO SON DOS WIDGETS Y UNA SOLA CONSULTA: la RPC
            marca con `auth.uid()` cuál de sus filas es la del que mira y el
            cliente la separa acá (Fase 64).
          */
          miTrabajo: (
            <MiTrabajo
              mio={mio}
              sinAutor={documentosSinAutor(porPersona.data ?? [])}
              mes={tramo?.desde ?? null}
              cargando={porPersona.isPending}
            />
          ),
          /*
            El de los demás, SÓLO PARA ADMIN (Fase 74). «Lo tuyo» lo ve
            cualquiera: es su propio trabajo. Cómo está repartido el equipo es
            información de quien reparte. La consulta no cambia —el servidor
            la deja para admin y employee—: esto es la pantalla eligiendo qué
            mostrar, no una puerta.

            Sin este widget la clave `equipo` tampoco está en la lista que se
            puede acomodar: ver `disponibles` en DashboardPage.
          */
          ...(rol === 'admin'
            ? {
                equipo: (
                  <PendientePorPersona
                    filas={resto}
                    cargando={porPersona.isPending}
                    error={!!porPersona.error}
                    onReintentar={() => void porPersona.refetch()}
                  />
                ),
              }
            : {}),
          ultimos: (
            <UltimosDocumentos
              documentos={ultimos.documentos}
              cargando={ultimos.cargando}
              error={!!ultimos.error}
              parcial={ultimos.parcial}
              onReintentar={ultimos.reintentar}
            />
          ),
        }}
      />
    </>
  )
}
