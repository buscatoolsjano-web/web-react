import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { FiltrosClientes } from '../components/FiltrosClientes'
import { ListadoClientes } from '../components/ListadoClientes'
import { Paginador } from '../components/Paginador'
import { useClientes } from '../hooks/useClientes'
import { useFiltrosClientes } from '../hooks/useFiltrosClientes'
import { aCsv, descargarCsv } from '../lib/csv'
import { exportarClientes } from '../services/clientes'
import type { OrdenClientes } from '../types'
import styles from './ClientesPage.module.css'

/**
 * El maestro de clientes.
 *
 * Entrega 1: sólo lectura. No hay botón de «Nuevo cliente» porque todavía no
 * se puede crear uno — y esconder un botón nunca fue lo que impide escribir:
 * eso lo hace RLS.
 */
export function ClientesPage() {
  const { filtros, aplicar, limpiar, hayFiltros } = useFiltrosClientes()
  const { data, isPending, isFetching, error } = useClientes(filtros)
  const { activa } = useEmpresa()
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())

  const ordenar = (columna: OrdenClientes) => {
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
      for (const c of data?.filas ?? []) {
        if (marcado) n.add(c.id)
        else n.delete(c.id)
      }
      return n
    })

  const hoy = () => new Date().toISOString().slice(0, 10)

  /**
   * Exportar.
   *
   * Con clientes seleccionados exporta ésos, que son los que están en
   * pantalla. Sin selección exporta **lo que muestran los filtros**, pidiendo
   * las páginas al servidor.
   */
  const exportar = useMutation({
    mutationFn: async () => {
      if (seleccionados.size > 0) {
        const filas = (data?.filas ?? []).filter((c) => seleccionados.has(c.id))
        return { contenido: aCsv(filas), filas: filas.length }
      }
      const { filas } = await exportarClientes(activa!.companyId, filtros)
      return { contenido: aCsv(filas), filas: filas.length }
    },
    onSuccess: ({ contenido }) => descargarCsv(`clientes-${hoy()}.csv`, contenido),
  })

  const total = data?.total ?? 0

  return (
    <div className={styles.page}>
      <header className={styles.encabezado}>
        <div>
          <h1 className={styles.titulo}>Clientes</h1>
          <p className={styles.subtitulo}>
            {isPending ? 'Cargando…' : `${total} ${total === 1 ? 'cliente' : 'clientes'}`}
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
        </div>
      </header>

      {exportar.error ? (
        <p className={styles.error} role="alert">
          No se pudo exportar: {exportar.error.message}
        </p>
      ) : null}

      <FiltrosClientes
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
          <ListadoClientes
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
