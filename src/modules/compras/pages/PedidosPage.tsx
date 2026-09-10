import { Link } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { permisosDe } from '../lib/permisos'
import { FiltrosPedidos } from '../components/FiltrosPedidos'
import { ListadoPedidos } from '../components/ListadoPedidos'
import { Paginador } from '../components/Paginador'
import { usePedidos } from '../hooks/usePedidos'
import { useFiltrosPedidos } from '../hooks/useFiltrosPedidos'
import type { OrdenPedidos } from '../types'
import styles from './ProveedoresPage.module.css'

/**
 * El listado de pedidos de compra.
 *
 * Todo del lado del servidor: filtros, orden, página y el total exacto.
 *
 * No hay una fila de «total general»: en este listado conviven pedidos en
 * USD, ARS y EUR, y sumarlos daría el mismo número sin sentido que daba el
 * panel del legacy. Cada importe lleva su moneda al lado.
 */
export function PedidosPage() {
  const { filtros, aplicar, limpiar, hayFiltros } = useFiltrosPedidos()
  const { data, isPending, isFetching, error } = usePedidos(filtros)
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)

  const ordenar = (columna: OrdenPedidos) => {
    // Click en la columna activa invierte; en otra, empieza descendente — un
    // listado de documentos se lee del más nuevo al más viejo.
    aplicar(
      columna === filtros.orden
        ? { direccion: filtros.direccion === 'asc' ? 'desc' : 'asc' }
        : { orden: columna, direccion: 'desc' },
    )
  }

  if (!permisos.verProveedores) {
    return (
      <div className={styles.page}>
        <h1 className={styles.titulo}>Pedidos de compra</h1>
        <p className={styles.error} role="note">
          Tu rol no tiene acceso a Compras. La sección es de administradores y empleados.
        </p>
      </div>
    )
  }

  const total = data?.total ?? 0

  return (
    <div className={styles.page}>
      <header className={styles.encabezado}>
        <div>
          <h1 className={styles.titulo}>Pedidos de compra</h1>
          <p className={styles.subtitulo}>
            {isPending ? 'Cargando…' : `${total} ${total === 1 ? 'pedido' : 'pedidos'}`}
          </p>
        </div>
        <div className={styles.acciones}>
          {permisos.crearProveedor ? (
            <Link to="/compras/pedidos/nuevo" className={styles.nuevo}>
              + Nuevo pedido
            </Link>
          ) : null}
        </div>
      </header>

      <FiltrosPedidos
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
          <ListadoPedidos
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
