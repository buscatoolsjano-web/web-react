import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { FiltrosDocumentos } from '../components/FiltrosDocumentos'
import { ListadoDocumentos } from '../components/ListadoDocumentos'
import { Paginador } from '../components/Paginador'
import { useDocumentos } from '../hooks/useDocumentos'
import { useFiltrosVentas } from '../hooks/useFiltrosVentas'
import { aCsv, descargarCsv } from '../lib/csv'
import { exportarCsv } from '../services/acciones'
import { ETIQUETA_DE, type OrdenVentas, type TipoDocumento } from '../types'
import styles from './ListadoPage.module.css'

export interface ListadoPageProps {
  tipo: TipoDocumento
  titulo: string
  /** Encabezado de la columna «Origen»; `null` en cotizaciones, que no tienen. */
  etiquetaOrigen: string | null
  /** Ruta de alta. Sin ella no se muestra el botón: todavía no se puede crear. */
  rutaNuevo?: string
}

/**
 * El listado, uno solo para los tres documentos.
 *
 * Todo pasa por el servidor: filtros, orden, página y el total exacto. Con
 * 636 documentos el legacy los traía todos para mostrar diez.
 */
export function ListadoPage({ tipo, titulo, etiquetaOrigen, rutaNuevo }: ListadoPageProps) {
  const { filtros, aplicar, limpiar, hayFiltros } = useFiltrosVentas()
  const { data, isPending, isFetching, error } = useDocumentos(tipo, filtros)
  const { activa } = useEmpresa()
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  // El botón se muestra a quien puede escribir. Lo que IMPIDE crear no es
  // esconder el botón: es RLS, que rechaza el insert de un rol externo.
  const puedeCrear = rutaNuevo !== undefined && (activa?.esInterno ?? false)

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
      descargarCsv(`${ETIQUETA_DE[tipo].plural}-${hoy()}.csv`, contenido)
    },
  })

  return (
    <div className={styles.page}>
      <header className={styles.encabezado}>
        <div>
          <h1 className={styles.titulo}>{titulo}</h1>
          <p className={styles.subtitulo}>
            {isPending
              ? 'Cargando…'
              : `${data?.total ?? 0} ${
                  (data?.total ?? 0) === 1
                    ? ETIQUETA_DE[tipo].singular
                    : ETIQUETA_DE[tipo].plural
                }`}
          </p>
        </div>
        <div className={styles.acciones}>
          <button
            type="button"
            className={styles.secundario}
            disabled={exportar.isPending || (data?.total ?? 0) === 0}
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
          {puedeCrear ? (
            <Link to={rutaNuevo} className={styles.nuevo}>
              + Nueva
            </Link>
          ) : null}
        </div>
      </header>

      {exportar.error ? (
        <p className={styles.error} role="alert">
          No se pudo exportar: {exportar.error.message}
        </p>
      ) : null}

      <FiltrosDocumentos
        tipo={tipo}
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
          <ListadoDocumentos
            filas={data?.filas ?? []}
            orden={filtros.orden}
            direccion={filtros.direccion}
            onOrdenar={ordenar}
            etiquetaOrigen={etiquetaOrigen}
            cargando={isPending}
            seleccionados={seleccionados}
            onSeleccionar={marcar}
            onSeleccionarTodos={marcarTodos}
          />
          <Paginador
            pagina={filtros.pagina}
            porPagina={filtros.porPagina}
            total={data?.total ?? 0}
            cargando={isFetching}
            onIr={(pagina) => aplicar({ pagina })}
            onTamano={(porPagina) => aplicar({ porPagina })}
          />
        </>
      )}
    </div>
  )
}
