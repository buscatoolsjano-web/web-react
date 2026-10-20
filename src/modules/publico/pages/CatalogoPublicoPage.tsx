import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Spinner } from '@/components/ui/Spinner'
import { TarjetaProducto } from '../components/TarjetaProducto'
import { categorias, listar } from '../services/catalogoPublico'
import { rutaCatalogo, rutaCategoria } from '../lib/rutas'
import { useMeta } from '../hooks/useMeta'
import { descripcionDeCategoria, tituloDeCategoria } from '../lib/seo'
import styles from './CatalogoPublicoPage.module.css'

/**
 * El catálogo público: todo, o una categoría (Fase 87 · E2).
 *
 * ── UNA PANTALLA Y NO DOS ───────────────────────────────────────────────────
 *
 * `/productos` y `/productos/balanceadores` son la misma lista con un filtro
 * puesto. Separarlas en dos componentes serían dos grillas, dos paginadores y
 * dos formas de quedarse sin resultados que se van separando con cada
 * cambio. Lo único que cambia de verdad es el título y el texto de arriba, y
 * eso son dos variables.
 *
 * ── POR QUÉ LA CATEGORÍA ESTÁ EN LA RUTA Y LA BÚSQUEDA EN LA QUERY ──────────
 *
 * Porque son cosas distintas para un buscador. `/productos/balanceadores` es
 * una página que queremos que exista en el índice: tiene su título, su texto
 * y 376 productos que no cambian. `?q=punta phillips` es un resultado de
 * búsqueda: hay infinitos, se repiten entre sí y no aportan nada al índice.
 * Por eso lo segundo va marcado para no indexar y lo primero no.
 */
export function CatalogoPublicoPage() {
  const { categoria } = useParams<{ categoria?: string }>()
  const [params, setParams] = useSearchParams()
  const texto = params.get('q') ?? ''
  const pagina = Math.max(1, Number(params.get('p') ?? '1') || 1)

  const qCategorias = useQuery({
    queryKey: ['catalogo-publico', 'categorias'],
    queryFn: categorias,
    staleTime: 60 * 60_000,
  })
  const laCategoria = (qCategorias.data ?? []).find((c) => c.slug === categoria)

  const q = useQuery({
    queryKey: ['catalogo-publico', 'listar', categoria ?? null, texto, pagina],
    queryFn: () =>
      listar({ categoria: categoria ?? null, texto: texto === '' ? null : texto, pagina }),
    staleTime: 5 * 60_000,
  })

  const nombre = laCategoria?.nombre ?? 'Catálogo completo'
  const cuantos = q.data?.total ?? laCategoria?.productos ?? 0

  useMeta({
    titulo: categoria ? tituloDeCategoria(nombre) : 'Herramientas industriales | Buscatools',
    descripcion: categoria
      ? descripcionDeCategoria(nombre, cuantos)
      : 'Catálogo de herramientas industriales para montaje, torque y ensamblaje: puntas, tubos, embocaduras, balanceadores y atornilladores.',
    canonica: categoria ? rutaCategoria(categoria) : rutaCatalogo(),
    // Un resultado de búsqueda, o una página dos, no aportan nada al índice:
    // hay infinitos y se repiten entre sí.
    sinIndexar: texto !== '' || pagina > 1,
  })

  const irA = (nueva: number) => {
    const siguiente = new URLSearchParams(params)
    if (nueva <= 1) siguiente.delete('p')
    else siguiente.set('p', String(nueva))
    setParams(siguiente)
    window.scrollTo({ top: 0 })
  }

  const porPagina = q.data?.porPagina ?? 24
  const ultima = Math.max(1, Math.ceil(cuantos / porPagina))

  return (
    <div className={styles.pagina}>
      <header className={styles.encabezado}>
        {/* La migaja no es adorno: es lo que le dice al buscador dónde está
            esta página dentro del sitio, y a la persona cómo volver. */}
        {categoria ? (
          <nav className={styles.migaja} aria-label="Dónde estás">
            <Link to={rutaCatalogo()}>Catálogo</Link>
            <span aria-hidden="true"> › </span>
            <span>{nombre}</span>
          </nav>
        ) : null}

        <h1 className={styles.titulo}>
          {texto !== '' ? `Resultados para «${texto}»` : nombre}
        </h1>

        <p className={styles.bajada}>
          {q.isPending ? (
            'Buscando…'
          ) : (
            <>
              <strong>{cuantos.toLocaleString('es-AR')}</strong>{' '}
              {cuantos === 1 ? 'producto' : 'productos'}
              {categoria && texto === '' ? ` en ${nombre.toLowerCase()}` : ''}. Consultá
              disponibilidad y precio sin compromiso.
            </>
          )}
        </p>
      </header>

      {q.isPending ? (
        <div className={styles.centrado} role="status">
          <Spinner size={24} />
        </div>
      ) : q.isError ? (
        <p className={styles.vacio}>
          No pudimos cargar el catálogo en este momento. Probá de nuevo en un rato.
        </p>
      ) : q.data.productos.length === 0 ? (
        <div className={styles.vacio}>
          <p>No encontramos nada con esa búsqueda.</p>
          <p className={styles.vacioAyuda}>
            Probá con menos palabras, con el modelo suelto o sólo con la marca.{' '}
            <Link to={rutaCatalogo()}>Ver todo el catálogo</Link>.
          </p>
        </div>
      ) : (
        <>
          <ul className={styles.grilla}>
            {q.data.productos.map((p) => (
              <li key={p.slug}>
                <TarjetaProducto producto={p} />
              </li>
            ))}
          </ul>

          {ultima > 1 ? (
            <nav className={styles.paginas} aria-label="Páginas">
              <button type="button" onClick={() => irA(pagina - 1)} disabled={pagina <= 1}>
                Anterior
              </button>
              <span>
                Página {pagina} de {ultima}
              </span>
              <button type="button" onClick={() => irA(pagina + 1)} disabled={pagina >= ultima}>
                Siguiente
              </button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  )
}
