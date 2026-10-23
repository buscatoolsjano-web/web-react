import { useEffect, useMemo } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Spinner } from '@/components/ui/Spinner'
import { Icon } from '@/components/icons/Icon'
import { GuiaFiltros } from '../components/GuiaFiltros'
import { TablaProductos } from '../components/TablaProductos'
import { columnasDeAtributo } from '../lib/columnas'
import { useCarritoPublico } from '../hooks/useCarritoPublico'
import { categorias, facetas, listar } from '../services/catalogoPublico'
import { rutaCatalogo, rutaCategoria } from '../lib/rutas'
import { useMeta } from '../hooks/useMeta'
import { descripcionDeCategoria, tituloDeCategoria } from '../lib/seo'
import styles from './CatalogoPublicoPage.module.css'

/**
 * El catálogo público, igual que el del ERP (Fase 87 · E2c).
 *
 * ── ES LA PORTADA, Y ES UNA TABLA ───────────────────────────────────────────
 *
 * «Entrás a la web y ya tenés el catálogo ahí listo para filtrar», y después:
 * «que lo repliques, una fila donde está cada columna con su título».
 *
 * Las dos cosas son la misma: lo que convierte una lista de nueve mil
 * productos en algo usable no es la foto, es poder comparar el encastre, la
 * medida y el largo en columnas y filtrar por ellos. Es lo que el ERP ya
 * resolvió, y acá se replica salvo lo que no se publica.
 *
 * ── LOS FILTROS VAN EN LA URL ───────────────────────────────────────────────
 *
 * Un filtro que no está en la URL no se puede compartir ni volver a
 * encontrar, y el botón «atrás» tiene que deshacer el último.
 *
 * La CATEGORÍA va en la ruta y el resto en la query, y no es un detalle:
 * `/productos/balanceadores` es una página que queremos en el índice del
 * buscador; `?marca=tecna&a.encastre=1/4` son combinaciones infinitas que se
 * repiten entre sí. Por eso lo segundo va marcado para no indexar.
 */

/** Los filtros de atributo viajan con prefijo, para no chocar con los demás. */
const PREFIJO_ATRIBUTO = 'a.'

