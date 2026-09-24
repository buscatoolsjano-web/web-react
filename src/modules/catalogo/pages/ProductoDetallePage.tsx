import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
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
import { ComparadorProductos } from '../components/ComparadorProductos'
import { DescripcionProducto } from '../components/DescripcionProducto'
import { HistorialStock } from '../components/HistorialStock'
import { HojaCatalogo } from '../components/HojaCatalogo'
import { ListaAtributos } from '../components/ListaAtributos'
import { ProductGallery } from '../components/ProductGallery'
import { RelacionadosProducto } from '../components/RelacionadosProducto'
import { useDefinicionesDeAtributos, useListasDePrecios } from '../hooks/useCatalogoFacetas'
import { useDisponibilidad, useMovimientos, useProducto, useSimilares } from '../hooks/useProductos'
import { formatearCantidad } from '../lib/formato'
import { hojaDeCatalogo } from '../lib/hojaCatalogo'
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
  const navigate = useNavigate()
  const { activa } = useEmpresa()

  const companyId = activa?.companyId ?? null
  const esInterno = activa?.esInterno ?? false

  const { porDefecto, cargando: listasCargando } = useListasDePrecios(companyId)
  const { data: definiciones = [] } = useDefinicionesDeAtributos(companyId)
  const { data: producto, isPending, isFetching, error, refetch } = useProducto(sku, porDefecto?.id ?? null, !listasCargando)
  const { data: disponibilidad } = useDisponibilidad(producto ? [producto.id] : [])
  // Fase 22 · Etapa B: en un teléfono no hay hover, y el tap desde el catálogo
  // llega acá y no al modal. Sin esto, los similares serían una función que
  // sólo existe con mouse.
  const similares = useSimilares(producto?.id ?? null, porDefecto?.id ?? null, !!producto, 6)
  // Fase 25 · E5: igual que en el modal, el historial se pide al abrirlo y no
  // al abrir el producto. Son páginas distintas del mismo dato, no hay razón
  // para que una cueste una consulta más que la otra.
  const [verHistorial, setVerHistorial] = useState(false)
  const movimientos = useMovimientos(producto?.id ?? null, verHistorial)

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
        // «Datos a revisar» no se muestra en el Catálogo (Fase 25 · E3).
        status={producto.esKit ? <Badge tone="info">Kit</Badge> : undefined}
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
          <DescripcionProducto descripcion={producto.descripcion} className={styles.descripcion} />
        </div>
      </div>

      <DocSection title="Características">
        <ListaAtributos atributos={producto.atributos} definiciones={definiciones} />
      </DocSection>

      {/*
        Fase 25 · E5: la ficha muestra lo MISMO que el modal.

        Faltaban la tabla comparativa y la hoja del catálogo, así que el mismo
        producto se veía completo abriéndolo desde la fila e incompleto
        abriéndolo por su URL. Es el mismo componente con la misma variante, no
        una segunda versión: dos comparadores serían dos respuestas para la
        misma pregunta.
      */}
      <DocSection title="Productos similares">
        {(similares.data?.productos.length ?? 0) > 0 ? (
          <ComparadorProductos
            principal={producto}
            similares={similares.data?.productos ?? []}
            fuentes={similares.data?.fuentes}
            familia={producto.categoria?.slug ?? null}
            moneda={porDefecto?.moneda ?? null}
            onAbrirProducto={(id) => void navigate(`/catalogo?producto=${id}`)}
            variante="completa"
          />
        ) : null}
        <RelacionadosProducto
          productos={similares.data?.productos ?? []}
          cargando={similares.isPending}
          moneda={porDefecto?.moneda ?? null}
          fuentes={similares.data?.fuentes}
          onAbrir={(id) => void navigate(`/catalogo?producto=${id}`)}
        />
      </DocSection>

      <DocSection title="Ficha">
        {hayFicha ? <MetaList items={ficha} /> : <Missing>Sin datos de ficha cargados.</Missing>}
      </DocSection>

      {esInterno ? (
        <DocSection title="Historial de stock">
          <HistorialStock
            movimientos={movimientos.data?.movimientos ?? []}
            total={movimientos.data?.total ?? 0}
            stockActual={producto.stock}
            abierto={verHistorial}
            cargando={movimientos.isFetching}
            onAbrir={() => setVerHistorial(true)}
          />
        </DocSection>
      ) : null}

      <DocSection title="Hoja del catálogo">
        <HojaCatalogo
          hoja={hojaDeCatalogo(producto.atributos, producto.imagenes)}
          marca={producto.marca?.nombre ?? null}
        />
      </DocSection>
    </div>
  )
}
