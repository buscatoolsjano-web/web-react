import { useParams } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { DocSection, MetaList, Missing, type MetaItem } from '@/components/document/DocSection'
import doc from '@/components/document/Document.module.css'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Badge } from '@/components/ui/Badge'
import { LinkButton } from '@/components/ui/LinkButton'
import { Spinner } from '@/components/ui/Spinner'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { DisponibilidadBadge, PrecioCelda, StockCelda } from '../components/Celdas'
import { ListaAtributos } from '../components/ListaAtributos'
import { ProductGallery } from '../components/ProductGallery'
import { useDefinicionesDeAtributos, useListasDePrecios } from '../hooks/useCatalogoFacetas'
import { useDisponibilidad, useProducto } from '../hooks/useProductos'
import { formatearCantidad } from '../lib/formato'
import styles from './ProductoDetallePage.module.css'

/**
 * Detalle de producto en `#/catalogo/:sku`.
 *
 * El SKU es único POR EMPRESA (products_company_id_sku_key), así que el
 * mismo código puede existir en Buscatools y en Torquetools: la empresa
 * activa determina cuál se muestra. Cambiar de empresa con esta ruta
 * abierta consulta el producto de la otra empresa, o muestra "no
 * encontrado" si allá no existe.
 */
export function ProductoDetallePage() {
  const { sku } = useParams<{ sku: string }>()
  const { activa } = useEmpresa()

  const companyId = activa?.companyId ?? null
  const esInterno = activa?.esInterno ?? false

  const { porDefecto, cargando: listasCargando } = useListasDePrecios(companyId)
  const { data: definiciones = [] } = useDefinicionesDeAtributos(companyId)
  const { data: producto, isPending, isFetching, error, refetch } = useProducto(sku, porDefecto?.id ?? null, !listasCargando)
  const { data: disponibilidad } = useDisponibilidad(producto ? [producto.id] : [])

  const volver = { to: '/catalogo', label: 'Catálogo' }

  if (isPending) {
    return (
      <div className={styles.cargando}>
        <Spinner label="Cargando producto…" />
      </div>
    )
  }

  if (error) {
    return (
      <div className={doc.pagina}>
        <PageHeader title="Producto" back={volver} />
        <ErrorState
          title="No se pudo cargar el producto."
          description={error instanceof Error ? error.message : String(error)}
          onRetry={() => void refetch()}
          retrying={isFetching}
        />
      </div>
    )
  }

  if (!producto) {
    return (
      <div className={doc.pagina}>
        <PageHeader title="Producto" back={volver} />
        <EmptyState
          icon="package"
          title={`No existe el producto ${sku ?? ''}`}
          description={`No se encontró en ${activa?.companyName ?? 'esta empresa'}.`}
          action={<LinkButton to="/catalogo">Volver al catálogo</LinkButton>}
        />
      </div>
    )
  }

  // La ficha muestra sólo lo cargado, como antes; si no hay nada, lo dice.
  const ficha: (MetaItem | null)[] = [
    producto.modelo ? { label: 'Modelo', value: producto.modelo } : null,
    producto.tipo ? { label: 'Tipo', value: producto.tipo } : null,
    producto.origen ? { label: 'Origen', value: producto.origen } : null,
    producto.ncm ? { label: 'NCM', value: producto.ncm } : null,
    producto.pesoG !== null ? { label: 'Peso', value: `${formatearCantidad(producto.pesoG)} g` } : null,
    producto.volumenCm3 !== null ? { label: 'Volumen', value: `${formatearCantidad(producto.volumenCm3)} cm³` } : null,
  ]
  const hayFicha = ficha.some(Boolean)

  return (
    <div className={doc.pagina}>
      <PageHeader
        back={volver}
        title={producto.nombre}
        subtitle={
          <>
            <code className={styles.sku}>{producto.sku}</code>
            {' · '}
            {producto.marca?.nombre ?? 'Sin marca'}
            {producto.categoria ? ` · ${producto.categoria.nombre}` : ''}
            {producto.serie ? ` · Serie ${producto.serie}` : ''}
          </>
        }
        status={
          producto.esKit || producto.necesitaRevision ? (
            <>
              {producto.esKit ? <Badge tone="info">Kit</Badge> : null}
              {producto.necesitaRevision ? (
                <Badge tone="warning" dot>
                  Datos a revisar
                </Badge>
              ) : null}
            </>
          ) : undefined
        }
      />

      <div className={styles.principal}>
        <ProductGallery imagenes={producto.imagenes} nombre={producto.nombre} />

        <div className={styles.resumen}>
          <dl className={styles.destacados}>
            <div className={styles.dato}>
              <dt className={styles.datoEtiqueta}>Precio{porDefecto ? ` · ${porDefecto.nombre}` : ''}</dt>
              <dd className={styles.datoValor}>
                <PrecioCelda monto={producto.precio} moneda={porDefecto?.moneda ?? null} />
              </dd>
            </div>
            <div className={styles.dato}>
              <dt className={styles.datoEtiqueta}>{esInterno ? 'Stock (real / virtual)' : 'Disponibilidad'}</dt>
              <dd className={styles.datoValor}>
                {esInterno ? (
                  <StockCelda stock={producto.stock} />
                ) : (
                  <DisponibilidadBadge disponible={disponibilidad?.get(producto.id) ?? false} />
                )}
              </dd>
            </div>
          </dl>
          {producto.descripcion ? <p className={styles.descripcion}>{producto.descripcion}</p> : null}
        </div>
      </div>

      <DocSection title="Características">
        <ListaAtributos atributos={producto.atributos} definiciones={definiciones} />
      </DocSection>

      <DocSection title="Ficha">
        {hayFicha ? <MetaList items={ficha} /> : <Missing>Sin datos de ficha cargados.</Missing>}
      </DocSection>
    </div>
  )
}
