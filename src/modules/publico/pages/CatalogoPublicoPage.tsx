import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Spinner } from '@/components/ui/Spinner'
import { TarjetaProducto } from '../components/TarjetaProducto'
import { BarraFiltros } from '../components/BarraFiltros'
import { categorias, facetas, listar } from '../services/catalogoPublico'
import { rutaCatalogo, rutaCategoria } from '../lib/rutas'
import { useMeta } from '../hooks/useMeta'
import { descripcionDeCategoria, tituloDeCategoria } from '../lib/seo'
import styles from './CatalogoPublicoPage.module.css'

/**
 * El catálogo público: todo, o una categoría (Fase 87 · E2).
 *
 * ── ES LA PORTADA (Fase 87 · E2b) ───────────────────────────────────────────
 *
 * «Entrás a la web y ya tenés el catálogo ahí listo para filtrar.» Antes la
 * raíz era una portada con un título grande, un párrafo y botones, y el
 * catálogo estaba a un clic. Un clic de más entre alguien que llegó buscando
 * un producto y el producto.
 *
 * Así que esta misma pantalla responde en `/` y en `/productos`. Lo que se
 * conserva de la portada es lo único que servía: el título con las palabras
 * por las que se busca, dicho en una línea arriba de la grilla en vez de en
 * una pantalla entera.
 *
 * ── UNA PANTALLA Y NO TRES ──────────────────────────────────────────────────
 *
 * `/`, `/productos` y `/productos/balanceadores` son la misma lista con un
 * filtro puesto. Separarlas serían tres grillas, tres paginadores y tres
 * formas de quedarse sin resultados que se van separando con cada cambio.
 *
 * ── POR QUÉ LOS FILTROS VAN EN LA URL ───────────────────────────────────────
 *
 * Porque un filtro que no está en la URL no se puede compartir ni volver a
 * encontrar. Alguien que filtró TECNA, serie BSDL, y quiere mandarle eso a un
 * compañero, manda la dirección. Y porque el botón «atrás» del navegador
 * tiene que deshacer el último filtro, que es lo que todo el mundo espera.
 *
 * La CATEGORÍA va en la ruta y los demás en la query, y eso no es un detalle:
 * `/productos/balanceadores` es una página que queremos en el índice del
 * buscador —tiene su título, su texto y 376 productos que no cambian—;
 * `?marca=tecna&serie=BSDL` son combinaciones infinitas que se repiten entre
 * sí y no aportan nada. Por eso lo segundo va marcado para no indexar.
 */
export function CatalogoPublicoPage() {
  const { categoria } = useParams<{ categoria?: string }>()
  const [params, setParams] = useSearchParams()
  const texto = params.get('q') ?? ''
  const marca = params.get('marca') ?? ''
  const serie = params.get('serie') ?? ''
  const tipo = params.get('tipo') ?? ''
  const pagina = Math.max(1, Number(params.get('p') ?? '1') || 1)
  const hayFiltro = texto !== '' || marca !== '' || serie !== '' || tipo !== ''

  const qCategorias = useQuery({
    queryKey: ['catalogo-publico', 'categorias'],
    queryFn: categorias,
    staleTime: 60 * 60_000,
  })
  const laCategoria = (qCategorias.data ?? []).find((c) => c.slug === categoria)

  // Las opciones dependen de la categoría y NO de los demás filtros: si se
  // recalcularan con la marca puesta, elegir TECNA dejaría el desplegable de
  // marcas con una sola opción y no habría forma de cambiarla.
  const qFacetas = useQuery({
    queryKey: ['catalogo-publico', 'facetas', categoria ?? null],
    queryFn: () => facetas(categoria ?? null),
    staleTime: 30 * 60_000,
  })

  const q = useQuery({
    queryKey: ['catalogo-publico', 'listar', categoria ?? null, marca, serie, tipo, texto, pagina],
    queryFn: () =>
      listar({
        categoria: categoria ?? null,
        marca: marca === '' ? null : marca,
        serie: serie === '' ? null : serie,
        tipo: tipo === '' ? null : tipo,
        texto: texto === '' ? null : texto,
        pagina,
      }),
    staleTime: 5 * 60_000,
  })

  const nombre = laCategoria?.nombre ?? 'Herramientas industriales'
  const cuantos = q.data?.total ?? laCategoria?.productos ?? 0

  useMeta({
    titulo: categoria
      ? tituloDeCategoria(nombre)
      : 'Herramientas industriales para montaje y torque | Buscatools',
    descripcion: categoria
      ? descripcionDeCategoria(nombre, cuantos)
      : 'Puntas, tubos y embocaduras, balanceadores, atornilladores y llaves de impacto. Importación directa de las marcas que usa la industria.',
    canonica: categoria ? rutaCategoria(categoria) : '/',
    sinIndexar: hayFiltro || pagina > 1,
  })

  /** Cambiar un filtro vuelve SIEMPRE a la página uno. */
  const ponerFiltro = (clave: string, valor: string) => {
    const siguiente = new URLSearchParams(params)
    if (valor === '') siguiente.delete(clave)
    else siguiente.set(clave, valor)
    // Quedarse en la página cuatro después de filtrar muestra una lista vacía
    // y parece que el filtro no encontró nada.
    siguiente.delete('p')
    setParams(siguiente)
  }

  const limpiar = () => {
    const siguiente = new URLSearchParams(params)
    for (const k of ['marca', 'serie', 'tipo', 'p']) siguiente.delete(k)
    setParams(siguiente)
  }

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

        {/* Lo único que sobrevive de la portada: las palabras por las que se
            busca, en una línea en vez de en una pantalla entera. */}
        {!categoria && texto === '' ? (
          <p className={styles.bajada}>
            Puntas, tubos y embocaduras, balanceadores, atornilladores, llaves de impacto y llaves
            dinamométricas. Importamos directo las marcas que ya usa tu línea de producción.
          </p>
        ) : null}

        <p className={styles.cuenta}>
          {q.isPending ? (
            'Buscando…'
          ) : (
            <>
              <strong>{cuantos.toLocaleString('es-AR')}</strong>{' '}
              {cuantos === 1 ? 'producto' : 'productos'}. Consultá disponibilidad y precio sin
              compromiso.
            </>
          )}
        </p>
      </header>

      <BarraFiltros
        facetas={qFacetas.data}
        marca={marca}
        serie={serie}
        tipo={tipo}
        onCambiar={ponerFiltro}
        onLimpiar={limpiar}
      />

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
