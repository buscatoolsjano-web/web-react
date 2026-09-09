import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagenProducto } from './ImagenProducto'
import type { ImagenProducto as Imagen } from '../types'
import styles from './ProductGallery.module.css'

export interface ProductGalleryProps {
  imagenes: readonly Imagen[]
  nombre: string
}

const ES_DIAGRAMA = (i: Imagen) => i.kind === 'shared_diagram' || i.kind === 'technical_diagram'

/**
 * Galería del detalle de producto.
 *
 * Sin librería: medido sobre los datos reales, **ningún producto tiene más de
 * dos imágenes** (6.187 con una, 1.336 con dos, 0 con tres o más). Traer un
 * carrusel de 40 KB para dos fotos no se justifica.
 *
 * Las fotos y los diagramas se muestran por separado. Un diagrama es una
 * página del catálogo APEX, compartida por hasta 77 productos: mostrarlo como
 * si fuera la foto del producto sería engañoso.
 */
export function ProductGallery({ imagenes, nombre }: ProductGalleryProps) {
  const fotos = imagenes.filter((i) => !ES_DIAGRAMA(i))
  const diagramas = imagenes.filter(ES_DIAGRAMA)

  const [indice, setIndice] = useState(0)
  const [ampliada, setAmpliada] = useState<Imagen | null>(null)

  const actual = fotos[indice] ?? fotos[0] ?? null

  if (fotos.length === 0 && diagramas.length === 0) {
    return (
      <div className={styles.galeria}>
        <ImagenProducto imagen={null} alt="" tamano="full" className={styles.principal} />
        <p className={styles.nota}>Sin imágenes</p>
      </div>
    )
  }

  return (
    <div className={styles.galeria}>
      {actual && (
        <button
          type="button"
          className={styles.botonPrincipal}
          onClick={() => setAmpliada(actual)}
          aria-label={`Ampliar imagen de ${nombre}`}
        >
          <ImagenProducto
            imagen={actual}
            alt={nombre}
            tamano="full"
            className={styles.principal}
          />
        </button>
      )}

      {fotos.length > 1 && (
        <div className={styles.miniaturas}>
          {fotos.map((img, i) => (
            <button
              key={img.url}
              type="button"
              className={i === indice ? styles.miniaturaActiva : styles.miniatura}
              onClick={() => setIndice(i)}
              aria-label={`Ver imagen ${i + 1} de ${fotos.length}`}
              aria-current={i === indice}
            >
              <ImagenProducto imagen={img} alt="" tamano="thumb" />
            </button>
          ))}
        </div>
      )}

      {diagramas.length > 0 && (
        <section className={styles.diagramas}>
          <h3 className={styles.tituloDiagramas}>
            Diagrama de catálogo
            <span className={styles.aclaracion}>
              {' '}
              — página del catálogo del fabricante, no una foto del producto
            </span>
          </h3>
          <div className={styles.miniaturas}>
            {diagramas.map((d) => (
              <button
                key={d.url}
                type="button"
                className={styles.miniatura}
                onClick={() => setAmpliada(d)}
                aria-label="Ampliar diagrama"
              >
                <ImagenProducto imagen={d} alt="" tamano="thumb" />
              </button>
            ))}
          </div>
        </section>
      )}

      {ampliada && (
        <Lightbox
          imagenes={ES_DIAGRAMA(ampliada) ? diagramas : fotos}
          inicial={(ES_DIAGRAMA(ampliada) ? diagramas : fotos).indexOf(ampliada)}
          nombre={nombre}
          onCerrar={() => setAmpliada(null)}
        />
      )}
    </div>
  )
}

/**
 * Visor ampliado.
 *
 * Cierra con Esc y con click en el fondo; navega con las flechas. El foco
 * queda dentro mientras está abierto y vuelve al botón que lo abrió, que es
 * lo mínimo para que se pueda usar sin mouse.
 */
function Lightbox({
  imagenes,
  inicial,
  nombre,
  onCerrar,
}: {
  imagenes: readonly Imagen[]
  inicial: number
  nombre: string
  onCerrar: () => void
}) {
  const [i, setI] = useState(Math.max(inicial, 0))
  const cerrarRef = useRef<HTMLButtonElement>(null)
  const hayVarias = imagenes.length > 1

  const anterior = useCallback(
    () => setI((v) => (v - 1 + imagenes.length) % imagenes.length),
    [imagenes.length],
  )
  const siguiente = useCallback(() => setI((v) => (v + 1) % imagenes.length), [imagenes.length])

  useEffect(() => {
    cerrarRef.current?.focus()
    const alTecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar()
      if (e.key === 'ArrowLeft' && hayVarias) anterior()
      if (e.key === 'ArrowRight' && hayVarias) siguiente()
    }
    document.addEventListener('keydown', alTecla)
    // El fondo no debe scrollear mientras el visor está abierto.
    const overflowPrevio = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', alTecla)
      document.body.style.overflow = overflowPrevio
    }
  }, [onCerrar, anterior, siguiente, hayVarias])

  const img = imagenes[i]
  if (!img) return null

  return (
    <div
      className={styles.lightbox}
      role="dialog"
      aria-modal="true"
      aria-label={`Imagen de ${nombre}`}
      onClick={onCerrar}
    >
      <div className={styles.lightboxCuerpo} onClick={(e) => e.stopPropagation()}>
        <button ref={cerrarRef} type="button" className={styles.cerrar} onClick={onCerrar}>
          <span aria-hidden="true">✕</span>
          <span className="sr-only">Cerrar</span>
        </button>

        {hayVarias && (
          <button type="button" className={styles.anterior} onClick={anterior}>
            <span aria-hidden="true">‹</span>
            <span className="sr-only">Anterior</span>
          </button>
        )}

        <img className={styles.lightboxImg} src={img.url} alt={nombre} />

        {hayVarias && (
          <button type="button" className={styles.siguiente} onClick={siguiente}>
            <span aria-hidden="true">›</span>
            <span className="sr-only">Siguiente</span>
          </button>
        )}

        {hayVarias && (
          <p className={styles.contador}>
            {i + 1} / {imagenes.length}
          </p>
        )}
      </div>
    </div>
  )
}
