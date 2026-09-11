import { Link } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { permisosDe } from '../lib/permisos'
import { FiltrosActivos } from '../components/FiltrosActivos'
import { ListadoActivos } from '../components/ListadoActivos'
import { Paginador } from '../components/Paginador'
import { useActivos } from '../hooks/useActivos'
import { useFiltrosActivos } from '../hooks/useFiltrosActivos'
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
export function ActivosPage() {
  const { filtros, aplicar, limpiar, hayFiltros } = useFiltrosActivos()
  const { data, isPending, isFetching, error } = useActivos(filtros)
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)

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

      {error ? (
        <p className={styles.error} role="alert">
          No se pudo leer el listado: {error.message}
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
