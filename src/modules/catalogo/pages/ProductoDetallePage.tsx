import { Link, useParams } from 'react-router-dom'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { DisponibilidadBadge, PrecioCelda, StockCelda } from '../components/Celdas'
import { ListaAtributos } from '../components/ListaAtributos'
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
  const { data: producto, isPending, error } = useProducto(sku, porDefecto?.id ?? null, !listasCargando)
  const { data: disponibilidad } = useDisponibilidad(producto ? [producto.id] : [])

  if (isPending) return <StatusMessage tono="pending" titulo="Cargando producto…" />

  if (error) {
    return (
      <StatusMessage
        tono="error"
        titulo="No se pudo cargar el producto"
        detalle={error instanceof Error ? error.message : String(error)}
      />
    )
  }

  if (!producto) {
    return (
      <div className={styles.page}>
        <StatusMessage
          tono="error"
          titulo={`No existe el producto ${sku ?? ''}`}
          detalle={`No se encontró en ${activa?.companyName ?? 'esta empresa'}.`}
        />
        <Link className={styles.volver} to="/catalogo">
          ← Volver al catálogo
        </Link>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <Link className={styles.volver} to="/catalogo">
        ← Volver al catálogo
      </Link>

      <header className={styles.encabezado}>
        <code className={styles.sku}>{producto.sku}</code>
        <h1 className={styles.titulo}>{producto.nombre}</h1>
        <p className={styles.meta}>
          {producto.marca?.nombre ?? 'Sin marca'}
          {producto.categoria && ` · ${producto.categoria.nombre}`}
          {producto.serie && ` · Serie ${producto.serie}`}
        </p>
        <div className={styles.badges}>
          {producto.esKit && <span className={styles.badge}>Kit</span>}
          {producto.necesitaRevision && (
            <span className={styles.badgeAviso}>Datos a revisar</span>
          )}
        </div>
      </header>

      <div className={styles.destacados}>
        <div className={styles.dato}>
          <span className={styles.datoEtiqueta}>Precio</span>
          <PrecioCelda monto={producto.precio} moneda={porDefecto?.moneda ?? null} />
        </div>
        <div className={styles.dato}>
          <span className={styles.datoEtiqueta}>
            {esInterno ? 'Stock (real / virtual)' : 'Disponibilidad'}
          </span>
          {esInterno ? (
            <StockCelda stock={producto.stock} />
          ) : (
            <DisponibilidadBadge disponible={disponibilidad?.get(producto.id) ?? false} />
          )}
        </div>
      </div>

      {producto.descripcion && <p className={styles.descripcion}>{producto.descripcion}</p>}

      <section className={styles.seccion}>
        <h2 className={styles.seccionTitulo}>Características</h2>
        <ListaAtributos atributos={producto.atributos} definiciones={definiciones} />
      </section>

      <section className={styles.seccion}>
        <h2 className={styles.seccionTitulo}>Ficha</h2>
        <dl className={styles.ficha}>
          <Fila etiqueta="Modelo" valor={producto.modelo} />
          <Fila etiqueta="Tipo" valor={producto.tipo} />
          <Fila etiqueta="Origen" valor={producto.origen} />
          <Fila etiqueta="NCM" valor={producto.ncm} />
          <Fila
            etiqueta="Peso"
            valor={producto.pesoG === null ? null : `${formatearCantidad(producto.pesoG)} g`}
          />
          <Fila
            etiqueta="Volumen"
            valor={
              producto.volumenCm3 === null
                ? null
                : `${formatearCantidad(producto.volumenCm3)} cm³`
            }
          />
        </dl>
      </section>
    </div>
  )
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
  if (!valor) return null
  return (
    <div className={styles.fichaItem}>
      <dt className={styles.fichaEtiqueta}>{etiqueta}</dt>
      <dd className={styles.fichaValor}>{valor}</dd>
    </div>
  )
}
