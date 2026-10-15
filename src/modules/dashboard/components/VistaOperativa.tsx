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
export function VistaOperativa() {
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
        B · LA EVOLUCIÓN, ARRIBA DE TODO (Fase 63).

        Estaba cuarta, debajo de los números. Se subió a pedido, y la razón es
        buena: «lo que está arriba ahora son números, pero al no haber muchos
        gráficos no se entiende bien». Un KPI dice «bajó 22 %» sin decir contra
        qué forma: doce meses a la vista son el contexto que vuelve legibles a
        los números que siguen, no al revés.

        Queda debajo del período, que es el marco —de qué mes se habla y contra
        qué se compara— y sin eso ni el gráfico ni los números se leen bien.
      */}
      <EvolucionComercial
        actividad={actividad.data}
        cargando={actividad.isPending}
        error={!!actividad.error}
        onReintentar={() => void actividad.refetch()}
      />

      {/* C · Situación del mes: un protagonista y dos secundarios. */}
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

      {/* D */}
      <AtencionHoy tarjetas={tarjetas} atencion={atencion.data} />

      {/*
        E · LO MÍO Y DESPUÉS LO DEL RESTO (Fase 64).

        «Si entro con el usuario Jano, primero quiero ver lo que yo tengo
        pendiente o qué estuve haciendo este mes; y después abajo, el pendiente
        del resto».

        Son DOS BLOQUES Y UNA SOLA CONSULTA: la RPC marca con `auth.uid()` cuál
        de sus filas es la del que mira y el cliente la separa acá. Pedir «lo
        mío» por separado serían 220 ms para traer una fila que ya está.

        Van debajo de «Atención hoy» y no arriba: primero QUÉ hay pendiente en
        la empresa, después de quién —incluido uno mismo—.
      */}
      <MiTrabajo
        mio={mio}
        sinAutor={documentosSinAutor(porPersona.data ?? [])}
        mes={tramo?.desde ?? null}
        cargando={porPersona.isPending}
      />
      {/*
        El de los demás, SÓLO PARA ADMIN (Fase 74).

        «Lo tuyo» lo ve cualquiera que entre: es su propio trabajo. Cómo está
        repartido el equipo —quién está tapado y quién libre— es información
        de quien reparte, y además deja ver el pendiente ajeno a alguien que
        no tiene nada que hacer con él.

        La consulta NO cambia: es la misma que alimenta el bloque de arriba,
        y el servidor sigue dejándola para admin y employee. Esto es la
        pantalla eligiendo qué mostrar, no una puerta: si alguna vez hace
        falta cerrarla de verdad, se cierra en la RPC.
      */}
      {rol === 'admin' ? (
        <PendientePorPersona
          filas={resto}
          cargando={porPersona.isPending}
          error={!!porPersona.error}
          onReintentar={() => void porPersona.refetch()}
        />
      ) : null}

      {/* F */}
      <UltimosDocumentos
        documentos={ultimos.documentos}
        cargando={ultimos.cargando}
        error={!!ultimos.error}
        parcial={ultimos.parcial}
        onReintentar={ultimos.reintentar}
      />
    </>
  )
}