export function CatalogoPublicoPage() {
  const { categoria } = useParams<{ categoria?: string }>()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const carrito = useCarritoPublico()

  const texto = params.get('q') ?? ''
  const marca = params.get('marca') ?? ''
  const serie = params.get('serie') ?? ''
  const tipo = params.get('tipo') ?? ''
  const modelo = params.get('modelo') ?? ''
  const pagina = Math.max(1, Number(params.get('p') ?? '1') || 1)

  /** Lo elegido en las columnas de atributo: `{encastre: '1/4 HEX BIT'}`. */
  const atributos = useMemo(() => {
    const out: Record<string, string> = {}
    for (const [k, v] of params.entries()) {
      if (k.startsWith(PREFIJO_ATRIBUTO) && v !== '') out[k.slice(PREFIJO_ATRIBUTO.length)] = v
    }
    return out
  }, [params])

  const hayFiltro =
    texto !== '' || modelo !== '' || marca !== '' || serie !== '' || tipo !== '' || Object.keys(atributos).length > 0

  const qCategorias = useQuery({
    queryKey: ['catalogo-publico', 'categorias'],
    queryFn: categorias,
    staleTime: 60 * 60_000,
  })
  const laCategoria = (qCategorias.data ?? []).find((c) => c.slug === categoria)

  // Las opciones dependen de TODOS los filtros activos (Fase 95): así «medida
  // 25mm» muestra cuántos hay DENTRO de lo ya filtrado y no en toda la
  // categoría. Cada faceta se calcula con los demás filtros MENOS el suyo, para
  // que cambiar una opción no deje el desplegable con un solo valor —el mismo
  // truco que catalog_facets del ERP—.
  const qFacetas = useQuery({
    queryKey: ['catalogo-publico', 'facetas', categoria ?? null, marca, serie, tipo, modelo, texto, atributos],
    queryFn: () =>
      facetas({
        categoria: categoria ?? null,
        marca: marca === '' ? null : marca,
        serie: serie === '' ? null : serie,
        tipo: tipo === '' ? null : tipo,
        modelo: modelo === '' ? null : modelo,
        texto: texto === '' ? null : texto,
        atributos,
      }),
    staleTime: 5 * 60_000,
  })

  const qc = useQueryClient()

  // 100 por página: la primera tanda es grande y se ve casi todo el catálogo de
  // un saque, sin paginar tanto. Las siguientes se precargan en segundo plano
  // (más abajo), así «Siguiente» abre al instante.
  const POR_PAGINA = 100
  const argsDe = (p: number) => ({
    categoria: categoria ?? null,
    marca: marca === '' ? null : marca,
    serie: serie === '' ? null : serie,
    tipo: tipo === '' ? null : tipo,
    modelo: modelo === '' ? null : modelo,
    texto: texto === '' ? null : texto,
    atributos,
    pagina: p,
    porPagina: POR_PAGINA,
  })
  const claveDe = (p: number) =>
    ['catalogo-publico', 'listar', categoria ?? null, marca, serie, tipo, modelo, texto, atributos, p] as const

  const q = useQuery({
    queryKey: claveDe(pagina),
    queryFn: () => listar(argsDe(pagina)),
    staleTime: 5 * 60_000,
  })

  // «Que mientras en segundo plano se vayan cargando los otros»: apenas llega la
  // página actual, se precargan las dos siguientes sin bloquear nada. Al tocar
  // «Siguiente» ya están servidas.
  useEffect(() => {
    const total = q.data?.total
    if (total === undefined) return
    const ultimaPagina = Math.max(1, Math.ceil(total / POR_PAGINA))
    for (const p of [pagina + 1, pagina + 2]) {
      if (p > ultimaPagina) continue
      void qc.prefetchQuery({ queryKey: claveDe(p), queryFn: () => listar(argsDe(p)), staleTime: 5 * 60_000 })
    }
    // claveDe/argsDe se recrean en cada render; las piezas reales son los filtros.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data?.total, pagina, categoria, marca, serie, tipo, modelo, texto, atributos])

  const nombre = laCategoria?.nombre ?? 'Herramientas industriales'
  const cuantos = q.data?.total ?? laCategoria?.productos ?? 0

  // Las columnas de atributo salen de las facetas, con la misma regla que el
  // ERP: sólo con categoría elegida, hasta cinco, y nada que esté vacío en
  // casi todas las filas. Ver `lib/columnas.ts`.
  const columnas = useMemo(
    () => columnasDeAtributo(categoria, qFacetas.data?.atributos ?? [], qFacetas.data?.total ?? 0),
    [categoria, qFacetas.data],
  )

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

  /** Cambiar cualquier filtro vuelve SIEMPRE a la página uno. */
  const filtrar = (clave: string, valor: string) => {
    const siguiente = new URLSearchParams(params)
    if (valor === '') siguiente.delete(clave)
    else siguiente.set(clave, valor)
    // Quedarse en la página cuatro después de filtrar muestra una lista vacía
    // y parece que el filtro no encontró nada.
    siguiente.delete('p')
    setParams(siguiente)
  }

  const limpiar = () => {
    const siguiente = new URLSearchParams()
    setParams(siguiente)
  }

  const irA = (nueva: number) => {
    const siguiente = new URLSearchParams(params)
    if (nueva <= 1) siguiente.delete('p')
    else siguiente.set('p', String(nueva))
    setParams(siguiente)
    window.scrollTo({ top: 0 })
  }

  const porPagina = q.data?.porPagina ?? 50
  const ultima = Math.max(1, Math.ceil(cuantos / porPagina))

  /** Lo que la tabla necesita saber de lo filtrado, con sus claves de URL. */
  const filtros: Record<string, string> = {
    q: texto,
    modelo,
    marca,
    serie,
    tipo,
    ...Object.fromEntries(
      Object.entries(atributos).map(([k, v]) => [`${PREFIJO_ATRIBUTO}${k}`, v]),
    ),
  }

  return (
    <div className={styles.pagina}>
      {/*
        El encabezado, COMPACTO (Fase 87 · E2d).
        «El catálogo tiene que empezar un poco más arriba, es mucho texto.»
        El título y la cuenta van en una sola fila; la descripción —que hace
        falta para el buscador— queda en UNA línea fina y apagada al lado, no
        en un párrafo de tres renglones que empujaba la tabla media pantalla
        abajo.
      */}
      <header className={styles.encabezado}>
        {categoria ? (
          <div className={styles.navCategoria}>
            {/* Volver para sacar el filtro de categoría: `navigate(-1)` deshace
                el último paso y conserva lo que había antes. */}
            <button type="button" className={styles.volver} onClick={() => void navigate(-1)}>
              <Icon name="chevron-left" size={16} aria-hidden="true" />
              Volver
            </button>
            <nav className={styles.migaja} aria-label="Dónde estás">
              <Link to={rutaCatalogo()}>Catálogo</Link>
              <span aria-hidden="true"> › </span>
              <span>{nombre}</span>
            </nav>
          </div>
        ) : null}

        <div className={styles.fila}>
          <h1 className={styles.titulo}>{nombre}</h1>
          <span className={styles.cuenta}>
            {q.isPending ? (
              'Buscando…'
            ) : (
              <>
                <strong>{cuantos.toLocaleString('es-AR')}</strong>{' '}
                {cuantos === 1 ? 'producto' : 'productos'}
                {hayFiltro ? (
                  <button type="button" className={styles.limpiar} onClick={limpiar}>
                    Limpiar filtros
                  </button>
                ) : null}
              </>
            )}
          </span>
        </div>

        {!categoria ? (
          <p className={styles.bajada}>
            Puntas, tubos y embocaduras, balanceadores, atornilladores, llaves de impacto y llaves
            dinamométricas. Importación directa. Consultá disponibilidad y precio sin compromiso.
          </p>
        ) : null}
      </header>

      {q.isError ? (
        <p className={styles.vacio}>
          No pudimos cargar el catálogo en este momento. Probá de nuevo en un rato.
        </p>
      ) : (
        <>
          {/*
            El filtro guiado (Fase 90), ARRIBA de la tabla: entrada rápida y
            visual que convive con los filtros de columna. Las dos escriben el
            mismo estado en la URL. La categoría va en la ruta, así que entrar a
            una navega (y arranca sin filtros viejos colgados).
          */}
          <GuiaFiltros
            categoria={categoria}
            categorias={qCategorias.data ?? []}
            facetas={qFacetas.data}
            tipo={tipo}
            atributos={atributos}
            total={cuantos}
            cargando={q.isPending}
            onFiltrar={filtrar}
            onCategoria={(slug) =>
              // `void`: navigate devuelve una Promise; onCategoria espera void y
              // no hay que esperarla (no-misused-promises + no-floating-promises).
              void navigate(slug === '' ? rutaCatalogo() : rutaCategoria(slug))
            }
          />

          <TablaProductos
            productos={q.data?.productos ?? []}
            columnas={columnas}
            facetas={qFacetas.data}
            filtros={filtros}
            onFiltrar={filtrar}
            carrito={carrito}
            // Con una categoría fija la columna diría siempre lo mismo.
            mostrarCategoria={!categoria}
          />

          {q.isPending ? (
            <div className={styles.centrado} role="status">
              <Spinner size={24} />
            </div>
          ) : null}

          {!q.isPending && q.data?.productos.length === 0 ? (
            <div className={styles.vacio}>
              <p>No encontramos nada con esos filtros.</p>
              <p className={styles.vacioAyuda}>
                Probá con menos palabras o sacando algún filtro.{' '}
                <Link to={rutaCatalogo()}>Ver todo el catálogo</Link>.
              </p>
            </div>
          ) : null}

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
