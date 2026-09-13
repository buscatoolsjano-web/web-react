import { Link, useSearchParams } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { SerieMensual } from '../components/SerieMensual'
import { TarjetaActividad } from '../components/TarjetaActividad'
import { useActividad } from '../hooks/useActividad'
import { etiquetaTramo, leerMes, textoRevision } from '../lib/actividad'
import { puedeVerInformes } from '../lib/permisos'
import { ErrorInforme } from '../services/actividad'
import type { ActividadComercial, TipoActividad } from '../types'
import styles from '../components/Informes.module.css'

/**
 * Informes v1 · actividad comercial.
 *
 * Todo lo agrega el servidor (`informe_actividad_comercial`): la pantalla no
 * baja documentos. Reglas a la vista, porque cambian lo que el legacy mostraba:
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
  return <ActividadComercialVista />
}

/** Hoy en Argentina, `YYYY-MM`: sólo para el tope del selector; el servidor decide igual. */
function mesActualAR(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date()).slice(0, 7)
}

const RUTA_LISTADO: Record<TipoActividad, string> = {
  entregas: '/ventas/entregas',
  pedidos: '/ventas/pedidos',
  cotizaciones: '/ventas/cotizaciones',
}

function ActividadComercialVista() {
  const [params, setParams] = useSearchParams()
  const mes = leerMes(params.get('mes'))
  const tope = mesActualAR()
  const actividad = useActividad(mes)

  const cambiarMes = (valor: string) => {
    const limpio = leerMes(valor)
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (limpio && limpio !== tope) n.set('mes', limpio)
        else n.delete('mes')
        return n
      },
      { replace: true },
    )
  }

  return (
    <div className={styles.page}>
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
          <label className={styles.control}>
            <span className={styles.controlEtiqueta}>Mes</span>
            <input
              type="month"
              className={styles.inputMes}
              value={mes ?? tope}
              max={tope}
              onChange={(e) => cambiarMes(e.target.value)}
            />
          </label>
          {mes ? (
            <button type="button" className={styles.boton} onClick={() => cambiarMes(tope)}>
              Mes en curso
            </button>
          ) : null}
          <button
            type="button"
            className={styles.boton}
            onClick={() => void actividad.refetch()}
            disabled={actividad.isFetching}
          >
            {actividad.isFetching && !actividad.isPending ? 'Actualizando…' : 'Actualizar'}
          </button>
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
        <Contenido datos={actividad.data} />
      )}
    </div>
  )
}

function Contenido({ datos }: { datos: ActividadComercial }) {
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
    </>
  )
}
