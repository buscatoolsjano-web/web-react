import { Link } from 'react-router-dom'
import { Icon } from '@/components/icons/Icon'
import type { ProductoPublicoResumen } from '../services/catalogoPublico'
import { urlDeFoto } from '../services/catalogoPublico'
import { rutaProductoPublico } from '../lib/rutas'
import styles from './TarjetaProducto.module.css'

/**
 * Un producto en la grilla pública (Fase 87 · E2).
 *
 * ── QUÉ LLEVA, Y QUÉ NO ─────────────────────────────────────────────────────
 *
 * Foto, nombre, marca y código. No hay precio ni stock, y no es que estén
 * ocultos: no vienen en la respuesta. Lo que ocupa ese lugar es el rasgo que
 * distingue al producto de sus hermanos —la serie y el tipo—, que en un
 * catálogo de ocho mil puntas es lo único que permite elegir de un vistazo.
 *
 * ── LA TARJETA ENTERA ES EL ENLACE ──────────────────────────────────────────
 *
 * Un `<a>` que envuelve todo y no un botón con un `onClick`: así el enlace se
 * puede abrir en otra pestaña, copiar, y lo sigue un buscador. En un sitio
 * hecho para ser indexado, cada tarjeta es un camino hacia una ficha, y un
 * camino que sólo existe si alguien hace clic con el mouse no es un camino.
 */
export function TarjetaProducto({ producto: p }: { producto: ProductoPublicoResumen }) {
  const foto = urlDeFoto(p)
  const detalle = [p.serie, p.tipo].filter((x) => x !== null && x !== '').join(' · ')

  return (
    <Link to={rutaProductoPublico(p.categoriaSlug, p.slug)} className={styles.tarjeta}>
      <div className={styles.foto}>
        {foto ? (
          <img
            src={foto}
            alt={p.imagenAlt ?? p.nombre}
            /* `lazy` y las medidas puestas: la grilla trae veinticuatro fotos
               de otro dominio, y sin alto declarado la página salta entera
               cada vez que entra una. */
            loading="lazy"
            decoding="async"
            width={240}
            height={240}
          />
        ) : (
          <span className={styles.sinFoto} aria-hidden="true">
            <Icon name="image" size={24} />
          </span>
        )}
      </div>

      <div className={styles.datos}>
        {p.marca ? <span className={styles.marca}>{p.marca}</span> : null}
        <span className={styles.nombre}>{p.nombre}</span>
        {detalle !== '' ? <span className={styles.detalle}>{detalle}</span> : null}
        <span className={styles.sku}>{p.sku}</span>
      </div>
    </Link>
  )
}
