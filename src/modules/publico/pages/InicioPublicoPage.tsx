import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '@/components/icons/Icon'
import { claveCategorias, claveFacetas, leerFiltros, pedirFacetas } from '../lib/consulta'
import { rutaCatalogo, rutaCategoria } from '../lib/rutas'
import { NOMBRE_SITIO } from '../lib/seo'
import { useMeta } from '../hooks/useMeta'
import { categorias, destacados, miniDeFoto, type CategoriaPublica } from '../services/catalogoPublico'
import { TarjetaProducto } from '../components/TarjetaProducto'
import { PREGUNTAS, PASOS, INDUSTRIAS, WHATSAPP_INICIO } from '../lib/inicio'
import fotosGuia from '../lib/fotosDeOpcion.generated.json'
import styles from './InicioPublicoPage.module.css'

/** Los filtros vacíos: las MISMAS claves que adelanta el layout en `/`. */
const SIN_FILTROS = leerFiltros(new URLSearchParams(), undefined)

/** Cuántos productos muestra la vidriera. */
const VIDRIERA = 8

const fmt = (n: number) => n.toLocaleString('es-AR')

/** Una marca que no es marca: no se ofrece ni se cuenta. */
const esGenerica = (nombre: string) => /^gen[eé]ric[oa]s?$/i.test(nombre.trim())

/**
 * La foto de una categoría: la portada que eligió un admin o, si no hay, la de
 * la guía de filtros (la misma regla que `GuiaFiltros`).
 */
function fotoDe(c: CategoriaPublica): string | null {
  const guia = (fotosGuia as Record<string, { portada?: string }>)[c.fotoSlug ?? c.slug]?.portada
  return c.portadaUrl ?? guia ?? null
}

/**
 * La portada del sitio público.
 *
 * Hasta acá la raíz ERA el catálogo. Funcionaba para quien ya sabía qué
 * buscaba, pero no le decía a nadie quiénes somos, qué hacemos ni por qué
 * consultarnos, y para el buscador era una tabla sin contexto. Ahora la raíz
 * cuenta eso —con un hero, las categorías, cómo trabajamos, marcas, industrias
 * y preguntas frecuentes— y el catálogo vive en `/productos`, a un clic.
 *
 * Todos los números salen del catálogo (productos, marcas, categorías): no se
 * afirma nada que no se pueda sostener.
 */
