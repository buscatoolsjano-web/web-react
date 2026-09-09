import { FiltrosDocumentos } from '../components/FiltrosDocumentos'
import { ListadoDocumentos } from '../components/ListadoDocumentos'
import { Paginador } from '../components/Paginador'
import { useDocumentos } from '../hooks/useDocumentos'
import { useFiltrosVentas } from '../hooks/useFiltrosVentas'
import { ETIQUETA_DE, type OrdenVentas, type TipoDocumento } from '../types'
import styles from './ListadoPage.module.css'

export interface ListadoPageProps {
  tipo: TipoDocumento
  titulo: string
  /** Encabezado de la columna «Origen»; `null` en cotizaciones, que no tienen. */
  etiquetaOrigen: string | null
}

/**
 * El listado, uno solo para los tres documentos.
 *
 * Todo pasa por el servidor: filtros, orden, página y el total exacto. Con
 * 636 documentos el legacy los traía todos para mostrar diez.
 */
export function ListadoPage({ tipo, titulo, etiquetaOrigen }: ListadoPageProps) {
  const { filtros, aplicar, limpiar, hayFiltros } = useFiltrosVentas()
  const { data, isPending, isFetching, error } = useDocumentos(tipo, filtros)

  const ordenar = (columna: OrdenVentas) => {
    // Click en la columna activa invierte; en otra, empieza descendente.
    aplicar(
      columna === filtros.orden
        ? { direccion: filtros.direccion === 'asc' ? 'desc' : 'asc' }
        : { orden: columna, direccion: 'desc' },
    )
  }

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
      </header>

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
