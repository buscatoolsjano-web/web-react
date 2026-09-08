import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ResponsiveTable } from '@/components/tables/ResponsiveTable'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useDebounce } from '@/hooks/useDebounce'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { CatalogoFiltros } from '../components/CatalogoFiltros'
import { Paginador } from '../components/Paginador'
import { PrecioCelda, DisponibilidadBadge, StockCelda } from '../components/Celdas'
import { construirColumnas } from '../components/columnas'
import {
  useCategorias,
  useDefinicionesDeAtributos,
  useListasDePrecios,
  useMarcas,
} from '../hooks/useCatalogoFacetas'
import { useDisponibilidad, useProductos } from '../hooks/useProductos'
import { useFiltrosCatalogo } from '../hooks/useFiltrosCatalogo'
import { contarFiltrosActivos } from '../lib/planDeConsulta'
import { OPCIONES_POR_PAGINA, type ProductoListado } from '../types'
import styles from './CatalogoPage.module.css'

export function CatalogoPage() {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const { activa } = useEmpresa()
  const { filtros, actualizar, limpiar } = useFiltrosCatalogo()

  const companyId = activa?.companyId ?? null
  const esInterno = activa?.esInterno ?? false

  // El input es local y se vuelca a la URL con retraso: así no se dispara
  // una consulta por cada tecla.
  const [textoInput, setTextoInput] = useState(filtros.q)
  const textoDiferido = useDebounce(textoInput, 300)

  useEffect(() => {
    if (textoDiferido !== filtros.q) actualizar({ q: textoDiferido })
  }, [textoDiferido, filtros.q, actualizar])

  const { listas, porDefecto, puedeElegir } = useListasDePrecios(companyId)
  const [listaElegida, setListaElegida] = useState<string | null>(null)

  // La lista efectiva sale de lo que RLS dejó ver. Un externo recibe una
  // sola, así que no hay nada que elegir; un interno puede cambiarla, pero
  // sólo entre las que ya le llegaron.
  const listaEfectiva = useMemo(
    () => listas.find((l) => l.id === listaElegida) ?? porDefecto,
    [listas, listaElegida, porDefecto],
  )

  const { data: marcas = [] } = useMarcas(companyId)
  const { data: categorias = [] } = useCategorias(companyId)
  const { data: definiciones = [] } = useDefinicionesDeAtributos(companyId)

  const { data, isPending, isFetching, error } = useProductos(filtros, listaEfectiva?.id ?? null)
  const productos = useMemo(() => data?.productos ?? [], [data])
  const total = data?.total ?? 0

  const idsPagina = useMemo(() => productos.map((p) => p.id), [productos])

  // `navigate` devuelve una promesa en React Router 7; no hay nada que
  // esperar acá, así que se descarta explícitamente.
  const abrirProducto = useCallback(
    (sku: string) => {
      void navigate(`/catalogo/${encodeURIComponent(sku)}`)
    },
    [navigate],
  )
  const { data: disponibilidad } = useDisponibilidad(idsPagina)

  const columnas = useMemo(
    () =>
      construirColumnas({
        esInterno,
        moneda: listaEfectiva?.moneda ?? null,
        disponibilidad,
      }),
    [esInterno, listaEfectiva, disponibilidad],
  )

  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false)
  const activos = contarFiltrosActivos(filtros)

  if (!activa) {
    return <StatusMessage tono="pending" titulo="Cargando empresa…" />
  }

  return (
    <div className={styles.page}>
      <header className={styles.encabezado}>
        <div>
          <h1 className={styles.titulo}>Catálogo</h1>
          <p className={styles.subtitulo}>
            {activa.companyName} · {activa.rol}
            {listaEfectiva && ` · ${listaEfectiva.nombre}`}
          </p>
        </div>
      </header>

      <div className={styles.barra}>
        <input
          className={styles.buscador}
          type="search"
          value={textoInput}
          onChange={(e) => setTextoInput(e.target.value)}
          placeholder="Buscar por SKU o nombre…"
          aria-label="Buscar productos"
        />

        {puedeElegir && (
          <label className={styles.control}>
            <span className="sr-only">Lista de precios</span>
            <select
              className={styles.select}
              value={listaEfectiva?.id ?? ''}
              onChange={(e) => setListaElegida(e.target.value)}
            >
              {listas.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nombre}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className={styles.control}>
          <span className="sr-only">Productos por página</span>
          <select
            className={styles.select}
            value={filtros.porPagina}
            onChange={(e) => actualizar({ porPagina: Number(e.target.value) })}
          >
            {OPCIONES_POR_PAGINA.map((n) => (
              <option key={n} value={n}>
                {n} por página
              </option>
            ))}
          </select>
        </label>

        {isMobile && (
          <button
            type="button"
            className={styles.botonFiltros}
            onClick={() => setFiltrosAbiertos((v) => !v)}
            aria-expanded={filtrosAbiertos}
          >
            Filtros{activos > 0 && ` (${activos})`}
          </button>
        )}
      </div>

      <div className={styles.cuerpo}>
        {(!isMobile || filtrosAbiertos) && (
          <aside className={styles.lateral}>
            <CatalogoFiltros
              filtros={filtros}
              marcas={marcas}
              categorias={categorias}
              definiciones={definiciones}
              onCambiar={actualizar}
              onLimpiar={() => {
                limpiar()
                setTextoInput('')
              }}
            />
          </aside>
        )}

        <section className={styles.resultados}>
          {error && (
            <StatusMessage
              tono="error"
              titulo="No se pudo cargar el catálogo"
              detalle={error instanceof Error ? error.message : String(error)}
            />
          )}

          {!error && (
            <>
              <ResponsiveTable
                columns={columnas}
                rows={productos}
                rowKey={(p) => p.id}
                isLoading={isPending}
                emptyMessage={
                  activos > 0 || filtros.q
                    ? 'Ningún producto coincide con la búsqueda. Probá quitar filtros.'
                    : 'No hay productos cargados en esta empresa.'
                }
                onRowClick={(p) => abrirProducto(p.sku)}
                renderCard={(p) => (
                  <TarjetaProducto
                    producto={p}
                    esInterno={esInterno}
                    moneda={listaEfectiva?.moneda ?? null}
                    disponible={disponibilidad?.get(p.id) ?? false}
                    onAbrir={() => abrirProducto(p.sku)}
                  />
                )}
              />

              <Paginador
                pagina={filtros.pagina}
                porPagina={filtros.porPagina}
                total={total}
                cargando={isFetching}
                onIr={(pagina) => actualizar({ pagina })}
              />
            </>
          )}
        </section>
      </div>
    </div>
  )
}

/**
 * Card mobile. Reproduce la del legacy: SKU, nombre, marca, precio y
 * stock/disponibilidad, con toda la card clickeable.
 */
function TarjetaProducto({
  producto,
  esInterno,
  moneda,
  disponible,
  onAbrir,
}: {
  producto: ProductoListado
  esInterno: boolean
  moneda: string | null
  disponible: boolean
  onAbrir: () => void
}) {
  return (
    <button type="button" className={styles.card} onClick={onAbrir}>
      <div className={styles.cardFila}>
        <code className={styles.cardSku}>{producto.sku}</code>
        <PrecioCelda monto={producto.precio} moneda={moneda} />
      </div>
      <div className={styles.cardNombre}>{producto.nombre}</div>
      <div className={styles.cardMeta}>
        <span>{producto.marca?.nombre ?? 'Sin marca'}</span>
        {producto.categoria && <span>· {producto.categoria.nombre}</span>}
      </div>
      <div className={styles.cardFila}>
        {esInterno ? (
          <StockCelda stock={producto.stock} />
        ) : (
          <DisponibilidadBadge disponible={disponible} />
        )}
      </div>
    </button>
  )
}