export function InicioPublicoPage() {
  const qCats = useQuery({ queryKey: claveCategorias, queryFn: categorias, staleTime: 60 * 60_000 })
  const qFacetas = useQuery({
    queryKey: claveFacetas(SIN_FILTROS),
    queryFn: () => pedirFacetas(SIN_FILTROS),
    staleTime: 5 * 60_000,
  })
  /*
   * La vidriera: dos productos CON foto de cada categoría, elegidos por la base
   * (`catalogo_publico_destacados`). Pedirle a cada categoría su primera página
   * no servía: el catálogo ordena por nombre, y en varias categorías los
   * primeros no tienen foto; y la del catálogo entero son todas puntas iguales.
   */
  const qVidriera = useQuery({
    queryKey: ['catalogo-publico', 'destacados'],
    queryFn: destacados,
    staleTime: 10 * 60_000,
  })

  const cats = qCats.data ?? []
  const marcas = (qFacetas.data?.marcas ?? []).filter((m) => m.slug && !esGenerica(m.nombre))
  const total = qFacetas.data?.total ?? cats.reduce((s, c) => s + c.productos, 0)
  const vidriera = (qVidriera.data ?? []).filter((p) => miniDeFoto(p) !== null).slice(0, VIDRIERA)
  const collage = cats
    .map((c) => ({ c, foto: fotoDe(c) }))
    .filter((x): x is { c: CategoriaPublica; foto: string } => x.foto !== null)
    .slice(0, 4)

  useMeta({
    titulo: `Herramientas industriales de montaje y torque | ${NOMBRE_SITIO}`,
    descripcion:
      'Atornilladores, balanceadores, puntas, tubos, llaves de impacto y dinamométricas para la industria. Asesoramiento técnico, factura A o B y envíos a todo el país.',
    canonica: '/',
    datos: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          name: NOMBRE_SITIO,
          url: 'https://app.buscatools.com/',
          email: 'info@buscatools.com.ar',
          telephone: '+54 9 11 2169-3304',
          areaServed: 'AR',
        },
        {
          '@type': 'FAQPage',
          mainEntity: PREGUNTAS.map((p) => ({
            '@type': 'Question',
            name: p.pregunta,
            acceptedAnswer: { '@type': 'Answer', text: p.respuesta },
          })),
        },
      ],
    },
  })

  return (
    <div className={styles.inicio}>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className={styles.hero} aria-labelledby="titulo-inicio">
        <div className={styles.heroTexto}>
          <p className={styles.kicker}>Importación y distribución de herramientas industriales</p>
          <h1 id="titulo-inicio" className={styles.heroTitulo}>
            Herramientas de montaje y torque para tu línea de producción
          </h1>
          <p className={styles.heroBajada}>
            Atornilladores, balanceadores, puntas, tubos, llaves de impacto y dinamométricas de las
            marcas que usa la industria. Te ayudamos a elegir la herramienta justa y te la enviamos a
            cualquier punto del país.
          </p>
          <div className={styles.heroAcciones}>
            <Link to={rutaCatalogo()} className={styles.botonPrimario}>
              <Icon name="search" size={20} aria-hidden="true" />
              Ver el catálogo
            </Link>
            <a href={WHATSAPP_INICIO} target="_blank" rel="noopener noreferrer" className={styles.botonSecundario}>
              <Icon name="message-circle" size={20} aria-hidden="true" />
              Consultar por WhatsApp
            </a>
          </div>
          <ul className={styles.confianza}>
            <li>
              <Icon name="check" size={16} aria-hidden="true" /> Respuesta en el día hábil
            </li>
            <li>
              <Icon name="check" size={16} aria-hidden="true" /> Factura A o B
            </li>
            <li>
              <Icon name="check" size={16} aria-hidden="true" /> Envíos a todo el país
            </li>
            <li>
              <Icon name="check" size={16} aria-hidden="true" /> Asesoramiento técnico
            </li>
          </ul>
        </div>

        {collage.length > 0 ? (
          <div className={styles.collage} aria-hidden="true">
            {collage.map(({ c, foto }, i) => (
              <Link key={c.slug} to={rutaCategoria(c.slug)} className={styles.collageCelda} tabIndex={-1}>
                <img
                  src={foto}
                  alt=""
                  width={240}
                  height={240}
                  // Las del hero se ven apenas carga la página: se piden ya.
                  fetchPriority={i < 2 ? 'high' : 'auto'}
                  decoding="async"
                />
                <span>{c.nombre}</span>
              </Link>
            ))}
          </div>
        ) : null}
      </section>

      {/* ── Números ──────────────────────────────────────────────────────── */}
      <section className={styles.numeros} aria-label="El catálogo en números">
        <div>
          <strong>{total > 0 ? fmt(total) : '—'}</strong>
          <span>productos en catálogo</span>
        </div>
        <div>
          <strong>{marcas.length > 0 ? marcas.length : '—'}</strong>
          <span>marcas</span>
        </div>
        <div>
          <strong>{cats.length > 0 ? cats.length : '—'}</strong>
          <span>categorías</span>
        </div>
        <div>
          <strong>
            <Icon name="truck" size={24} aria-hidden="true" />
          </strong>
          <span>envíos a todo el país</span>
        </div>
      </section>

      {/* ── Categorías ───────────────────────────────────────────────────── */}
      <section className={styles.seccion} aria-labelledby="titulo-categorias">
        <div className={styles.encabezado}>
          <h2 id="titulo-categorias">Qué podés encontrar</h2>
          <Link to={rutaCatalogo()} className={styles.verTodo}>
            Ver todo el catálogo <Icon name="chevron-right" size={16} aria-hidden="true" />
          </Link>
        </div>
        <ul className={styles.categorias}>
          {cats.map((c) => (
            <li key={c.slug}>
              <Link to={rutaCategoria(c.slug)} className={styles.categoria}>
                <span className={styles.categoriaFoto}>
                  {fotoDe(c) ? (
                    <img src={fotoDe(c) ?? ''} alt="" width={160} height={160} loading="lazy" decoding="async" />
                  ) : (
                    <Icon name="image" size={32} aria-hidden="true" />
                  )}
                </span>
                <span className={styles.categoriaNombre}>{c.nombre}</span>
                <span className={styles.categoriaCuantos}>{fmt(c.productos)} productos</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Cómo trabajamos ──────────────────────────────────────────────── */}
      <section className={`${styles.seccion} ${styles.fondoSuave}`} aria-labelledby="titulo-pasos">
        <h2 id="titulo-pasos">Cómo trabajamos</h2>
        <ol className={styles.pasos}>
          {PASOS.map((p, i) => (
            <li key={p.titulo} className={styles.paso}>
              <span className={styles.pasoNumero} aria-hidden="true">
                {i + 1}
              </span>
              <h3>{p.titulo}</h3>
              <p>{p.texto}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Destacados ───────────────────────────────────────────────────── */}
      {vidriera.length > 0 ? (
        <section className={styles.seccion} aria-labelledby="titulo-destacados">
          <div className={styles.encabezado}>
            <h2 id="titulo-destacados">Algunos productos del catálogo</h2>
            <Link to={rutaCatalogo()} className={styles.verTodo}>
              Ver los {total > 0 ? fmt(total) : ''} productos <Icon name="chevron-right" size={16} aria-hidden="true" />
            </Link>
          </div>
          <ul className={styles.vidriera}>
            {vidriera.map((p) => (
              <li key={p.slug}>
                <TarjetaProducto producto={p} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── Marcas ───────────────────────────────────────────────────────── */}
      {marcas.length > 0 ? (
        <section className={`${styles.seccion} ${styles.fondoSuave}`} aria-labelledby="titulo-marcas">
          <h2 id="titulo-marcas">Marcas con las que trabajamos</h2>
          <p className={styles.bajada}>
            Herramientas originales, con la garantía del fabricante. Tocá una marca para ver sus
            productos.
          </p>
          <ul className={styles.marcas}>
            {marcas.slice(0, 18).map((m) => (
              <li key={m.slug}>
                <Link to={`${rutaCatalogo()}?marca=${encodeURIComponent(m.slug ?? '')}`} className={styles.marca}>
                  {m.nombre}
                  <span>{fmt(m.cuantos)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── Industrias ───────────────────────────────────────────────────── */}
      <section className={styles.seccion} aria-labelledby="titulo-industrias">
        <h2 id="titulo-industrias">Para quién trabajamos</h2>
        <ul className={styles.industrias}>
          {INDUSTRIAS.map((i) => (
            <li key={i.titulo} className={styles.industria}>
              <Icon name={i.icono} size={24} aria-hidden="true" />
              <h3>{i.titulo}</h3>
              <p>{i.texto}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Preguntas frecuentes ─────────────────────────────────────────── */}
      <section className={`${styles.seccion} ${styles.fondoSuave}`} aria-labelledby="titulo-preguntas">
        <h2 id="titulo-preguntas">Preguntas frecuentes</h2>
        <div className={styles.preguntas}>
          {PREGUNTAS.map((p) => (
            <details key={p.pregunta} className={styles.pregunta}>
              <summary>{p.pregunta}</summary>
              <p>{p.respuesta}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ── Cierre ───────────────────────────────────────────────────────── */}
      <section className={styles.cierre} aria-labelledby="titulo-cierre">
        <h2 id="titulo-cierre">¿Estás armando una línea o necesitás reponer herramientas?</h2>
        <p>Contanos qué tenés que ajustar y te proponemos la herramienta, los accesorios y el precio.</p>
        <div className={styles.heroAcciones}>
          <a href={WHATSAPP_INICIO} target="_blank" rel="noopener noreferrer" className={styles.botonPrimario}>
            <Icon name="message-circle" size={20} aria-hidden="true" />
            Escribinos por WhatsApp
          </a>
          <Link to={rutaCatalogo()} className={styles.botonSecundario}>
            Explorar el catálogo
          </Link>
        </div>
      </section>
    </div>
  )
}
