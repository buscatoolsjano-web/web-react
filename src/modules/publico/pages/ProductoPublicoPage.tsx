import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Spinner } from '@/components/ui/Spinner'
import { Icon } from '@/components/icons/Icon'
import { TarjetaProducto } from '../components/TarjetaProducto'
import { producto as pedirProducto, urlDeFoto } from '../services/catalogoPublico'
import { conBarraFinal, rutaCanonica, rutaCatalogo, rutaCategoria, rutaProductoPublico } from '../lib/rutas'
import { useMeta } from '../hooks/useMeta'
import { useCarritoPublico } from '../hooks/useCarritoPublico'
import {
  altDeImagen,
  datosEstructurados,
  descripcionDeProducto,
  nombreDeAtributo,
  tituloDeProducto,
  valorLegible,
} from '../lib/seo'
import { tambienBuscadoComo } from '../lib/sinonimos'
import styles from './ProductoPublicoPage.module.css'

/**
 * La ficha pública de un producto (Fase 87 · E2).
 *
 * ── ES LA PÁGINA QUE IMPORTA ────────────────────────────────────────────────
 *
 * Son nueve mil, una por producto, y son las que van a aparecer en el
 * buscador: nadie busca «catálogo de herramientas», buscan «punta phillips 2
 * de 50 mm». Todo lo demás del sitio existe para que estas páginas se
 * encuentren y se entiendan.
 *
 * Por eso tiene tres cosas que una ficha interna no necesita: el título y la
 * descripción armados con lo que distingue a ESTE producto, los datos
 * estructurados que le dicen al buscador que esto es un producto y no un
 * texto, y los relacionados, que son los que hacen que la visita siga.
 *
 * ── SIN PRECIO NI STOCK ─────────────────────────────────────────────────────
 *
 * No están ocultos: no vienen. Y en su lugar va lo que sí se puede decir, que
 * es «consultá»: una ficha que no dice qué hacer después es una visita
 * perdida.
 */
