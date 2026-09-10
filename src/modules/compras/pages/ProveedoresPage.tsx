import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { permisosDe } from '../lib/permisos'
import { FiltrosProveedores } from '../components/FiltrosProveedores'
import { ListadoProveedores } from '../components/ListadoProveedores'
import { Paginador } from '../components/Paginador'
import { useProveedores } from '../hooks/useProveedores'
import { useFiltrosProveedores } from '../hooks/useFiltrosProveedores'
import { aCsv, descargarCsv } from '../lib/csv'
import { exportarProveedores } from '../services/proveedores'
import type { OrdenProveedores } from '../types'
import styles from './ProveedoresPage.module.css'

/**
 * El maestro de proveedores.
 *
 * 142 registros migrados del sistema anterior. Filtros, orden, página y total
 * exacto los resuelve el servidor.
 *
 * A quien no sea admin ni employee este listado le vuelve vacío: la policy de
 * `suppliers` es `app.current_writer_company_ids()`. Se avisa antes de
 * mostrarle una pantalla en blanco, pero lo que lo impide es RLS.
 */
export function ProveedoresPage() {
  const { filtros, aplicar, limpiar, hayFiltros } = useFiltrosProveedores()
  const { data, isPending, isFetching, error } = useProveedores(filtros)
  const { activa } = useEmpresa()
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  const permisos = permisosDe(activa)

  const ordenar = (columna: OrdenProveedores) => {
    // Click en la columna activa invierte; en otra, empieza ascendente — un
    // maestro se lee alfabéticamente, al revés que un listado de documentos.
    aplicar(
      columna === filtros.orden
        ? { direccion: filtros.direccion === 'asc' ? 'desc' : 'asc' }
        : { orden: columna, direccion: 'asc' },
    )
  }

  const marcar = (id: string, marcado: boolean) =>
    setSeleccionados((s) => {
      const n = new Set(s)
      if (marcado) n.add(id)
      else n.delete(id)
      return n
    })

  const marcarTodos = (marcado: boolean) =>
    setSeleccionados((s) => {
      const n = new Set(s)
      for (const p of data?.filas ?? []) {
        if (marcado) n.add(p.id)
        else n.delete(p.id)
      }
      return n
    })

  const hoy = () => new Date().toISOString().slice(0, 10)

  /**
   * Exportar.
   *
   * Con proveedores seleccionados exporta ésos. Sin selección exporta **lo que
   * muestran los filtros**, pidiendo las páginas al servidor.
   */
  const exportar = useMutation({
    mutationFn: async () => {
      if (seleccionados.size > 0) {
        const filas = (data?.filas ?? []).filter((p) => seleccionados.has(p.id))
        return { contenido: aCsv(filas), filas: filas.length }
      }
      const { filas } = await exportarProveedores(activa!.companyId, filtros)
      return { contenido: aCsv(filas), filas: filas.length }
    },
    onSuccess: ({ contenido }) => descargarCsv(`proveedores-${hoy()}.csv`, contenido),
  })

  if (!permisos.verProveedores) {
    return (
      <div className={styles.page}>
        <h1 className={styles.titulo}>Proveedores</h1>
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
          <h1 className={styles.titulo}>Proveedores</h1>
          <p className={styles.subtitulo}>
            {isPending ? 'Cargando…' : `${total} ${total === 1 ? 'proveedor' : 'proveedores'}`}
          </p>
        </div>
        <div className={styles.acciones}>
          <button
            type="button"
            className={styles.secundario}
            disabled={exportar.isPending || total === 0}
            onClick={() => exportar.mutate()}
          >
            {exportar.isPending
              ? 'Exportando…'
              : seleccionados.size > 0
                ? `Exportar ${seleccionados.size} a CSV`
                : 'Exportar a CSV'}
          </button>
          {seleccionados.size > 0 ? (
            <button
              type="button"
              className={styles.secundario}
              onClick={() => setSeleccionados(new Set())}
            >
              Limpiar selección
            </button>
          ) : null}
          {permisos.crearProveedor ? (
            <Link to="/compras/proveedores/nuevo" className={styles.nuevo}>
              + Nuevo proveedor
            </Link>
          ) : null}
        </div>
      </header>

      {exportar.error ? (
        <p className={styles.error} role="alert">
          No se pudo exportar: {exportar.error.message}
        </p>
      ) : null}

      <FiltrosProveedores
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
          <ListadoProveedores
            filas={data?.filas ?? []}
            orden={filtros.orden}
            direccion={filtros.direccion}
            onOrdenar={ordenar}
            cargando={isPending}
            seleccionados={seleccionados}
            onSeleccionar={marcar}
            onSeleccionarTodos={marcarTodos}
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
