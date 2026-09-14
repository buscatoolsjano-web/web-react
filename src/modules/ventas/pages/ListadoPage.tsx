import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { LinkButton } from '@/components/ui/LinkButton'
import { Icon } from '@/components/icons/Icon'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Pagination } from '@/components/tables/Pagination'
import { contar } from '@/components/tables/rango'
import doc from '@/components/document/Document.module.css'
import { AvisoAutoridadStel } from '../components/AvisoAutoridadStel'
import { FiltrosDocumentos } from '../components/FiltrosDocumentos'
import { ListadoDocumentos } from '../components/ListadoDocumentos'
import { useAutoridadNumeracion } from '../hooks/useAutoridadNumeracion'
import { useDocumentos } from '../hooks/useDocumentos'
import { TAMANOS_DE_PAGINA, useFiltrosVentas } from '../hooks/useFiltrosVentas'
import { DOC_TYPE_DE, motivoBloqueo } from '../lib/autoridad'
import { aCsv, descargarCsv } from '../lib/csv'
import { escribeVentas } from '../lib/permisos'
import { exportarCsv } from '../services/acciones'
import { ETIQUETA_DE, type OrdenVentas, type TipoDocumento } from '../types'

export interface ListadoPageProps {
  tipo: TipoDocumento
  titulo: string
  /** Encabezado de la columna «Origen»; `null` en cotizaciones, que no tienen. */
  etiquetaOrigen: string | null
  /** Ruta de alta. Sin ella no se muestra el botón: todavía no se puede crear. */
  rutaNuevo?: string
  /** Texto del botón de alta («Nueva cotización»). */
  etiquetaNuevo?: string
}

/**
 * El listado, uno solo para los tres documentos.
 *
 * Todo pasa por el servidor: filtros, orden, página y el total exacto. Con
 * 636 documentos el legacy los traía todos para mostrar diez.
 */
export function ListadoPage({ tipo, titulo, etiquetaOrigen, rutaNuevo, etiquetaNuevo = 'Nuevo' }: ListadoPageProps) {
  const { filtros, aplicar, limpiar, hayFiltros } = useFiltrosVentas()
  const { data, isPending, isFetching, error, refetch } = useDocumentos(tipo, filtros)
  const { activa } = useEmpresa()
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  // El botón se muestra a quien puede escribir (admin y employee, el mismo
  // conjunto que `quotes_write`/`orders_write`). Lo que IMPIDE crear no es
  // esconder el botón: es RLS.
  const puedeCrear = rutaNuevo !== undefined && escribeVentas(activa?.rol)
  // Fase 12 E2.5: con STEL como autoridad no se emite. Lo impone la base.
  const autoridad = useAutoridadNumeracion()
  const docType = DOC_TYPE_DE[tipo]
  const stel = autoridad.stel(docType)
  const etiquetas = ETIQUETA_DE[tipo]

  const ordenar = (columna: OrdenVentas) => {
    // Click en la columna activa invierte; en otra, empieza descendente.
    aplicar(
      columna === filtros.orden
        ? { direccion: filtros.direccion === 'asc' ? 'desc' : 'asc' }
        : { orden: columna, direccion: 'desc' },
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
      for (const d of data?.filas ?? []) {
        if (marcado) n.add(d.id)
        else n.delete(d.id)
      }
      return n
    })

  const hoy = () => new Date().toISOString().slice(0, 10)

  /**
   * Exportar.
   *
   * Con documentos seleccionados exporta ésos, y son los que ya están en
   * pantalla. Sin selección exporta **lo que muestran los filtros**, pidiendo
   * las páginas al servidor: no se baja la tabla entera para filtrar después.
   */
  const exportar = useMutation({
    mutationFn: async () => {
      if (seleccionados.size > 0) {
        const filas = (data?.filas ?? []).filter((d) => seleccionados.has(d.id))
        return { contenido: aCsv(tipo, filas), filas: filas.length }
      }
      return exportarCsv(tipo, activa!.companyId, filtros)
    },
    onSuccess: ({ contenido }) => {
      descargarCsv(`${etiquetas.plural}-${hoy()}.csv`, contenido)
    },
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
      {puedeCrear && !stel && !autoridad.cargando ? (
        <LinkButton to={rutaNuevo} variant="primary" icon={<Icon name="plus" size={16} />}>
          {etiquetaNuevo}
        </LinkButton>
      ) : null}
      {puedeCrear && (stel || autoridad.cargando) ? (
        <Button
          icon={<Icon name="plus" size={16} />}
          disabled
          aria-describedby={stel ? 'motivo-nueva' : undefined}
        >
          {etiquetaNuevo}
        </Button>
      ) : null}
    </>
  )

  return (
    <div className={doc.listado}>
      <PageHeader
        title={titulo}
        subtitle={isPending ? 'Cargando…' : contar(total, etiquetas)}
        actions={acciones}
      />

      {stel ? (
        <AvisoAutoridadStel detalle="Podés consultar, buscar, filtrar y exportar. Crear, emitir, confirmar o despachar desde el ERP está bloqueado hasta completar la migración." />
      ) : null}
      {puedeCrear && stel ? (
        <p id="motivo-nueva" className={doc.motivo}>
          {motivoBloqueo(docType)}
        </p>
      ) : null}

      {exportar.error ? (
        <Alert tone="danger" role="alert" title="No se pudo exportar">
          <p>{exportar.error.message}</p>
        </Alert>
      ) : null}

      <FiltrosDocumentos
        tipo={tipo}
        filtros={filtros}
        hayFiltros={hayFiltros}
        onAplicar={aplicar}
        onLimpiar={limpiar}
      />

      {error ? (
        <ErrorState
          title="No se pudo leer el listado."
          description="Revisá la conexión y volvé a intentar."
          onRetry={() => void refetch()}
          retrying={isFetching}
        />
      ) : vacio ? (
        hayFiltros ? (
          <EmptyState
            icon="search"
            title="Sin resultados para estos filtros"
            description={`No hay ${etiquetas.plural} que coincidan. Probá con otro cliente, estado o fecha.`}
            action={
              <Button variant="secondary" onClick={limpiar}>
                Limpiar filtros
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon="inbox"
            title={`Todavía no hay ${etiquetas.plural}`}
            action={
              puedeCrear && !stel && !autoridad.cargando ? (
                <LinkButton to={rutaNuevo} variant="primary" icon={<Icon name="plus" size={16} />}>
                  {etiquetaNuevo}
                </LinkButton>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          <ListadoDocumentos
            filas={filas}
            orden={filtros.orden}
            direccion={filtros.direccion}
            onOrdenar={ordenar}
            etiquetaOrigen={etiquetaOrigen}
            cargando={isPending}
            seleccionados={seleccionados}
            onSeleccionar={marcar}
            onSeleccionarTodos={marcarTodos}
          />
          <Pagination
            offset={(filtros.pagina - 1) * filtros.porPagina}
            pageSize={filtros.porPagina}
            total={total}
            noun={etiquetas}
            loading={isFetching}
            onChange={(offset) => aplicar({ pagina: Math.floor(offset / filtros.porPagina) + 1 })}
            pageSizeOptions={TAMANOS_DE_PAGINA}
            onPageSizeChange={(porPagina) => aplicar({ porPagina })}
          />
        </>
      )}
    </div>
  )
}
