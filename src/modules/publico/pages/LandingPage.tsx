import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { categorias, listar } from '../services/catalogoPublico'
import { TarjetaProducto } from '../components/TarjetaProducto'
import { rutaCatalogo, rutaCategoria } from '../lib/rutas'
import { useMeta } from '../hooks/useMeta'
import styles from './LandingPage.module.css'

/**
 * La portada (Fase 87 · E2).
 *
 * ── PARA QUIÉN ES ───────────────────────────────────────────────────────────
 *
 * Para alguien que buscó «puntas para atornillador industrial» y cayó acá sin
 * saber quiénes somos. Tiene que entender en cinco segundos qué vendemos, y
 * en diez tiene que estar mirando productos. Todo lo que no sirva para eso
 * sobra.
 *
 * ── LAS PALABRAS NO SON RELLENO ─────────────────────────────────────────────
 *
 * El texto de arriba dice «puntas, tubos, embocaduras, balanceadores,
 * atornilladores, llaves de impacto» porque ÉSAS son las palabras que la
 * gente escribe en el buscador. Un título que diga «soluciones integrales
 * para la industria» no lo busca nadie: suena a folleto y no contiene ni una
 * palabra por la que se pueda encontrar.
 *
 * Y las ocho categorías con su cantidad real son el otro motivo: son ocho
 * enlaces con texto descriptivo desde la página más importante del sitio,
 * que es lo que hace que las ocho se descubran.
 */
export function LandingPage() {
  const qCategorias = useQuery({
    queryKey: ['catalogo-publico', 'categorias'],
    queryFn: categorias,
    staleTime: 60 * 60_000,
  })

  // Una muestra, para que la portada tenga productos de verdad y no sólo
  // cajas de texto. La primera página alcanza: es una vidriera, no un
  // listado.
  const qMuestra = useQuery({
    queryKey: ['catalogo-publico', 'listar', null, '', 1],
    queryFn: () => listar({ porPagina: 12 }),
    staleTime: 30 * 60_000,
  })

  const total = (qCategorias.data ?? []).reduce((n, c) => n + c.productos, 0)

  useMeta({
    titulo: 'Herramientas industriales para montaje y torque | Buscatools',
    descripcion:
      'Puntas, tubos, embocaduras, balanceadores, atornilladores y llaves de impacto. ' +
      'Importación directa de las marcas que usa la industria. Consultá precio y stock.',
    canonica: '/',
  })

  return (
    <div className={styles.pagina}>
      <section className={styles.hero}>
        <h1 className={styles.titulo}>
          Herramientas industriales para <strong>montaje, torque y ensamblaje</strong>
        </h1>
        <p className={styles.bajada}>
          Puntas, tubos y embocaduras, balanceadores, atornilladores, llaves de impacto y llaves
          dinamométricas. Importamos directo las marcas que ya usa tu línea de producción y
          entregamos en todo el país.
        </p>
        <div className={styles.acciones}>
          <Link to={rutaCatalogo()} className={styles.boton}>
            Ver el catálogo
            {total > 0 ? <span className={styles.botonCuantos}>{total.toLocaleString('es-AR')}</span> : null}
          </Link>
          <a className={styles.botonSecundario} href="mailto:info@buscatools.com.ar">
            Pedir asesoramiento
          </a>
        </div>
      </section>

      <section className={styles.seccion} aria-labelledby="categorias">
        <h2 id="categorias" className={styles.subtitulo}>
          Qué tenemos
        </h2>
        <ul className={styles.categorias}>
          {(qCategorias.data ?? []).map((c) => (
            <li key={c.slug}>
              <Link to={rutaCategoria(c.slug)} className={styles.categoria}>
                <span className={styles.categoriaNombre}>{c.nombre}</span>
                <span className={styles.categoriaCuantos}>
                  {c.productos.toLocaleString('es-AR')} productos
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {(qMuestra.data?.productos.length ?? 0) > 0 ? (
        <section className={styles.seccion} aria-labelledby="destacados">
          <div className={styles.encabezadoSeccion}>
            <h2 id="destacados" className={styles.subtitulo}>
              Del catálogo
            </h2>
            <Link to={rutaCatalogo()} className={styles.verTodo}>
              Ver todo →
            </Link>
          </div>
          <ul className={styles.grilla}>
            {(qMuestra.data?.productos ?? []).map((p) => (
              <li key={p.slug}>
                <TarjetaProducto producto={p} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={styles.porque} aria-labelledby="porque">
        <h2 id="porque" className={styles.subtitulo}>
          Por qué comprarnos
        </h2>
        <ul className={styles.razones}>
          <li>
            <strong>Importación directa.</strong> Traemos de fábrica, sin intermediarios: el mismo
            producto que usa tu línea, al costo que corresponde.
          </li>
          <li>
            <strong>Stock real en Argentina.</strong> Lo que está disponible se entrega, no se
            encarga. Consultanos por cantidades.
          </li>
          <li>
            <strong>Te ayudamos a elegir.</strong> Encastre, medida, largo y torque: si no sabés
            cuál necesitás, decinos qué estás armando.
          </li>
        </ul>
      </section>
    </div>
  )
}
