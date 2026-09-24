import { useState } from 'react'
import { Icon } from '@/components/icons/Icon'
import type { ImagenProducto as Imagen } from '../types'
import styles from './ImagenProducto.module.css'

export interface ImagenProductoProps {
  imagen: Imagen | null
  alt: string
  /** 'thumb' usa la miniatura verificada si existe; 'full' siempre el original. */
  tamano?: 'thumb' | 'full'
  /**
   * 'eager' para listas cortas que se ven enteras —las 25 filas de un modal—:
   * ahí `lazy` no ahorra nada y deja la columna en blanco hasta que el
   * navegador decide que el elemento "entró" en pantalla, cosa que no siempre
   * pasa adentro de un contenedor con scroll propio.
   */
  prioridad?: 'lazy' | 'eager'
  className?: string | undefined
}

/**
 * Imagen de producto con degradación en tres pasos.
 *
 * El orden es el que aprobamos y no se puede relajar:
 *
 *   1. miniatura VERIFICADA, si existe;
 *   2. si no, el original;
 *   3. si el original falla, placeholder.
 *
 * `thumbUrl` sólo viene poblada cuando la verificación offline la encontró
 * con HTTP 200. Nunca se deriva reescribiendo el nombre del archivo: medido
 * sobre las 3.317 URLs reales, el 46 % de las de WordPress no tiene
 * miniatura y las de apexbits no tienen ninguna. Derivarla a ciegas dejaría
 * rota la mitad de las imágenes.
 *
 * Sin imagen se ve un ícono propio (decorativo, `aria-hidden`) y el texto
 * «Sin imagen» queda para lectores de pantalla. Antes era el glifo `▣`, con
 * contraste bajo y sin semántica.
 *
 * La caja tiene proporción fija por CSS, así que el alto está reservado
 * antes de que la imagen cargue y el listado no salta (CLS).
 */
export function ImagenProducto({ imagen, alt, tamano = 'thumb', prioridad = 'lazy', className }: ImagenProductoProps) {
  const [falloOriginal, setFalloOriginal] = useState(false)
  const [falloMiniatura, setFalloMiniatura] = useState(false)

  const usarMiniatura = tamano === 'thumb' && imagen?.thumbUrl !== null && !falloMiniatura
  const src = imagen === null ? null : usarMiniatura ? imagen.thumbUrl : imagen.url

  if (src === null || falloOriginal) {
    return (
      <div className={[styles.caja, styles.vacia, className].filter(Boolean).join(' ')}>
        <Icon name="image" size={tamano === 'full' ? 32 : 20} className={styles.icono} />
        <span className="sr-only">Sin imagen</span>
      </div>
    )
  }

  return (
    <div className={[styles.caja, className].filter(Boolean).join(' ')}>
      <img
        className={styles.img}
        src={src}
        alt={alt}
        loading={prioridad}
        decoding="async"
        onError={() => {
          // Si falla la miniatura se prueba el original; si falla el
          // original, placeholder. No se reintenta en bucle.
          if (usarMiniatura) setFalloMiniatura(true)
          else setFalloOriginal(true)
        }}
      />
    </div>
  )
}
