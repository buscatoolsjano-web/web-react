import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Button } from '@/components/ui/Button'
import { LinkButton } from '@/components/ui/LinkButton'
import { Icon } from '@/components/icons/Icon'
import { contar, type Sustantivo } from '@/components/tables/rango'
import doc from '@/components/document/Document.module.css'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { permisosDe } from '../lib/permisos'
import { FiltrosClientes } from '../components/FiltrosClientes'
import { ListadoClientes } from '../components/ListadoClientes'
import { Paginador } from '../components/Paginador'
import { useClientes } from '../hooks/useClientes'
import { useFiltrosClientes } from '../hooks/useFiltrosClientes'
import { aCsv, descargarCsv } from '../lib/csv'
import { exportarClientes } from '../services/clientes'
import type { OrdenClientes } from '../types'

const CLIENTE: Sustantivo = { singular: 'cliente', plural: 'clientes' }

/**
 * El maestro de clientes.
 *
 * Todo pasa por el servidor: filtros, orden, página y el total exacto. El
 * legacy tenía los 988 en memoria y filtraba con `_clientes_applyFilters`
 * sobre el array entero para mostrar 25.
 */
export function ClientesPage() {
  const { filtros, aplicar, limpiar, hayFiltros } = useFiltrosClientes()
  const { data, isPending, isFetching, error, refetch } = useClientes(filtros)
  const { activa } = useEmpresa()
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  // El botón se le muestra a quien puede crear. Lo que IMPIDE crear no es
  // esconderlo: es la policy `customers_insert`.
  const permisos = permisosDe(activa)

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
  const filas = data?.filas ?? []
  const vacio = !isPending && !error && filas.length === 0

  const acciones = (
    <>
      <Button
        variant="secondary"
        icon={<Icon name="download" size={16} />}
        loading={exportar.isPending}
        disabled={total === 0}
        onClick={() => exportar.mutate()}
      >
        {exportar.isPending
          ? 'Exportando…'
          : seleccionados.size > 0
            ? `Exportar ${seleccionados.size} a CSV`
            : 'Exportar a CSV'}
      </Button>
      {seleccionados.size > 0 ? (
        <Button variant="ghost" onClick={() => setSeleccionados(new Set())}>
          Limpiar selección
        </Button>
      ) : null}
      <LinkButton to="/clientes/revisar" variant="secondary">
        Revisar
      </LinkButton>
      {permisos.crearCliente ? (
        <LinkButton to="/clientes/nuevo" variant="primary" icon={<Icon name="plus" size={16} />}>
          Nuevo cliente
        </LinkButton>
      ) : null}
    </>
  )

  return (
    <div className={doc.listado}>
      <PageHeader title="Clientes" subtitle={isPending ? 'Cargando…' : contar(total, CLIENTE)} actions={acciones} />

      {exportar.error ? (
        <Alert tone="danger" role="alert" title="No se pudo exportar">
          <p>{exportar.error.message}</p>
        </Alert>
      ) : null}

      <FiltrosClientes filtros={filtros} hayFiltros={hayFiltros} onAplicar={aplicar} onLimpiar={limpiar} />

      {error ? (
        <ErrorState
          title="No se pudo leer el listado."
          description={error.message}
          onRetry={() => void refetch()}
          retrying={isFetching}
        />
      ) : vacio ? (
        hayFiltros ? (
          <EmptyState
            icon="search"
            title="Sin resultados para estos filtros"
            description="No hay clientes que coincidan. Probá con otro nombre, CUIT o rubro."
            action={
              <Button variant="secondary" onClick={limpiar}>
                Limpiar filtros
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon="users"
            title="Todavía no hay clientes"
            description="Los clientes que se den de alta van a aparecer acá."
            action={
              permisos.crearCliente ? (
                <LinkButton to="/clientes/nuevo" variant="primary" icon={<Icon name="plus" size={16} />}>
                  Nuevo cliente
                </LinkButton>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          <ListadoClientes
            filas={filas}
            orden={filtros.orden}
            direccion={filtros.direccion}
            onOrdenar={ordenar}
            cargando={isPending}
            seleccionados={seleccionados}
            onSeleccionar={marcar}
            onSeleccionarTodos={marcarTodos}
          />
          {total > 0 ? (
            <Paginador
              pagina={filtros.pagina}
              porPagina={filtros.porPagina}
              total={total}
              cargando={isFetching}
              sustantivo={CLIENTE}
              onIr={(pagina) => aplicar({ pagina })}
              onTamano={(porPagina) => aplicar({ porPagina })}
            />
          ) : null}
        </>
      )}
    </div>
  )
}
