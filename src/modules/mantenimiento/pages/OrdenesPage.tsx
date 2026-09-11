import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { permisosDe } from '../lib/permisos'
import { FiltrosOrdenes } from '../components/FiltrosOrdenes'
import { ListadoOrdenes } from '../components/ListadoOrdenes'
import { Paginador } from '../components/Paginador'
import { useOrdenes } from '../hooks/useOrdenes'
import { useFiltrosOrdenes } from '../hooks/useFiltrosOrdenes'
import {
  etiquetaDeCotizacion,
  etiquetaDeEstado,
  etiquetaDeEtapa,
  etiquetaDeServicio,
} from '../lib/estados'
import { descargarCsv, ordenesACsv } from '../lib/csv'
import { exportarOrdenes } from '../services/ordenes'
import type { OrdenDeOrdenes } from '../types'
import styles from './Pagina.module.css'

/**
 * Las órdenes de servicio.
 *
 * Filtros, orden, página y total exacto los resuelve el servidor.
 */
const hoy = () => new Date().toISOString().slice(0, 10)

export function OrdenesPage() {
  const { filtros, aplicar, limpiar, hayFiltros } = useFiltrosOrdenes()
  const { data, isPending, isFetching, error } = useOrdenes(filtros)
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)

  // Las etiquetas van en castellano, como en pantalla: un CSV que dice
  // «quotation» y «on_hold» obliga a traducir a mano lo que la aplicación ya
  // sabe traducir.
  const exportar = useMutation({
    mutationFn: () => exportarOrdenes(activa!.companyId, filtros),
    onSuccess: ({ filas }) =>
      descargarCsv(
        `ordenes-de-servicio-${hoy()}.csv`,
        ordenesACsv(
          filas,
          etiquetaDeEtapa,
          etiquetaDeEstado,
          etiquetaDeServicio,
          etiquetaDeCotizacion,
        ),
      ),
  })

  const ordenar = (columna: OrdenDeOrdenes) => {
    // Click en la columna activa invierte; en otra, empieza descendente — un
    // listado de documentos se lee de lo más nuevo a lo más viejo.
    aplicar(
      columna === filtros.orden
        ? { direccion: filtros.direccion === 'asc' ? 'desc' : 'asc' }
        : { orden: columna, direccion: 'desc' },
    )
  }

  if (!permisos.ver) {
    return (
      <div className={styles.page}>
        <h1 className={styles.titulo}>Órdenes de servicio</h1>
        <p className={styles.error} role="note">
          Tu rol no tiene acceso a Mantenimiento. La sección es de administradores y empleados.
        </p>
      </div>
    )
  }

  const total = data?.total ?? 0

  return (
    <div className={styles.page}>
      <header className={styles.encabezado}>
        <div>
          <h1 className={styles.titulo}>Órdenes de servicio</h1>
          <p className={styles.subtitulo}>
            {isPending ? 'Cargando…' : `${total} ${total === 1 ? 'orden' : 'órdenes'}`}
          </p>
        </div>
        <div className={styles.acciones}>
          <Link to="/mantenimiento/activos" className={styles.secundario}>
            Equipos
          </Link>
          <Link to="/mantenimiento/puntos" className={styles.secundario}>
            Puntos de revisión
          </Link>
          <button
            type="button"
            className={styles.secundario}
            disabled={exportar.isPending || total === 0}
            onClick={() => exportar.mutate()}
          >
            {exportar.isPending ? 'Exportando…' : 'Exportar a CSV'}
          </button>
          {permisos.crear ? (
            <Link to="/mantenimiento/ordenes/nueva" className={styles.primario}>
              + Nueva orden
            </Link>
          ) : null}
        </div>
      </header>

      <FiltrosOrdenes
        filtros={filtros}
        hayFiltros={hayFiltros}
        onAplicar={aplicar}
        onLimpiar={limpiar}
      />

      {exportar.error ? (
        <p className={styles.error} role="alert">
          No se pudo exportar: {exportar.error.message}
        </p>
      ) : null}

      {error ? (
        <p className={styles.error} role="alert">
          No se pudo leer el listado: {error.message}
        </p>
      ) : (
        <>
          <ListadoOrdenes
            filas={data?.filas ?? []}
            orden={filtros.orden}
            direccion={filtros.direccion}
            onOrdenar={ordenar}
            cargando={isPending}
          />
          <Paginador
            pagina={filtros.pagina}
            porPagina={filtros.porPagina}
            total={total}
            cargando={isFetching}
            onIr={(pagina) => aplicar({ pagina })}
            onTamano={(porPagina) => aplicar({ porPagina })}
          />
        </>
      )}
    </div>
  )
}