export function ProductoPublicoPage() {
  const { categoria = '', producto: slug = '' } = useParams<{
    categoria: string
    producto: string
  }>()

  const carrito = useCarritoPublico()
  const navigate = useNavigate()

  const q = useQuery({
    queryKey: ['catalogo-publico', 'producto', slug],
    queryFn: () => pedirProducto(slug),
    staleTime: 30 * 60_000,
  })

  const p = q.data?.producto ?? null
  // Con barra final: es la forma canónica, la que GitHub sirve con 200 desde
  // el HTML prerenderizado. Ver `conBarraFinal`.
  const canonica = p ? conBarraFinal(rutaProductoPublico(p.categoriaSlug, p.slug)) : rutaCatalogo()
  const foto = p ? urlDeFoto(p) : null

  useMeta(
    p
      ? {
          titulo: tituloDeProducto(p),
          descripcion: descripcionDeProducto(p),
          canonica,
          imagen: foto,
          datos: datosEstructurados(
            { ...p, imagen: foto },
            `${typeof window === 'undefined' ? '' : window.location.origin}${canonica}`,
          ),
        }
      : null,
  )

  if (q.isPending) {
    return (
      <div className={styles.centrado} role="status">
        <Spinner size={24} />
      </div>
    )
  }

  if (q.isError) {
    return <p className={styles.aviso}>No pudimos cargar el producto. Probá de nuevo en un rato.</p>
  }

  if (!q.data || !p) {
    return (
      <div className={styles.aviso}>
        <h1 className={styles.titulo}>No encontramos ese producto</h1>
        <p>
          Puede que lo hayamos dado de baja o que el enlace esté mal.{' '}
          <Link to={rutaCatalogo()}>Ver todo el catálogo</Link>.
        </p>
      </div>
    )
  }

  /*
   * Si llegaron con la categoría equivocada, se corrige.
   *
   * La base encuentra la ficha sólo con el slug, así que
   * `/productos/balanceadores/speedrill-ph2-phillips` también funcionaría. Si
   * eso se dejara pasar, el mismo producto tendría tantas direcciones como
   * categorías haya, y un buscador que ve el mismo contenido en ocho lugares
   * reparte el crédito entre los ocho.
   */
  const correcta = rutaCanonica({ categoria, producto: slug }, p)
  if (correcta !== null) return <Navigate to={correcta} replace />

  // Lo que se guarda en la lista: el SKU, el nombre y por dónde volver. Sin
  // ningún id interno, que ni siquiera llega hasta acá.
  const item = {
    sku: p.sku,
    slug: p.slug,
    categoriaSlug: p.categoriaSlug,
    nombre: p.nombre,
    imagen: foto,
  }
  const enLista = carrito.cantidadDe(p.sku)
  const tambienBuscado = tambienBuscadoComo(p)

  const atributos = Object.entries(p.atributos ?? {})
    .map(([clave, valor]) => [nombreDeAtributo(clave), valorLegible(valor)] as const)
    .filter(([, valor]) => valor !== '')

  return (
    <article className={styles.pagina}>
      {/* Volver a la lista de donde se vino, con sus filtros intactos. */}
      <button type="button" className={styles.volver} onClick={() => void navigate(-1)}>
        <Icon name="chevron-left" size={16} aria-hidden="true" />
        Volver
      </button>
      <nav className={styles.migaja} aria-label="Dónde estás">
        <Link to={rutaCatalogo()}>Catálogo</Link>
        <span aria-hidden="true"> › </span>
        <Link to={rutaCategoria(p.categoriaSlug)}>{p.categoria}</Link>
      </nav>

      <div className={styles.ficha}>
        <div className={styles.foto}>
          {foto ? (
            <img src={foto} alt={p.imagenAlt ?? altDeImagen(p)} width={520} height={520} />
          ) : (
            <span className={styles.sinFoto} aria-hidden="true">
              <Icon name="image" size={32} />
            </span>
          )}
        </div>

        <div className={styles.datos}>
          {p.marca ? <p className={styles.marca}>{p.marca}</p> : null}
          <h1 className={styles.titulo}>{p.nombre}</h1>
          <p className={styles.sku}>{p.sku}</p>

          {p.descripcion ? <p className={styles.descripcion}>{p.descripcion}</p> : null}

          {/* Los otros nombres del producto, visibles y verdaderos: ayudan a
              quien no sabe el termino tecnico y hacen que la ficha aparezca al
              buscar «dado» o «boca de llave» (Fase 88 · SEO). */}
          {tambienBuscado !== '' ? <p className={styles.tambien}>{tambienBuscado}</p> : null}

          {atributos.length > 0 ? (
            <dl className={styles.atributos}>
              {atributos.map(([nombre, valor]) => (
                <div key={nombre}>
                  <dt>{nombre}</dt>
                  <dd>{valor}</dd>
                </div>
              ))}
              {p.origen ? (
                <div>
                  <dt>Origen</dt>
                  <dd>{p.origen}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}

          {/*
            Lo que ocupa el lugar del precio.
            Una ficha que no dice qué hacer después es una visita perdida, y
            acá no se puede decir «comprar» porque no hay precio publicado.
          */}
          <div className={styles.consulta}>
            <p className={styles.consultaTexto}>
              Los precios y la disponibilidad los informamos a pedido, según cantidad.
            </p>

            {/*
              Agregar a la lista en vez de «comprar»: no hay precio publicado,
              así que lo que se arma acá es una consulta, no un pedido. Y el
              botón cambia de texto una vez agregado —con el enlace para ir a
              pedirla— porque si no, quien agregó tres productos no tiene
              ninguna señal de que algo pasó.
            */}
            {enLista > 0 ? (
              <div className={styles.yaEsta}>
                <span className={styles.yaEstaTexto}>
                  <Icon name="check" size={16} aria-hidden="true" />
                  {enLista === 1 ? 'Agregado a tu lista' : `${enLista} en tu lista`}
                </span>
                <div className={styles.yaEstaAcciones}>
                  <button type="button" className={styles.botonSecundario} onClick={() => carrito.agregar(item)}>
                    Agregar otro
                  </button>
                  <Link to="/cotizar" className={styles.boton}>
                    Pedir cotización
                  </Link>
                </div>
              </div>
            ) : (
              <button type="button" className={styles.boton} onClick={() => carrito.agregar(item)}>
                <Icon name="cart" size={16} aria-hidden="true" />
                Agregar a mi consulta
              </button>
            )}
          </div>
        </div>
      </div>

      {q.data.relacionados.length > 0 ? (
        <section className={styles.relacionados}>
          <h2 className={styles.subtitulo}>
            {p.serie ? `Más de la serie ${p.serie}` : `Más de ${p.categoria}`}
          </h2>
          <ul className={styles.grilla}>
            {q.data.relacionados.map((r) => (
              <li key={r.slug}>
                <TarjetaProducto producto={r} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  )
}
