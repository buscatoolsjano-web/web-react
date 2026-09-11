import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { permisosDe } from '../lib/permisos'
import { FiltrosActivos } from '../components/FiltrosActivos'
import { ListadoActivos } from '../components/ListadoActivos'
import { Paginador } from '../components/Paginador'
import { useActivos } from '../hooks/useActivos'
import { useFiltrosActivos } from '../hooks/useFiltrosActivos'
import { descargarCsv, equiposACsv } from '../lib/csv'
import { exportarActivos } from '../services/activos'
import type { OrdenActivos } from '../types'
import styles from './Pagina.module.css'

/**
 * El parque de equipos.
 *
 * Filtros, orden, página y total exacto los resuelve el servidor: nunca se
 * traen todas las filas al navegador.
 *
 * A quien no sea admin ni employee este listado le vuelve vacío: las ocho
 * tablas de Mantenimiento usan `app.current_maintenance_company_ids()`. Se
 * avisa antes de mostrarle una pantalla en blanco, pero lo que lo impide es
 * RLS, no este `if`.
 */
const hoy = () => new Date().toISOString().slice(0, 10)

export function ActivosPage() {
  const { filtros, aplicar, limpiar, hayFiltros } = useFiltrosActivos()
  const { data, isPending, isFetching, error } = useActivos(filtros)
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)

  // Exporta **lo que muestran los filtros**, no la página visible ni la tabla
  // entera: es lo que alguien espera cuando filtró antes de apretar el botón.
  const exportar = useMutation({
    mutationFn: () => exportarActivos(activa!.companyId, filtros),
    onSuccess: ({ filas }) => descargarCsv(`equipos-${hoy()}.csv`, equiposACsv(filas)),
  })

  const ordenar = (columna: OrdenActivos) => {
    // Click en la columna activa invierte; en otra, empieza ascendente — un
    // parque de equipos se lee por referencia, no por fecha.
    aplicar(
      columna === filtros.orden
        ? { direccion: filtros.direccion === 'asc' ? 'desc' : 'asc' }
        : { orden: columna, direccion: 'asc' },
    )
  }

  if (!permisos.ver) {
    return (
      <div className={styles.page}>
        <h1 className={styles.titulo}>Equipos</h1>
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
          <h1 className={styles.titulo}>Equipos</h1>
          <p className={styles.subtitulo}>
            {isPending ? 'Cargando…' : `${total} ${total === 1 ? 'equipo' : 'equipos'}`}
          </p>
        </div>
        <div className={styles.acciones}>
          <Link to="/mantenimiento/ordenes" className={styles.secundario}>
            Órdenes de servicio
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
            <Link to="/mantenimiento/activos/nuevo" className={styles.primario}>
              + Nuevo equipo
            </Link>
          ) : null}
        </div>
      </header>

      <FiltrosActivos
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
          {error.message}
        </p>
      ) : (
        <>
          <ListadoActivos
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
