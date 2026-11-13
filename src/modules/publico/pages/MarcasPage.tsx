import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '@/components/icons/Icon'
import { claveFacetas, leerFiltros, pedirFacetas } from '../lib/consulta'
import { RUTA_MARCAS, rutaCatalogo, rutaCategoria, rutaMarca } from '../lib/rutas'
import { NOMBRE_SITIO, recortar, LARGO_DESCRIPCION } from '../lib/seo'
import { esGenerica, textoDeMarca } from '../lib/contenidos'
import { useMeta } from '../hooks/useMeta'
import { facetas, listar, miniDeFoto } from '../services/catalogoPublico'
import { TarjetaProducto } from '../components/TarjetaProducto'
import styles from './PaginaInfo.module.css'

const SIN_FILTROS = leerFiltros(new URLSearchParams(), undefined)
const fmt = (n: number) => n.toLocaleString('es-AR')

function Migas({ marca }: { marca?: string }) {
  return (
    <nav aria-label="Estás en">
      <ol className={styles.migas}>
        <li>
          <Link to="/">Inicio</Link>
        </li>
        <li>{marca ? <Link to={RUTA_MARCAS}>Marcas</Link> : 'Marcas'}</li>
        {marca ? <li>{marca}</li> : null}
      </ol>
    </nav>
  )
}

/** `/marcas`: todas las marcas del catálogo, con cuántos productos tiene cada una. */
export function MarcasPage() {
  const q = useQuery({
    queryKey: claveFacetas(SIN_FILTROS),
    queryFn: () => pedirFacetas(SIN_FILTROS),
    staleTime: 5 * 60_000,
  })
  const marcas = (q.data?.marcas ?? []).filter((m) => m.slug && !esGenerica(m.nombre))

  useMeta({
    titulo: `Marcas de herramientas industriales | ${NOMBRE_SITIO}`,
    descripcion:
      'Las marcas de herramientas industriales con las que trabajamos: TECNA, Ingersoll Rand, FEIN, TOHNICHI, APEX, FIAM, SPEEDRILL y más. Productos originales y asesoramiento técnico.',
    canonica: RUTA_MARCAS,
  })

  return (
    <div className={styles.pagina}>
      <Migas />
      <header className={styles.cabeza}>
        <h1>Marcas con las que trabajamos</h1>
        <p className={styles.bajada}>
          Herramientas originales, con la garantía de cada fabricante. Elegí una marca para ver qué
          tenemos de ella en el catálogo.
        </p>
      </header>
      <ul className={styles.marcas}>
        {marcas.map((m) => (
          <li key={m.slug}>
            <Link to={rutaMarca(m.slug ?? '')} className={styles.marca}>
              <strong>{m.nombre}</strong>
              <span>{fmt(m.cuantos)} productos</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** `/marcas/:marca`: qué es la marca, en qué categorías está y algunos productos. */
export function MarcaPage() {
  const { marca = '' } = useParams<{ marca: string }>()
  const qF = useQuery({
    queryKey: ['catalogo-publico', 'marca', marca, 'facetas'],
    queryFn: () => facetas({ marca }),
    staleTime: 10 * 60_000,
  })
  const qL = useQuery({
    queryKey: ['catalogo-publico', 'marca', marca, 'productos'],
    queryFn: () => listar({ marca, pagina: 1, porPagina: 100 }),
    staleTime: 10 * 60_000,
  })

  const nombre = qF.data?.marcas.find((m) => m.slug === marca)?.nombre ?? marca.toUpperCase()
  const total = qF.data?.total ?? 0
  const categorias = (qF.data?.categorias ?? []).filter((c) => c.cuantos > 0)
  const texto = textoDeMarca(
    marca,
    nombre,
    total,
    categorias.map((c) => c.nombre),
  )
  // Los que tienen foto primero: la página de una marca es una vidriera, y el
  // catálogo los trae por nombre, con los sin foto mezclados adelante.
  const productos = [...(qL.data?.productos ?? [])]
    .sort((a, b) => Number(miniDeFoto(b) !== null) - Number(miniDeFoto(a) !== null))
    .slice(0, 24)

  useMeta({
    titulo: `${nombre}: herramientas en Argentina | ${NOMBRE_SITIO}`,
    descripcion: recortar(`${nombre}. ${texto.bajada} Consultá precio y disponibilidad.`, LARGO_DESCRIPCION),
    canonica: rutaMarca(marca),
  })

  const verTodos = `${rutaCatalogo()}?marca=${encodeURIComponent(marca)}`

  return (
    <div className={styles.pagina}>
      <Migas marca={nombre} />
      <header className={styles.cabeza}>
        <h1>{nombre}</h1>
        <p className={styles.bajada}>{texto.bajada}</p>
      </header>

      <div className={styles.texto}>
        {texto.parrafos.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>

      {categorias.length > 0 ? (
        <section className={styles.seccion} aria-labelledby="titulo-cats">
          <h2 id="titulo-cats">{nombre} por categoría</h2>
          <ul className={styles.chips}>
            {categorias.map((c) => (
              <li key={c.slug ?? c.nombre}>
                <Link
                  to={`${rutaCategoria(c.slug ?? '')}?marca=${encodeURIComponent(marca)}`}
                  className={styles.chip}
                >
                  {c.nombre} <span>{fmt(c.cuantos)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {productos.length > 0 ? (
        <section className={styles.seccion} aria-labelledby="titulo-prod">
          <h2 id="titulo-prod">Productos {nombre}</h2>
          <ul className={styles.grilla}>
            {productos.map((p) => (
              <li key={p.slug}>
                <TarjetaProducto producto={p} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className={styles.acciones}>
        <Link to={verTodos} className={styles.botonPrimario}>
          <Icon name="search" size={20} aria-hidden="true" />
          Ver {total > 0 ? `los ${fmt(total)} productos` : 'todos los productos'} de {nombre}
        </Link>
        <Link to={RUTA_MARCAS} className={styles.botonSecundario}>
          Otras marcas
        </Link>
      </div>
    </div>
  )
}
